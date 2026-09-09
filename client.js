var $=function(s){return document.querySelector(s)};
var SUIT_SYM={s:'\u2660',h:'\u2665',d:'\u2666',c:'\u2663'};
var SUIT_COLOR={s:'#e0e0e0',h:'#ff4444',d:'#ff4444',c:'#e0e0e0'};
var state={screen:'home',tableId:null,mySeat:-1,tableState:null,pollTimer:null,me:null};

function api(url,body){
  var token=localStorage.getItem('poker_token');
  var opts={headers:{'Content-Type':'application/json'}};
  if(token)opts.headers['Authorization']='Bearer '+token;
  if(body){opts.method='POST';opts.body=JSON.stringify(body)}
  return fetch(url,opts).then(function(r){return r.json()});
}

function openModal(html){$('#modalContent').innerHTML=html;$('#modalOverlay').hidden=false}
function closeModal(){$('#modalOverlay').hidden=true}

function showError(msg){
  var el=$('#authError');
  if(el){el.textContent=msg;el.style.display='block'}
}

function init(){
  $('#homeScreen').hidden=false;
  $('#tableScreen').hidden=true;
  if(localStorage.getItem('poker_token')){
    loadState();
  }else{
    showAuth();
  }
  $('#modalOverlay').onclick=function(e){if(e.target===$('#modalOverlay'))closeModal()};
}

function showHome(){
  state.screen='home';state.tableId=null;
  if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=null}
  $('#homeScreen').hidden=false;$('#tableScreen').hidden=true;
  loadState();
}

function showAuth(){
  state.screen='auth';state.me=null;
  if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=null}
  $('#homeScreen').hidden=false;$('#tableScreen').hidden=true;
  $('#homeScreen').innerHTML='<div class="auth-box">'+
    '<div class="logo">\u2660 SANI POKER \u2665</div>'+
    '<div class="auth-form">'+
    '<input id="authUser" type="text" placeholder="Username" autocomplete="username">'+
    '<input id="authPass" type="password" placeholder="Password" autocomplete="current-password">'+
    '<div id="authError" class="auth-error" style="display:none"></div>'+
    '<div class="auth-buttons">'+
    '<button class="btn-gold" id="btnLogin">Login</button>'+
    '<button class="btn-secondary" id="btnRegister">Register</button>'+
    '</div></div></div>';
  $('#btnLogin').onclick=doLogin;
  $('#btnRegister').onclick=doRegister;
  $('#authPass').onkeydown=function(e){if(e.key==='Enter')doLogin()};
  $('#authUser').onkeydown=function(e){if(e.key==='Enter')doLogin()};
}

function doLogin(){
  var u=$('#authUser').value.trim();
  var p=$('#authPass').value;
  if(!u||!p){showError('Fill in all fields');return}
  showError('');
  $('#btnLogin').textContent='Loading...';
  $('#btnLogin').disabled=true;
  api('/api/login',{username:u,password:p}).then(function(r){
    $('#btnLogin').textContent='Login';
    $('#btnLogin').disabled=false;
    if(r.error){showError(r.error);return}
    localStorage.setItem('poker_token',r.token);
    state.me={uid:r.uid,username:r.username,displayName:r.displayName,chips:r.chips,vip:r.vip};
    loadState();
  }).catch(function(e){
    $('#btnLogin').textContent='Login';
    $('#btnLogin').disabled=false;
    showError('Connection error');
  });
}

function doRegister(){
  var u=$('#authUser').value.trim();
  var p=$('#authPass').value;
  if(!u||!p){showError('Fill in all fields');return}
  if(u.length<2){showError('Username min 2 chars');return}
  if(p.length<4){showError('Password min 4 chars');return}
  showError('');
  $('#btnRegister').textContent='Loading...';
  $('#btnRegister').disabled=true;
  api('/api/register',{username:u,password:p}).then(function(r){
    $('#btnRegister').textContent='Register';
    $('#btnRegister').disabled=false;
    if(r.error){showError(r.error);return}
    localStorage.setItem('poker_token',r.token);
    state.me={uid:r.uid,username:r.username,displayName:r.displayName,chips:r.chips,vip:r.vip};
    loadState();
  }).catch(function(e){
    $('#btnRegister').textContent='Register';
    $('#btnRegister').disabled=false;
    showError('Connection error');
  });
}

