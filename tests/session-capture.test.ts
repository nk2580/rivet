import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {CaptureRuntime,type SpeechSource,type SpeechText,type SummaryInput} from '../desktop/capture';
import {SQLiteStore} from '../desktop/sqlite';
import {Workspace} from '../src/storage/workspace';
import {createCharacter} from '../src/domain/character';
import {recordBase,type Campaign,type Session,type Note} from '../src/domain/schema';
import {captureClock,recapBody,recapSection} from '../src/domain/session-capture';
import {captureSummariser} from '../desktop/capture-summary';

class Speech implements SpeechSource {
  starts=0;stops=0;available=true;tail='';text:(text:SpeechText)=>void=()=>{};failed:(message:string)=>void=()=>{};
  ready(){return this.available;}
  async start(text:(text:SpeechText)=>void,failed:(message:string)=>void){this.starts++;this.text=text;this.failed=failed;}
  async stop(){this.stops++;if(this.tail)this.say(this.tail);}
  say(text:string,at=1000){this.text({text,startMs:at,endMs:at+1000,uncertain:false});}
}
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();vi.unstubAllGlobals();});
async function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'rivet-capture-')),file=join(directory,'workspace.sqlite');
  let store=new SQLiteStore(file),workspace=new Workspace(store.asWorkspaceStore(),'local',true),now=Date.parse('2026-10-24T01:00:00Z');
  const character=createCharacter('The recorder','5e-2024');
  const campaign:Campaign={...recordBase('Table campaign'),kind:'campaign',description:'',activeSessionId:null};character.campaignId=campaign.id;
  const session:Session={...recordBase('The old tower'),kind:'session',campaignId:campaign.id,date:'2026-10-24',characterIds:[character.id],summary:''};campaign.activeSessionId=session.id;
  await workspace.saveMany([{data:character,expectedRevision:0},{data:campaign,expectedRevision:0},{data:session,expectedRevision:0}]);
  const speech=new Speech(),requests:SummaryInput[]=[],summarise=vi.fn(async(input:SummaryInput)=>{requests.push(input);return {group:'- The party discovered a tower.',dm:'- Prepare the tower’s next room.'};});
  const runtime=()=>new CaptureRuntime(store,workspace,{speech,summarise,changed:()=>{},notesChanged:()=>{},automatic:false,now:()=>now});let capture=runtime();
  const f={character,campaign,session,speech,requests,summarise,get capture(){return capture;},get store(){return store;},get workspace(){return workspace;},async start(){await capture.start(character.id,session.id);return capture.status().run!.id;},async advance(ms:number){for(let left=ms;left>0;){const step=Math.min(left,5000);now+=step;left-=step;await capture.tick();}await capture.settled();},async restart(){await capture.close();store.close();store=new SQLiteStore(file);workspace=new Workspace(store.asWorkspaceStore(),'local',true);capture=runtime();},notes:async()=>(await workspace.list('note')).map(row=>row.data as Note)};
  cleanups.push(async()=>{await capture.close();store.close();rmSync(directory,{recursive:true,force:true});});return f;
}
describe('session capture lifecycle and queue',()=>{
  it('loads speech only while listening and serialises duplicate start, pause and resume',async()=>{
    const f=await fixture();await Promise.all([f.start(),f.start()]);expect(f.speech.starts).toBe(1);const id=f.capture.status().run!.id;
    await Promise.all([f.capture.pause(id),f.capture.pause(id)]);expect(f.speech.stops).toBe(1);expect(f.capture.status().run?.state).toBe('paused');
    await f.start();expect(f.speech.starts).toBe(2);expect(f.capture.status().run?.id).toBe(id);
  });
  it('summarises at ten active minutes, skips silence, and excludes paused time',async()=>{
    const f=await fixture(),id=await f.start();await f.advance(600000);expect(f.summarise).not.toHaveBeenCalled();
    f.speech.say('The party enters a tower.');await f.advance(599000);expect(f.summarise).not.toHaveBeenCalled();await f.advance(1000);expect(f.summarise).toHaveBeenCalledTimes(1);
    await f.capture.pause(id);f.speech.say('A short retained tail.');const active=f.capture.status().run!.activeMs;await f.advance(900000);expect(f.capture.status().run!.activeMs).toBe(active);
    await f.start();await f.advance(600000);expect(f.summarise).toHaveBeenCalledTimes(2);
  });
  it('manual summary consumes only its frozen range while recording continues',async()=>{
    const f=await fixture(),id=await f.start();f.speech.say('The party finds a map.');await f.capture.summarise(id);await f.capture.settled();
    f.speech.say('A bridge collapses.');await f.advance(600000);
    expect(f.requests).toHaveLength(2);expect(f.requests[0].source).toContain('finds a map');expect(f.requests[1].source).toContain('bridge collapses');expect(f.requests[1].source).not.toContain('finds a map');expect(f.capture.status().run?.state).toBe('listening');
  });
  it('flushes the speech tail on pause, adds quick corrections, and creates one final recap',async()=>{
    const f=await fixture(),before=await f.workspace.get('character',f.character.id),id=await f.start();f.speech.tail='The guard agrees to help.';await f.capture.pause(id);await f.capture.quickNote(id,'Correction: the guard is named Thariel.');
    await Promise.all([f.capture.end(id),f.capture.end(id)]);await f.capture.settled();
    expect(f.requests[0].source).toContain('guard agrees');expect(f.requests[0].source).toContain('Thariel');expect(f.requests.at(-1)?.final).toBe(true);
    const notes=await f.notes();expect(notes).toHaveLength(2);expect(notes.filter(n=>n.tags.includes('final-recap'))).toHaveLength(1);expect(notes.every(n=>!n.shareWithGuide)).toBe(true);
    expect(f.capture.runs(f.session.id)[0].state).toBe('ended');expect(await f.workspace.get('character',f.character.id)).toEqual(before);expect(await f.store.activity.toArray()).toEqual([]);
  });
  it('keeps failed work queued, ends the microphone immediately, and retries without duplicate notes',async()=>{
    const f=await fixture(),id=await f.start();f.speech.say('The party meets a merchant.');f.summarise.mockRejectedValueOnce(new TypeError('Offline'));
    await f.capture.pause(id);await f.capture.end(id);await f.capture.settled();expect(f.speech.stops).toBe(1);expect(await f.notes()).toHaveLength(0);expect(f.capture.status().run?.state).toBe('finalising');expect(f.capture.status().pendingJobs).toBe(2);
    await f.capture.retry(id);await f.capture.settled();expect(await f.notes()).toHaveLength(2);await f.capture.retry(id);await f.capture.settled();expect(await f.notes()).toHaveLength(2);
  });
  it('preserves edited checkpoint text and uses those edits in the consolidated recap',async()=>{
    const f=await fixture(),id=await f.start();f.speech.say('A disputed name.');await f.capture.summarise(id);await f.capture.settled();const entry=(await f.workspace.list('note'))[0];
    await f.workspace.save({...entry.data as Note,body:recapBody('Edited: Thariel owns the tower.','Ask about the missing key.')},entry.localRevision);
    await f.capture.pause(id);await f.capture.end(id);await f.capture.settled();expect(f.requests.at(-1)?.source).toContain('Thariel owns the tower');expect((await f.workspace.get('note',entry.id))?.data).toMatchObject({body:expect.stringContaining('Edited: Thariel')});
  });
  it('retains final speech when quitting and never reopens the microphone on restart',async()=>{
    const f=await fixture();await f.start();f.speech.tail='Last words before quitting.';await f.restart();expect(f.speech.starts).toBe(1);expect(f.capture.status().run?.state).toBe('interrupted');
    const transcript=await f.capture.transcript(f.capture.status().run!.id);expect(transcript.segments.map(s=>s.text).join(' ')).toContain('Last words before quitting.');
  });
  it('records device loss and requires explicit resume',async()=>{
    const f=await fixture(),id=await f.start();f.speech.failed('Microphone disconnected.');await f.capture.settled();expect(f.capture.status().run?.state).toBe('interrupted');expect((await f.capture.transcript(id)).segments.some(s=>s.kind==='gap')).toBe(true);expect(f.speech.starts).toBe(1);
  });
  it('rejects a different session or character without retargeting an active capture',async()=>{
    const f=await fixture(),id=await f.start();const other=createCharacter('Someone else','5e-2024');other.campaignId=f.campaign.id;await f.workspace.save(other,0);
    await expect(f.capture.start(other.id,f.session.id)).rejects.toThrow('Capture belongs');expect(f.capture.status().run?.id).toBe(id);
  });
  it('paginates transcript reads and does not save audio or credential fields',async()=>{
    const f=await fixture(),id=await f.start();for(let i=0;i<105;i++)await f.capture.quickNote(id,`Event ${i}`);
    const first=await f.capture.transcript(id),next=await f.capture.transcript(id,100);expect(first.segments).toHaveLength(100);expect(first.hasMore).toBe(true);expect(next.segments).toHaveLength(5);
    expect(Object.keys(f.capture.exportBackup()).sort()).toEqual(['jobs','runs','segments','version']);
  });
  it('imports capture data held, preserves existing records, and never listens or uploads automatically',async()=>{
    const f=await fixture(),id=await f.start();await f.capture.quickNote(id,'A name to keep.');f.summarise.mockRejectedValueOnce(new Error('Offline'));await f.capture.summarise(id);await f.capture.settled();await f.capture.pause(id);const backup=f.capture.exportBackup();
    const store=new SQLiteStore(':memory:'),workspace=new Workspace(store.asWorkspaceStore(),'local',true);await workspace.importRecords((await f.workspace.exportBackup()).records);
    const speech=new Speech(),summarise=vi.fn(),capture=new CaptureRuntime(store,workspace,{speech,summarise,changed:()=>{},notesChanged:()=>{},automatic:false});
    try{expect(await capture.importBackup(backup)).toBe(1);await capture.tick();await capture.settled();expect(speech.starts).toBe(0);expect(summarise).not.toHaveBeenCalled();expect(capture.runs(f.session.id)[0].held).toBe(true);expect(await capture.importBackup(backup)).toBe(0);}
    finally{await capture.close();store.close();}
  });
  it('rolls back note creation when its completion receipt cannot be saved',async()=>{
    const f=await fixture(),id=await f.start();f.speech.say('A discovered clue.');
    f.store.connection.exec("CREATE TRIGGER fail_capture_completion BEFORE UPDATE ON capture_jobs WHEN json_extract(NEW.payload,'$.state')='complete' BEGIN SELECT RAISE(ABORT,'Synthetic receipt failure'); END;");
    await f.capture.summarise(id);await f.capture.settled();expect(await f.notes()).toHaveLength(0);expect(f.capture.status().pendingJobs).toBe(1);
    f.store.connection.exec('DROP TRIGGER fail_capture_completion');await f.capture.retry(id);await f.capture.settled();expect(await f.notes()).toHaveLength(1);
  });
  it('retains buffered speech if the transaction that queues its summary rolls back',async()=>{
    const f=await fixture(),id=await f.start();f.speech.say('Do not lose this buffered clue.');
    f.store.connection.exec("CREATE TRIGGER fail_capture_queue BEFORE INSERT ON capture_jobs BEGIN SELECT RAISE(ABORT,'Synthetic queue failure'); END;");
    await expect(f.capture.summarise(id)).rejects.toThrow('Synthetic queue failure');
    f.store.connection.exec('DROP TRIGGER fail_capture_queue');
    expect((await f.capture.transcript(id)).segments.map(segment=>segment.text)).toContain('Do not lose this buffered clue.');
    await f.capture.summarise(id);await f.capture.settled();expect(f.requests[0].source).toContain('Do not lose this buffered clue.');
  });
  it('stops recognition on transcript storage failure and retains buffered text for recovery',async()=>{
    const f=await fixture(),id=await f.start();f.store.connection.exec("CREATE TRIGGER fail_capture_text BEFORE INSERT ON capture_segments BEGIN SELECT RAISE(ABORT,'Synthetic disk failure'); END;");
    for(let i=0;i<20;i++)f.speech.say(`Buffered event ${i}`);await f.capture.settled();await f.capture.settled();
    expect(f.speech.stops).toBe(1);expect(f.capture.status().run?.state).toBe('interrupted');expect(f.capture.status().run?.error).toContain('Synthetic disk failure');
    f.store.connection.exec('DROP TRIGGER fail_capture_text');await f.start();await f.capture.summarise(id);await f.capture.settled();expect(f.requests[0].source).toContain('Buffered event 19');
  });
  it('rejects malformed backups before writing capture records',async()=>{
    const f=await fixture(),id=await f.start();await f.capture.quickNote(id,'Remember this.');const backup=f.capture.exportBackup();
    expect(()=>f.capture.validateBackup({...backup,segments:[...backup.segments,...backup.segments]})).toThrow('Duplicate');
    expect(()=>f.capture.validateBackup({...backup,segments:[{...backup.segments[0],sequence:3}]})).toThrow('incomplete');
  });
});
describe('audience copy and ChatGPT boundaries',()=>{
  it('extracts the current edited audience sections without leaking a missing section',()=>{
    const body=recapBody('The party reached town.','Prepare the mayor.');expect(recapSection(body,'group')).toBe('The party reached town.');expect(recapSection(body,'dm')).toBe('Prepare the mayor.');expect(recapSection('Unstructured edited text','group')).toBe('');expect(captureClock(601000)).toBe('10:01');
  });
  it('uses the existing account, text-only requests, and waits for response.completed',async()=>{
    const auth={status:async()=>({active:'account'}),modelPreference:async()=>({model:'available-model'}),token:async()=> 'synthetic-token'};
    const fetch=vi.fn(async(_url:unknown,options:RequestInit)=>{const body=JSON.parse(String(options.body));expect(body).toMatchObject({model:'available-model',store:false,stream:true});expect(body.tools).toBeUndefined();expect(body.input[0].content).toContain('new events');return new Response(`data: ${JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify({group:'An event.',dm:'A follow-up.'})})}\n\ndata: ${JSON.stringify({type:'response.completed',response:{status:'completed'}})}\n\n`);});vi.stubGlobal('fetch',fetch);
    const result=await captureSummariser(auth as never)({title:'Session',final:false,source:'new events',previous:'',signal:new AbortController().signal});expect(result.group).toBe('An event.');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects interrupted streams and account changes without publishing partial output',async()=>{
    const status=vi.fn().mockResolvedValue({active:'account'}),auth={status,modelPreference:async()=>({model:'model'}),token:async()=> 'synthetic-token'},input={title:'Session',final:false,source:'events',previous:'',signal:new AbortController().signal};
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(`data: ${JSON.stringify({type:'response.output_text.delta',delta:'{"group":"partial"}'})}\n\n`)));
    await expect(captureSummariser(auth as never)(input)).rejects.toThrow('interrupted');
    status.mockResolvedValueOnce({active:'account'}).mockResolvedValueOnce({active:'other'});vi.stubGlobal('fetch',vi.fn(async()=>new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed'}})}\n\n`)));
    await expect(captureSummariser(auth as never)(input)).rejects.toThrow('account changed');
  });
});
