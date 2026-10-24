import {describe,expect,it} from 'vitest';
import {characterCommandSchema,routineCommandTypes,type CharacterCommand} from '../src/domain/commands';
import {RULESETS,type Character} from '../src/domain/schema';
import {calculate} from '../src/domain/character';
import {oracleFixture,oracleItem,toolCall,oracleAnswer,sameSheet} from './fixtures/oracle';

type Scenario={name:string;command:(c:Character)=>CharacterCommand;check:(c:Character)=>void;fifthOnly?:boolean};
const scenarios:Scenario[]=[
  {name:'currency',command:()=>({type:'currency',operation:'set',amounts:{copper:12,silver:20,electrum:3,gold:125.5,platinum:4}}),check:c=>expect(c).toMatchObject({copper:12,silver:20,electrum:3,gold:125.5,platinum:4})},
  {name:'receive coins',command:()=>({type:'currency',operation:'add',amounts:{silver:7,gold:10}}),check:c=>expect(c).toMatchObject({copper:3,silver:17,electrum:2,gold:35,platinum:1})},
  {name:'spend coins',command:()=>({type:'currency',operation:'spend',amounts:{silver:4,gold:2.5}}),check:c=>expect(c).toMatchObject({copper:3,silver:6,electrum:2,gold:22.5,platinum:1})},
  {name:'damage',command:()=>({type:'damage',amount:10}),check:c=>{expect(c.hp).toBe(24);expect(c.tempHp).toBe(0);}},
  {name:'heal',command:()=>({type:'heal',amount:99}),check:c=>{expect(c.hp).toBe(48);if(c.ruleset!=='3.5e')expect(c.deathSaves).toEqual({successes:0,failures:0});}},
  {name:'temporary-hp',command:()=>({type:'temporary-hp',amount:8}),check:c=>expect(c.tempHp).toBe(8)},
  {name:'condition',command:()=>({type:'condition',name:'Frightened',active:true}),check:c=>expect(c.conditions).toEqual(['Poisoned','Frightened'])},
  {name:'resource',command:()=>({type:'resource',resourceId:'channel',change:1}),check:c=>expect(c.resources[0].spent).toBe(2)},
  {name:'slot',command:()=>({type:'slot',level:1,change:1}),check:c=>expect(c.slots[0].spent).toBe(2)},
  {name:'concentration',command:()=>({type:'concentration',name:'Spirit Guardians'}),check:c=>{expect(c.concentration).toBe('Spirit Guardians');expect(c.effects).toEqual([]);expect(c.slots[1].spent).toBe(1);},fifthOnly:true},
  {name:'spell-cast',command:()=>({type:'spell-cast',spellId:'guardians',slotLevel:3,exemptTargets:'My party',duration:'Up to 10 minutes'}),check:c=>{expect(c.slots[1].spent).toBe(2);expect(c.concentration).toBe('Spirit Guardians');expect(c.effects).toMatchObject([{spellId:'guardians',exemptTargets:'My party'}]);},fifthOnly:true},
  {name:'inventory-add',command:()=>({type:'inventory-add',item:oracleItem('dagger')}),check:c=>expect(c.inventory.at(-1)?.id).toBe('dagger')},
  {name:'inventory-import',command:()=>({type:'inventory-import',items:[oracleItem('arrows'),oracleItem('pouch')]}),check:c=>expect(c.inventory.slice(-2).map(i=>i.id)).toEqual(['arrows','pouch'])},
  {name:'inventory-update',command:c=>({type:'inventory-update',item:{...c.inventory.find(i=>i.id==='rope')!,quantity:3}}),check:c=>expect(c.inventory.find(i=>i.id==='rope')?.quantity).toBe(3)},
  {name:'inventory-remove',command:()=>({type:'inventory-remove',itemId:'rope'}),check:c=>expect(c.inventory.some(i=>i.id==='rope')).toBe(false)},
  {name:'inventory-equip',command:()=>({type:'inventory-equip',itemId:'plate',equipped:true,slot:'body',replaceIds:[]}),check:c=>expect(c.inventory.find(i=>i.id==='plate')).toMatchObject({equipped:true,equipSlot:'body'})},
  {name:'equipment-rules',command:()=>({type:'equipment-rules',enabled:true,armorTraining:['heavy','shield']}),check:c=>{expect(c.equipmentRules).toBe(true);expect(c.armorTraining).toEqual(['heavy','shield']);expect(calculate(c,'armorClass').total).toBeGreaterThan(0);}},
  {name:'spell-add',command:()=>({type:'spell-add',spell:{id:'cure',name:'Cure Wounds',level:1,castingTime:'Action',range:'Touch',concentration:false,prepared:true,notes:''}}),check:c=>expect(c.spells.at(-1)?.name).toBe('Cure Wounds')},
  {name:'spell-update',command:c=>({type:'spell-update',spell:{...c.spells.find(s=>s.id==='bolt')!,range:'120 feet'}}),check:c=>expect(c.spells.find(s=>s.id==='bolt')?.range).toBe('120 feet')},
  {name:'spell-remove',command:()=>({type:'spell-remove',spellId:'bolt'}),check:c=>expect(c.spells.some(s=>s.id==='bolt')).toBe(false)},
  {name:'spell-prepare',command:()=>({type:'spell-prepare',spellId:'bolt',prepared:false}),check:c=>expect(c.spells.find(s=>s.id==='bolt')?.prepared).toBe(false)},
  {name:'character-update',command:()=>({type:'character-update',changes:{name:'Reviewed hero',abilities:{wis:18},classes:[{classId:'fighter',name:'Fighter',level:2}],gold:125,feats:['Alert'],features:'A table-approved feature.',slots:[{level:2,maximum:3,spent:1,reset:'long'}]}}),check:c=>{expect(c.name).toBe('Reviewed hero');expect(c.abilities).toEqual({str:10,dex:10,con:10,int:10,wis:18,cha:10});expect(c.classes[0].level).toBe(2);expect(c.gold).toBe(125);expect(c.slots).toEqual([{level:2,maximum:3,spent:1,reset:'long'}]);expect(c.inventory).toHaveLength(5);}},
  {name:'resource-add',command:()=>({type:'resource-add',resource:{id:'ability',name:'Custom ability',description:'A table-approved ability.',maximum:3,spent:0,reset:'long',shortRecovery:0}}),check:c=>expect(c.resources.at(-1)).toMatchObject({id:'ability',maximum:3,spent:0,reset:'long'})},
  {name:'resource-update',command:()=>({type:'resource-update',resource:{id:'channel',maximum:3,reset:'long'}}),check:c=>expect(c.resources[0]).toMatchObject({maximum:3,spent:1,reset:'long',shortRecovery:1})},
  {name:'resource-remove',command:()=>({type:'resource-remove',resourceId:'channel'}),check:c=>expect(c.resources).toEqual([])},
  {name:'fifth-state',command:()=>({type:'fifth-state',changes:{inspiration:true,exhaustion:2,deathSaves:{successes:2}}}),check:c=>{if(c.ruleset==='3.5e')throw new Error('Fifth-edition fixture required');expect(c.inspiration).toBe(true);expect(c.exhaustion).toBe(2);expect(c.deathSaves).toEqual({successes:2,failures:1});},fifthOnly:true},
  {name:'rest',command:()=>({type:'rest',kind:'long'}),check:c=>{expect(c.hp).toBe(48);expect(c.tempHp).toBe(0);expect(c.resources[0].spent).toBe(0);expect(c.slots.map(s=>s.spent)).toEqual([0,0,0]);expect(c.concentration).toBeNull();expect(c.conditions).toEqual(['Poisoned']);},fifthOnly:true},
  {name:'short rest healing',command:()=>({type:'rest',kind:'short',hitDice:[{classId:'fighter',count:1}],healing:7}),check:c=>{expect(c.hp).toBe(37);expect(c.tempHp).toBe(4);expect(c.resources[0].spent).toBe(0);expect(c.slots[0].spent).toBe(1);expect(c.concentration).toBe('Bless');if(c.ruleset!=='3.5e')expect(c.hitDice[0].spent).toBe(1);},fifthOnly:true},
  {name:'remove condition',command:()=>({type:'condition',name:'poisoned',active:false}),check:c=>expect(c.conditions).toEqual([])},
  {name:'restore resource',command:()=>({type:'resource',resourceId:'channel',change:-1}),check:c=>expect(c.resources[0].spent).toBe(0)},
  {name:'restore slot',command:()=>({type:'slot',level:1,change:-1}),check:c=>expect(c.slots[0].spent).toBe(0)},
  {name:'end concentration',command:()=>({type:'concentration',name:null}),check:c=>{expect(c.concentration).toBeNull();expect(c.effects).toEqual([]);},fifthOnly:true},
  {name:'cast cantrip',command:()=>({type:'spell-cast',spellId:'guidance',slotLevel:0}),check:c=>{expect(c.concentration).toBe('Guidance');expect(c.slots.map(s=>s.spent)).toEqual([1,1,0]);},fifthOnly:true},
  {name:'upcast spell',command:()=>({type:'spell-cast',spellId:'guardians',slotLevel:4}),check:c=>{expect(c.slots[2].spent).toBe(1);expect(c.effects[0].slotLevel).toBe(4);},fifthOnly:true},
  {name:'non-concentration cast',command:()=>({type:'spell-cast',spellId:'bolt',slotLevel:1}),check:c=>{expect(c.concentration).toBe('Bless');expect(c.effects[0].spellId).toBe('bless');expect(c.slots[0].spent).toBe(2);},fifthOnly:true},
  {name:'stow equipment',command:()=>({type:'inventory-equip',itemId:'sword',equipped:false,slot:'carried',replaceIds:[]}),check:c=>expect(c.inventory.find(i=>i.id==='sword')?.equipped).toBe(false)},
  {name:'replace occupied hands',command:()=>({type:'inventory-equip',itemId:'greatsword',equipped:true,slot:'two-hands',replaceIds:['sword','shield']}),check:c=>expect(c.inventory.filter(i=>i.equipped).map(i=>i.id)).toEqual(['greatsword'])},
  {name:'temporary HP never stack or lower the existing total',command:()=>({type:'temporary-hp',amount:2}),check:c=>expect(c.tempHp).toBe(4)},
  {name:'lethal resolved damage',command:()=>({type:'damage',amount:40}),check:c=>{expect(c.hp).toBe(c.ruleset==='3.5e'?-6:0);if(c.ruleset==='3.5e')expect(c.stable).toBe(false);else{expect(c.concentration).toBeNull();expect(c.effects).toEqual([]);}}},
  {name:'incapacitation clears concentration',command:()=>({type:'condition',name:'Stunned',active:true}),check:c=>{expect(c.concentration).toBeNull();expect(c.effects).toEqual([]);},fifthOnly:true},
];

