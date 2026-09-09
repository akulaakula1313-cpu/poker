const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const DB=path.join(__dirname,'db.json'),PORT=3000;
function loadDB(){try{return JSON.parse(fs.readFileSync(DB,'utf8'))}catch(e){return{users:{},tables:{},sessions:{},hands:{}}}}
function saveDB(d){fs.writeFileSync(DB,JSON.stringify(d,null,2))}

const SUITS=['s','h','d','c'],RANKS=['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const RVAL={2:0,3:1,4:2,5:3,6:4,7:5,8:6,9:7,T:8,J:9,Q:10,K:11,A:12};
const HAND_NAMES=['High Card','One Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush','Royal Flush'];
const SUIT_SYMBOL={s:'♠',h:'♥',d:'♦',c:'♣'};
const RANK_DISPLAY={T:'10',J:'J',Q:'Q',K:'K',A:'A'};

function makeDeck(){const d=[];for(const s of SUITS)for(const r of RANKS)d.push(r+s);return d}
function shuffle(deck){const a=[...deck];for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}
function cardRank(c){return RVAL[c[0]]}
function cardSuit(c){return c[1]}
function cardDisplay(c){return(RANK_DISPLAY[c[0]]||c[0])+SUIT_SYMBOL[c[1]]}
function isRed(c){return c[1]==='h'||c[1]==='d'}

function eval5(cards){
  if(cards.length!==5)return null;
  const sorted=[...cards].sort((a,b)=>cardRank(b)-cardRank(a));
  const rv=sorted.map(cardRank),sv=sorted.map(cardSuit);
  const flush=sv.every(s=>s===sv[0]);
  let straight=false,straightHigh=0;
  const uniq=[...new Set(rv)].sort((a,b)=>b-a);
  if(uniq.length>=5){
    for(let i=0;i<=uniq.length-5;i++){
      if(uniq[i]-uniq[i+4]===4){straight=true;straightHigh=uniq[i];break}
    }
  }
  if(!straight&&uniq.length>=5){
    const hasA=rv.includes(12),has2=rv.includes(0),has3=rv.includes(1),has4=rv.includes(2),has5=rv.includes(3);
    if(hasA&&has2&&has3&&has4&&has5){straight=true;straightHigh=3}
  }
  const counts={};for(const r of rv)counts[r]=(counts[r]||0)+1;
  const groups=Object.entries(counts).map(([r,c])=>({rank:+r,count:c})).sort((a,b)=>b.count-a.count||b.rank-a.rank);
  const cats=groups.map(g=>g.count), kickers=groups.map(g=>g.rank);
  if(flush&&straight){
    if(straightHigh===12&&rv.includes(8))return{cat:9,tie:[12]};
    return{cat:8,tie:[straightHigh]};
  }
  if(cats[0]===4)return{cat:7,tie:[kickers[0],kickers[1]]};
  if(cats[0]===3&&cats[1]===2)return{cat:6,tie:[kickers[0],kickers[1]]};
  if(flush)return{cat:5,tie:rv};
  if(straight)return{cat:4,tie:[straightHigh]};
  if(cats[0]===3)return{cat:3,tie:[kickers[0],kickers[1],kickers[2]]};
  if(cats[0]===2&&cats[1]===2)return{cat:2,tie:[kickers[0],kickers[1],kickers[2]]};
  if(cats[0]===2)return{cat:1,tie:[kickers[0],kickers[1],kickers[2],kickers[3]]};
  return{cat:0,tie:rv};
}

function bestHand(cards){
  if(cards.length<5)return null;
  let best=null;
  const n=cards.length;
  for(let a=0;a<n-4;a++)for(let b=a+1;b<n-3;b++)for(let c=b+1;c<n-2;c++)for(let d=c+1;d<n-1;d++)for(let e=d+1;e<n;e++){
    const h=eval5([cards[a],cards[b],cards[c],cards[d],cards[e]]);
    if(!best||compareHands(h,best)>0)best=h;
  }
  return best;
}

function compareHands(a,b){
  if(a.cat!==b.cat)return a.cat-b.cat;
  for(let i=0;i<Math.min(a.tie.length,b.tie.length);i++){
    if(a.tie[i]!==b.tie[i])return a.tie[i]-b.tie[i];
  }
  return 0;
}

function rankName(cat){return HAND_NAMES[cat]||'Unknown'}

// ====== GAME STATE ======
let tableIdCounter=0;
const tables={};

function createTable(name,blinds,host){
  const id=String(++tableIdCounter);
  const sb=blinds[0],bb=blinds[1];
  tables[id]={id,name,seats:Array(10).fill(null),sb,bb,
    minBuyIn:bb*20,maxBuyIn:bb*200,
    state:'WAITING',handId:0,buttonSeat:-1,
    sbSeat:-1,bbSeat:-1,community:[],deck:[],
    currentStreet:'',currentBet:0,lastFullRaise:0,
    actorSeat:-1,pots:[],handLog:[],
    handPlayers:{},handHistory:[],
    lastActionTime:0,turnDeadline:0,
    streetBets:{},streetContrib:{}
  };
  return tables[id];
}

function getTablePlayers(t){
  const p=[];
  for(let i=0;i<10;i++)if(t.seats[i])p.push({seat:i,...t.seats[i]});
  return p;
}

function getActivePlayers(t){
  return getTablePlayers(t).filter(p=>p.status==='ACTIVE'||p.status==='ALL_IN');
}

function getActors(t){
  return getTablePlayers(t).filter(p=>(p.status==='ACTIVE')&&!p.folded);
}

function nextSeat(t,from){
  for(let i=1;i<=10;i++){
    const s=(from+i)%10;
    if(t.seats[s]&&(t.seats[s].status==='ACTIVE'||t.seats[s].status==='ALL_IN'))return s;
  }
  return-1;
}

function advanceButton(t){
  const occupied=[];
  for(let i=0;i<10;i++)if(t.seats[i])occupied.push(i);
  if(occupied.length<2)return;
  const active=[];
  for(let i=0;i<10;i++)if(t.seats[i]&&(t.seats[i].status==='ACTIVE'||t.seats[i].status==='ALL_IN'))active.push(i);
  if(active.length===0){
    t.buttonSeat=occupied[0];
    t.sbSeat=occupied.length>1?occupied[1]:occupied[0];
    t.bbSeat=occupied.length>2?occupied[2]:occupied[0];
    return;
  }
  let btnIdx=active.indexOf(t.buttonSeat);
  if(btnIdx===-1)btnIdx=0;
  else btnIdx=(btnIdx+1)%active.length;
  t.buttonSeat=active[btnIdx];
  if(active.length===2){
    t.sbSeat=t.buttonSeat;
    t.bbSeat=active[(btnIdx+1)%active.length];
  }else{
    t.sbSeat=active[(btnIdx+1)%active.length];
    t.bbSeat=active[(btnIdx+2)%active.length];
  }
}

function startHand(t){
  if(getTablePlayers(t).length<2)return;
  t.handId++;
  t.state='STARTING';
  t.community=[];
  t.deck=shuffle(makeDeck());
  t.currentStreet='PRE_FLOP';
  t.currentBet=0;
  t.lastFullRaise=t.bb;
  t.actorSeat=-1;
  t.pots=[];
  t.handLog=[];
  t.handPlayers={};
  t.streetBets={};
  t.streetContrib={};
  for(let i=0;i<10;i++){
    if(!t.seats[i])continue;
    const p=t.seats[i];
    p.holeCards=[];
    p.streetBet=0;
    p.totalBet=0;
    p.folded=false;
    p.isAllIn=false;
    p.status='ACTIVE';
    p.lastAction='';
    p.lastActionTime=0;
  }
  advanceButton(t);
  for(let i=0;i<10;i++){
    if(!t.seats[i])continue;
    t.seats[i].holeCards=[t.deck.pop(),t.deck.pop()];
  }
  const sbP=t.seats[t.sbSeat],bbP=t.seats[t.bbSeat];
  const sbAmt=Math.min(t.sb,sbP.stack);
  sbP.stack-=sbAmt;
  sbP.streetBet=sbAmt;
  sbP.totalBet=sbAmt;
  sbP.lastAction='SB';
  if(sbP.stack===0)sbP.isAllIn=true;
  const bbAmt=Math.min(t.bb,bbP.stack);
  bbP.stack-=bbAmt;
  bbP.streetBet=bbAmt;
  bbP.totalBet=bbAmt;
  bbP.lastAction='BB';
  if(bbP.stack===0)bbP.isAllIn=true;
  t.currentBet=t.bb;
  t.lastFullRaise=t.bb;
  t.state='PRE_FLOP';
  t.handLog.push({type:'hand_start',handId:t.handId,button:t.buttonSeat,sb:t.sbSeat,bb:t.bbSeat});
  if(occupiedCount(t)===2){
    t.actorSeat=t.sbSeat;
  }else{
    t.actorSeat=nextSeat(t,t.bbSeat);
  }
  t.turnDeadline=Date.now()+30000;
  t.handPlayers={};
  for(let i=0;i<10;i++){
    if(t.seats[i])t.handPlayers[i]={seat:i,stack:t.seats[i].stack+t.seats[i].totalBet,finalStack:0,contributions:[],holeCards:t.seats[i].holeCards};
  }
  logHand(t,{type:'deal',handId:t.handId});
}

function occupiedCount(t){let c=0;for(let i=0;i<10;i++)if(t.seats[i])c++;return c}

function advanceStreet(t){
  const order=['PRE_FLOP','FLOP','TURN','RIVER'];
  const idx=order.indexOf(t.currentStreet);
  if(idx<0||idx>=order.length-1){endHand(t);return}
  t.currentStreet=order[idx+1];
  if(t.currentStreet==='FLOP'){
    t.deck.pop();
    t.community.push(t.deck.pop(),t.deck.pop(),t.deck.pop());
  }else if(t.currentStreet==='TURN'){
    t.deck.pop();
    t.community.push(t.deck.pop());
  }else if(t.currentStreet==='RIVER'){
    t.deck.pop();
    t.community.push(t.deck.pop());
  }
  for(let i=0;i<10;i++)t.streetBets[i]=0;
  t.currentBet=0;
  t.lastFullRaise=t.bb;
  t.actorSeat=nextSeat(t,t.buttonSeat);
  t.turnDeadline=Date.now()+30000;
  t.handLog.push({type:'street',street:t.currentStreet,community:[...t.community]});
  logHand(t,{type:'community',street:t.currentStreet,cards:[...t.community]});
  while(t.actorSeat!==-1&&(t.seats[t.actorSeat].folded||t.seats[t.actorSeat].isAllIn)){
    t.actorSeat=nextSeat(t,t.actorSeat);
    if(t.actorSeat===-1||t.actorSeat===nextSeat(t,t.buttonSeat))break;
  }
  const active=getActors(t);
  if(active.length<=1){
    const allIn=getTablePlayers(t).filter(p=>p.isAllIn&&!p.folded);
    if(active.length===0&&allIn.length>=2){
      while(t.community.length<5){
        if(t.community.length===0){t.deck.pop();t.community.push(t.deck.pop(),t.deck.pop(),t.deck.pop())}
        else{t.deck.pop();t.community.push(t.deck.pop())}
      }
      endHand(t);
    }else if(active.length<=1){
      endHand(t);
    }
  }
}

function buildPots(t){
  const players=getTablePlayers(t).filter(p=>p.totalBet>0);
  const sorted=[...players].sort((a,b)=>a.totalBet-b.totalBet);
  const pots=[];
  const processed=new Set();
  let prevLevel=0;
  for(const p of sorted){
    if(processed.has(p.seat))continue;
    const level=p.totalBet-prevLevel;
    if(level<=0)continue;
    const allAtLevel=players.filter(x=>x.totalBet>=p.totalBet&&!processed.has(x.seat));
    const eligible=allAtLevel.filter(x=>!x.folded);
    if(eligible.length>0){
      const amount=level*allAtLevel.length;
      pots.push({amount,eligible:eligible.map(x=>x.seat)});
    }else if(allAtLevel.length>0){
      const amount=level*allAtLevel.length;
      pots.push({amount,eligible:allAtLevel.map(x=>x.seat)});
    }
    for(const x of players){
      if(x.totalBet<=p.totalBet)processed.add(x.seat);
    }
    prevLevel=p.totalBet;
  }
  if(pots.length===0){
    const totalIn=getTablePlayers(t).reduce((s,p)=>s+p.totalBet,0);
    if(totalIn>0)pots.push({amount:totalIn,eligible:getTablePlayers(t).filter(p=>!p.folded).map(p=>p.seat)});
  }
  const mainIdx=pots.findIndex(p=>p.eligible.length>1);
  if(mainIdx>0){
    const main=pots.splice(mainIdx,1)[0];
    pots.unshift(main);
  }
  return pots;
}

function shouldAdvance(t){
  const actors=getActors(t);
  const inHand=getTablePlayers(t).filter(p=>!p.folded);
  if(inHand.length<=1)return true;
  if(actors.length===0)return true;
  if(actors.length===1&&actors[0].isAllIn)return true;
  const active=actors.filter(p=>!p.isAllIn);
  if(active.length===0)return true;
  for(const a of active){
    if((t.streetBets[a.seat]||0)<t.currentBet)return false;
  }
  for(const a of active){
    if(a.lastAction===''||a.lastAction==='SB'||a.lastAction==='BB')return false;
  }
  return true;
}

function endHand(t){
  t.state='SHOWDOWN';
  const inHand=getTablePlayers(t).filter(p=>!p.folded);
  if(inHand.length===1){
    const winner=inHand[0];
    const pots=buildPots(t);
    for(const pot of pots){
      winner.stack+=pot.amount;
    }
    t.handLog.push({type:'end',reason:'last_player',winner:winner.seat,pots});
    const totalWon=pots.reduce((s,p)=>s+p.amount,0);
    logHand(t,{type:'end',reason:'fold',winner:winner.seat,amount:totalWon});
    recordHandResult(t,winner.seat,totalWon,'Fold Win');
    t.lastHandResult={winner:t.seats[winner.seat].name,amount:totalWon,hand:'Fold Win',reason:'All opponents folded'};
    finishHand(t);
    return;
  }
  const pots=buildPots(t);
  t.pots=pots;
  const results=[];
  for(const pot of pots){
    let bestRank=null,bestSeat=-1;
    const eligibleCards=pot.eligible.map(s=>({seat:s,cards:[...t.seats[s].holeCards,...t.community]}));
    for(const ec of eligibleCards){
      const h=bestHand(ec.cards);
      if(!h)continue;
      if(!bestRank||compareHands(h,bestRank)>0){bestRank=h;bestSeat=ec.seat}
    }
    const winners=pot.eligible.filter(s=>{
      const h=bestHand([...t.seats[s].holeCards,...t.community]);
      return h&&compareHands(h,bestRank)===0;
    });
    const share=Math.floor(pot.amount/winners.length);
    const remainder=pot.amount-share*winners.length;
    for(let i=0;i<winners.length;i++){
      t.seats[winners[i]].stack+=share+(i===0?remainder:0);
    }
    results.push({pot:pot.amount,winners,hand:rankName(bestRank.cat)});
    for(const w of winners)recordHandResult(t,w,pot.amount/winners.length,rankName(bestRank.cat));
  }
  t.handLog.push({type:'showdown',results});
  logHand(t,{type:'showdown',results,community:[...t.community]});
  for(const s of inHand){
    logHand(t,{type:'cards',seat:s.seat,cards:s.holeCards});
  }
  if(results.length>0){
    const topResult=results.reduce((a,b)=>b.pot>a.pot?b:a);
    const mainWinner=topResult.winners[0];
    t.lastHandResult={winner:t.seats[mainWinner]?.name,amount:topResult.pot,hand:topResult.hand,reason:'Showdown'};
  }
  finishHand(t);
}

function finishHand(t){
  for(let i=0;i<10;i++){
    if(t.seats[i]&&t.seats[i].stack<=0){
      t.seats[i]=null;
    }
  }
  if(occupiedCount(t)<2){
    t.state='WAITING';
    t.community=[];
    t.actorSeat=-1;
    t.buttonSeat=-1;
    t.sbSeat=-1;
    t.bbSeat=-1;
    for(let i=0;i<10;i++)if(t.seats[i])t.seats[i].holeCards=[];
    return;
  }
  t.community=[];
  for(let i=0;i<10;i++){
    if(t.seats[i]){
      t.seats[i].holeCards=[];
      t.seats[i].streetBet=0;
      t.seats[i].totalBet=0;
      t.seats[i].folded=false;
      t.seats[i].isAllIn=false;
      t.seats[i].lastAction='';
      t.seats[i].status='ACTIVE';
    }
  }
  t.state='WAITING';
  t.currentBet=0;
  t.actorSeat=-1;
  setTimeout(()=>startHand(t),3000);
}

function logHand(t,event){
  if(!t.handHistory)t.handHistory=[];
  t.handHistory.push({...event,ts:Date.now()});
}

function performAction(t,seat,action,amount){
  if(t.actorSeat!==seat)return{ok:false,error:'Not your turn'};
  const p=t.seats[seat];
  if(!p||p.folded||p.isAllIn)return{ok:false,error:'Invalid player'};
  switch(action){
    case'fold':
      p.folded=true;
      p.status='FOLDED';
      p.lastAction='FOLD';
      t.handLog.push({type:'action',seat,action:'FOLD'});
      break;
    case'check':
      if(t.currentBet>(t.streetBets[seat]||0))return{ok:false,error:'Cannot check, must call'};
      p.lastAction='CHECK';
      t.handLog.push({type:'action',seat,action:'CHECK'});
      break;
    case'call':{
      const callAmt=Math.min(t.currentBet-(t.streetBets[seat]||0),p.stack);
      p.stack-=callAmt;
      p.streetBet=(p.streetBet||0)+callAmt;
      p.totalBet+=callAmt;
      t.streetBets[seat]=(t.streetBets[seat]||0)+callAmt;
      p.lastAction='CALL';
      if(p.stack===0)p.isAllIn=true;
      t.handLog.push({type:'action',seat,action:'CALL',amount:callAmt});
      break;
    }
    case'raise':{
      const curContrib=t.streetBets[seat]||0;
      const minTotal=t.currentBet+t.lastFullRaise;
      const totalBet=Math.max(amount,minTotal);
      const raiseAmt=totalBet-curContrib;
      if(raiseAmt>=p.stack){
        return performAction(t,seat,'allin');
      }
      p.stack-=raiseAmt;
      p.streetBet=(p.streetBet||0)+raiseAmt;
      p.totalBet+=raiseAmt;
      t.streetBets[seat]=(t.streetBets[seat]||0)+raiseAmt;
      const raiseSize=totalBet-t.currentBet;
      if(raiseSize>=t.lastFullRaise&&p.stack>=0){
        t.lastFullRaise=raiseSize;
      }
      t.currentBet=totalBet;
      p.lastAction='RAISE';
      t.handLog.push({type:'action',seat,action:'RAISE',amount:totalBet});
      break;
    }
    case'bet':{
      if(t.currentBet>0)return{ok:false,error:'Bet not allowed, use raise'};
      const betAmt=Math.max(amount,t.bb);
      if(betAmt>=p.stack){
        return performAction(t,seat,'allin');
      }
      p.stack-=betAmt;
      p.streetBet=betAmt;
      p.totalBet+=betAmt;
      t.streetBets[seat]=betAmt;
      t.currentBet=betAmt;
      t.lastFullRaise=betAmt;
      p.lastAction='BET';
      t.handLog.push({type:'action',seat,action:'BET',amount:betAmt});
      break;
    }
    case'allin':{
      const allInAmt=p.stack;
      const curContrib=t.streetBets[seat]||0;
      const newTotal=curContrib+allInAmt;
      p.stack=0;
      p.streetBet+=allInAmt;
      p.totalBet+=allInAmt;
      t.streetBets[seat]=(t.streetBets[seat]||0)+allInAmt;
      if(newTotal>t.currentBet){
        const raiseSize=newTotal-t.currentBet;
        if(raiseSize>=t.lastFullRaise){
          t.lastFullRaise=raiseSize;
        }
        t.currentBet=newTotal;
      }
      p.isAllIn=true;
      p.lastAction='ALL_IN';
      t.handLog.push({type:'action',seat,action:'ALL_IN',amount:allInAmt});
      break;
    }
    default:return{ok:false,error:'Unknown action'};
  }
  p.lastActionTime=Date.now();
  t.actorSeat=-1;
  if(shouldAdvance(t)){
    const inHand=getTablePlayers(t).filter(p=>!p.folded);
    if(inHand.length<=1){
      endHand(t);
    }else{
      advanceStreet(t);
    }
  }else{
    t.actorSeat=nextSeat(t,seat);
    while(t.actorSeat!==-1&&(t.seats[t.actorSeat].folded||t.seats[t.actorSeat].isAllIn)){
      const prev=t.actorSeat;
      t.actorSeat=nextSeat(t,t.actorSeat);
      if(t.actorSeat===prev||t.actorSeat===-1)break;
    }
    if(t.actorSeat!==-1)t.turnDeadline=Date.now()+30000;
  }
  return{ok:true};
}

// ====== AI BOT ======
function aiAction(t,seat){
  const p=t.seats[seat];
  if(!p||p.folded||p.isAllIn)return null;
  const hole=p.holeCards;
  const board=t.community;
  const street=t.currentStreet;
  let handStr=0;
  if(street==='PRE_FLOP'){
    handStr=preFlopStrength(hole);
  }else{
    const all=[...hole,...board];
    const h=bestHand(all);
    handStr=h?h.cat/9:0;
  }
  const toCall=t.currentBet-(t.streetBets[seat]||0);
  const totalPot=getTablePlayers(t).reduce((s,p)=>s+p.totalBet,0);
  const pot=totalPot;
  const potOdds=toCall>0?toCall/(pot+toCall):0;
  const activePlayers=getActors(t).length;
  const r=Math.random();
  if(street==='PRE_FLOP'){
    if(handStr>=0.75){
      if(toCall===0)return{action:'raise',amount:t.currentBet+t.lastFullRaise*2};
      if(potOdds<handStr*0.8)return{action:'call'};
      return r<0.3?{action:'raise',amount:t.currentBet+t.lastFullRaise}:{action:'call'};
    }
    if(handStr>=0.45){
      if(toCall===0)return r<0.3?{action:'raise',amount:t.currentBet+t.lastFullRaise}:{action:'check'};
      if(toCall<=t.bb*3)return{action:'call'};
      if(potOdds<handStr*0.6)return{action:'call'};
      return r<0.7?{action:'fold'}:{action:'call'};
    }
    if(handStr>=0.25){
      if(toCall===0)return r<0.15?{action:'bet',amount:t.bb}:{action:'check'};
      if(toCall<=t.bb)return r<0.8?{action:'call'}:{action:'fold'};
      return r<0.9?{action:'fold'}:{action:'call'};
    }
    if(toCall===0)return{action:'check'};
    return r<0.95?{action:'fold'}:{action:'call'};
  }else{
    if(handStr>=0.7){
      if(toCall===0){
        const betSize=Math.floor(pot*0.7);
        if(betSize>=p.stack)return{action:'allin'};
        if(betSize>=t.bb)return{action:'bet',amount:betSize};
        return{action:'check'};
      }
      if(r<0.15&&p.stack>toCall+t.lastFullRaise){
        return{action:'raise',amount:t.currentBet+t.lastFullRaise};
      }
      if(p.stack<=toCall)return{action:'allin'};
      return{action:'call'};
    }
    if(handStr>=0.4){
      if(toCall===0){
        if(r<0.4){const amt=Math.floor(pot*0.5);return amt>=t.bb?{action:'bet',amount:amt}:{action:'check'}}
        return{action:'check'};
      }
      if(toCall<=Math.floor(pot*0.4))return r<0.6?{action:'call'}:{action:'fold'};
      return r<0.8?{action:'fold'}:{action:'call'};
    }
    if(toCall===0){
      if(r<0.2&&p.stack>=t.bb){const amt=t.bb;return{action:'bet',amount:amt}}
      return{action:'check'};
    }
    return r<0.85?{action:'fold'}:{action:'call'};
  }
}

function preFlopStrength(hole){
  const r1=cardRank(hole[0]),r2=cardRank(hole[1]);
  const s1=cardSuit(hole[0]),s2=cardSuit(hole[1]);
  const suited=s1===s2;
  const high=Math.max(r1,r2),low=Math.min(r1,r2);
  const gap=high-low;
  let s=high*2;
  if(r1===r2)s=Math.max(s,16);
  if(suited)s+=2;
  if(gap<=1&&high>=7)s+=2;
  if(gap<=1&&high<7)s+=1;
  if(gap===0)s+=3;
  if(s>=17)return 0.9;
  if(s>=13)return 0.75;
  if(s>=10)return 0.55;
  if(s>=7)return 0.4;
  if(s>=5)return 0.3;
  return 0.15;
}

function getPublicState(t,seat){
  const players=[];
  for(let i=0;i<10;i++){
    if(!t.seats[i])continue;
    const p=t.seats[i];
    const isMe=i===seat;
    players.push({
      seat:i,
      name:p.name,
      avatar:p.avatar,
      stack:p.stack,
      holeCards:isMe?p.holeCards:(t.state==='SHOWDOWN'&&!p.folded?p.holeCards:['?','?']),
      status:p.status,
      folded:p.folded,
      isAllIn:p.isAllIn,
      lastAction:p.lastAction,
      isDealer:i===t.buttonSeat,
      isSB:i===t.sbSeat,
      isBB:i===t.bbSeat,
      streetBet:t.streetBets[i]||0,
      totalBet:p.totalBet,
      isMe
    });
  }
  return{
    tableId:t.id,
    name:t.name,
    state:t.state,
    handId:t.handId,
    sb:t.sb,
    bb:t.bb,
    minBuyIn:t.minBuyIn,
    maxBuyIn:t.maxBuyIn,
    community:t.community,
    currentStreet:t.currentStreet,
    currentBet:t.currentBet,
    lastFullRaise:t.lastFullRaise,
    actorSeat:t.actorSeat,
    buttonSeat:t.buttonSeat,
    sbSeat:t.sbSeat,
    bbSeat:t.bbSeat,
    pots:t.pots,
    handLog:t.handLog.slice(-20),
    turnDeadline:t.turnDeadline,
    players,
    mySeat:seat!==undefined?seat:-1,
    lastHandResult:t.lastHandResult||null
  };
}

// ====== HTTP SERVER ======
function readBody(req){
  return new Promise((resolve,reject)=>{
    let d='';req.on('data',c=>d+=c);req.on('end',()=>resolve(d));
    req.on('error',reject);
  });
}

function json(res,data,code=200){
  res.writeHead(code,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
  res.end(JSON.stringify(data));
}

function err(res,msg,code=400){json(res,{error:msg},code)}

function getSession(req){
  const h=req.headers.authorization;
  if(!h||!h.startsWith('Bearer '))return null;
  const db=loadDB();
  return db.sessions[h.slice(7)]||null;
}

function setCors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
}

async function handleRequest(req,res){
  setCors(res);
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}
  const url=new URL(req.url,'http://localhost');
  const p=url.pathname;
  try{
    if(p==='/'||p==='/index.html'){
      res.writeHead(200,{'Content-Type':'text/html'});
      res.end(fs.readFileSync(path.join(__dirname,'index.html'),'utf8'));
      return;
    }
    if(p==='/client.js'){
      res.writeHead(200,{'Content-Type':'application/javascript'});
      res.end(fs.readFileSync(path.join(__dirname,'client.js'),'utf8'));
      return;
    }
    if(p==='/style.css'){
      res.writeHead(200,{'Content-Type':'text/css'});
      res.end(fs.readFileSync(path.join(__dirname,'style.css'),'utf8'));
      return;
    }
    if(p==='/api/register'&&req.method==='POST'){
      const body=JSON.parse(await readBody(req));
      const{username,password}=body;
      if(!username||!password)return err(res,'Username and password required');
      if(username.length<2||username.length>16)return err(res,'Username 2-16 chars');
      if(password.length<4)return err(res,'Password min 4 chars');
      const db=loadDB();
      const uname=username.toLowerCase();
      if(Object.values(db.users).find(u=>u.username===uname))return err(res,'Username taken');
      const uid='u'+Date.now()+Math.random().toString(36).slice(2,8);
      const hash=crypto.createHash('sha256').update(password).digest('hex');
      db.users[uid]={uid,username:uname,displayName:username,password:hash,chips:10000,vip:false,
        inventory:{boards:['classic'],pieces:['classic'],selectedBoard:'classic',selectedPieces:'classic'},
        stats:{handsPlayed:0,handsWon:0,totalEarnings:0}
      };
      const sid='s'+Date.now()+Math.random().toString(36).slice(2,8);
      db.sessions[sid]={uid,created:Date.now()};
      saveDB(db);
      json(res,{uid,username:uname,displayName:username,token:sid,chips:10000});
      return;
    }
    if(p==='/api/login'&&req.method==='POST'){
      const body=JSON.parse(await readBody(req));
      const{username,password}=body;
      const db=loadDB();
      const uname=(username||'').toLowerCase();
      const user=Object.values(db.users).find(u=>u.username===uname);
      if(!user)return err(res,'User not found');
      const hash=crypto.createHash('sha256').update(password||'').digest('hex');
      if(user.password!==hash)return err(res,'Wrong password');
      const sid='s'+Date.now()+Math.random().toString(36).slice(2,8);
      db.sessions[sid]={uid:user.uid,created:Date.now()};
      saveDB(db);
      json(res,{uid:user.uid,username:user.username,displayName:user.displayName,token:sid,chips:user.chips,vip:user.vip});
      return;
    }
    if(p==='/api/state'){
      const sess=getSession(req);
      if(!sess)return err(res,'Unauthorized',401);
      const db=loadDB();
      const u=db.users[sess.uid];
      if(!u)return err(res,'User not found',404);
      const tableList=Object.values(tables).map(t=>({id:t.id,name:t.name,players:getTablePlayers(t).length,state:t.state,sb:t.sb,bb:t.bb}));
      json(res,{user:{uid:u.uid,username:u.username,displayName:u.displayName,chips:u.chips,vip:u.vip,stats:u.stats},tables:tableList});
      return;
    }
    if(p==='/api/table/create'&&req.method==='POST'){
      const sess=getSession(req);
      if(!sess)return err(res,'Unauthorized',401);
      const body=JSON.parse(await readBody(req));
      const{blinds,tableName}=body;
      const sb=(blinds&&blinds[0])||50,bb=(blinds&&blinds[1])||100;
      const db=loadDB();
      const u=db.users[sess.uid];
      if(!u)return err(res,'User not found',404);
      const buyAmt=bb*100;
      if(u.chips<buyAmt)return err(res,'Not enough chips');
      u.chips-=buyAmt;
      const t=createTable(tableName||u.displayName+"'s Table",[sb,bb],sess.uid);
      const seatIdx=0;
      t.seats[seatIdx]={name:u.displayName,uid:sess.uid,avatar:u.displayName[0].toUpperCase(),
        stack:buyAmt,holeCards:[],status:'WAITING',folded:false,isAllIn:false,
        streetBet:0,totalBet:0,lastAction:''};
      t.buttonSeat=0;t.sbSeat=0;t.bbSeat=1;
      saveDB(db);
      json(res,{tableId:t.id,seat:seatIdx});
      return;
    }
    if(p==='/api/table/join'&&req.method==='POST'){
      const sess=getSession(req);
      if(!sess)return err(res,'Unauthorized',401);
      const body=JSON.parse(await readBody(req));
      const{tableId,buyIn}=body;
      const t=tables[tableId];
      if(!t)return err(res,'Table not found',404);
      const db=loadDB();
      const u=db.users[sess.uid];
      if(!u)return err(res,'User not found',404);
      let seatIdx=-1;
      for(let i=0;i<10;i++){
        if(!t.seats[i]){seatIdx=i;break}
      }
      if(seatIdx===-1)return err(res,'Table full');
      for(let i=0;i<10;i++){
        if(t.seats[i]&&t.seats[i].uid===sess.uid)return err(res,'Already at table');
      }
      const amt=Math.min(buyIn||t.maxBuyIn,u.chips,t.maxBuyIn);
      if(amt<t.minBuyIn)return err(res,'Buy-in too small, minimum '+t.minBuyIn);
      u.chips-=amt;
      t.seats[seatIdx]={name:u.displayName,uid:sess.uid,avatar:u.displayName[0].toUpperCase(),
        stack:amt,holeCards:[],status:'ACTIVE',folded:false,isAllIn:false,
        streetBet:0,totalBet:0,lastAction:''};
      saveDB(db);
      if(t.state==='WAITING'&&getTablePlayers(t).length>=2){
        setTimeout(()=>startHand(t),2000);
      }
      json(res,{tableId:t.id,seat:seatIdx});
      return;
    }
    if(p==='/api/table/leave'&&req.method==='POST'){
      const sess=getSession(req);
      if(!sess)return err(res,'Unauthorized',401);
      const body=JSON.parse(await readBody(req));
      const{tableId}=body;
      const t=tables[tableId];
      if(!t)return err(res,'Table not found',404);
      for(let i=0;i<10;i++){
        if(t.seats[i]&&t.seats[i].uid===sess.uid){
          if(t.state!=='WAITING'&&!t.seats[i].folded){
            t.seats[i].folded=true;
            t.seats[i].status='FOLDED';
            t.seats[i].lastAction='FOLD';
            if(t.actorSeat===i){
              t.actorSeat=-1;
              if(shouldAdvance(t)){
                const inHand=getTablePlayers(t).filter(x=>!x.folded);
                if(inHand.length<=1)endHand(t);
                else advanceStreet(t);
              }else{
                t.actorSeat=nextSeat(t,i);
                while(t.actorSeat!==-1&&(t.seats[t.actorSeat].folded||t.seats[t.actorSeat].isAllIn)){
                  const prev=t.actorSeat;
                  t.actorSeat=nextSeat(t,t.actorSeat);
                  if(t.actorSeat===prev||t.actorSeat===-1)break;
                }
                if(t.actorSeat!==-1)t.turnDeadline=Date.now()+30000;
                processBotActions(t);
              }
            }
          }
          const db=loadDB();
          if(db.users[sess.uid])db.users[sess.uid].chips+=t.seats[i].stack;
          t.seats[i]=null;
          saveDB(db);
          break;
        }
      }
      json(res,{ok:true});
      return;
    }
    if(p==='/api/table/state'){
      const sess=getSession(req);
      if(!sess)return err(res,'Unauthorized',401);
      const url=new URL(req.url,'http://localhost');
      const tableId=url.searchParams.get('tableId');
      const t=tables[tableId];
      if(!t)return err(res,'Table not found',404);
      let mySeat=-1;
      for(let i=0;i<10;i++){
        if(t.seats[i]&&t.seats[i].uid===sess.uid){mySeat=i;break}
      }
      json(res,getPublicState(t,mySeat));
      return;
    }
    if(p==='/api/table/action'&&req.method==='POST'){
      const sess=getSession(req);
      if(!sess)return err(res,'Unauthorized',401);
      const body=JSON.parse(await readBody(req));
      const{tableId,action,amount}=body;
      const t=tables[tableId];
      if(!t)return err(res,'Table not found',404);
      let mySeat=-1;
      for(let i=0;i<10;i++){
        if(t.seats[i]&&t.seats[i].uid===sess.uid){mySeat=i;break}
      }
      if(mySeat===-1)return err(res,'Not at table');
      const result=performAction(t,mySeat,action,amount||0);
      if(!result.ok)return err(res,result.error);
      processBotActions(t);
      json(res,{ok:true,tableState:getPublicState(t,mySeat)});
      return;
    }
    if(p==='/api/table/bot'&&req.method==='POST'){
      const sess=getSession(req);
      if(!sess)return err(res,'Unauthorized',401);
      const body=JSON.parse(await readBody(req));
      const{tableId}=body;
      const t=tables[tableId];
      if(!t)return err(res,'Table not found',404);
      addBotToTable(t,sess.uid);
      json(res,{ok:true});
      return;
    }
    err(res,'Not found',404);
  }catch(e){
    console.error('Error:',e);
    err(res,'Internal error',500);
  }
}