function loadState(){
  api('/api/state').then(function(r){
    if(r.error){
      localStorage.removeItem('poker_token');
      showAuth();
      return;
    }
    state.me=r.user;
    renderHome(r.user,r.tables);
  }).catch(function(e){
    showAuth();
  });
}

function renderHome(user,tables){
  state.screen='home';$('#homeScreen').hidden=false;$('#tableScreen').hidden=true;
  var html='<div class="top-bar"><div class="logo-small">\u2660 SANI POKER</div><div class="user-info"><span class="chips-display">\uD83D\uDCB0 '+user.chips.toLocaleString()+'</span><span class="username-display">'+user.displayName+'</span></div></div>';
  html+='<div class="menu-cards">';
  html+='<div class="mode-card" id="mcCreate"><div class="mode-icon">\uD83C\uDCCF</div><div class="mode-title">Create Table</div><div class="mode-desc">Host a new game</div></div>';
  html+='<div class="mode-card" id="mcQuick"><div class="mode-icon">\uD83E\uDD16</div><div class="mode-title">Quick Play</div><div class="mode-desc">Play vs AI bots</div></div>';
  html+='<div class="mode-card" id="mcRefresh"><div class="mode-icon">\uD83D\uDD04</div><div class="mode-title">Refresh</div><div class="mode-desc">Update tables</div></div>';
  html+='</div>';
  html+='<div class="tables-section"><h3>Open Tables</h3><div id="tablesList" class="tables-list">';
  if(tables&&tables.length>0){
    for(var i=0;i<tables.length;i++){
      var t=tables[i];
      var sc=t.state==='WAITING'?'#44cc44':t.state==='SHOWDOWN'?'#ffcc00':'#ff6644';
      html+='<div class="table-row" data-tid="'+t.id+'"><span class="table-name">'+t.name+'</span><span class="table-blinds">'+t.sb+'/'+t.bb+'</span><span class="table-players">'+t.players+'/10</span><span class="table-state" style="color:'+sc+'">'+t.state+'</span></div>';
    }
  }else{
    html+='<div class="empty-list">No tables yet. Create one!</div>';
  }
  html+='</div></div>';
  $('#homeScreen').innerHTML=html;
  $('#mcCreate').onclick=showCreateTable;
  $('#mcQuick').onclick=showQuickPlay;
  $('#mcRefresh').onclick=loadState;
  var rows=document.querySelectorAll('.table-row');
  for(var j=0;j<rows.length;j++){
    (function(row){
      row.onclick=function(){joinTable(row.getAttribute('data-tid'))};
    })(rows[j]);
  }
}

function showCreateTable(){
  openModal('<div class="hint-modal"><h2>Create Table</h2><div class="form-group"><label>Blinds</label><div class="blind-options" id="blindOpts">'+
    '<button class="btn-blind active" data-sb="50" data-bb="100">50/100</button>'+
    '<button class="btn-blind" data-sb="100" data-bb="200">100/200</button>'+
    '<button class="btn-blind" data-sb="250" data-bb="500">250/500</button>'+
    '<button class="btn-blind" data-sb="500" data-bb="1000">500/1000</button>'+
    '</div></div><div class="modal-buttons">'+
    '<button class="btn-gold" id="btnDoCreate">Create</button>'+
    '<button class="btn-secondary" id="btnCancelCreate">Cancel</button>'+
    '</div></div>');
  var createBlinds=[50,100];
  var btns=document.querySelectorAll('.btn-blind');
  for(var i=0;i<btns.length;i++){
    btns[i].onclick=function(){
      for(var j=0;j<btns.length;j++)btns[j].classList.remove('active');
      this.classList.add('active');
      createBlinds=[parseInt(this.getAttribute('data-sb')),parseInt(this.getAttribute('data-bb'))];
    };
  }
  $('#btnDoCreate').onclick=function(){
    api('/api/table/create',{blinds:createBlinds}).then(function(r){
      if(r.error){alert(r.error);return}
      closeModal();
      enterTable(r.tableId,r.seat);
    });
  };
  $('#btnCancelCreate').onclick=closeModal;
}