describe('complete Oracle action acceptance matrix',()=>{
  it('includes every advertised command discriminator',()=>{
    const covered=new Set(scenarios.map(s=>s.command({inventory:[],spells:[]} as unknown as Character).type));
    expect([...covered].sort()).toEqual(characterCommandSchema.options.map(option=>option.shape.type.value).sort());
  });
  for(const edition of RULESETS)for(const scenario of scenarios.filter(s=>edition!=='3.5e'||!s.fifthOnly)){
    it(`${edition}: ${scenario.name}, agent tool → SQLite → restart → Undo`,async()=>{
      const f=await oracleFixture(edition);
      try{
        const command=scenario.command(f.character),routine=routineCommandTypes.has(command.type);
        const result=await f.turn((request,round)=>{
          if(round===0)return [toolCall('get_character',{})];
          if(round===1){
            const read=request.input.findLast((entry:any)=>entry.type==='function_call_output');
            const current=JSON.parse(read.output);expect(current.revision).toBe(1);
            return [toolCall(routine?'apply_character_action':'propose_character_action',{command,reason:`Explicit acceptance request: ${scenario.name}`,...(routine?{expectedRevision:current.revision}:{})})];
          }
          return [oracleAnswer];
        });
        expect(result.messages.filter((m:any)=>m.role==='tool').map((m:any)=>m.status)).toEqual(['complete','complete']);
        if(!routine){
          expect(sameSheet((await f.workspace.get('character',f.character.id))!.data as Character)).toEqual(sameSheet(f.character));
          const proposal=result.messages.find((m:any)=>m.role==='proposal');expect(proposal?.status).toBe('pending');
          await f.runtime.applyProposal(proposal!.details.id);
        }
        let saved=(await f.workspace.get('character',f.character.id))!;
        expect(saved.localRevision).toBe(2);scenario.check(saved.data as Character);
        expect(sameSheet((await f.workspace.get('character',f.other.id))!.data as Character)).toEqual(sameSheet(f.other));
        expect(await f.store.outbox.toArray()).toEqual([]);
        expect(await f.store.activity.toArray()).toHaveLength(1);
        expect(f.events.some(e=>e.type==='character-changed'&&e.characterId===f.character.id)).toBe(true);
        const action=f.runtime.messages(f.session.id).messages.find((m:any)=>m.role==='action');
        expect(action,'Every saved Oracle edit needs a durable, undoable receipt').toBeDefined();
        expect(action!.details.canUndo).toBe(true);
        await f.restart();saved=(await f.workspace.get('character',f.character.id))!;scenario.check(saved.data as Character);
        expect(f.runtime.messages(f.session.id).messages.find((m:any)=>m.role==='action')?.details.canUndo).toBe(true);
        await f.runtime.undoAction(String(action!.id));
        expect(sameSheet((await f.workspace.get('character',f.character.id))!.data as Character)).toEqual(sameSheet(f.character));
        expect(f.runtime.messages(f.session.id).messages.find((m:any)=>m.role==='action')).toMatchObject({status:'undone',details:{canUndo:false}});
        await f.restart();
        expect(sameSheet((await f.workspace.get('character',f.character.id))!.data as Character)).toEqual(sameSheet(f.character));
      }finally{await f.close();}
    },15000);
  }
});
