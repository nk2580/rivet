import {describe,expect,it,vi} from 'vitest';
import {oracleAnswer,oracleAuth,oracleFixture,toolCall,toolStream} from './fixtures/oracle';

describe('Permanent Oracle chat deletion',()=>{
  it('removes messages, model history and proposals durably, keeping sheets, activity and other chats',async()=>{
    const f=await oracleFixture();
    try{
      const kept=await f.runtime.create(f.character.id,'Keep this chat');
      const unrelated=await f.runtime.create(f.other.id,'Another character’s chat');
      await f.turn((_request,round)=>round===0?[toolCall('apply_character_action',{command:{type:'damage',amount:10},expectedRevision:1,reason:'Requested damage.'})]:round===1?[toolCall('propose_character_action',{command:{type:'inventory-remove',itemId:'rope'},reason:'Remove the rope.'})]:[oracleAnswer],'DELETE-CHAT-CONTENT-SENTINEL');
      const proposal=f.runtime.messages(f.session.id).messages.find((m:any)=>m.role==='proposal')!.details.id;
      await f.runtime.applyProposal(proposal);
      await f.turn((_request,round)=>round===0?[toolCall('propose_character_action',{command:{type:'inventory-remove',itemId:'sword'},reason:'Remove the sword.'})]:[oracleAnswer],'DELETE-CHAT-PENDING-SENTINEL');
      const pending=f.runtime.messages(f.session.id).messages.findLast((m:any)=>m.role==='proposal')!.details.id;
      const sheet=await f.workspace.get('character',f.character.id),activity=await f.store.activity.toArray();
      const other=await f.workspace.get('character',f.other.id);
      expect(activity).toHaveLength(2);
      expect(JSON.stringify(f.runtime.exportBackup())).toContain('DELETE-CHAT-CONTENT-SENTINEL');
      expect(await f.runtime.deleteSession(f.session.id,f.character.id)).toEqual({deleted:true});
      expect(()=>f.runtime.messages(f.session.id)).toThrow('not found');
      expect(f.store.connection.prepare('SELECT * FROM chat_messages WHERE session_id=?').all(f.session.id)).toEqual([]);
      expect(await f.store.meta.get(`proposal/${proposal}`)).toBeUndefined();
      expect(await f.store.meta.get(`proposal/${pending}`)).toBeUndefined();
      await expect(f.runtime.applyProposal(pending)).rejects.toThrow('unavailable');
      const backup=JSON.stringify(f.runtime.exportBackup());
      expect(backup).not.toContain(f.session.id);expect(backup).not.toContain('DELETE-CHAT-');
      expect(f.events.at(-1)).toEqual({type:'session-deleted',sessionId:f.session.id,characterId:f.character.id});
      await f.restart();
      expect(f.runtime.list(f.character.id).map((s:any)=>s.id)).toEqual([kept.id]);
      expect(f.runtime.list(f.other.id).map((s:any)=>s.id)).toEqual([unrelated.id]);
      expect(await f.workspace.get('character',f.character.id)).toEqual(sheet);
      expect(await f.workspace.get('character',f.other.id)).toEqual(other);
      expect(await f.store.activity.toArray()).toEqual(activity);
      // The independent sheet history remains usable after its chat receipt is gone.
      await f.workspace.undo(String((await f.workspace.get('character',f.character.id))!.undoHead));
      expect((await f.workspace.get('character',f.character.id))!.data).toMatchObject({hp:24,inventory:expect.arrayContaining([expect.objectContaining({id:'rope'})])});
    }finally{await f.close();}
  });

  it.each([false,true])('aborts an active response without recreating the chat (committed sheet update=%s)',async(commitFirst)=>{
    const f=await oracleFixture();let round=0,waiting=false,aborted=false;
    try{
      vi.stubGlobal('fetch',vi.fn(async(_url:string,options:RequestInit)=>{
        if(commitFirst&&round++===0)return toolStream([toolCall('apply_character_action',{command:{type:'damage',amount:10},expectedRevision:1,reason:'Requested damage.'})]);
        return new Response(new ReadableStream({start(controller){waiting=true;options.signal?.addEventListener('abort',()=>{aborted=true;controller.error(new Error('Cancelled test response'));},{once:true});}}),{headers:{'Content-Type':'text/event-stream'}});
      }));
      await f.runtime.send(f.session.id,'Record damage, then explain.','synthetic-model');
      await vi.waitFor(()=>expect(waiting).toBe(true),{timeout:5000});
      await f.runtime.deleteSession(f.session.id,f.character.id);
      expect(aborted).toBe(true);expect(f.runtime.list(f.character.id)).toEqual([]);
      expect(f.events.at(-1)?.type).toBe('session-deleted');
      expect(f.runtime.exportBackup().messages).toEqual([]);
      await f.restart();
      expect(f.runtime.exportBackup().sessions).toEqual([]);expect(f.runtime.exportBackup().messages).toEqual([]);
      expect((await f.workspace.get('character',f.character.id))!.data).toMatchObject({hp:commitFirst?24:30});
      expect(await f.store.activity.toArray()).toHaveLength(commitFirst?1:0);
    }finally{await f.close();}
  });

  it('cancels a send still checking the account and rejects new sends during deletion',async()=>{
    const f=await oracleFixture();let release!:()=>void;
    const token=vi.spyOn(oracleAuth,'token').mockImplementationOnce(()=>new Promise<string>(resolve=>{release=()=>resolve('synthetic-test-token');}));
    try{
      const sending=f.runtime.send(f.session.id,'Not stored.','synthetic-model').catch(error=>error);
      await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
      await expect(f.runtime.send(f.session.id,'Duplicate.','synthetic-model')).rejects.toThrow('already answering');
      const deleting=f.runtime.deleteSession(f.session.id,f.character.id);
      await expect(f.runtime.send(f.session.id,'Too late.','synthetic-model')).rejects.toThrow('being deleted');
      release();expect(await sending).toBeInstanceOf(Error);await deleting;
      expect(f.runtime.exportBackup()).toEqual({version:1,sessions:[],messages:[]});
      expect(await f.store.activity.toArray()).toEqual([]);
    }finally{release?.();token.mockRestore();await f.close();}
  });

  it('rolls back all deletion rows on failure and can be retried',async()=>{
    const f=await oracleFixture();
    try{
      await f.turn((_request,round)=>round===0?[toolCall('propose_character_action',{command:{type:'inventory-remove',itemId:'rope'},reason:'Remove rope.'})]:[oracleAnswer]);
      const backup=f.runtime.exportBackup(),meta=await f.store.meta.toArray();
      f.store.connection.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON chat_sessions BEGIN SELECT RAISE(ABORT,'Synthetic delete failure'); END;");
      await expect(f.runtime.deleteSession(f.session.id,f.character.id)).rejects.toThrow('Synthetic delete failure');
      expect(f.runtime.exportBackup()).toEqual(backup);expect(await f.store.meta.toArray()).toEqual(meta);
      expect(f.events.some(event=>event.type==='session-deleted')).toBe(false);
      f.store.connection.exec('DROP TRIGGER fail_delete');
      expect(await f.runtime.deleteSession(f.session.id,f.character.id)).toEqual({deleted:true});
    }finally{await f.close();}
  });

  it('checks the character boundary and safely handles repeated or simultaneous deletes',async()=>{
    const f=await oracleFixture();
    try{
      await expect(f.runtime.deleteSession(f.session.id,f.other.id)).rejects.toThrow('another character');
      expect(f.runtime.list(f.character.id)).toHaveLength(1);
      const results=await Promise.all([f.runtime.deleteSession(f.session.id,f.character.id),f.runtime.deleteSession(f.session.id,f.character.id)]);
      expect(results).toEqual([{deleted:true},{deleted:true}]);
      expect(f.events.filter(event=>event.type==='session-deleted')).toHaveLength(1);
      expect(await f.runtime.deleteSession(f.session.id,f.character.id)).toEqual({deleted:false});
    }finally{await f.close();}
  });
});
