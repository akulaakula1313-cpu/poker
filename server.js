const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const rooms = new Map();

const RANKS = "23456789TJQKA";
const SUITS = ["s","h","d","c"];
const RANK_VALUE = Object.fromEntries([...RANKS].map((r,i)=>[r,i+2]));

function uid(){ return crypto.randomBytes(12).toString("hex"); }
function roomCode(){ return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function card(r,s){ return r+s; }
function makeDeck(){
  const d=[]; for(const r of RANKS) for(const s of SUITS) d.push(card(r,s)); return d;
}
function secureShuffle(a){
  for(let i=a.length-1;i>0;i--){ const j=crypto.randomInt(i+1); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function nextSeat(seats, seat, predicate){
  const sorted=[...seats].sort((a,b)=>a.seat-b.seat);
  if(!sorted.length) return null;
  let idx=sorted.findIndex(x=>x.seat===seat); if(idx<0) idx=0;
  for(let n=1;n<=sorted.length;n++){ const p=sorted[(idx+n)%sorted.length]; if(predicate(p)) return p; }
  return null;
}
function orderedFromButton(players, buttonSeat){
  const sorted=[...players].sort((a,b)=>a.seat-b.seat);
  const idx=sorted.findIndex(p=>p.seat===buttonSeat);
  if(idx<0) return sorted;
  return sorted.slice(idx+1).concat(sorted.slice(0,idx+1));
}
function active(players){ return players.filter(p=>p.status==="ACTIVE" || p.status==="ALL_IN"); }
function contenders(players){ return players.filter(p=>p.status!=="FOLDED" && p.status!=="OUT" && p.status!=="SITTING_OUT"); }
function canAct(p){ return p.status==="ACTIVE"; }

function evaluate5(cs){
  const vals=cs.map(c=>RANK_VALUE[c[0]]).sort((a,b)=>b-a);
  const counts={}; for(const v of vals) counts[v]=(counts[v]||0)+1;
  const groups=Object.entries(counts).map(([v,n])=>[Number(v),n]).sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  const flush=cs.every(c=>c[1]===cs[0][1]);
  const uniq=[...new Set(vals)].sort((a,b)=>b-a);
  let straightHigh=null;
  if(uniq.includes(14)) uniq.push(1);
  for(let i=0;i<=uniq.length-5;i++){
    if(uniq[i]-uniq[i+4]===4){ straightHigh=uniq[i]; break; }
  }
  if(flush && straightHigh) return [8,straightHigh];
  const quad=groups.find(g=>g[1]===4); if(quad) return [7,quad[0],...vals.filter(v=>v!==quad[0])];
  const trips=groups.filter(g=>g[1]===3), pairs=groups.filter(g=>g[1]===2);
  if(trips.length>=1 && (pairs.length>=1 || trips.length>=2)){
    const t=trips[0][0], p=trips.length>=2?trips[1][0]:pairs[0][0]; return [6,t,p];
  }
  if(flush) return [5,...vals];
  if(straightHigh) return [4,straightHigh];
  if(trips.length) return [3,trips[0][0],...vals.filter(v=>v!==trips[0][0])];
  if(pairs.length>=2) return [2,pairs[0][0],pairs[1][0],...vals.filter(v=>v!==pairs[0][0]&&v!==pairs[1][0])];
  if(pairs.length===1) return [1,pairs[0][0],...vals.filter(v=>v!==pairs[0][0])];
  return [0,...vals];
}
function cmp(a,b){ for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i]||0,y=b[i]||0;if(x!==y)return x-y;}return 0; }
function best7(cards){
  if(cards.length<5) throw new Error("SHOWDOWN_REQUIRES_5_CARDS");
  let best=null, bestCards=null;
  for(let a=0;a<cards.length-4;a++)for(let b=a+1;b<cards.length-3;b++)for(let c=b+1;c<cards.length-2;c++)
  for(let d=c+1;d<cards.length-1;d++)for(let e=d+1;e<cards.length;e++){
    const five=[cards[a],cards[b],cards[c],cards[d],cards[e]], score=evaluate5(five);
    if(!best||cmp(score,best)>0){best=score;bestCards=five;}
  }
  return {score:best,cards:bestCards};
}
const category=["High Card","Pair","Two Pair","Three of a Kind","Straight","Flush","Full House","Four of a Kind","Straight Flush"];

function buildPots(players){
  const levels=[...new Set(players.map(p=>p.totalContribution).filter(x=>x>0))].sort((a,b)=>a-b);
  let prev=0, pots=[];
  for(const level of levels){
    const contributors=players.filter(p=>p.totalContribution>=level);
    const amount=(level-prev)*contributors.length;
    if(amount>0){
      pots.push({
        amount,
        eligible: players.filter(p=>p.totalContribution>=level && p.status!=="FOLDED").map(p=>p.id),
        cap: level
      });
    }
    prev=level;
  }
  return pots;
}
function oddChipOrder(players, buttonSeat){
  const sorted=orderedFromButton(players,buttonSeat);
  return sorted.map(p=>p.id);
}
function payout(pots, players, winnersByPot, buttonSeat){
  const byId=new Map(players.map(p=>[p.id,p]));
  let paid=0;
  for(let i=0;i<pots.length;i++){
    const pot=pots[i], ws=winnersByPot[i]||[];
    if(!ws.length) throw new Error("POT_WITHOUT_WINNER");
    const share=Math.floor(pot.amount/ws.length), rem=pot.amount%ws.length;
    ws.forEach(id=>byId.get(id).stack+=share); paid+=share*ws.length;
    const order=oddChipOrder(players,buttonSeat).filter(id=>ws.includes(id));
    for(let k=0;k<rem;k++){byId.get(order[k%order.length]).stack++;paid++;}
  }
  return paid;
}

class Hand {
  constructor(room){
    this.room=room; this.id=uid(); this.seq=0; this.actionIds=new Set(); this.events=[];
    this.street="PRE_FLOP"; this.board=[]; this.deck=secureShuffle(makeDeck());
    this.currentBet=0; this.lastFullRaise=room.bb; this.actorId=null; this.buttonSeat=room.buttonSeat;
    this.players=room.players.map(p=>({
      id:p.id,name:p.name,seat:p.seat,stack:p.stack,status:p.sittingOut?"SITTING_OUT":"ACTIVE",
      hole:[],streetContribution:0,totalContribution:0,isDealer:p.seat===this.buttonSeat
    }));
    this.deal(); this.postBlinds(); this.actorId=this.preflopActor();
    this.log("HAND_STARTED",{buttonSeat:this.buttonSeat});
    this.advanceIfNeeded();
  }
  log(type,data={}){this.events.push({at:Date.now(),seq:++this.seq,type,...data});}
  deal(){
    const ps=this.players.filter(p=>p.status==="ACTIVE");
    const order=orderedFromButton(ps,this.buttonSeat);
    for(let round=0;round<2;round++) for(const p of order) p.hole.push(this.deck.pop());
  }
  postBlinds(){
    const ps=this.players.filter(p=>p.status==="ACTIVE");
    const ordered=orderedFromButton(ps,this.buttonSeat);
    const sb=ps.length===2?ordered[0]:ordered[0], bb=ps.length===2?ordered[1]:ordered[1];
    this.sbId=sb.id; this.bbId=bb.id;
    this.commit(sb,Math.min(this.room.sb,sb.stack),"SB");
    this.commit(bb,Math.min(this.room.bb,bb.stack),"BB");
    this.currentBet=Math.max(sb.streetContribution,bb.streetContribution);
    if(sb.stack===0)sb.status="ALL_IN"; if(bb.stack===0)bb.status="ALL_IN";
  }
  commit(p,amount,reason){
    amount=Math.max(0,Math.min(amount,p.stack)); p.stack-=amount;p.streetContribution+=amount;p.totalContribution+=amount;
    this.log("CHIPS_COMMITTED",{playerId:p.id,amount,reason});
  }
  preflopActor(){
    const ps=this.players.filter(p=>p.status!=="SITTING_OUT");
    const ordered=orderedFromButton(ps,this.buttonSeat);
    const target=ps.length===2?this.sbId:this.bbId;
    return nextSeat(ps, target, p=>p.status==="ACTIVE")?.id || null;
  }
  postflopActor(){
    const ps=this.players.filter(p=>p.status==="ACTIVE");
    return nextSeat(ps,this.buttonSeat,p=>p.status==="ACTIVE")?.id || null;
  }
  validate(id,action,amount){
    if(this.actionIds.has(action.id)) return {duplicate:true};
    if(this.actorId!==id) throw new Error("NOT_YOUR_TURN");
    const p=this.players.find(x=>x.id===id); if(!p||p.status!=="ACTIVE")throw new Error("PLAYER_CANNOT_ACT");
    const need=Math.max(0,this.currentBet-p.streetContribution);
    const max=p.stack;
    if(action.type==="FOLD") return {commit:0};
    if(action.type==="CHECK"){if(need!==0)throw new Error("CHECK_NOT_ALLOWED");return {commit:0};}
    if(action.type==="CALL"){if(need===0)throw new Error("NOTHING_TO_CALL");return {commit:Math.min(need,max)};}
    if(action.type==="ALL_IN") return {commit:max};
    if(action.type==="BET"){
      if(this.currentBet!==0)throw new Error("BET_NOT_ALLOWED");
      const a=Number(amount); if(!Number.isInteger(a)||a<=0||a>max)throw new Error("INVALID_BET");
      if(a< this.room.bb && a<max)throw new Error("BET_TOO_SMALL");
      return {commit:a, raisesTo:a, fullRaise:a};
    }
    if(action.type==="RAISE"){
      if(this.currentBet===0)throw new Error("RAISE_NOT_ALLOWED");
      const to=Number(amount); const minTo=this.currentBet+this.lastFullRaise;
      if(!Number.isInteger(to)||to<=this.currentBet||to>this.currentBet+max)throw new Error("INVALID_RAISE");
      const allIn=to===this.currentBet+max;
      if(to<minTo && !allIn)throw new Error("RAISE_TOO_SMALL");
      return {commit:to-p.streetContribution, raisesTo:to, fullRaise:to-this.currentBet};
    }
    throw new Error("UNKNOWN_ACTION");
  }
  apply(id,action){
    const v=this.validate(id,action,action.amount);
    if(v.duplicate)return {ok:true,duplicate:true};
    this.actionIds.add(action.id);
    const p=this.players.find(x=>x.id===id);
    if(action.type==="FOLD")p.status="FOLDED";
    else if(action.type!=="CHECK"){
      this.commit(p,v.commit,action.type);
      if(v.raisesTo!==undefined){
        const old=this.currentBet; this.currentBet=v.raisesTo;
        if(v.fullRaise>=this.lastFullRaise || action.type==="BET") this.lastFullRaise=v.fullRaise;
        this.log("BETTING_LEVEL_CHANGED",{from:old,to:this.currentBet,lastFullRaise:this.lastFullRaise});
      }
      if(p.stack===0)p.status="ALL_IN";
    }
    this.log("ACTION",{playerId:id,action:{type:action.type,amount:action.amount??null}});
    this.seq++;
    this.advanceAfterAction();
    return {ok:true};
  }
  advanceAfterAction(){
    const alive=this.players.filter(p=>p.status!=="FOLDED"&&p.status!=="SITTING_OUT");
    if(alive.length===1){this.finishByFold(alive[0]);return;}
    const actors=this.players.filter(p=>p.status==="ACTIVE");
    const matched=actors.length>0 && actors.every(p=>p.streetContribution===this.currentBet);
    if(actors.length===0){this.runout();return;}
    if(matched){this.advanceStreet();return;}
    this.actorId=nextSeat(this.players.filter(p=>p.status==="ACTIVE"),this.actorId,p=>p.status==="ACTIVE")?.id || null;
    this.advanceIfNeeded();
  }
  advanceIfNeeded(){
    if(!this.actorId){this.runout();return;}
    const actors=this.players.filter(p=>p.status==="ACTIVE");
    if(!actors.length){this.runout();return;}
    const p=this.players.find(x=>x.id===this.actorId);
    if(!p||p.status!=="ACTIVE")this.actorId=nextSeat(actors,p?.seat??this.buttonSeat,x=>x.status==="ACTIVE")?.id||null;
  }
  advanceStreet(){
    this.players.forEach(p=>p.streetContribution=0);
    this.currentBet=0; this.lastFullRaise=this.room.bb;
    if(this.street==="PRE_FLOP"){this.street="FLOP";this.burn();this.board.push(this.deck.pop(),this.deck.pop(),this.deck.pop());}
    else if(this.street==="FLOP"){this.street="TURN";this.burn();this.board.push(this.deck.pop());}
    else if(this.street==="TURN"){this.street="RIVER";this.burn();this.board.push(this.deck.pop());}
    else {this.showdown();return;}
    this.log("STREET",{street:this.street,board:this.board});
    this.actorId=this.postflopActor();
    this.advanceIfNeeded();
  }
  burn(){this.deck.pop();}
  runout(){
    while(this.street!=="RIVER"){
      if(this.street==="PRE_FLOP"){this.street="FLOP";this.burn();this.board.push(this.deck.pop(),this.deck.pop(),this.deck.pop());}
      else if(this.street==="FLOP"){this.street="TURN";this.burn();this.board.push(this.deck.pop());}
      else if(this.street==="TURN"){this.street="RIVER";this.burn();this.board.push(this.deck.pop());}
    }
    this.log("AUTO_RUNOUT",{board:this.board}); this.showdown();
  }
  finishByFold(winner){
    const pots=buildPots(this.players), winners= pots.map(()=>[winner.id]);
    payout(pots,this.players,winners,this.buttonSeat);
    this.result={type:"FOLD_WIN",winnerIds:[winner.id],pots};
    this.street="FINISHED";this.actorId=null;this.log("PAYOUT",{pots,winners});
    this.syncStacks();
  }
  showdown(){
    const eligible=this.players.filter(p=>p.status!=="FOLDED"&&p.status!=="SITTING_OUT");
    const scores=new Map(eligible.map(p=>[p.id,best7([...p.hole,...this.board])]));
    const pots=buildPots(this.players), winners=[];
    for(const pot of pots){
      const es=pot.eligible.map(id=>scores.get(id)).filter(Boolean);
      let best=es[0].score; let ids=[];
      for(const id of pot.eligible){const s=scores.get(id);if(!s)continue;const c=cmp(s.score,best);if(c>0){best=s.score;ids=[id];}else if(c===0)ids.push(id);}
      winners.push(ids);
    }
    payout(pots,this.players,winners,this.buttonSeat);
    this.result={type:"SHOWDOWN",winners,winnersByPot:winners,pots,scores:Object.fromEntries([...scores].map(([id,v])=>[id,{category:category[v.score[0]],score:v.score,cards:v.cards}]))};
    this.street="FINISHED";this.actorId=null;this.log("SHOWDOWN",{winners,winnersByPot:winners});this.log("PAYOUT",{pots,winners});this.syncStacks();
  }
  syncStacks(){for(const hp of this.players){const rp=this.room.players.find(p=>p.id===hp.id);if(rp)rp.stack=hp.stack;}}
  snapshot(viewer){
    return {handId:this.id,street:this.street,board:this.board,currentBet:this.currentBet,lastFullRaise:this.lastFullRaise,actorId:this.actorId,
      buttonSeat:this.buttonSeat,sbId:this.sbId,bbId:this.bbId,players:this.players.map(p=>({...p,hole:p.id===viewer||this.street==="FINISHED"?p.hole:["XX","XX"]})),
      result:this.result||null,events:this.events.slice(-80)};
  }
}

function aiAction(hand, botId){
  const p=hand.players.find(x=>x.id===botId); if(!p||hand.actorId!==botId)return;
  const need=Math.max(0,hand.currentBet-p.streetContribution);
  const strength=RANK_VALUE[p.hole[0][0]]+RANK_VALUE[p.hole[1][0]];
  let action;
  if(need===0){ action = strength>=24 && hand.currentBet===0 ? {type:"BET",amount:Math.min(p.stack,hand.room.bb*2)} : {type:"CHECK"}; }
  else if(strength>=25) action={type:"CALL",amount:need};
  else if(strength<14) action={type:"FOLD"};
  else action={type:"CALL",amount:need};
  try{hand.apply(botId,{...action,id:uid()});}catch{hand.apply(botId,{type:need?"CALL":"CHECK",amount:need,id:uid()});}
  broadcast(hand.room);
}

function createRoom(ws){
  let code; do code=roomCode(); while(rooms.has(code));
  const room={code,bb:100,sb:50,buttonSeat:0,players:[],hand:null,sockets:new Map(),createdAt:Date.now()};
  rooms.set(code,room); return room;
}
function publicRoom(room,viewer){
  return {code:room.code,players:room.players.map(p=>({id:p.id,name:p.name,seat:p.seat,stack:p.stack,sittingOut:p.sittingOut})),hand:room.hand?.snapshot(viewer)||null};
}
function broadcast(room){
  for(const [id,ws] of room.sockets){if(ws.readyState===1)ws.send(JSON.stringify({type:"STATE",state:publicRoom(room,id)}));}
}
function send(ws,type,data){if(ws.readyState===1)ws.send(JSON.stringify({type,...data}));}
function startHand(room){
  if(room.hand && room.hand.street!=="FINISHED")return;
  const eligible=room.players.filter(p=>!p.sittingOut && p.stack>0);
  if(eligible.length<2)throw new Error("NEED_TWO_PLAYERS");
  room.hand=new Hand(room);
  broadcast(room);
  maybeBot(room);
}
function maybeBot(room){
  if(!room.hand)return;
  const actor=room.hand.players.find(p=>p.id===room.hand.actorId);
  if(actor && actor.isBot)setTimeout(()=>aiAction(room.hand,actor.id),350);
}
function addPlayer(room,ws,name,isBot=false){
  if(room.players.length>=10)throw new Error("TABLE_FULL");
  const used=new Set(room.players.map(p=>p.seat)); let seat=0;while(used.has(seat))seat++;
  const p={id:uid(),name:String(name||"Player").slice(0,20),seat,stack:10000,sittingOut:false,isBot};
  room.players.push(p);room.sockets.set(p.id,ws);return p;
}
function handle(ws,msg,session){
  if(!msg||typeof msg!=="object")throw new Error("BAD_MESSAGE");
  if(msg.type==="CREATE"){const room=createRoom(ws),p=addPlayer(room,ws,msg.name,false);session.room=room;session.id=p.id;send(ws,"ROOM",{room:publicRoom(room,p.id)});return;}
  if(msg.type==="JOIN"){const room=rooms.get(String(msg.code||"").toUpperCase());if(!room)throw new Error("ROOM_NOT_FOUND");const p=addPlayer(room,ws,msg.name,false);session.room=room;session.id=p.id;send(ws,"ROOM",{room:publicRoom(room,p.id)});broadcast(room);return;}
  if(msg.type==="LOCAL_BOT"){const room=createRoom(ws),p=addPlayer(room,ws,msg.name,false);const bot={id:uid(),name:"Astra • AI",seat:1,stack:10000,sittingOut:false,isBot:true};room.players.push(bot);room.sockets.set(p.id,ws);session.room=room;session.id=p.id;startHand(room);return;}
  if(!session.room)throw new Error("NOT_IN_ROOM");
  const room=session.room;
  if(msg.type==="START"){startHand(room);broadcast(room);maybeBot(room);return;}
  if(msg.type==="ACTION"){
    if(!room.hand)throw new Error("NO_HAND");
    const a=msg.action||{}; if(typeof a.id!=="string")throw new Error("ACTION_ID_REQUIRED");
    room.hand.apply(session.id,a); broadcast(room); maybeBot(room); return;
  }
  if(msg.type==="NEW_HAND"){startHand(room);broadcast(room);maybeBot(room);return;}
  if(msg.type==="RESYNC"){send(ws,"STATE",{state:publicRoom(room,session.id)});return;}
  throw new Error("UNKNOWN_COMMAND");
}
function serve(req,res){
  let u=req.url.split("?")[0]; if(u==="/")u="/index.html";
  const safePath = path.normalize(u).replace(/^([.][.][\\/])+/, "");
  const f=path.join(ROOT, safePath); if(!f.startsWith(ROOT)){res.writeHead(403);return res.end();}
  fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end("Not found");}
    const ext=path.extname(f),ct={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"}[ext]||"application/octet-stream";
    res.writeHead(200,{"Content-Type":ct,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'"});res.end(d);
  });
}
const server=http.createServer(serve);
const wss=new WebSocketServer({server});
wss.on("connection",ws=>{
  const session={room:null,id:null};
  ws.on("message",buf=>{
    try{handle(ws,JSON.parse(buf.toString()),session);}
    catch(e){send(ws,"ERROR",{message:e.message||"SERVER_ERROR"});}
  });
  ws.on("close",()=>{if(session.room&&session.id){session.room.sockets.delete(session.id);const p=session.room.players.find(x=>x.id===session.id);if(p)p.sittingOut=true;broadcast(session.room);}});
});
if (require.main === module) server.listen(PORT,()=>console.log(`Premium Poker running at http://localhost:${PORT}`));

module.exports={evaluate5,best7,buildPots,payout,makeDeck,secureShuffle};
