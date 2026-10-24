import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { createCharacter } from '../src/domain/character';
import { RivetDatabase, Workspace } from '../src/storage/database';
import { SyncEngine, type SyncStatus } from '../src/storage/sync-engine';
import { FirestoreTransport } from '../src/storage/sync';

const PROJECT_ID='demo-rivet-sync-test';
let environment:RulesTestEnvironment;
describe('actual Firestore transport with independent device databases',()=>{
  beforeAll(async()=>{environment=await initializeTestEnvironment({projectId:PROJECT_ID,firestore:{host:'127.0.0.1',port:Number(process.env.RIVET_RULES_TEST_PORT||8081),rules:await readFile('firestore.rules','utf8')}});await environment.clearFirestore();});
  afterAll(async()=>{await environment?.cleanup();});
  it('synchronizes, deduplicates a retry, and retains both devices through conflict resolution',async()=>{
    const claims={email:'owner@example.test',email_verified:true,firebase:{sign_in_provider:'google.com' as const}};
    // Rules-testing exposes compat wrappers; modular Firestore unwraps them at its API boundary.
    const cloudA=environment.authenticatedContext('owner',claims).firestore() as unknown as Firestore,cloudB=environment.authenticatedContext('owner',claims).firestore() as unknown as Firestore;
    const dbA=new RivetDatabase(`rivet-integration-a-${crypto.randomUUID()}`),dbB=new RivetDatabase(`rivet-integration-b-${crypto.randomUUID()}`);
    const a=new Workspace(dbA,'owner'),b=new Workspace(dbB,'owner');
    const statusA:SyncStatus[]=[],statusB:SyncStatus[]=[];
    const transportA=new FirestoreTransport(cloudA,'owner');
    const settings={online:()=>true,onReconnect:()=>()=>{},delay:600000};
    const syncA=new SyncEngine(dbA,transportA,'owner',status=>statusA.push(status),settings),syncB=new SyncEngine(dbB,new FirestoreTransport(cloudB,'owner'),'owner',status=>statusB.push(status),settings);
    syncA.start();syncB.start();
    try{
      const c=createCharacter('Transport acceptance','5e-2024');await a.save(c,0);
      const pending=(await dbA.outbox.toArray())[0];await syncA.flush();
      await vi.waitFor(async()=>expect((await b.get('character',c.id))?.data).toMatchObject({hp:10}),{timeout:8000});
      await transportA.commit(pending);expect((await getDoc(doc(cloudA,`users/owner/records/character__${c.id}`))).data()?.revision).toBe(1);
      const rejected=await transportA.commit({...pending,operationId:'older-client-queued-edit',baseRevision:1,writerVersion:2,data:{...c,equipmentRules:false}});
      expect(rejected).toMatchObject({accepted:false,record:{revision:1,writerVersion:3,data:{equipmentRules:true}}});
      expect((await getDoc(doc(cloudA,`users/owner/records/character__${c.id}`))).data()?.writerVersion).toBe(3);
      syncB.stop();await b.execute(c.id,{type:'damage',amount:4},1);
      await a.execute(c.id,{type:'damage',amount:2},1);await syncA.flush();
      syncB.start();await vi.waitFor(async()=>expect(await dbB.conflicts.count()).toBe(1),{timeout:8000});
      const entry=(await b.get('character',c.id))!;await syncB.resolve(entry.key,'local');
      await vi.waitFor(async()=>expect((await a.get('character',c.id))?.data).toMatchObject({hp:6}),{timeout:8000});
      expect((await getDoc(doc(cloudA,`users/owner/records/character__${c.id}`))).data()?.revision).toBe(3);
      expect(await dbB.meta.where('key').startsWith('recovery/owner/').count()).toBe(1);
      expect(await dbA.outbox.count()).toBe(0);expect(await dbB.outbox.count()).toBe(0);
      expect(statusA.some(status=>status.state==='synced')).toBe(true);expect(statusB.some(status=>status.state==='conflict')).toBe(true);
    }finally{syncA.stop();syncB.stop();await dbA.delete();await dbB.delete();}
  });
});
