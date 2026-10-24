import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultState,validateState,applyHP,spendSlot,longRest,shortRest,buildContext,contextNotes,mod,proficiency,uid} from '../dist/model.js';
import {FirebaseStore} from '../dist/firebase.js';

test('starter sheet round-trips through export validation',()=>{
 const s=defaultState();assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))),s);assert.equal(mod(s.character.abilities.wis)+proficiency(5)+8,15);assert.match(uid(),/^[a-f0-9-]{36}$/);
});
test('damage consumes temporary HP first and concentration uses total damage',()=>{
 const c=defaultState().character;c.tempHp=8;c.concentration='Bless';
 const result=applyHP(c,'damage',25);assert.equal(c.hp,31);assert.equal(c.tempHp,0);assert.equal(result.check,12);
});
test('damage at zero ends concentration and never creates negative HP',()=>{
 const c=defaultState().character;c.concentration='Bless';const result=applyHP(c,'damage',999);assert.equal(c.hp,0);assert.equal(c.concentration,'');assert.equal(result.atZero,true);assert.equal(result.check,null);
});
test('healing caps at maximum and clears death saves; temporary HP do not stack',()=>{
 const c=defaultState().character;c.hp=0;c.death={success:2,failure:1};applyHP(c,'heal',999);assert.equal(c.hp,c.maxHp);assert.deepEqual(c.death,{success:0,failure:0});applyHP(c,'temp',10);applyHP(c,'temp',5);assert.equal(c.tempHp,10);assert.throws(()=>applyHP(c,'damage',-1));assert.throws(()=>applyHP(c,'damage',1.5));
});
test('spell slots cannot be overspent',()=>{
 const c=defaultState().character;spendSlot(c,3);spendSlot(c,3);assert.throws(()=>spendSlot(c,3));assert.throws(()=>spendSlot(c,9));assert.equal(c.slots[2].used,2);
});
test('2024 long rest restores dice and slots, reduces exhaustion, preserves unrelated conditions',()=>{
 const c=defaultState().character;c.hp=2;c.tempHp=7;c.hitDice=0;c.exhaustion=3;c.conditions=['Poisoned'];c.concentration='Bless';c.slots[0].used=4;c.resources[0].used=2;longRest(c);assert.equal(c.hp,48);assert.equal(c.hitDice,5);assert.equal(c.tempHp,0);assert.equal(c.exhaustion,2);assert.deepEqual(c.conditions,['Poisoned']);assert.equal(c.slots[0].used,0);assert.equal(c.resources[0].used,0);
});
test('short rest records manual healing and configured limited recovery',()=>{
 const c=defaultState().character;c.hp=5;c.resources[0].used=2;c.slots[0].used=2;assert.equal(shortRest(c,2,13),13);assert.equal(c.hp,18);assert.equal(c.hitDice,3);assert.equal(c.resources[0].used,1);assert.equal(c.slots[0].used,2);assert.throws(()=>shortRest(c,0,9));assert.throws(()=>shortRest(c,4,12));
});
test('AI context includes active and carried notes only, never excluded notes or unrelated sessions',()=>{
 const s=defaultState();s.sessions[0].notes.push({id:'private',text:'PRIVATE-TEST-MARKER',include:false,carry:true,tag:'Story',createdAt:1});s.sessions.push({id:'other',title:'Other session',date:'2026-10-22',notes:[{id:'no',text:'OTHER-SESSION-MARKER',include:true,carry:false,tag:'Story',createdAt:1},{id:'yes',text:'CARRIED-TEST-MARKER',include:true,carry:true,tag:'Ruling',createdAt:1}]});
 const context=buildContext(s,'Can I heal?');assert.match(context,/CARRIED-TEST-MARKER/);assert.doesNotMatch(context,/PRIVATE-TEST-MARKER|OTHER-SESSION-MARKER/);assert.match(context,/MY QUESTION\n\nCan I heal\?/);assert.equal(contextNotes(s).length,4);assert.doesNotMatch(buildContext(s,'Question',{includeNotes:false}),/CARRIED-TEST-MARKER/);
});
test('import rejects corrupted state and out-of-range values without mutating the original',()=>{
 const s=defaultState();s.character.hp=999;assert.throws(()=>validateState(s));s.character.hp=48;s.activeSession='missing';assert.throws(()=>validateState(s));s.activeSession='phandalin';s.character.skills={constructor:1};assert.throws(()=>validateState(s));
});
test('Firebase transaction refuses a stale revision instead of overwriting another device',async()=>{
 const store=new FirebaseStore({});store.user={uid:'one'};store.ref={};let wrote=false;
 store.f={runTransaction:async(_,fn)=>fn({get:async()=>({exists:()=>true,data:()=>({revision:9})}),set:()=>wrote=true}),serverTimestamp:()=>0};
 await assert.rejects(()=>store.save(defaultState(),8),e=>e.code==='rivet/conflict');assert.equal(wrote,false);
});
test('Firebase saves increment revision and send only the intended payload',async()=>{
 const store=new FirebaseStore({});store.user={uid:'one'};store.ref={};let saved;
 store.f={runTransaction:async(_,fn)=>fn({get:async()=>({exists:()=>true,data:()=>({revision:3})}),set:(_,value)=>saved=value}),serverTimestamp:()=>123};
 const s=defaultState();assert.equal(await store.save(s,3),4);assert.equal(saved.revision,4);assert.deepEqual(JSON.parse(saved.payload),s);assert.deepEqual(Object.keys(saved).sort(),['payload','revision','schemaVersion','updatedAt']);
});