function processBotActions(t,attempt){
  if(t.actorSeat===-1)return;
  const p=t.seats[t.actorSeat];
  if(!p)return;
  if(p.uid&&!p.uid.startsWith('bot_'))return;
  const decision=aiAction(t,t.actorSeat);
  if(!decision){
    const fallback=t.currentBet-(t.streetBets[t.actorSeat]||0)>0?'fold':'check';
    const result=performAction(t,t.actorSeat,fallback,0);
    if(result.ok)setTimeout(()=>processBotActions(t),800);
    return;
  }
  const result=performAction(t,t.actorSeat,decision.action,decision.amount||0);
  if(!result.ok){
    const fallback=t.currentBet-(t.streetBets[t.actorSeat]||0)>0?'fold':'check';
    const fb=performAction(t,t.actorSeat,fallback,0);
    if(fb.ok)setTimeout(()=>processBotActions(t),800);
    return;
  }
  setTimeout(()=>processBotActions(t),800);
}

function addBotToTable(t,hostUid){
  let seatIdx=-1;
  for(let i=0;i<10;i++){
    if(!t.seats[i]){seatIdx=i;break}
  }
  if(seatIdx===-1)return;
  const botId='bot_'+Date.now();
  const names=['Bot Alex','Bot Sam','Bot Kim','Bot Pat','Bot Leo','Bot Max','Bot Zoe','Bot Ian','Bot Ann','Bot Jay'];
  const name=names[Math.floor(Math.random()*names.length)];
  t.seats[seatIdx]={name,uid:botId,avatar:name[4],stack:t.bb*100,
    holeCards:[],status:'ACTIVE',folded:false,isAllIn:false,
    streetBet:0,totalBet:0,lastAction:''};
  if(t.state==='WAITING'&&getTablePlayers(t).length>=2){
    setTimeout(()=>startHand(t),2000);
  }
}

