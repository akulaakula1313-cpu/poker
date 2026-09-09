const $=s=>document.querySelector(s);
const SUIT_SYM={s:'\u2660',h:'\u2665',d:'\u2666',c:'\u2663'};
const SUIT_COLOR={s:'#e0e0e0',h:'#ff4444',d:'#ff4444',c:'#e0e0e0'};
let state={screen:'home',tableId:null,mySeat:-1,tableState:null,pollTimer:null,me:null};

function api(url,body){
  const token=localStorage.getItem('poker_token');
  const opts={headers:{'Content-Type':'application/json'}};
  if(token)opts.headers['Authorization']='Bearer '+token;
  if(body){opts.method='POST';opts.body=JSON.stringify(body)}
  return fetch(url,opts).then(r=>r.json());
}

function openModal(html){$('#modalContent').innerHTML=html;$('#modalOverlay').hidden=false}
function closeModal(){$('#modalOverlay').hidden=true}

function init(){
  if(localStorage.getItem('poker_token')){loadState()}else{showHome()}
  $('#modalOverlay').onclick=e=>{if(e.target===$('#modalOverlay'))closeModal()};
}

function showHome(){
  state.screen='home';state.tableId=null;
  if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=null}
  $('#homeScreen').hidden=false;$('#tableScreen').hidden=true;
  loadState();
}

async function loadState(){
  try{const r=await api('/api/state');if(r.error){showAuth();return}state.me=r.user;renderHome(r.user,r.tables)}catch(e){showAuth()}
}

function showAuth(){
  state.screen='auth';state.me=null;
  $('#homeScreen').innerHTML='<div class="auth-box"><div class="logo">\u2660 SANI POKER \u2665</div><div class="auth-form"><input id="authUser" type="text" placeholder="Username" autocomplete="username"><input id="authPass" type="password" placeholder="Password" autocomplete="current-password"><div class="auth-buttons"><button class="btn-gold" onclick="doLogin()">Login</button><button class="btn-secondary" onclick="doRegister()">Register</button></div></div></div>';
}

async function doLogin(){
  const u=$('#authUser').value.trim(),p=$('#authPass').value;
  if(!u||!p)return alert('Fill in all fields');
  const r=await api('/api/login',{username:u,password:p});
  if(r.error)return alert(r.error);
  localStorage.setItem('poker_token',r.token);
  state.me={uid:r.uid,username:r.username,displayName:r.displayName,chips:r.chips,vip:r.vip};loadState();
}

async function doRegister(){
  const u=$('#authUser').value.trim(),p=$('#authPass').value;
  if(!u||!p)return alert('Fill in all fields');
  const r=await api('/api/register',{username:u,password:p});
  if(r.error)return alert(r.error);
  localStorage.setItem('poker_token',r.token);
  state.me={uid:r.uid,username:r.username,displayName:r.displayName,chips:r.chips,vip:r.vip};loadState();
}

function renderHome(user,tables){
  state.screen='home';$('#homeScreen').hidden=false;$('#tableScreen').hidden=true;
  let html='<div class="top-bar"><div class="logo-small">\u2660 SANI POKER</div><div class="user-info"><span class="chips-display">\uD83D\uDCB0 '+user.chips.toLocaleString()+'</span><span class="username-display">'+user.displayName+'</span></div></div>';
  html+='<div class="menu-cards"><div class="mode-card" onclick="showCreateTable()"><div class="mode-icon">\uD83C\uDCCF</div><div class="mode-title">Create Table</div><div class="mode-desc">Host a new game</div></div>';
  html+='<div class="mode-card" onclick="showQuickPlay()"><div class="mode-icon">\uD83E\uDD16</div><div class="mode-title">Quick Play</div><div class="mode-desc">Play vs AI bots</div></div>';
  html+='<div class="mode-card" onclick="loadState()"><div class="mode-icon">\uD83D\uDD04</div><div class="mode-title">Refresh</div><div class="mode-desc">Update tables</div></div></div>';
  html+='<div class="tables-section"><h3>Open Tables</h3><div id="tablesList" class="tables-list">';
  if(tables&&tables.length>0){
    for(const t of tables){
      const sc=t.state==='WAITING'?'#44cc44':t.state==='SHOWDOWN'?'#ffcc00':'#ff6644';
      html+='<div class="table-row" onclick="joinTable(\''+t.id+'\')"><span class="table-name">'+t.name+'</span><span class="table-blinds">'+t.sb+'/'+t.bb+'</span><span class="table-players">'+t.players+'/10</span><span class="table-state" style="color:'+sc+'">'+t.state+'</span></div>';
    }
  }else{html+='<div class="empty-list">No tables yet. Create one!</div>'}
  html+='</div></div>';
  $('#homeScreen').innerHTML=html;
}

