import {describe,expect,it} from 'vitest';
import {CharacterActions} from '../desktop/character-actions';
import {RULESETS,type Character} from '../src/domain/schema';
import {routineCommandTypes} from '../src/domain/commands';
import {oracleFixture,oracleItem,toolCall,oracleAnswer,sameSheet} from './fixtures/oracle';

const invalidActions=[
  {type:'currency',operation:'spend',amounts:{copper:1,gold:999999999}},
  {type:'currency',operation:'set',amounts:{silver:-1}},
  {type:'currency',operation:'add',amounts:{}},
  {type:'currency',operation:'set',amounts:{platinum:1.5}},
  {type:'character-update',changes:{abilities:{wis:101}}},
  {type:'character-update',changes:{ruleset:'3.5e'}},
  {type:'character-update',changes:{}},
  {type:'character-update',changes:{maxHp:1}},
  {type:'character-update',changes:{campaignId:'missing'}},
  {type:'resource-add',resource:{id:'channel',name:'Duplicate',maximum:3,spent:0,reset:'long'}},
  {type:'resource-update',resource:{id:'missing',maximum:3}},
  {type:'resource-update',resource:{id:'channel',maximum:0}},
  {type:'resource-remove',resourceId:'missing'},
  {type:'rest',kind:'short',hitDice:[{classId:'missing',count:1}],healing:5},
  {type:'rest',kind:'long',healing:99},
  {type:'fifth-state',changes:{exhaustion:7}},
  {type:'damage',amount:0}, {type:'heal',amount:-1}, {type:'temporary-hp',amount:0},
  {type:'condition',name:' ',active:true}, {type:'resource',resourceId:'missing',change:1},
  {type:'slot',level:4,change:-1}, {type:'concentration',name:'Cannot concentrate at 0 HP'},
  {type:'spell-cast',spellId:'missing',slotLevel:3},
  {type:'inventory-add',item:oracleItem('rope')},
  {type:'inventory-import',items:[oracleItem('duplicate'),oracleItem('duplicate')]},
  {type:'inventory-update',item:oracleItem('missing')},
  {type:'inventory-remove',itemId:'missing'},
  {type:'inventory-equip',itemId:'greatsword',equipped:true,slot:'two-hands',replaceIds:[]},
  {type:'equipment-rules',enabled:true,armorTraining:['imaginary']},
  {type:'spell-add',spell:{id:'new-bless',name:'Bless',level:1,castingTime:'Action',range:'Touch',concentration:true,prepared:true,notes:''}},
  {type:'spell-update',spell:{id:'missing',name:'Missing',level:1,castingTime:'Action',range:'Touch',concentration:false,prepared:true,notes:''}},
  {type:'spell-remove',spellId:'missing'}, {type:'spell-prepare',spellId:'missing',prepared:true},
  {type:'resource',resourceId:'channel',change:2}, {type:'resource',resourceId:'channel',change:-2},
  {type:'inventory-equip',itemId:'missing',equipped:true,slot:'body',replaceIds:[]},
  {type:'spell-cast',spellId:'guardians',slotLevel:1},
  {type:'spell-cast',spellId:'guidance',slotLevel:1},
];

