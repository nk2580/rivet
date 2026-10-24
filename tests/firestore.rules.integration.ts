import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

// Only the explicitly named local test project is cleared. Never points to production.
const PROJECT_ID='demo-rivet-rules-test';
let environment:RulesTestEnvironment;
const claims=(email='owner@example.test',verified=true,provider:'google.com'|'password'='google.com')=>({email,email_verified:verified,firebase:{sign_in_provider:provider}});
const value=(revision=1,kind='character')=>({schemaVersion:2,writerVersion:3,kind,payload:'{}',revision,updatedAt:serverTimestamp(),deleted:false,operationId:`test-operation-${revision}`});
describe('Firestore owner and revision rules',()=>{
  beforeAll(async()=>{environment=await initializeTestEnvironment({projectId:PROJECT_ID,firestore:{host:'127.0.0.1',port:Number(process.env.RIVET_RULES_TEST_PORT||8081),rules:await readFile('firestore.rules','utf8')}});});
  beforeEach(async()=>{await environment.clearFirestore();});
  afterAll(async()=>{await environment?.cleanup();});
  it('permits only the verified Google owner under their own UID',async()=>{
    const owner=environment.authenticatedContext('owner',claims()).firestore();
    await assertSucceeds(setDoc(doc(owner,'users/owner/records/character__one'),value()));
    for(const context of [environment.unauthenticatedContext(),environment.authenticatedContext('other',claims('other@example.com')),environment.authenticatedContext('owner',claims(undefined,false)),environment.authenticatedContext('owner',claims(undefined,true,'password')),environment.authenticatedContext('different-uid',claims())]) {
      await assertFails(getDoc(doc(context.firestore(),'users/owner/records/character__one')));
    }
  });
  it('requires exactly one revision increment and denies hard deletion',async()=>{
    const store=environment.authenticatedContext('owner',claims()).firestore();const ref=doc(store,'users/owner/records/character__one');
    await assertSucceeds(setDoc(ref,value()));
    await assertFails(updateDoc(ref,{...value(3)}));
    await assertSucceeds(updateDoc(ref,{...value(2)}));
    await assertFails(deleteDoc(ref));
    await assertSucceeds(updateDoc(ref,{...value(3),deleted:true}));
  });
  it('denies browser access to integration secrets, legacy writes, and unexpected paths',async()=>{
    const store=environment.authenticatedContext('owner',claims()).firestore();
    for(const path of ['_server/chatgpt','integrations/chatgpt','users/owner/sheets/main']) {
      await assertFails(setDoc(doc(store,path),{secret:'test-fixture'}));
      if(!path.includes('sheets'))await assertFails(getDoc(doc(store,path)));
    }
  });
  it('rejects extra fields, oversized payloads, changed record kinds and invalid revisions',async()=>{
    const store=environment.authenticatedContext('owner',claims()).firestore();const ref=doc(store,'users/owner/records/character__one');
    await assertFails(setDoc(ref,{...value(),secret:'not-a-client-field'}));
    await assertFails(setDoc(ref,{...value(),payload:'x'.repeat(200001)}));
    await assertFails(setDoc(ref,value(0)));
    const {writerVersion:_version,...oldClient}=value();await assertFails(setDoc(ref,oldClient));
    await assertFails(setDoc(ref,{...value(),writerVersion:2}));
    await assertSucceeds(setDoc(ref,value()));
    await assertFails(updateDoc(ref,value(2,'note')));
    expect((await getDoc(ref)).data()?.revision).toBe(1);
  });
});