function showQuickPlay(){
  api('/api/table/create',{blinds:[50,100],tableName:'Quick Play'}).then(function(r){
    if(r.error){alert(r.error);return}
    return api('/api/table/bot',{tableId:r.tableId}).then(function(){
      return api('/api/table/bot',{tableId:r.tableId});
    }).then(function(){
      enterTable(r.tableId,r.seat);
    });
  });
}

function joinTable(tableId){
  api('/api/table/join',{tableId:tableId,buyIn:10000}).then(function(r){
    if(r.error){alert(r.error);return}
    enterTable(tableId,r.seat);
  });
}

function enterTable(tableId,seat){
  state.tableId=tableId;state.mySeat=seat;state.screen='table';
  $('#homeScreen').hidden=true;$('#tableScreen').hidden=false;
  startPolling();
}

function startPolling(){
  if(state.pollTimer)clearInterval(state.pollTimer);
  pollTable();
  state.pollTimer=setInterval(pollTable,1000);
}

function pollTable(){
  if(!state.tableId||state.screen!=='table')return;
  api('/api/table/state?tableId='+state.tableId).then(function(r){
    if(r.error){
      if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=null}
      showHome();
      return;
    }
    state.tableState=r;state.mySeat=r.mySeat;
    renderTable(r);
  }).catch(function(){});
}