const server=http.createServer(handleRequest);
server.listen(PORT,()=>{
  console.log('SANI POKER running on http://localhost:'+PORT);
  setInterval(checkTimeouts,5000);
});

function checkTimeouts(){
  const now=Date.now();
  for(const t of Object.values(tables)){
    if(t.state==='WAITING'||t.state==='SHOWDOWN')continue;
    if(t.actorSeat===-1)continue;
    if(t.turnDeadline===0)continue;
    if(now<t.turnDeadline)continue;
    const p=t.seats[t.actorSeat];
    if(!p)continue;
    if(p.uid&&p.uid.startsWith('bot_'))continue;
    const fallback=t.currentBet-(t.streetBets[t.actorSeat]||0)>0?'fold':'check';
    performAction(t,t.actorSeat,fallback,0);
    processBotActions(t);
  }
}

function recordHandResult(t,winnerSeat,amount,handName){
  const db=loadDB();
  for(const p of getTablePlayers(t)){
    const u=db.users[p.uid];
    if(!u)continue;
    if(!u.stats)u.stats={handsPlayed:0,handsWon:0,totalEarnings:0};
    u.stats.handsPlayed++;
    if(p.seat===winnerSeat){
      u.stats.handsWon++;
      u.stats.totalEarnings+=amount;
    }
  }
  saveDB(db);
}