function showCreateTable(){
  openModal('<div class="hint-modal"><h2>Create Table</h2><div class="form-group"><label>Blinds</label><div class="blind-options"><button class="btn-blind active" onclick="selectBlind(this,50,100)">50/100</button><button class="btn-blind" onclick="selectBlind(this,100,200)">100/200</button><button class="btn-blind" onclick="selectBlind(this,250,500)">250/500</button><button class="btn-blind" onclick="selectBlind(this,500,1000)">500/1000</button></div></div><div class="modal-buttons"><button class="btn-gold" onclick="doCreateTable()">Create</button><button class="btn-secondary" onclick="closeModal()">Cancel</button></div></div>');
}

let createBlinds=[50,100];
function selectBlind(el,sb,bb){document.querySelectorAll('.btn-blind').forEach(b=>b.classList.remove('active'));el.classList.add('active');createBlinds=[sb,bb]}

async function doCreateTable(){const r=await api('/api/table/create',{blinds:createBlinds});if(r.error)return alert(r.error);closeModal();enterTable(r.tableId,r.seat)}
async function showQuickPlay(){const r=await api('/api/table/create',{blinds:[50,100],tableName:'Quick Play'});if(r.error)return alert(r.error);await api('/api/table/bot',{tableId:r.tableId});await api('/api/table/bot',{tableId:r.tableId});enterTable(r.tableId,r.seat)}
async function joinTable(tableId){const r=await api('/api/table/join',{tableId,buyIn:10000});if(r.error)return alert(r.error);enterTable(tableId,r.seat)}

function enterTable(tableId,seat){
  state.tableId=tableId;state.mySeat=seat;state.screen='table';
  $('#homeScreen').hidden=true;$('#tableScreen').hidden=false;startPolling();
}

function startPolling(){if(state.pollTimer)clearInterval(state.pollTimer);pollTable();state.pollTimer=setInterval(pollTable,1000)}

async function pollTable(){
  if(!state.tableId)return;
  try{const r=await api('/api/table/state?tableId='+state.tableId);if(r.error){showHome();return}state.tableState=r;state.mySeat=r.mySeat;renderTable(r)}catch(e){}
}

