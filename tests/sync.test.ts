import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCharacter } from '../src/domain/character';
import { RivetDatabase, Workspace, type PendingEntry } from '../src/storage/database';
import { SyncEngine, type CloudRecord, type CloudTransport, type CommitResult, type SyncStatus } from '../src/storage/sync-engine';

class TestCloud implements CloudTransport {
  records=new Map<string,CloudRecord>();listeners=new Set<(records:CloudRecord[])=>void>();
  attempts=0;lastSince:number|undefined;silent=false;
  failure:'before'|'after'|null=null;
  errorCode:string|undefined;
  beforeReturn:(()=>Promise<void>)|undefined;
  listen(since:number|undefined,receive:(records:CloudRecord[])=>void){
    this.lastSince=since;this.listeners.add(receive);
    receive([...this.records.values()].filter(record=>since===undefined||(record.timestamp??0)>=since));
    return()=>{this.listeners.delete(receive);};
  }
  async commit(pending:PendingEntry):Promise<CommitResult>{
    this.attempts++;
    if(this.failure==='before'){this.failure=null;throw Object.assign(new Error('Temporary network interruption'),{code:this.errorCode});}
    const current=this.records.get(pending.key);
    if(current?.operationId===pending.operationId)return {accepted:true,record:current};
    if((current?.revision??0)!==pending.baseRevision)return {accepted:false,record:current??null};
    const record:CloudRecord={data:structuredClone(pending.data),revision:(current?.revision??0)+1,deleted:pending.deleted,operationId:pending.operationId,timestamp:Date.now()};
    this.records.set(pending.key,record);
    if(!this.silent)for(const listener of this.listeners)listener([record]);
    if(this.beforeReturn){const callback=this.beforeReturn;this.beforeReturn=undefined;await callback();}
    if(this.failure==='after'){this.failure=null;throw new Error('Response lost after commit');}
    return {accepted:true,record};
  }
}
const databases:RivetDatabase[]=[],engines:SyncEngine[]=[];
function device(cloud:TestCloud){
  const db=new RivetDatabase(`rivet-sync-test-${crypto.randomUUID()}`);databases.push(db);
  const statuses:SyncStatus[]=[];
  const engine=new SyncEngine(db,cloud,'owner',status=>statuses.push(status),{online:()=>true,onReconnect:()=>()=>{},delay:600000});engines.push(engine);engine.start();
  return {db,workspace:new Workspace(db,'owner'),engine,statuses};
}
afterEach(async()=>{for(const engine of engines.splice(0))engine.stop();for(const db of databases.splice(0))await db.delete();});
describe('revision synchronization and durable recovery',()=>{
  it('preserves an explicitly rejected older-client write even when the cloud revision is unchanged',async()=>{
    const cloud=new TestCloud(),a=device(cloud),c=createCharacter('Upgrade recovery','5e-2024');
    await a.workspace.save(c,0);await a.engine.flush();const entry=(await a.workspace.get('character',c.id))!;
    await a.workspace.save({...c,hp:7},entry.localRevision);
    const commit=vi.spyOn(cloud,'commit').mockResolvedValue({accepted:false,record:{data:c,revision:1,operationId:'already-current-format',deleted:false,writerVersion:3}});
    await a.engine.flush();
    const conflict=await a.db.conflicts.get(entry.key);expect(conflict).toMatchObject({local:{hp:7},remote:{hp:10},remoteRevision:1});
    expect(await a.db.outbox.count()).toBe(1);commit.mockRestore();
    await a.engine.resolve(entry.key,'cloud');expect((await a.workspace.get('character',c.id))?.data).toMatchObject({hp:10});expect(await a.db.meta.where('key').startsWith('recovery/owner/').count()).toBe(1);
  });
  it('preserves two devices and the latest local edit when resolving a conflict',async()=>{
    const cloud=new TestCloud(),a=device(cloud),c=createCharacter('Mira','5e-2024');
    await a.workspace.save(c,0);await a.engine.flush();
    const b=device(cloud);await vi.waitFor(async()=>expect(await b.workspace.get('character',c.id)).toBeDefined());b.engine.stop();
    await a.workspace.execute(c.id,{type:'damage',amount:3},1);await a.engine.flush();
    await b.workspace.execute(c.id,{type:'damage',amount:5},1);b.engine.start();
    await vi.waitFor(async()=>expect(await b.db.conflicts.count()).toBe(1));
    await b.workspace.execute(c.id,{type:'damage',amount:1},2);
    const entry=(await b.workspace.get('character',c.id))!;
    await expect(b.engine.resolve(`another-owner/character/${c.id}`,'local')).rejects.toThrow();
    await b.engine.resolve(entry.key,'cloud');
    expect((await b.workspace.get('character',c.id))?.data).toMatchObject({hp:7});
    const recovery=await b.db.meta.where('key').startsWith('recovery/owner/').first();
    expect(recovery?.value).toMatchObject({local:{hp:4},remote:{hp:7}});
    expect(await b.db.conflicts.count()).toBe(0);expect(await b.db.outbox.count()).toBe(0);
  });
  it('recognizes an interrupted accepted write after restart without losing newer edits',async()=>{
    const cloud=new TestCloud();cloud.silent=true;cloud.failure='after';
    const a=device(cloud),c=createCharacter('Mira','5e-2014');await a.workspace.save(c,0);
    await a.engine.flush();expect(await a.db.outbox.count()).toBe(1);a.engine.stop();
    await a.workspace.execute(c.id,{type:'damage',amount:3},1);
    const recovered=new SyncEngine(a.db,cloud,'owner',()=>{},{online:()=>true,onReconnect:()=>()=>{},delay:600000});engines.push(recovered);recovered.start();
    await vi.waitFor(async()=>expect((await a.workspace.get('character',c.id))?.cloudRevision).toBe(1));
    expect(await a.db.conflicts.count()).toBe(0);await recovered.flush();
    expect(await a.db.outbox.count()).toBe(0);
    expect([...cloud.records.values()][0]).toMatchObject({revision:2,data:{hp:7}});
  });
  it('keeps edits made while an older revision is in flight',async()=>{
    const cloud=new TestCloud();cloud.silent=true;const a=device(cloud),c=createCharacter('Mira','5e-2024');await a.workspace.save(c,0);
    cloud.beforeReturn=async()=>{await a.workspace.execute(c.id,{type:'damage',amount:2},1);};
    await a.engine.flush();
    expect((await a.workspace.get('character',c.id))?.data).toMatchObject({hp:8});
    expect((await a.db.outbox.toArray())[0]).toMatchObject({baseRevision:1,data:{hp:8}});
    await a.engine.flush();expect(await a.db.outbox.count()).toBe(0);expect([...cloud.records.values()][0].data).toMatchObject({hp:8});
  });
  it('retries a transient failure without a new edit or connectivity event',async()=>{
    const cloud=new TestCloud();cloud.failure='before';const a=device(cloud),c=createCharacter('Mira','3.5e');await a.workspace.save(c,0);
    await a.engine.flush();expect(await a.db.outbox.count()).toBe(1);
    await vi.waitFor(async()=>expect(await a.db.outbox.count()).toBe(0),{timeout:5000});
    expect(cloud.attempts).toBe(2);expect(a.statuses.some(status=>status.state==='error')).toBe(true);
  });
  it('backs off quota failures while preserving a usable local backup',async()=>{
    const cloud=new TestCloud();cloud.failure='before';cloud.errorCode='resource-exhausted';
    const a=device(cloud),c=createCharacter('Mira','5e-2024');await a.workspace.save(c,0);
    const timer=vi.spyOn(globalThis,'setTimeout');
    try{
      await a.engine.flush();
      expect(timer).toHaveBeenCalledWith(expect.any(Function),300000);
      expect(await a.db.outbox.count()).toBe(1);
      expect((await a.workspace.exportBackup()).records[0]).toMatchObject({name:'Mira',hp:10});
      expect(a.statuses.at(-1)).toMatchObject({state:'error',message:expect.stringContaining('quota')});
    }finally{timer.mockRestore();}
  });
  it('keeps local conflict resolution revision-checked and resumes a persisted cursor',async()=>{
    const cloud=new TestCloud(),a=device(cloud),c=createCharacter('Mira','3.5e');await a.workspace.save(c,0);await a.engine.flush();
    await vi.waitFor(async()=>expect(await a.db.meta.get('sync-cursor/owner')).toBeDefined());
    a.engine.stop();const since=(await a.db.meta.get('sync-cursor/owner'))?.value;
    a.engine.start();await vi.waitFor(()=>expect(cloud.lastSince).toBe(since));
    await a.workspace.execute(c.id,{type:'damage',amount:2},1);
    const entry=(await a.workspace.get('character',c.id))!;
    await a.db.conflicts.put({key:entry.key,ownerUid:'owner',local:entry.data,remote:{...c,hp:9},remoteRevision:1,at:new Date().toISOString()});
    await a.engine.resolve(entry.key,'local');
    expect([...cloud.records.values()][0]).toMatchObject({revision:2,data:{hp:8}});
    expect(await a.db.meta.where('key').startsWith('recovery/owner/').count()).toBe(1);
  });
});
