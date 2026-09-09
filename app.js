
function ruStreet(v){
  return ({WAITING:"ОЖИДАНИЕ",PRE_FLOP:"ПРЕФЛОП",FLOP:"ФЛОП",TURN:"ТЁРН",RIVER:"РИВЕР",SHOWDOWN:"ВСКРЫТИЕ",PAYOUT:"ВЫПЛАТА",FINISHED:"ЗАВЕРШЕНО"}[v]||v||"");
}
function ruStatus(v){
  return ({WAITING:"ОЖИДАНИЕ",ACTIVE:"ХОДИТ",FOLDED:"СБРОСИЛ",ALL_IN:"ОЛЛ-ИН",SITTING_OUT:"НЕ ИГРАЕТ",DISCONNECTED:"ОТКЛЮЧЁН",OUT:"ВЫБЫЛ"}[v]||v||"");
}
function ruEvent(v){
  return ({
    HAND_STARTED:"НАЧАЛО РАЗДАЧИ",BLINDS_POSTED:"БЛАЙНДЫ",CARDS_DEALT:"КАРТЫ РАЗДАНЫ",
    FOLD:"ПАС",CHECK:"ЧЕК",CALL:"КОЛЛ",BET:"СТАВКА",RAISE:"ПОВЫШЕНИЕ",ALL_IN:"ОЛЛ-ИН",
    FLOP:"ФЛОП",TURN:"ТЁРН",RIVER:"РИВЕР",SHOWDOWN:"ВСКРЫТИЕ",
    POT_AWARDED:"БАНК ВЫПЛАЧЕН",HAND_FINISHED:"РАЗДАЧА ЗАВЕРШЕНА"
  }[v]||v||"СОБЫТИЕ");
}
function ruResult(v){
  return ({FOLD_WIN:"ПОБЕДА — ВСЕ СБРОСИЛИ",SHOWDOWN:"ВСКРЫТИЕ"}[v]||v||"РЕЗУЛЬТАТ");
}
function ruError(v){
  return ({
    SHOWDOWN_REQUIRES_5_CARDS:"Для вскрытия нужно 5 общих карт.",
    POT_WITHOUT_WINNER:"Невозможно определить победителя банка.",
    NOT_YOUR_TURN:"Сейчас не ваш ход.",
    PLAYER_CANNOT_ACT:"Игрок не может выполнить действие.",
    CHECK_NOT_ALLOWED:"Чек сейчас недоступен.",
    NOTHING_TO_CALL:"Нет ставки для колла.",
    BET_NOT_ALLOWED:"Ставка сейчас недоступна.",
    INVALID_BET:"Некорректный размер ставки.",
    BET_TOO_SMALL:"Ставка слишком мала.",
    RAISE_NOT_ALLOWED:"Повышение сейчас недоступно.",
    INVALID_RAISE:"Некорректный размер повышения.",
    RAISE_TOO_SMALL:"Повышение слишком мало.",
    UNKNOWN_ACTION:"Неизвестное действие.",
    NEED_TWO_PLAYERS:"Нужно минимум два игрока.",
    TABLE_FULL:"Стол заполнен.",
    BAD_MESSAGE:"Некорректное сообщение.",
    ROOM_NOT_FOUND:"Комната не найдена.",
    NOT_IN_ROOM:"Вы не находитесь за столом.",
    NO_HAND:"Активной раздачи нет.",
    ACTION_ID_REQUIRED:"Не указан идентификатор действия.",
    UNKNOWN_COMMAND:"Неизвестная команда.",
    SERVER_ERROR:"Ошибка сервера."
  }[v]||v||"Ошибка");
}
const $=id=>document.getElementById(id);
let ws=null,me=null,state=null;
function connect(msg){
  ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host);
  ws.onopen=()=>{ $("status").textContent="ПОДКЛЮЧЕНО"; ws.send(JSON.stringify(msg)); };
  ws.onclose=()=>{$("status").textContent="НЕ ПОДКЛЮЧЕНО"};
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==="ERROR")alert(ruError(m.message));if(m.type==="ROOM"){state=m.room;render();}if(m.type==="STATE"){state=m.state;render();}};
}
function send(type,data={}){if(ws?.readyState===1)ws.send(JSON.stringify({type,...data}))}
$("bot").onclick=()=>connect({type:"LOCAL_BOT",name:$("name").value});
$("create").onclick=()=>connect({type:"CREATE",name:$("name").value});
$("join").onclick=()=>connect({type:"JOIN",code:$("code").value,name:$("name").value});
$("newHand").onclick=()=>send("NEW_HAND");
document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>{
  if(!state?.hand)return;
  const type=b.dataset.action, amount=Number($("amount").value);
  send("ACTION",{action:{id:crypto.randomUUID(),type,amount}});
});
function suit(c){return c==="s"?"♠":c==="h"?"♥":c==="d"?"♦":"♣"}
function cardView(c,hidden=false){if(hidden)return `<div class="cardx back">?</div>`;if(!c||c==="XX")return `<div class="cardx back">?</div>`;const r=c[0],s=c[1];return `<div class="cardx ${s==="h"||s==="d"?"red":""}">${r}${suit(s)}</div>`}
function render(){
  $("lobby").classList.add("hidden");$("table").classList.remove("hidden");
  if(!state)return;
  const h=state.hand;$("room").textContent=`КОМНАТА ${state.code||"ЛОКАЛЬНАЯ"}`;$("street").textContent=h?` • ${ruStreet(h.street)}`:"";
  if(!h){$("turn").textContent="Ожидание игроков";return}
  $("board").innerHTML=h.board.map(c=>cardView(c)).join("");
  const pot=(h.events||[]).filter(e=>e.type==="CHIPS_COMMITTED").reduce((a,e)=>a+Number(e.amount||0),0);
  $("pot").textContent=`БАНК ${pot}`;
  const ps=h.players||[];$("seats").innerHTML=ps.map((p,i)=>{
    const ang=(i/Math.max(ps.length,1))*Math.PI*2-Math.PI/2,x=50+41*Math.cos(ang),y=50+37*Math.sin(ang);
    const isMe=p.id===getMe(); const active=p.id===h.actorId;
    return `<div class="seat ${isMe?"me ":""}${active?"active":""}" style="left:${x}%;top:${y}%">
      <div class="seat-name">${p.name}${p.isDealer?" ◉":""}</div><div class="chips">🪙 ${p.stack}</div>
      <div class="hole">${(p.hole||[]).map(c=>cardView(c,c==="XX")).join("")}</div>
      <small>${ruStatus(p.status)}</small></div>`;
  }).join("");
  const actor=ps.find(p=>p.id===h.actorId);$("turn").textContent=actor?`Ход: ${actor.name}`:"";
  $("log").innerHTML=(h.events||[]).slice(-30).reverse().map(e=>`<div><b>#${e.seq}</b> ${ruEvent(e.type)} ${e.playerId?e.playerId.slice(0,5):""} ${e.amount??""}</div>`).join("");
  if(h.result){
    const ids=(h.result.winners||h.result.winnerIds||[]).flat(); const names=ids.map(id=>ps.find(p=>p.id===id)?.name||id).join(", ");
    $("result").innerHTML=`<b>${ruResult(h.result.type)}</b><br>Победитель: ${names||"—"}`;
  } else $("result").textContent="Раздача продолжается";
}
function getMe(){if(me)return me; const n=$("name").value; return state?.players?.find(p=>p.name===n)?.id||state?.hand?.players?.find(p=>p.name===n)?.id||null}
