import {describe,expect,it} from 'vitest';
import {createCharacter} from '../src/domain/character';
import {applyCharacterCommand,characterCommandSchema} from '../src/domain/commands';
import {characterSchema,type Character,type RulesetId} from '../src/domain/schema';

const apply=(c:Character,command:unknown)=>applyCharacterCommand(c,characterCommandSchema.parse(command)).character;
function fixture(edition:RulesetId='5e-2024'){
  const c=createCharacter('Rest fixture',edition);
  c.classes=[{classId:'fighter',name:'Fighter',level:6}];c.hp=12;c.maxHp=50;c.tempHp=5;c.conditions=['Poisoned'];
  c.resources=[
    {id:'short',name:'Short',maximum:3,spent:3,reset:'short',shortRecovery:0},
    {id:'partial',name:'Partial short recovery',maximum:4,spent:4,reset:'long',shortRecovery:1},
    {id:'partial-short',name:'Partial short',maximum:4,spent:4,reset:'short',shortRecovery:2},
    {id:'long',name:'Long',maximum:3,spent:2,reset:'long',shortRecovery:0},
    {id:'daily',name:'Daily',maximum:3,spent:2,reset:'daily',shortRecovery:0},
    {id:'manual',name:'Manual',maximum:3,spent:2,reset:'manual',shortRecovery:0},
  ];
  c.slots=[{level:1,maximum:4,spent:4},{level:2,maximum:2,spent:2,reset:'short'},{level:3,maximum:1,spent:1,reset:'manual'}];
  if(c.ruleset!=='3.5e'){c.hitDice=[{classId:'fighter',size:10,maximum:6,spent:4}];c.exhaustion=2;c.inspiration=true;c.deathSaves={successes:1,failures:2};c.concentration='Bless';c.effects=[{id:'bless',name:'Bless',source:'test',duration:'1 minute',notes:'',modifiers:[],concentration:true},{id:'other',name:'Other',source:'test',duration:'Until removed',notes:'',modifiers:[]}];}
  return c;
}