function renderTable(ts){
  const me=ts.players.find(p=>p.isMe);
  const container=$('#tableScreen');
  const isMyTurn=ts.actorSeat===state.mySeat&&ts.state!=='WAITING'&&ts.state!=='SHOWDOWN';
  const community=ts.community||[];
  let html='<div class="top-bar"><button class="btn-back" onclick="leaveTable()">&larr;</button><div class="logo-small">\u2660 '+ts.name+'</div><div class="chips-display">\uD83D\uDCB0 '+(me?me.stack.toLocaleString():'0')+'</div></div>';
  html+='<div class="table-area"><div class="felt"><div class="table-oval">';
  html+='<div class="community-area"><div class="board-cards">'+community.map(c=>renderCard(c)).join('')+'</div><div class="pot-area">';
  if(ts.pots&&ts.pots.length>0){
    const totalPot=ts.pots.reduce((s,p)=>s+p.amount,0);
    html+='<div class="pot-chips">\uD83D\uDCB0 '+totalPot.toLocaleString()+'</div>';
    for(let i=1;i<ts.pots.length;i++)html+='<div class="side-pot">Side '+i+': '+ts.pots[i].amount.toLocaleString()+'</div>';
  }
  html+='</div><div class="street-label">'+(ts.currentStreet||'')+'</div></div>';
  const seatPos=getSeatPositions(ts.players.length);
  for(const p of ts.players){
    const pos=seatPos.find(s=>s.seat===p.seat);if(!pos)continue;
    const isActive=ts.actorSeat===p.seat;
    html+='<div class="seat '+(isActive?'active-seat':'')+' '+(p.isMe?'my-seat':'')+'" style="left:'+pos.x+'%;top:'+pos.y+'%">';
    html+='<div class="player-box '+(p.folded?'folded':'')+'">';
    html+='<div class="player-name">'+p.name+'</div>';
    html+='<div class="player-cards">'+p.holeCards.map(c=>c==='?'?'<div class="card card-back">\uD83D\uDC1E</div>':renderCard(c)).join('')+'</div>';
    html+='<div class="player-stack">\uD83D\uDCB0 '+p.stack.toLocaleString()+'</div>';
    html+='<div class="player-action">'+p.lastAction+(p.streetBet>0?' '+p.streetBet.toLocaleString():'')+'</div>';
    if(p.isDealer)html+='<div class="dealer-badge">D</div>';
    if(p.isSB)html+='<div class="blind-badge sb-badge">SB</div>';
    if(p.isBB)html+='<div class="blind-badge bb-badge">BB</div>';
    html+='</div></div>';
  }
  html+='</div></div>';
  if(ts.state!=='WAITING')html+='<div class="timer-bar"><div class="timer-fill" style="width:'+getTimerPercent(ts)+'%"></div></div>';
  html+='<div class="action-bar">';
  if(isMyTurn){
    const toCall=ts.currentBet-(me?me.streetBet:0);
    const minRaise=ts.currentBet+ts.lastFullRaise;
    const canCheck=toCall===0;
    const potTotal=ts.pots.reduce((s,p)=>s+p.amount,0)+(me?me.streetBet:0)+toCall;
    html+='<button class="btn-action btn-fold" onclick="doAction(\'fold\')">Fold</button>';
    if(canCheck)html+='<button class="btn-action btn-check" onclick="doAction(\'check\')">Check</button>';
    else html+='<button class="btn-action btn-call" onclick="doAction(\'call\')">Call '+toCall.toLocaleString()+'</button>';
    if(!me.isAllIn){
      if(toCall>0&&me.stack<=toCall){
        html+='<button class="btn-action btn-allin" onclick="doAction(\'allin\')">All In '+me.stack.toLocaleString()+'</button>';
      }else{
      html+='<div class="raise-controls">';
      html+='<button class="btn-action btn-raise" onclick="doRaise()">Raise</button>';
      html+='<input type="range" id="raiseSlider" min="'+minRaise+'" max="'+(me.stack+me.streetBet)+'" value="'+minRaise+'" oninput="updateRaiseLabel()" class="raise-slider">';
      html+='<div id="raiseLabel" class="raise-label">'+minRaise.toLocaleString()+'</div>';
      html+='<div class="raise-presets">';
      html+='<button class="btn-preset" onclick="setRaise('+minRaise+')">Min</button>';
      html+='<button class="btn-preset" onclick="setRaise('+Math.floor(potTotal/2)+')">\u00BD Pot</button>';
      html+='<button class="btn-preset" onclick="setRaise('+potTotal+')">Pot</button>';
      html+='<button class="btn-preset" onclick="setRaise('+Math.floor(me.stack*0.5+me.streetBet)+')">\u00BD Stack</button>';
      html+='<button class="btn-preset btn-allin-preset" onclick="doAction(\'allin\')">All In</button>';
      html+='</div></div>';
      }
    }
  }else if(ts.state==='WAITING'){
    html+='<div class="waiting-msg">Waiting for players...</div>';
    if(ts.lastHandResult){
      html+='<div class="last-result">\uD83C\uDFC6 '+ts.lastHandResult.winner+' won '+ts.lastHandResult.amount.toLocaleString()+' with '+ts.lastHandResult.hand+'</div>';
    }
  }
  else if(ts.state==='SHOWDOWN'){
    html+='<div class="showdown-msg">Showdown!</div>';
    if(ts.lastHandResult){
      html+='<div class="last-result">\uD83C\uDFC6 '+ts.lastHandResult.winner+' won '+ts.lastHandResult.amount.toLocaleString()+' with '+ts.lastHandResult.hand+'</div>';
    }
  }
  else{
    const actorName=ts.players.find(p=>p.seat===ts.actorSeat);
    html+='<div class="waiting-msg">Waiting for '+(actorName?actorName.name:'...')+' to act</div>';
  }
  html+='</div></div>';
  container.innerHTML=html;
}

