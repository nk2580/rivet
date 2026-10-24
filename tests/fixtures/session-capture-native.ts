import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {SQLiteStore} from '../../desktop/sqlite';
import {NativeSpeech} from '../../desktop/capture-speech';

const directory=resolve('.local',`session-capture-native-${Date.now()}`);await mkdir(directory,{recursive:true});
const bytes=await readFile(resolve('.local/capture-deps/english.zip')),original=globalThis.fetch;
const store=new SQLiteStore(':memory:');let downloads=0;
try{
  globalThis.fetch=async()=>{downloads++;return new Response(bytes);};
  const speech=new NativeSpeech(store,directory,resolve('dist-electron'),()=>{});
  await speech.installModel();assert.equal(speech.ready(),true);await speech.installModel();assert.equal(downloads,1);
  const devices=await speech.devices();assert.ok(Array.isArray(devices));await speech.selectDevice('');
  const broken=new NativeSpeech(store,join(directory,'invalid-download'),resolve('dist-electron'),()=>{});
  globalThis.fetch=async()=>new Response('This is not a valid speech model.');await assert.rejects(broken.installModel(),/checksum/);assert.equal(broken.ready(),false);
  await writeFile(join(directory,'result.json'),JSON.stringify({passed:true,checks:['pinned model extraction','ready marker','idempotent install','microphone enumeration without recording','system-default selection','invalid-download rejection'],microphoneCount:devices.length,note:'No microphone stream was opened. Test downloads used the locally cached official archive.'},null,2));console.log(directory);
}finally{globalThis.fetch=original;store.close();}