describe('full sheet edits preserve omitted fields and validate edition boundaries',()=>{
  it('merges nested scores, skills and saves without defaulting unrelated fields or losing private content',()=>{
    const c=fixture();if(c.ruleset==='3.5e')throw new Error('Wrong fixture');
    c.notes='PRIVATE';c.backstory='PRIVATE BACKSTORY';c.skills={perception:1,athletics:1};c.armorTraining=['heavy'];
    const updated=apply(c,{type:'character-update',changes:{abilities:{str:18},skills:{perception:2},deathSaves:{successes:2}}});
    expect(updated).toMatchObject({abilities:{str:18,dex:10},skills:{perception:2,athletics:1},deathSaves:{successes:2,failures:2},equipmentRules:true,armorTraining:['heavy'],notes:'PRIVATE',backstory:'PRIVATE BACKSTORY'});
    expect(c.abilities.str).toBe(10);
  });
  it('records an atomic class advancement with hit-die configuration, features, slots and current HP',()=>{
    const c=fixture();
    const updated=apply(c,{type:'character-update',changes:{classes:[{classId:'fighter',name:'Fighter',level:7,subclassId:'champion'}],hitDice:[{classId:'fighter',size:10,maximum:7,spent:4}],maxHp:60,hp:60,feats:['Alert'],features:'Improved critical',spellAbility:'wis',saveProficiencies:['str','con'],slots:[{level:1,maximum:2,spent:0}]}});
    expect(updated).toMatchObject({classes:[{level:7,subclassId:'champion'}],maxHp:60,hp:60,hitDice:[{maximum:7,spent:4}],feats:['Alert'],features:'Improved critical',spellAbility:'wis'});
  });
  it('edits 3.5e ranks, saves and combat statistics while preserving omitted map entries',()=>{
    const c=fixture('3.5e');if(c.ruleset!=='3.5e')throw new Error('Wrong fixture');c.skillRanks={Climb:2,Jump:3};
    expect(apply(c,{type:'character-update',changes:{skillRanks:{Climb:4},saves:{will:3},baseAttackBonus:6,touchArmorClass:12,flatFootedArmorClass:15,nonlethalDamage:5,stable:true}})).toMatchObject({skillRanks:{Climb:4,Jump:3},saves:{will:3,fortitude:2,reflex:0},baseAttackBonus:6,stable:true});
  });
  it.each([
    ['5e-2024',{skillRanks:{Climb:4}}],['3.5e',{skills:{athletics:1}}],['3.5e',{inspiration:true}],
    ['5e-2024',{id:'another'}],['5e-2024',{rulesVersion:'other'}],['5e-2024',{abilities:{luck:20}}],
    ['5e-2024',{hitDice:[{classId:'fighter',size:10,maximum:7,spent:0}]}],
    ['5e-2024',{hitDice:[{classId:'fighter',size:10,maximum:6,spent:7}]}],
    ['5e-2024',{effects:[{id:'bad',name:'Other concentration',source:'test',duration:'',notes:'',modifiers:[],concentration:true}]}],
  ] as const)('rejects invalid %s sheet fields %j',(edition,changes)=>{
    const c=fixture(edition),before=structuredClone(c);expect(()=>apply(c,{type:'character-update',changes})).toThrow();expect(c).toEqual(before);
  });
  it('supports effects and calculation overrides without losing unrelated sheet data',()=>{
    const c=fixture();const effect={id:'ward',name:'Ward',source:'DM ruling',duration:'Until removed',notes:'',modifiers:[{target:'armorClass',value:1,type:'bonus',source:'Ward'}]};
    const updated=apply(c,{type:'character-update',changes:{effects:[...c.effects,effect],overrides:[{id:'speed',target:'speed',value:40,reason:'DM-approved movement',source:'DM ruling'}]}});
    expect(updated.effects.at(-1)).toEqual(effect);expect(updated.overrides[0].value).toBe(40);expect(updated.resources).toEqual(c.resources);
  });
  it('preserves resource usage and short recovery when changing its long-rest capacity',()=>{
    const c=fixture();expect(apply(c,{type:'resource-update',resource:{id:'partial',maximum:5,description:'Updated ability'}}).resources[1]).toMatchObject({maximum:5,spent:4,shortRecovery:1,reset:'long',description:'Updated ability'});
    expect(()=>apply(c,{type:'resource-update',resource:{id:'partial',maximum:3}})).toThrow('overspent');
  });
  it('rejects duplicate slot levels and overspent hit dice on import or save as well',()=>{
    const c=fixture();expect(()=>characterSchema.parse({...c,slots:[c.slots[0],c.slots[0]]})).toThrow('Duplicate');
    expect(()=>characterSchema.parse({...c,hitDice:[{classId:'fighter',size:10,maximum:6,spent:7}]})).toThrow('overspent');
  });
});