function renderCard(c){
  if(!c||c==='?')return'<div class="card card-back">\uD83D\uDC1E</div>';
  const rank=c[0]==='T'?'10':c[0];const suit=c[1];
  const sym=SUIT_SYM[suit]||'';const color=SUIT_COLOR[suit]||'#fff';
  return'<div class="card" style="color:'+color+'"><div class="card-rank">'+rank+'</div><div class="card-suit">'+sym+'</div></div>';
}

function getSeatPositions(count){
  const positions=[
    [{seat:0,x:45,y:80}],
    [{seat:0,x:35,y:80},{seat:1,x:65,y:80}],
    [{seat:0,x:15,y:75},{seat:1,x:45,y:85},{seat:2,x:75,y:75}],
    [{seat:0,x:10,y:60},{seat:1,x:35,y:85},{seat:2,x:65,y:85},{seat:3,x:85,y:60}],
    [{seat:0,x:5,y:50},{seat:1,x:25,y:85},{seat:2,x:55,y:85},{seat:3,x:75,y:85},{seat:4,x:92,y:50}],
    [{seat:0,x:5,y:35},{seat:1,x:15,y:75},{seat:2,x:40,y:90},{seat:3,x:60,y:90},{seat:4,x:80,y:75},{seat:5,x:92,y:35}],
    [{seat:0,x:5,y:25},{seat:1,x:12,y:60},{seat:2,x:30,y:88},{seat:3,x:55,y:88},{seat:4,x:75,y:60},{seat:5,x:88,y:25},{seat:6,x:50,y:5}],
    [{seat:0,x:5,y:20},{seat:1,x:12,y:50},{seat:2,x:25,y:82},{seat:3,x:50,y:90},{seat:4,x:75,y:82},{seat:5,x:88,y:50},{seat:6,x:92,y:20},{seat:7,x:50,y:2}],
    [{seat:0,x:5,y:18},{seat:1,x:10,y:42},{seat:2,x:22,y:75},{seat:3,x:42,y:90},{seat:4,x:62,y:90},{seat:5,x:80,y:75},{seat:6,x:90,y:42},{seat:7,x:92,y:18},{seat:8,x:50,y:2}],
    [{seat:0,x:3,y:15},{seat:1,x:8,y:38},{seat:2,x:18,y:68},{seat:3,x:35,y:88},{seat:4,x:55,y:88},{seat:5,x:72,y:68},{seat:6,x:85,y:38},{seat:7,x:92,y:15},{seat:8,x:50,y:2},{seat:9,x:5,y:2}]
  ];
  return positions[Math.min(count,10)-1]||positions[0];
}

function getTimerPercent(ts){if(!ts.turnDeadline)return 100;const remaining=Math.max(0,ts.turnDeadline-Date.now());return Math.min(100,(remaining/30000)*100)}
function updateRaiseLabel(){const s=$('#raiseSlider');const l=$('#raiseLabel');if(s&&l)l.textContent=parseInt(s.value).toLocaleString()}
function setRaise(amount){const s=$('#raiseSlider');if(s){s.value=Math.min(amount,parseInt(s.max));updateRaiseLabel()}}

async function doAction(action){if(!state.tableId)return;await api('/api/table/action',{tableId:state.tableId,action})}
async function doRaise(){const s=$('#raiseSlider');if(!s)return;if(!state.tableId)return;await api('/api/table/action',{tableId:state.tableId,action:'raise',amount:parseInt(s.value)})}

async function leaveTable(){
  if(state.tableId)await api('/api/table/leave',{tableId:state.tableId});
  if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=null}
  state.tableId=null;showHome();
}

window.addEventListener('load',init);
