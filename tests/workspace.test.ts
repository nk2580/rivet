import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RivetDatabase, Workspace, StaleRevisionError, CommandIdentityError } from '../src/storage/database';
import { createCharacter } from '../src/domain/character';
import { migrateLegacy } from '../src/storage/import';
import { defaultState } from '../legacy/dist/model.js';

describe('durable owner-scoped command workspace', () => {
  let db: RivetDatabase;
  let workspace: Workspace;
  beforeEach(() => {db = new RivetDatabase(`rivet-test-${crypto.randomUUID()}`); workspace = new Workspace(db, 'owner');});
  afterEach(async () => {await db.delete();});
  it('persists an independent record and outbox per character', async () => {
    const a = createCharacter('A', '5e-2024'), b = createCharacter('B', '3.5e');
    await workspace.save(a); await workspace.save(b);
    await workspace.execute(a.id, {type: 'damage', amount: 3}, 1);
    expect((await workspace.get('character', a.id))?.data).toMatchObject({hp: 7});
    expect((await workspace.get('character', b.id))?.data).toMatchObject({hp: 10});
    expect(await db.outbox.count()).toBe(2);
    expect(await new Workspace(db, 'other-user').list('character')).toEqual([]);
  });
  it('reads an offline sheet created before additive fields without resetting it or stamping pending old writes as current',async()=>{
    const c=createCharacter('Cached legacy','5e-2024');await workspace.save(c,0);
    const entry=(await workspace.get('character',c.id))!;
    const old=structuredClone(c) as Partial<typeof c>;delete old.equipmentRules;delete old.armorTraining;
    await db.documents.put({...entry,writerVersion:2,data:old as typeof c});
    const pending=(await db.outbox.toArray())[0];await db.outbox.put({...pending,writerVersion:undefined,data:old as typeof c});
    db.close();await db.open();
    expect((await workspace.get('character',c.id))?.data).toMatchObject({name:'Cached legacy',hp:10,equipmentRules:false,armorTraining:[]});
    expect((await db.outbox.toArray())[0].writerVersion).toBeUndefined();
    await db.documents.put({...entry,writerVersion:99});await expect(workspace.get('character',c.id)).rejects.toThrow('newer Rivet version');
  });
  it('makes retried command identities idempotent and rejects stale concurrent changes', async () => {
    const c = createCharacter('A', '5e-2014'); await workspace.save(c);
    const receipt = await workspace.execute(c.id, {type: 'damage', amount: 2}, 1, 'command-1');
    expect(await workspace.execute(c.id, {type: 'damage', amount: 2}, 1, 'command-1')).toEqual(receipt);
    await expect(workspace.execute(c.id, {type: 'damage', amount: 4}, 1)).rejects.toBeInstanceOf(StaleRevisionError);
    expect((await workspace.get('character', c.id))?.data).toMatchObject({hp: 8});
  });
  it('undoes only the newest applicable change', async () => {
    const c = createCharacter('A', '5e-2024'); await workspace.save(c);
    const receipt = await workspace.execute(c.id, {type: 'damage', amount: 4}, 1);
    await workspace.undo(receipt.key);
    expect((await workspace.get('character', c.id))?.data).toMatchObject({hp: 10});
    await expect(workspace.undo(receipt.key)).rejects.toThrow();
  });
  it('can undo a chain while rejecting edits outside that chain', async () => {
    const c = createCharacter('A', '5e-2024'); await workspace.save(c,0);
    const a = await workspace.execute(c.id,{type:'damage',amount:4},1);
    const b = await workspace.execute(c.id,{type:'heal',amount:2},2);
    await expect(workspace.undo(a.key)).rejects.toThrow('latest action');
    await workspace.undo(b.key); await workspace.undo(a.key);
    const current = (await workspace.get('character',c.id))!;
    expect(current.data).toMatchObject({hp:10});
    const d = await workspace.execute(c.id,{type:'damage',amount:1},current.localRevision);
    const changed = (await workspace.get('character',c.id))!;
    await workspace.save({...changed.data,name:'Updated'},changed.localRevision);
    await expect(workspace.undo(d.key)).rejects.toThrow('latest action');
  });
  it('never reuses a command ID for another payload or character',async()=>{
    const a=createCharacter('A','5e-2024'),b=createCharacter('B','5e-2024');
    await workspace.save(a,0);await workspace.save(b,0);
    await workspace.execute(a.id,{type:'damage',amount:2},1,'request-1');
    await expect(workspace.execute(a.id,{type:'damage',amount:4},1,'request-1')).rejects.toBeInstanceOf(CommandIdentityError);
    await expect(workspace.execute(b.id,{type:'damage',amount:2},1,'request-1')).rejects.toBeInstanceOf(CommandIdentityError);
  });
  it('serializes simultaneous tabs and survives closing and reopening IndexedDB',async()=>{
    const c=createCharacter('A','5e-2014');await workspace.save(c,0);
    const secondDb=new RivetDatabase(db.name),secondTab=new Workspace(secondDb,'owner');
    try{
      const outcomes=await Promise.allSettled([
        workspace.execute(c.id,{type:'damage',amount:3},1),
        secondTab.execute(c.id,{type:'heal',amount:1},1),
      ]);
      expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);
      expect(outcomes.filter(o=>o.status==='rejected')).toHaveLength(1);
      const saved=(await workspace.get('character',c.id))!;
      secondDb.close();db.close();await db.open();
      expect(await workspace.get('character',c.id)).toEqual(saved);
      expect(await db.outbox.count()).toBe(1);
    }finally{secondDb.close();}
  });
  it('keeps tombstones through imports and allows explicit restoration',async()=>{
    const c=createCharacter('A','3.5e');await workspace.save(c,0);
    const deleted=await workspace.setDeleted('character',c.id,true,1);
    expect(await workspace.list('character')).toEqual([]);
    expect(await workspace.importRecords([c])).toBe(0);
    await workspace.setDeleted('character',c.id,false,deleted.localRevision);
    expect(await workspace.list('character')).toHaveLength(1);
    expect(await new Workspace(db,'someone-else').get('character',c.id)).toBeUndefined();
  });
  it('imports atomically and never silently replaces an existing record', async () => {
    const c = createCharacter('A', '5e-2024'); await workspace.save(c);
    const backup = await workspace.exportBackup();
    expect(await workspace.importRecords(backup.records)).toBe(0);
    await expect(workspace.importRecords([createCharacter('B', '3.5e'), {...c, hp: 900}])).rejects.toThrow();
    expect((await workspace.list('character')).length).toBe(1);
  });
  it('rolls back a grouped save if a linked record changed in another tab',async()=>{
    const a=createCharacter('A','5e-2024'),b=createCharacter('B','3.5e');await workspace.save(a,0);await workspace.save(b,0);
    await expect(workspace.saveMany([{data:{...a,name:'Changed'},expectedRevision:1},{data:b,expectedRevision:0}])).rejects.toBeInstanceOf(StaleRevisionError);
    expect((await workspace.get('character',a.id))?.data.name).toBe('A');
  });
  it('round-trips original source archives without exporting another owner’s local records',async()=>{
    const original=defaultState();const migrated=await migrateLegacy(original);
    await workspace.importRecords(migrated.records,[migrated.source]);
    await db.meta.put({key:'source/another-owner/private',value:{private:'not in this backup'}});
    const backup=await workspace.exportBackup();
    expect(backup.sourceArchives).toHaveLength(1);expect(backup.sourceArchives[0].original).toEqual(original);
    const restored=new Workspace(db,'restored-owner');
    await restored.importRecords(backup.records,backup.sourceArchives);
    expect((await restored.exportBackup()).sourceArchives[0].original).toEqual(original);
  });
  it('round-trips archives and both conflict versions in an atomic owner-scoped backup',async()=>{
    const c=createCharacter('A','5e-2024');await workspace.save(c,0);await workspace.setDeleted('character',c.id,true,1);
    const copy={key:`owner/character/${c.id}`,ownerUid:'owner',local:c,remote:{...c,hp:6},remoteRevision:3,at:new Date().toISOString()};
    await db.meta.put({key:'recovery/owner/copy-one',value:copy});
    await db.meta.put({key:'recovery/another-owner/private',value:{private:'excluded'}});
    const backup=await workspace.exportBackup();
    expect(backup.records).toHaveLength(0);expect(backup.archivedRecords).toHaveLength(1);expect(backup.recoveryCopies).toHaveLength(1);
    const restored=new Workspace(db,'restored-owner');
    await restored.importRecords(backup.records,backup.sourceArchives,backup.recoveryCopies,backup.archivedRecords);
    expect(await restored.list('character')).toEqual([]);expect((await restored.get('character',c.id))?.deleted).toBe(true);
    expect((await restored.exportBackup()).recoveryCopies).toEqual(backup.recoveryCopies);
    await expect(restored.importRecords([createCharacter('New','3.5e')],[],[{...backup.recoveryCopies[0],remote:{...c,id:'mismatch'}}])).rejects.toThrow();
    expect((await db.documents.where('ownerUid').equals('restored-owner').toArray())).toHaveLength(1);
  });
});