function renderTable(ts){
  var me=null;
  for(var i=0;i<ts.players.length;i++){
    if(ts.players[i].isMe){me=ts.players[i];break}
  }
  var container=$('#tableScreen');
  var isMyTurn=ts.actorSeat===state.mySeat&&ts.state!=='WAITING'&&ts.state!=='SHOWDOWN';
  var community=ts.community||[];
  var html='<div class="top-bar"><button class="btn-back" id="btnBack">&larr;</button><div class="logo-small">\u2660 '+ts.name+'</div><div class="chips-display">\uD83D\uDCB0 '+(me?me.stack.toLocaleString():'0')+'</div></div>';
  html+='<div class="table-area"><div class="felt"><div class="table-oval">';
  html+='<div class="community-area"><div class="board-cards">';
  for(var c=0;c<community.length;c++) html+=renderCard(community[c]);
  html+='</div><div class="pot-area">';
  if(ts.pots&&ts.pots.length>0){
    var totalPot=0;
    for(var pi=0;pi<ts.pots.length;pi++) totalPot+=ts.pots[pi].amount;
    html+='<div class="pot-chips">\uD83D\uDCB0 '+totalPot.toLocaleString()+'</div>';
    for(var si=1;si<ts.pots.length;si++) html+='<div class="side-pot">Side '+si+': '+ts.pots[si].amount.toLocaleString()+'</div>';
  }
  html+='</div><div class="street-label">'+(ts.currentStreet||'')+'</div></div>';
  var seatPos=getSeatPositions(ts.players.length);
  for(var pi2=0;pi2<ts.players.length;pi2++){
    var p=ts.players[pi2];
    var pos=null;
    for(var si2=0;si2<seatPos.length;si2++){if(seatPos[si2].seat===p.seat){pos=seatPos[si2];break}}
    if(!pos)continue;
    var isActive=ts.actorSeat===p.seat;
    html+='<div class="seat '+(isActive?'active-seat':'')+' '+(p.isMe?'my-seat':'')+'" style="left:'+pos.x+'%;top:'+pos.y+'%">';
    html+='<div class="player-box '+(p.folded?'folded':'')+'">';
    html+='<div class="player-name">'+p.name+'</div>';
    html+='<div class="player-cards">';
    for(var ci=0;ci<p.holeCards.length;ci++){
      html+=(p.holeCards[ci]==='?'?'<div class="card card-back">\uD83D\uDC1E</div>':renderCard(p.holeCards[ci]));
    }
    html+='</div>';
    html+='<div class="player-stack">\uD83D\uDCB0 '+p.stack.toLocaleString()+'</div>';
    html+='<div class="player-action">'+p.lastAction+(p.streetBet>0?' '+p.streetBet.toLocaleString():'')+'</div>';
    if(p.isDealer)html+='<div class="dealer-badge">D</div>';
    if(p.isSB)html+='<div class="blind-badge sb-badge">SB</div>';
    if(p.isBB)html+='<div class="blind-badge bb-badge">BB</div>';
    html+='</div></div>';
  }
  html+='</div></div>';
  if(ts.state!=='WAITING') html+='<div class="timer-bar"><div class="timer-fill" id="timerFill" style="width:'+getTimerPercent(ts)+'%"></div></div>';
  html+='<div class="action-bar">';
  if(isMyTurn&&me){
    var toCall=ts.currentBet-me.streetBet;
    var minRaise=ts.currentBet+ts.lastFullRaise;
    var canCheck=toCall<=0;
    var potTotal=0;
    for(var k=0;k<ts.pots.length;k++) potTotal+=ts.pots[k].amount;
    potTotal+=me.streetBet+toCall;
    html+='<button class="btn-action btn-fold" id="actFold">Fold</button>';
    if(canCheck){
      html+='<button class="btn-action btn-check" id="actCheck">Check</button>';
    }else{
      html+='<button class="btn-action btn-call" id="actCall">Call '+toCall.toLocaleString()+'</button>';
    }
    if(!me.isAllIn){
      if(toCall>0&&me.stack<=toCall){
        html+='<button class="btn-action btn-allin" id="actAllin">All In '+me.stack.toLocaleString()+'</button>';
      }else{
        html+='<div class="raise-controls">';
        html+='<button class="btn-action btn-raise" id="actRaise">Raise</button>';
        html+='<input type="range" id="raiseSlider" min="'+minRaise+'" max="'+(me.stack+me.streetBet)+'" value="'+minRaise+'" class="raise-slider">';
        html+='<div id="raiseLabel" class="raise-label">'+minRaise.toLocaleString()+'</div>';
        html+='<div class="raise-presets">';
        html+='<button class="btn-preset" id="rpMin">Min</button>';
        html+='<button class="btn-preset" id="rpHalf">1/2 Pot</button>';
        html+='<button class="btn-preset" id="rpPot">Pot</button>';
        html+='<button class="btn-preset" id="rpHalfStack">1/2 Stack</button>';
        html+='<button class="btn-preset btn-allin-preset" id="actAllin2">All In</button>';
        html+='</div></div>';
      }
    }
  }else if(ts.state==='WAITING'){
    html+='<div class="waiting-msg">Waiting for players...</div>';
    if(ts.lastHandResult){
      html+='<div class="last-result">\uD83C\uDFC6 '+ts.lastHandResult.winner+' won '+ts.lastHandResult.amount.toLocaleString()+' with '+ts.lastHandResult.hand+'</div>';
    }
  }else if(ts.state==='SHOWDOWN'){
    html+='<div class="showdown-msg">Showdown!</div>';
    if(ts.lastHandResult){
      html+='<div class="last-result">\uD83C\uDFC6 '+ts.lastHandResult.winner+' won '+ts.lastHandResult.amount.toLocaleString()+' with '+ts.lastHandResult.hand+'</div>';
    }
  }else{
    var actorName=null;
    for(var ai=0;ai<ts.players.length;ai++){if(ts.players[ai].seat===ts.actorSeat){actorName=ts.players[ai].name;break}}
    html+='<div class="waiting-msg">Waiting for '+(actorName||'...')+' to act</div>';
  }
  html+='</div></div>';
  container.innerHTML=html;
  bindEvents(ts,me);
}

