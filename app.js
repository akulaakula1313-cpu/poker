const $=id=>document.getElementById(id);
let ws=null,me=null,state=null;
function connect(msg){
  ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host);
  ws.onopen=()=>{ $("status").textContent="CONNECTED"; ws.send(JSON.stringify(msg)); };
  ws.onclose=()=>{$("status").textContent="DISCONNECTED"};
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==="ERROR")alert(m.message);if(m.type==="ROOM"){state=m.room;render();}if(m.type==="STATE"){state=m.state;render();}};
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
  const h=state.hand;$("room").textContent=`ROOM ${state.code||"LOCAL"}`;$("street").textContent=h?` • ${h.street}`:"";
  if(!h){$("turn").textContent="Ожидание игроков";return}
  $("board").innerHTML=h.board.map(c=>cardView(c)).join("");
  const pot=(h.events||[]).filter(e=>e.type==="CHIPS_COMMITTED").reduce((a,e)=>a+Number(e.amount||0),0);
  $("pot").textContent=`POT ${pot}`;
  const ps=h.players||[];$("seats").innerHTML=ps.map((p,i)=>{
    const ang=(i/Math.max(ps.length,1))*Math.PI*2-Math.PI/2,x=50+41*Math.cos(ang),y=50+37*Math.sin(ang);
    const isMe=p.id===getMe(); const active=p.id===h.actorId;
    return `<div class="seat ${isMe?"me ":""}${active?"active":""}" style="left:${x}%;top:${y}%">
      <div class="seat-name">${p.name}${p.isDealer?" ◉":""}</div><div class="chips">🪙 ${p.stack}</div>
      <div class="hole">${(p.hole||[]).map(c=>cardView(c,c==="XX")).join("")}</div>
      <small>${p.status}</small></div>`;
  }).join("");
  const actor=ps.find(p=>p.id===h.actorId);$("turn").textContent=actor?`Ход: ${actor.name}`:"";
  $("log").innerHTML=(h.events||[]).slice(-30).reverse().map(e=>`<div>#${e.seq} ${e.type} ${e.playerId?e.playerId.slice(0,5):""} ${e.amount??""}</div>`).join("");
  if(h.result){
    const ids=(h.result.winners||h.result.winnerIds||[]).flat(); const names=ids.map(id=>ps.find(p=>p.id===id)?.name||id).join(", ");
    $("result").innerHTML=`<b>${h.result.type}</b><br>Winner: ${names||"—"}`;
  } else $("result").textContent="Hand in progress";
}
function getMe(){if(me)return me; const n=$("name").value; return state?.players?.find(p=>p.name===n)?.id||state?.hand?.players?.find(p=>p.name===n)?.id||null}
