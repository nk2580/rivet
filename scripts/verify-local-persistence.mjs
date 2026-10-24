import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';

const base=process.env.RIVET_TEST_API||'http://127.0.0.1:18080';
const local=hostname=>['127.0.0.1','localhost'].includes(hostname);
assert(local(new URL(base).hostname),'Only local emulator verification is supported.');
const config=await (await fetch(`${base}/api/config`)).json();
assert.equal(config.mode,'emulator');assert.equal(config.firebase.projectId,'demo-rivet');
assert(local(new URL(config.authEmulatorUrl).hostname));assert(local(config.firestoreEmulatorHost));
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const payload={sub:'rivet-local-owner',email:'owner@example.test',email_verified:true,name:'Local test owner',aud:'demo-rivet',iss:'https://accounts.google.com',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600};
const synthetic=`${encode({alg:'none',typ:'JWT'})}.${encode(payload)}.`;
const authResponse=await fetch(`${config.authEmulatorUrl}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-rivet-public-key`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestUri:base,returnSecureToken:true,postBody:new URLSearchParams({id_token:synthetic,providerId:'google.com'}).toString()})});
assert.equal(authResponse.status,200,'Local emulator identity failed.');
const credential=await authResponse.json(),records=[];
if(process.argv[2]==='seed'){
  const backup=JSON.parse(await readFile(new URL('../.local/qa/browser-roundtrip-backup.json',import.meta.url),'utf8'));
  const original=JSON.parse(await readFile(new URL('../.local/qa/legacy-fixture.json',import.meta.url),'utf8'));
  assert.deepEqual(backup.sourceArchives[0].original,original,'Only the known synthetic browser fixture may seed this test.');
  assert.equal(backup.records.length,6);
  const root=`projects/demo-rivet/databases/(default)/documents/users/${credential.localId}/records`;
  const writes=backup.records.map(record=>{
    assert(record.id.startsWith(backup.sourceArchives[0].id));
    return {update:{name:`${root}/${record.kind}__${record.id}`,fields:{schemaVersion:{integerValue:'2'},writerVersion:{integerValue:'3'},kind:{stringValue:record.kind},payload:{stringValue:JSON.stringify(record)},revision:{integerValue:'1'},deleted:{booleanValue:false},operationId:{stringValue:randomUUID()}}},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:{exists:false}};
  });
  const response=await fetch(`http://${config.firestoreEmulatorHost}:${config.firestoreEmulatorPort}/v1/projects/demo-rivet/databases/(default)/documents:commit`,{method:'POST',headers:{Authorization:`Bearer ${credential.idToken}`,'Content-Type':'application/json'},body:JSON.stringify({writes})});
  assert.equal(response.status,200,'Synthetic seeding failed; existing records are never replaced.');
  console.log('Seeded the six known synthetic records for persistence verification.');process.exit(0);
}
let page='';
do{
  const url=new URL(`http://${config.firestoreEmulatorHost}:${config.firestoreEmulatorPort}/v1/projects/demo-rivet/databases/(default)/documents/users/${encodeURIComponent(credential.localId)}/records`);
  url.searchParams.set('pageSize','1000');if(page)url.searchParams.set('pageToken',page);
  const response=await fetch(url,{headers:{Authorization:`Bearer ${credential.idToken}`}});
  assert.equal(response.status,200,'Local Firestore read failed.');const result=await response.json();
  for(const document of result.documents??[])records.push({id:document.name.split('/').at(-1),revision:document.fields.revision.integerValue,deleted:document.fields.deleted.booleanValue,digest:createHash('sha256').update(document.fields.payload.stringValue).digest('hex')});
  page=result.nextPageToken||'';
}while(page);
records.sort((a,b)=>a.id.localeCompare(b.id));assert(records.length>0,'Create synthetic records before running persistence acceptance.');
const path=new URL('../.local/qa/emulator-persistence.json',import.meta.url);
if(process.argv[2]==='snapshot'){await mkdir(new URL('../.local/qa/',import.meta.url),{recursive:true});await writeFile(path,JSON.stringify(records,null,2));console.log(`Saved checksums for ${records.length} emulator records. No credentials were saved.`);}
else if(process.argv[2]==='verify'){assert.deepEqual(records,JSON.parse(await readFile(path,'utf8')));console.log(`Restart persistence verified: ${records.length} emulator records have identical payloads and revisions.`);}
else throw new Error('Choose snapshot or verify.');