function bindEvents(ts,me){
  var btnBack=$('#btnBack');
  if(btnBack) btnBack.onclick=leaveTable;
  var actFold=$('#actFold');
  if(actFold) actFold.onclick=function(){doAction('fold')};
  var actCheck=$('#actCheck');
  if(actCheck) actCheck.onclick=function(){doAction('check')};
  var actCall=$('#actCall');
  if(actCall) actCall.onclick=function(){doAction('call')};
  var actAllin=$('#actAllin');
  if(actAllin) actAllin.onclick=function(){doAction('allin')};
  var actAllin2=$('#actAllin2');
  if(actAllin2) actAllin2.onclick=function(){doAction('allin')};
  var actRaise=$('#actRaise');
  if(actRaise) actRaise.onclick=function(){
    var s=$('#raiseSlider');
    if(s) doRaise(parseInt(s.value));
  };
  var slider=$('#raiseSlider');
  if(slider){
    slider.oninput=function(){
      var l=$('#raiseLabel');
      if(l) l.textContent=parseInt(slider.value).toLocaleString();
    };
  }
  var rpMin=$('#rpMin');
  if(rpMin) rpMin.onclick=function(){var s=$('#raiseSlider');if(s){s.value=s.min;var l=$('#raiseLabel');if(l)l.textContent=parseInt(s.min).toLocaleString()}};
  var rpHalf=$('#rpHalf');
  if(rpHalf) rpHalf.onclick=function(){var s=$('#raiseSlider');if(s){var v=Math.floor(parseInt(s.max)*0.5);s.value=v;var l=$('#raiseLabel');if(l)l.textContent=v.toLocaleString()}};
  var rpPot=$('#rpPot');
  if(rpPot) rpPot.onclick=function(){var s=$('#raiseSlider');if(s){var v=parseInt(s.max);s.value=v;var l=$('#raiseLabel');if(l)l.textContent=v.toLocaleString()}};
}

function renderCard(c){
  if(!c||c==='?')return'<div class="card card-back">\uD83D\uDC1E</div>';
  var rank=c[0]==='T'?'10':c[0];
  var suit=c[1];
  var sym=SUIT_SYM[suit]||'';
  var color=SUIT_COLOR[suit]||'#fff';
  return'<div class="card" style="color:'+color+'"><div class="card-rank">'+rank+'</div><div class="card-suit">'+sym+'</div></div>';
}

function getSeatPositions(count){
  var positions=[
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

function getTimerPercent(ts){
  if(!ts.turnDeadline)return 100;
  var remaining=Math.max(0,ts.turnDeadline-Date.now());
  return Math.min(100,(remaining/30000)*100);
}

function doAction(action){
  if(!state.tableId)return;
  api('/api/table/action',{tableId:state.tableId,action:action}).then(function(r){
    if(r.error) alert(r.error);
  });
}

function doRaise(amount){
  if(!state.tableId)return;
  api('/api/table/action',{tableId:state.tableId,action:'raise',amount:amount}).then(function(r){
    if(r.error) alert(r.error);
  });
}

function leaveTable(){
  if(state.tableId){
    api('/api/table/leave',{tableId:state.tableId}).then(function(){
      if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=null}
      state.tableId=null;
      showHome();
    });
  }else{
    if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=null}
    state.tableId=null;
    showHome();
  }
}

if(window.location.protocol==='file:'){
  document.body.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0e17;color:#e8e8e8;font-family:sans-serif;text-align:center;padding:20px">'+
    '<div><div style="font-size:2em;color:#d4a843;margin-bottom:20px">&#9824; SANI POKER &#9829;</div>'+
    '<p style="font-size:1.3em;margin-bottom:10px">Cannot run from file!</p>'+
    '<p style="color:#888;margin-bottom:10px">Open terminal and run:</p>'+
    '<code style="background:#151c2c;padding:12px 20px;border-radius:8px;display:inline-block;color:#d4a843;font-size:1.1em">cd "C:\\Users\\\u043e\u0444\u0444\u0438\u0441\u0435\\Desktop\\poker" && node server.js</code>'+
    '<p style="color:#888;margin-top:16px">Then open: <a href="http://localhost:3000" style="color:#d4a843">http://localhost:3000</a></p></div></div>';
}else{
  window.onload=init;
}
