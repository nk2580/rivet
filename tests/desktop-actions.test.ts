import {afterEach,describe,expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import {SQLiteStore} from '../desktop/sqlite';
import {Workspace} from '../src/storage/workspace';
import {AssistantRuntime} from '../desktop/assistant';
import {CharacterActions} from '../desktop/character-actions';
import {castingCharacter} from './fixtures/casting';

afterEach(()=>vi.unstubAllGlobals());
const paths={exec:process.execPath,mcp:resolve('dist-electron/mcp.cjs'),rules:resolve('dist-electron/rules.sqlite')};
const tool=(name:string,args:unknown,callId:string=crypto.randomUUID())=>({type:'function_call',id:crypto.randomUUID(),call_id:callId,name,arguments:JSON.stringify(args)});
const answer={type:'message',role:'assistant',content:[{type:'output_text',text:'The requested sheet update is recorded.'}]};
const stream=(output:unknown[])=>new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output}})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
async function fixture(){
  const store=new SQLiteStore(':memory:'),workspace=new Workspace(store.asWorkspaceStore(),'local',true),character=castingCharacter(),events:any[]=[];
  await workspace.save(character,0);
  const runtime=new AssistantRuntime(store,workspace,{token:async()=>'synthetic-oauth',status:async()=>({active:'fixture'})} as any,paths,event=>events.push(event));
  const session=await runtime.create(character.id,'Cast acceptance');
  return {store,workspace,character,runtime,session,events,actions:new CharacterActions(store,workspace)};
}
const cast={type:'spell-cast',spellId:'guardians',slotLevel:3,exemptTargets:'party',duration:'Up to 10 minutes'};

describe('Oracle character updates through real SQLite and the agent loop',()=>{
  it('advertises usable schemas, applies a cast once on replay, refreshes the sheet and undoes both state changes',async()=>{
    const f=await fixture(),requests:any[]=[];let round=0;
    const apply=tool('apply_character_action',{command:cast,expectedRevision:1,reason:'The user requested this cast.'},'repeated-provider-call');
    vi.stubGlobal('fetch',vi.fn(async(_url:string,options:RequestInit)=>{
      requests.push(JSON.parse(String(options.body)));
      if(round++===0)return stream([tool('get_character',{})]);
      if(round===2)return stream([apply,apply]);
      return stream([answer]);
    }));
    try{
      await f.runtime.send(f.session.id,'Cast Spirit Guardians using a third-level slot. Exempt my party.','fixture-model');
      await vi.waitFor(()=>expect(f.runtime.messages(f.session.id).running).toBe(false),{timeout:5000});
      const schema=requests[0].tools.find((entry:any)=>entry.name==='apply_character_action').parameters;
      expect(schema.required).toContain('expectedRevision');expect(JSON.stringify(schema.properties.command)).toContain('spell-cast');expect(JSON.stringify(schema.properties.command)).toContain('slotLevel');expect(JSON.stringify(schema.properties.command)).not.toContain('inventory-remove');
      const current=await f.workspace.get('character',f.character.id);
      expect(current).toMatchObject({localRevision:2,data:{concentration:'Spirit Guardians',slots:[{spent:0},{spent:1},{spent:0}]}});
      expect((await f.store.activity.toArray())).toHaveLength(1);
      const actions=f.runtime.messages(f.session.id).messages.filter((message:any)=>message.role==='action');expect(actions).toHaveLength(1);expect(actions[0].details.canUndo).toBe(true);
      expect(f.events.some(event=>event.type==='character-changed')).toBe(true);
      await f.runtime.undoAction(String(actions[0].id));
      expect((await f.workspace.get('character',f.character.id))?.data).toMatchObject({concentration:null,slots:[{spent:0},{spent:0},{spent:0}],effects:[]});
      expect(f.runtime.messages(f.session.id).messages.find((message:any)=>message.role==='action')).toMatchObject({status:'undone',details:{canUndo:false}});
      const retried=await f.actions.apply(f.session.id,f.character.id,cast,1,'The user requested this cast.','repeated-provider-call');expect(retried.applied).toBe(false);
      expect(f.runtime.validateBackup(f.runtime.exportBackup()).messages.some(message=>message.role==='action'&&message.status==='undone')).toBe(true);
    }finally{await f.runtime.close();f.store.close();}
  });
  it('replays the originally reported cast_spell payload as a valid reviewable atomic cast',async()=>{
    const f=await fixture();let round=0;
    vi.stubGlobal('fetch',vi.fn(async()=>round++===0?stream([tool('propose_character_action',{command:{type:'cast_spell',spell:'Spirit Guardians',slotLevel:3,exemptTargets:'party'},reason:'Cast the spell with the party unaffected.'})]):stream([answer])));
    try{
      await f.runtime.send(f.session.id,'Cast Spirit Guardians with my party unaffected.','fixture-model');
      await vi.waitFor(()=>expect(f.runtime.messages(f.session.id).running).toBe(false),{timeout:5000});
      const proposal=f.runtime.messages(f.session.id).messages.find((message:any)=>message.role==='proposal');
      expect(proposal).toMatchObject({status:'pending',details:{command:{type:'spell-cast',spellId:'guardians'}}});
      await f.runtime.applyProposal(proposal!.details.id);
      expect((await f.workspace.get('character',f.character.id))?.data).toMatchObject({concentration:'Spirit Guardians',slots:[{spent:0},{spent:1},{spent:0}]});
    }finally{await f.runtime.close();f.store.close();}
  });
  it('refuses stale state and non-routine edits and rolls back the sheet if its receipt cannot be stored',async()=>{
    const f=await fixture();
    try{
      await expect(f.actions.apply(f.session.id,f.character.id,{type:'inventory-remove',itemId:'anything'},1,'Remove an item.','blocked-edit')).rejects.toThrow('review');
      f.store.connection.exec("CREATE TRIGGER reject_action_receipt BEFORE INSERT ON chat_messages WHEN NEW.role='action' BEGIN SELECT RAISE(ABORT,'Receipt unavailable'); END;");
      await expect(f.actions.apply(f.session.id,f.character.id,cast,1,'Cast the spell.','receipt-failure')).rejects.toThrow('Receipt unavailable');
      expect((await f.workspace.get('character',f.character.id))).toMatchObject({localRevision:1,data:{concentration:null,slots:[{spent:0},{spent:0},{spent:0}]}});expect(await f.store.activity.toArray()).toEqual([]);
      f.store.connection.exec('DROP TRIGGER reject_action_receipt');
      await f.workspace.execute(f.character.id,{type:'damage',amount:1},1);
      await expect(f.actions.apply(f.session.id,f.character.id,cast,1,'Cast the spell.','stale-edit')).rejects.toThrow('changed');
      const applied=await f.actions.apply(f.session.id,f.character.id,cast,2,'Cast the spell.','valid-edit');expect(applied.applied).toBe(true);
      if(!applied.applied)throw new Error('Expected cast to apply');
      await f.workspace.execute(f.character.id,{type:'heal',amount:1},3);
      expect(f.runtime.messages(f.session.id).messages.find((message:any)=>message.role==='action')?.details.canUndo).toBe(false);
      await expect(f.runtime.undoAction(applied.receiptId)).rejects.toThrow('newer edit');
      expect((await f.workspace.get('character',f.character.id))?.data).toMatchObject({hp:48,concentration:'Spirit Guardians'});
    }finally{await f.runtime.close();f.store.close();}
  });
});