describe('source-specific, deterministic rest recovery',()=>{
  it('short rests recover configured uses and slots, and spend only selected hit dice with resolved healing',()=>{
    const c=fixture();const updated=apply(c,{type:'rest',kind:'short',hitDice:[{classId:'fighter',count:2}],healing:15});
    expect(updated.hp).toBe(27);expect(updated.resources.map(r=>r.spent)).toEqual([0,3,2,2,2,2]);expect(updated.slots.map(s=>s.spent)).toEqual([4,0,1]);
    expect(updated).toMatchObject({hitDice:[{spent:6}],exhaustion:2,inspiration:true,tempHp:5,concentration:'Bless',conditions:['Poisoned']});
  });
  it.each(['5e-2014','5e-2024'] as const)('%s long rests restore eligible resources without resetting daily/manual pools or unrelated conditions',(edition)=>{
    const c=fixture(edition),updated=apply(c,{type:'rest',kind:'long',...(edition==='5e-2014'?{reduceExhaustion:true}:{})});
    expect(updated).toMatchObject({hp:50,tempHp:0,concentration:null,exhaustion:1,inspiration:true,deathSaves:{successes:0,failures:0},conditions:['Poisoned']});
    expect(updated.resources.map(r=>r.spent)).toEqual([0,0,0,0,2,2]);expect(updated.slots.map(s=>s.spent)).toEqual([0,0,1]);
    expect(updated).toMatchObject({hitDice:[{spent:edition==='5e-2014'?1:0}]});expect(updated.effects.map(e=>e.id)).toEqual(['other']);
  });
  it('2014 exhaustion reduction requires confirmed food and drink and hit dice round down with a minimum of one',()=>{
    const c=fixture('5e-2014');c.classes[0].level=5;if(c.ruleset==='3.5e')throw new Error('Wrong fixture');c.hitDice[0].maximum=5;
    expect(apply(c,{type:'rest',kind:'long'})).toMatchObject({exhaustion:2,hitDice:[{spent:2}]});
    c.classes[0].level=1;c.hitDice[0]={classId:'fighter',size:10,maximum:1,spent:1};
    expect(apply(c,{type:'rest',kind:'long'})).toMatchObject({hitDice:[{spent:0}]});
  });
  it('2014 multiclass recovery requires a choice when the allowance cannot restore all spent pools',()=>{
    const c=fixture('5e-2014');if(c.ruleset==='3.5e')throw new Error('Wrong fixture');
    c.classes=[{classId:'fighter',name:'Fighter',level:3},{classId:'wizard',name:'Wizard',level:2}];c.hitDice=[{classId:'fighter',size:10,maximum:3,spent:3},{classId:'wizard',size:6,maximum:2,spent:2}];
    expect(()=>apply(c,{type:'rest',kind:'long'})).toThrow('Choose which 2');
    expect(apply(c,{type:'rest',kind:'long',recoverHitDice:[{classId:'wizard',count:2}]})).toMatchObject({hitDice:[{spent:3},{spent:0}]});
    expect(()=>apply(c,{type:'rest',kind:'long',recoverHitDice:[{classId:'fighter',count:3}]})).toThrow('exactly 2');
  });
  it.each([
    {type:'rest',kind:'short',hitDice:[{classId:'fighter',count:1}]},
    {type:'rest',kind:'short',hitDice:[{classId:'fighter',count:3}],healing:10},
    {type:'rest',kind:'short',hitDice:[{classId:'fighter',count:1},{classId:'fighter',count:1}],healing:10},
    {type:'rest',kind:'short',healing:10},
    {type:'rest',kind:'short',hitDice:[{classId:'fighter',count:1}],healing:0},
    {type:'rest',kind:'short',reduceExhaustion:true},
    {type:'rest',kind:'long',hitDice:[]},
    {type:'rest',kind:'long',recoverHitDice:[]},
  ])('rejects invalid rest inputs atomically: %j',command=>{
    const c=fixture(),before=structuredClone(c);expect(()=>apply(c,command)).toThrow();expect(c).toEqual(before);
  });
  it('permits zero resolved short-rest healing in 2014 and never invents healing without dice',()=>{
    expect(apply(fixture('5e-2014'),{type:'rest',kind:'short',hitDice:[{classId:'fighter',count:1}],healing:0}).hp).toBe(12);
    expect(apply(fixture(),{type:'rest',kind:'short'}).hp).toBe(12);
  });
  it('rejects fifth-edition rest/state semantics for 3.5e and recovery at zero HP',()=>{
    expect(()=>apply(fixture('3.5e'),{type:'rest',kind:'long'})).toThrow('3.5e');expect(()=>apply(fixture('3.5e'),{type:'fifth-state',changes:{inspiration:true}})).toThrow('fifth-edition');
    const c=fixture();c.hp=0;expect(()=>apply(c,{type:'rest',kind:'long'})).toThrow('cannot benefit');
  });
});