describe('Oracle failure boundaries and mutation safety',()=>{
  for(const edition of RULESETS)for(const command of invalidActions){
    it(`${edition}: rejects invalid ${command.type} without changing any saved state`,async()=>{
      const f=await oracleFixture(edition);
      try{
        if(command.type==='concentration'){f.character.hp=0;await f.workspace.save(f.character,1);}
        const before=(await f.workspace.get('character',f.character.id))!;
        const result=await f.turn((_request,round)=>round===0?[toolCall(routineCommandTypes.has(command.type)?'apply_character_action':'propose_character_action',{command,reason:'Explicit invalid acceptance request',expectedRevision:before.localRevision})]:[oracleAnswer]);
        expect(result.messages.find((m:any)=>m.role==='tool')).toMatchObject({status:'error',details:{result:{error:expect.any(String)}}});
        expect(result.messages.some((m:any)=>m.role==='proposal'||m.role==='action')).toBe(false);
        expect(await f.workspace.get('character',f.character.id)).toEqual(before);
        expect(await f.store.activity.toArray()).toEqual([]);
        expect(f.events.some(e=>e.type==='character-changed')).toBe(false);
        await f.restart();expect(await f.workspace.get('character',f.character.id)).toEqual(before);
      }finally{await f.close();}
    },15000);
  }

  for(const edition of RULESETS)for(const entity of ['item','spell'] as const){
    it(`${edition}: Oracle can edit ${entity} metadata without losing its unread private notes`,async()=>{
      const f=await oracleFixture(edition);
      try{
        const result=await f.turn((request,round)=>{
          if(round===0)return [toolCall('get_character',{})];
          if(round===1){
            const publicSheet=JSON.parse(request.input.findLast((entry:any)=>entry.type==='function_call_output').output).character;
            const current=entity==='item'?publicSheet.inventory.find((i:any)=>i.id==='rope'):publicSheet.spells.find((s:any)=>s.id==='bolt');
            expect(current).not.toHaveProperty('notes');
            return [toolCall('propose_character_action',{command:entity==='item'?{type:'inventory-update',item:{...current,quantity:3}}:{type:'spell-update',spell:{...current,range:'120 feet'}},reason:'Change only the requested metadata.'})];
          }
          return [oracleAnswer];
        });
        const proposal=result.messages.find((m:any)=>m.role==='proposal');expect(proposal).toBeDefined();
        await f.runtime.applyProposal(proposal!.details.id);
        const saved=(await f.workspace.get('character',f.character.id))!.data as Character;
        if(entity==='item')expect(saved.inventory.find(i=>i.id==='rope')).toMatchObject({quantity:3,notes:'PRIVATE ITEM NOTE'});
        else expect(saved.spells.find(s=>s.id==='bolt')).toMatchObject({range:'120 feet',notes:'PRIVATE SPELL NOTE'});
      }finally{await f.close();}
    });
  }

  for(const edition of RULESETS)it(`${edition}: adding an existing condition with different casing is idempotent`,async()=>{
    const f=await oracleFixture(edition);
    try{
      await f.turn((_request,round)=>round===0?[toolCall('apply_character_action',{command:{type:'condition',name:'poisoned',active:true},reason:'Mark Poisoned',expectedRevision:1})]:[oracleAnswer]);
      expect(((await f.workspace.get('character',f.character.id))!.data as Character).conditions).toEqual(['Poisoned']);
    }finally{await f.close();}
  });

  it.each(['receipt','proposal','message'] as const)('commits reviewed sheet changes atomically when %s storage fails',async(failure)=>{
    const f=await oracleFixture();
    try{
      const result=await f.turn((_request,round)=>round===0?[toolCall('propose_character_action',{command:{type:'inventory-add',item:oracleItem('dagger')},reason:'Add a dagger.'})]:[oracleAnswer]);
      const proposal=result.messages.find((m:any)=>m.role==='proposal')!;
      const trigger=failure==='receipt'?"BEFORE INSERT ON chat_messages WHEN NEW.role='action'":failure==='proposal'?"BEFORE UPDATE ON meta WHEN NEW.key LIKE 'proposal/%'":"BEFORE UPDATE ON chat_messages WHEN NEW.role='proposal' AND NEW.status='applied'";
      f.store.connection.exec(`CREATE TRIGGER reject_storage ${trigger} BEGIN SELECT RAISE(ABORT,'Storage unavailable'); END;`);
      await expect(f.runtime.applyProposal(proposal.details.id)).rejects.toThrow('Storage unavailable');
      expect(sameSheet((await f.workspace.get('character',f.character.id))!.data as Character)).toEqual(sameSheet(f.character));
      expect(await f.store.activity.toArray()).toEqual([]);
      expect(f.runtime.messages(f.session.id).messages.find((m:any)=>m.role==='proposal')?.status).toBe('pending');
      expect(f.runtime.messages(f.session.id).messages.some((m:any)=>m.role==='action')).toBe(false);
      f.store.connection.exec('DROP TRIGGER reject_storage');
      await f.runtime.applyProposal(proposal.details.id);
      await expect(f.runtime.applyProposal(proposal.details.id)).rejects.toThrow('already applied');
      expect(await f.store.activity.toArray()).toHaveLength(1);
    }finally{await f.close();}
  });

  it('rejects cross-character and changed-edition writes and conflicting provider-call reuse',async()=>{
    const f=await oracleFixture();
    try{
      const actions=new CharacterActions(f.store,f.workspace);
      await expect(actions.apply(f.session.id,f.other.id,{type:'damage',amount:1},1,'Wrong character','wrong-character')).rejects.toThrow('session');
      await actions.apply(f.session.id,f.character.id,{type:'damage',amount:1},1,'Damage one','same-call');
      await expect(actions.apply(f.session.id,f.character.id,{type:'damage',amount:2},2,'Damage two','same-call')).rejects.toThrow('different request');
      f.store.connection.prepare("UPDATE chat_sessions SET edition='3.5e' WHERE id=?").run(f.session.id);
      await expect(actions.apply(f.session.id,f.character.id,{type:'heal',amount:1},2,'Wrong edition','wrong-edition')).rejects.toThrow('edition');
      expect(((await f.workspace.get('character',f.character.id))!.data as Character).tempHp).toBe(3);
      expect(await f.store.activity.toArray()).toHaveLength(1);
    }finally{await f.close();}
  });

  it('disables Undo for archived characters instead of offering an action that cannot apply',async()=>{
    const f=await oracleFixture();
    try{
      const actions=new CharacterActions(f.store,f.workspace);
      await actions.apply(f.session.id,f.character.id,{type:'damage',amount:1},1,'Resolved damage.','archive-check');
      await f.workspace.setDeleted('character',f.character.id,true,2);
      expect(f.runtime.messages(f.session.id).messages.find((m:any)=>m.role==='action')?.details.canUndo).toBe(false);
      await expect(f.runtime.send(f.session.id,'Heal one.','synthetic-model')).rejects.toThrow('active character');
    }finally{await f.close();}
  });

  it('marks a pending review stale immediately when another saved action changes the sheet',async()=>{
    const f=await oracleFixture();
    try{
      const result=await f.turn((_request,round)=>round===0?[toolCall('propose_character_action',{command:{type:'inventory-remove',itemId:'rope'},reason:'Remove the rope.'})]:[oracleAnswer]);
      const proposal=result.messages.find((m:any)=>m.role==='proposal')!;
      await f.workspace.execute(f.character.id,{type:'damage',amount:1},1);
      expect(f.runtime.messages(f.session.id).messages.find((m:any)=>m.role==='proposal')?.status).toBe('stale');
      await expect(f.runtime.applyProposal(proposal.details.id)).rejects.toThrow('changed');
      expect(((await f.workspace.get('character',f.character.id))!.data as Character).inventory.some(i=>i.id==='rope')).toBe(true);
    }finally{await f.close();}
  });
});
