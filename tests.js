const assert=require("assert");
const {evaluate5,best7,buildPots,payout,makeDeck,secureShuffle}=require("./server");
const deck=secureShuffle(makeDeck()); assert.equal(new Set(deck).size,52);
assert.equal(evaluate5(["As","Ks","Qs","Js","Ts"])[0],8);
assert.equal(evaluate5(["5s","4d","3h","2c","As"])[1],5);
assert.equal(best7(["As","Ks","Qs","Js","Ts","2c","2d"]).score[0],8);
const players=[
{id:"a",stack:0,totalContribution:100,status:"ACTIVE"},
{id:"b",stack:0,totalContribution:200,status:"ACTIVE"},
{id:"c",stack:0,totalContribution:300,status:"FOLDED"}];
const pots=buildPots(players); assert.deepEqual(pots.map(p=>p.amount),[300,200,100]);
players.forEach(p=>p.stack=0); payout(pots,players,[["a"],["b"],["b"]],0);
assert.equal(players.reduce((s,p)=>s+p.stack,0),600);
console.log("PASS: deck/evaluator/pots/payout invariants");
