import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {SQLiteStore} from './sqlite';
import type {Workspace} from '../src/storage/workspace';
import {recordBase,type Note} from '../src/domain/schema';
import {CAPTURE_INTERVAL_MS,captureBackupSchema,captureRunSchema,captureSegmentSchema,captureJobSchema,recapBody,captureClock,type CaptureRun,type CaptureSegment,type CaptureJob,type CaptureStatus,type CaptureTranscript,type CaptureBackup} from '../src/domain/session-capture';

export type SpeechText={text:string;startMs:number;endMs:number;uncertain:boolean};
export interface SpeechSource {ready():boolean;start(text:(text:SpeechText)=>void,failed:(message:string)=>void):Promise<void>;stop():Promise<void>;}
export type SummaryInput={title:string;final:boolean;source:string;previous:string;signal:AbortSignal};
export type Summariser=(input:SummaryInput)=>Promise<{group:string;dm:string}>;
const summarySchema=z.object({group:z.string().trim().min(1).max(16000),dm:z.string().trim().min(1).max(8000)});
type Dependencies={speech:SpeechSource;summarise:Summariser;changed:()=>void;notesChanged:()=>void;now?:()=>number;automatic?:boolean};
const json=<T>(row:unknown):T=>JSON.parse((row as {payload:string}).payload);

/** One owner in the desktop main process. No model tools or character commands are exposed here. */
export class CaptureRuntime {
  private timer:ReturnType<typeof setInterval>|undefined;
  private tail:Promise<unknown>=Promise.resolve();
  private buffer:CaptureSegment[]=[];
  private work:Promise<void>|null=null;
  private abort:AbortController|null=null;
  private closed=false;
  private busy=false;
  private lastTick:number;
  private lastPersist:number;
  private listeningId:string|null=null;
  private activeSince=0;
  private fault:{id:string;message:string}|null=null;
  private now:()=>number;
  constructor(private store:SQLiteStore,private workspace:Workspace,private deps:Dependencies){
    this.now=deps.now??Date.now;this.lastTick=this.lastPersist=this.now();
    store.connection.exec(`CREATE TABLE IF NOT EXISTS capture_runs(id TEXT PRIMARY KEY,payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
      CREATE TABLE IF NOT EXISTS capture_segments(run_id TEXT NOT NULL REFERENCES capture_runs(id),sequence INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),PRIMARY KEY(run_id,sequence)) STRICT;
      CREATE TABLE IF NOT EXISTS capture_jobs(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES capture_runs(id),payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
      CREATE INDEX IF NOT EXISTS capture_jobs_run ON capture_jobs(run_id);`);
    // Reopening a workspace never reopens its microphone.
    for(const run of this.allRuns())if(run.state==='listening'){this.putRun({...run,state:'interrupted',error:'Listening stopped when Rivet closed. Resume when the table is ready.'});this.append(run.id,'gap','Rivet closed while listening. Speech during the interruption was not captured.');}
    for(const job of this.jobs())if(job.state==='running')this.putJob({...job,state:'pending'});
    this.flush();this.buffer=[];
    if(deps.automatic!==false){this.timer=setInterval(()=>{void this.tick().catch(error=>this.report(error));},1000);this.timer.unref?.();}
  }
  private async transaction<T>(action:()=>Promise<T>):Promise<T>{
    const result=await this.store.transaction<T>(action);
    // Remove buffered text only after a successful commit. A rolled-back checkpoint must not lose speech.
    const persisted=this.store.connection.prepare('SELECT 1 FROM capture_segments WHERE run_id=? AND sequence=?');
    this.buffer=this.buffer.filter(segment=>!persisted.get(segment.runId,segment.sequence));
    return result;
  }
  private serial<T>(action:()=>Promise<T>):Promise<T>{const result=this.tail.then(action);this.tail=result.catch(()=>{});return result;}
  private allRuns(){return this.store.connection.prepare('SELECT payload FROM capture_runs ORDER BY rowid DESC').all().map(row=>json<CaptureRun>(row));}
  private getRun(id:string){const row=this.store.connection.prepare('SELECT payload FROM capture_runs WHERE id=?').get(id);if(!row)throw new Error('Session capture not found.');return json<CaptureRun>(row);}
  private putRun(run:CaptureRun){this.store.connection.prepare('INSERT INTO capture_runs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(run.id,JSON.stringify(captureRunSchema.parse(run)));}
  private jobs(runId?:string){return (runId?this.store.connection.prepare('SELECT payload FROM capture_jobs WHERE run_id=? ORDER BY rowid').all(runId):this.store.connection.prepare('SELECT payload FROM capture_jobs ORDER BY rowid').all()).map(row=>json<CaptureJob>(row));}
  private putJob(job:CaptureJob){this.store.connection.prepare('INSERT INTO capture_jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(job.id,job.runId,JSON.stringify(captureJobSchema.parse(job)));}
  private sequence(id:string){return Math.max(Number(this.store.connection.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM capture_segments WHERE run_id=?').get(id)?.n),...this.buffer.filter(s=>s.runId===id).map(s=>s.sequence));}
  private active(){return this.allRuns().find(run=>!run.held&&['listening','paused','interrupted'].includes(run.state))??null;}
  private view(run:CaptureRun){if(this.fault?.id===run.id)return {...run,state:'interrupted' as const,error:this.fault.message};return this.listeningId===run.id?{...run,activeMs:run.activeMs+Math.max(0,this.now()-this.activeSince)}:run;}
  status():CaptureStatus{
    const stored=this.active()??this.allRuns().find(run=>run.state==='finalising')??null;
    const run=stored?this.view(stored):null;
    const jobs=run?this.jobs(run.id):[];
    return {run,pendingSegments:run?this.sequence(run.id)-run.lastQueuedSequence:0,pendingJobs:jobs.filter(j=>j.state!=='complete').length,summarising:jobs.some(j=>j.state==='running'),nextSummarySeconds:run?Math.max(0,Math.ceil((run.nextSummaryMs-run.activeMs)/1000)):600,busy:this.busy};
  }
  runs(sessionId:string){return this.allRuns().filter(run=>run.sessionId===sessionId).map(run=>this.view(run));}
  transcript(id:string,after=0):Promise<CaptureTranscript>{return this.serial(()=>this.transaction<CaptureTranscript>(async()=>{this.getRun(id);this.flush();const rows=this.store.connection.prepare('SELECT payload FROM capture_segments WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT 101').all(id,after);return {segments:rows.slice(0,100).map(row=>json<CaptureSegment>(row)),hasMore:rows.length>100};}));}
  private append(id:string,kind:CaptureSegment['kind'],text:string,timing?:SpeechText){
    if(!text.trim())return;const run=this.view(this.getRun(id));
    const segment=captureSegmentSchema.parse({runId:id,sequence:this.sequence(id)+1,kind,text:text.trim(),at:new Date(this.now()).toISOString(),startMs:timing?.startMs??run.activeMs,endMs:timing?.endMs??run.activeMs,uncertain:timing?.uncertain??false});
    this.buffer.push(segment);if(this.buffer.length>=20)void this.serial(()=>this.transaction(async()=>this.flush())).catch(error=>this.report(error));this.deps.changed();
  }
  private flush(){
    if(!this.buffer.length)return;
    // Call only during initialization or inside the store's serialized transaction.
    const insert=this.store.connection.prepare('INSERT OR IGNORE INTO capture_segments VALUES(?,?,?)');
    for(const segment of this.buffer)insert.run(segment.runId,segment.sequence,JSON.stringify(segment));
  }
  private async validate(run:Pick<CaptureRun,'characterId'|'sessionId'|'campaignId'>){
    const character=await this.workspace.get('character',run.characterId),session=await this.workspace.get('session',run.sessionId),campaign=await this.workspace.get('campaign',run.campaignId);
    if(!character||character.deleted||character.data.kind!=='character'||character.data.campaignId!==run.campaignId||!session||session.deleted||session.data.kind!=='session'||session.data.campaignId!==run.campaignId||!campaign||campaign.deleted)throw new Error('Choose an available session in this character’s campaign.');
    return session.data;
  }
  start(characterId:string,sessionId:string){return this.serial(async()=>{
    if(this.closed)throw new Error('Session capture is closing.');
    const active=this.active();
    if(active&&(active.characterId!==characterId||active.sessionId!==sessionId))throw new Error(`Capture belongs to ${active.title}. End that session before starting another.`);
    const existing=active?this.view(active):this.allRuns().find(run=>run.held&&run.characterId===characterId&&run.sessionId===sessionId&&run.state==='interrupted');
    if(existing?.state==='listening')return this.status();
    if(!this.deps.speech.ready())throw new Error('Open Settings → Session capture to download the English speech model first.');
    const character=await this.workspace.get('character',characterId);
    if(!character||character.deleted||character.data.kind!=='character'||!character.data.campaignId)throw new Error('Create or choose a campaign and session in the journal first.');
    const session=await this.validate({characterId,sessionId,campaignId:character.data.campaignId});
    let run:CaptureRun=existing??{id:randomUUID(),characterId,sessionId,campaignId:character.data.campaignId,title:session.name,state:'paused',createdAt:new Date(this.now()).toISOString(),endedAt:null,activeMs:0,nextSummaryMs:CAPTURE_INTERVAL_MS,lastQueuedSequence:0,error:'',held:false};
    await this.transaction(async()=>this.putRun(run));
    this.busy=true;this.deps.changed();
    try{
      const base=run.activeMs;
      await this.deps.speech.start(text=>{this.append(run.id,'speech',text.text,{...text,startMs:base+text.startMs,endMs:base+text.endMs});},message=>{void this.interrupt(message);});
      if(this.closed){await this.deps.speech.stop();throw new Error('Session capture is closing.');}
      run={...this.getRun(run.id),state:'listening',error:'',held:false};await this.transaction(async()=>this.putRun(run));this.fault=null;this.listeningId=run.id;this.lastTick=this.activeSince=this.lastPersist=this.now();
    }catch(error){await this.transaction(async()=>this.putRun({...this.getRun(run.id),state:'interrupted',error:this.message(error)}));throw error;}
    finally{this.busy=false;this.deps.changed();}
    return this.status();
  });}
  private elapsed(){if(this.listeningId){const run=this.getRun(this.listeningId);this.putRun(this.view(run));this.activeSince=this.now();}}
  private async stopListening(id:string,state:'paused'|'interrupted',error=''){
    const run=this.getRun(id);let lostTail='';
    if(run.state==='listening'){
      await this.transaction(async()=>this.elapsed());
      try{await this.deps.speech.stop();}catch(failure){state='interrupted';error=lostTail=this.message(failure);}
      this.listeningId=null;
    }
    await this.transaction(async()=>{if(lostTail)this.append(id,'gap',lostTail);this.flush();this.putRun({...this.getRun(id),state,error});});
  }
  pause(id:string){return this.serial(async()=>{const run=this.getRun(id);if(!['listening','paused','interrupted'].includes(run.state))return this.status();await this.stopListening(id,'paused');this.deps.changed();return this.status();});}
  interrupt(message:string){return this.serial(async()=>{const run=this.active();if(run?.state==='listening'){await this.stopListening(run.id,'interrupted',message);await this.transaction(async()=>{this.append(run.id,'gap',message);this.flush();});this.deps.changed();}});}
  quickNote(id:string,text:string){return this.serial(async()=>{const run=this.getRun(id);if(!['listening','paused','interrupted'].includes(run.state))throw new Error('This session has ended. Add further notes in the journal.');await this.transaction(async()=>{this.append(id,'note',z.string().trim().min(1).max(4000).parse(text));this.flush();});});}
  private enqueue(id:string,final=false){
    this.flush();let run=this.getRun(id);const last=this.sequence(id);
    if(final){if(this.jobs(id).some(j=>j.final))return;const job:CaptureJob={id:randomUUID(),runId:id,noteId:randomUUID(),fromSequence:0,toSequence:last,final:true,state:'pending',attempts:0,retryAt:0,createdAt:new Date(this.now()).toISOString()};this.putJob(job);return;}
    const rows=this.store.connection.prepare('SELECT payload FROM capture_segments WHERE run_id=? AND sequence>? ORDER BY sequence').all(id,run.lastQueuedSequence).map(row=>json<CaptureSegment>(row));
    let from=run.lastQueuedSequence+1,length=0,to=run.lastQueuedSequence;
    const queue=()=>{if(to<from)return;this.putJob({id:randomUUID(),runId:id,noteId:randomUUID(),fromSequence:from,toSequence:to,final:false,state:'pending',attempts:0,retryAt:0,createdAt:new Date(this.now()).toISOString()});run={...run,lastQueuedSequence:to};from=to+1;length=0;};
    for(const segment of rows){if(length+segment.text.length>30000)queue();to=segment.sequence;length+=segment.text.length;}
    queue();this.putRun(run);
  }
  summarise(id:string){return this.serial(async()=>{const run=this.getRun(id);if(!['listening','paused','interrupted'].includes(run.state))return this.status();await this.transaction(async()=>this.enqueue(id));this.deps.changed();this.kick();return this.status();});}
  end(id:string){return this.serial(async()=>{const run=this.getRun(id);if(['ended','finalising'].includes(run.state))return this.status();await this.stopListening(id,'paused');await this.transaction(async()=>{this.enqueue(id);this.enqueue(id,true);this.putRun({...this.getRun(id),state:'finalising',held:false,endedAt:new Date(this.now()).toISOString()});});this.deps.changed();this.kick();return this.status();});}
  retry(id:string){return this.serial(async()=>{const run=this.getRun(id),active=this.active();if(run.held&&active&&active.id!==id)throw new Error('End the current capture before resuming an imported capture.');await this.transaction(async()=>{this.putRun({...run,held:false,error:''});for(const job of this.jobs(id))if(job.state==='pending')this.putJob({...job,retryAt:0});});this.deps.changed();this.kick();return this.status();});}
  async tick(){
    await this.serial(async()=>{
      if(this.closed)return;
      const at=this.now();
      if(this.listeningId&&at-this.lastTick>15000){this.activeSince=at;await this.stopListening(this.listeningId,'interrupted','The computer or recorder was suspended. Resume listening when the table is ready.');await this.transaction(async()=>{const run=this.active();if(run){this.append(run.id,'gap','Recorder suspension: speech during the interruption was not captured.');this.flush();}});this.deps.changed();}
      this.lastTick=at;
      if(this.listeningId&&at-this.lastPersist>=5000)await this.transaction(async()=>{this.elapsed();this.flush();this.lastPersist=at;const run=this.getRun(this.listeningId!);if(run.activeMs>=run.nextSummaryMs){this.enqueue(run.id);this.putRun({...this.getRun(run.id),nextSummaryMs:(Math.floor(run.activeMs/CAPTURE_INTERVAL_MS)+1)*CAPTURE_INTERVAL_MS});}this.deps.changed();});
    });this.kick();
  }
  private kick(){if(this.closed||this.work)return;this.work=this.process().catch(error=>this.report(error)).finally(()=>{this.work=null;});}
  private async process(){
    for(;;){
      if(this.closed)return;
      const jobs=this.jobs();
      const job=jobs.find((job,index)=>job.state==='pending'&&job.retryAt<=this.now()&&!this.getRun(job.runId).held&&!jobs.slice(0,index).some(older=>older.runId===job.runId&&older.state!=='complete'));
      if(!job)return;
      const run=this.getRun(job.runId);this.abort=new AbortController();
      await this.transaction(async()=>this.putJob({...job,state:'running'}));this.deps.changed();
      try{
        await this.validate(run);
        const segments=this.store.connection.prepare('SELECT payload FROM capture_segments WHERE run_id=? AND sequence>=? AND sequence<=? ORDER BY sequence').all(run.id,job.fromSequence,job.toSequence).map(row=>json<CaptureSegment>(row));
        const prior:string[]=[];
        for(const checkpoint of this.jobs(run.id).filter(j=>j.state==='complete'&&!j.final)){const note=await this.workspace.get('note',checkpoint.noteId);if(note&&!note.deleted&&note.data.kind==='note')prior.push(note.data.body);}
        const source=job.final?prior.join('\n\n'):segments.map(s=>`[${captureClock(s.startMs)} ${s.kind}${s.uncertain?' uncertain':''}] ${s.text}`).join('\n');
        // Checkpoints are short. Final context uses bounded successive blocks rather than truncating source text.
        let summary:{group:string;dm:string};
        if(!source.trim())summary={group:'No session events were captured.',dm:'No follow-ups were recorded.'};
        else if(job.final&&source.length>30000){
          let condensed='';for(let offset=0;offset<source.length;offset+=24000){const part=summarySchema.parse(await this.deps.summarise({title:run.title,final:true,source:source.slice(offset,offset+24000),previous:condensed,signal:this.abort.signal}));condensed=recapBody(part.group,part.dm);}
          summary={group:condensed.match(/## Group recap\n\n([\s\S]*?)\n\n## DM follow-ups/)?.[1]??condensed,dm:condensed.split('## DM follow-ups\n\n')[1]??'No follow-ups recorded.'};
        }else summary=summarySchema.parse(await this.deps.summarise({title:run.title,final:job.final,source,previous:job.final?'':prior.at(-1)?.slice(0,8000)??'',signal:this.abort.signal}));
        if(this.closed||this.abort.signal.aborted)throw new Error('Summary interrupted. Your text is saved.');
        const note:Note={...recordBase(`${run.title} · ${job.final?'Final recap':`Session recap ${captureClock(segments[0]?.startMs??0)}–${captureClock(segments.at(-1)?.endMs??0)}`}`.slice(0,200)),id:job.noteId,kind:'note',noteType:'note',campaignId:run.campaignId,characterId:null,sessionId:run.sessionId,body:recapBody(summary.group,summary.dm),tags:['session-recap',...(job.final?['final-recap']:[])],linkedIds:[],status:'open',shareWithGuide:false,carryForward:false};
        await this.transaction(async()=>{await this.validate(run);if(!await this.workspace.get('note',job.noteId))await this.workspace.save(note,0);this.putJob({...job,state:'complete'});this.putRun({...this.getRun(run.id),error:'',...(job.final?{state:'ended' as const}:{})});});this.deps.notesChanged();
      }catch(error){
        await this.transaction(async()=>{this.putJob({...job,state:'pending',attempts:job.attempts+1,retryAt:this.now()+Math.min(600000,15000*2**Math.min(job.attempts,6))});this.putRun({...this.getRun(run.id),error:this.message(error)});});
        this.deps.changed();return;
      }finally{this.abort=null;this.deps.changed();}
    }
  }
  private message(error:unknown){return (error instanceof Error?error.message:'Session capture failed. Your saved text is kept.').slice(0,2000);}
  private report(error:unknown){
    const run=this.active();if(!run||this.fault?.id===run.id)return;
    const message=`Listening interrupted: ${this.message(error)}`.slice(0,2000);this.fault={id:run.id,message};this.listeningId=null;this.deps.changed();
    // A storage failure must stop audio work and bound the retained text, even if SQLite cannot record the error yet.
    void this.serial(async()=>{await this.deps.speech.stop();await this.transaction(async()=>{this.append(run.id,'gap',message);this.flush();this.putRun({...this.getRun(run.id),state:'interrupted',error:message});});}).then(()=>this.deps.changed(),()=>this.deps.changed());
  }
  exportBackup():CaptureBackup{const rows=[...this.store.connection.prepare('SELECT payload FROM capture_segments ORDER BY run_id,sequence').all().map(row=>json<CaptureSegment>(row)),...this.buffer];return {version:1,runs:this.allRuns().map(run=>this.view(run)),segments:[...new Map(rows.map(segment=>[`${segment.runId}/${segment.sequence}`,segment])).values()],jobs:this.jobs()};}
  validateBackup(value:unknown){
    const backup=captureBackupSchema.parse(value),runs=new Map(backup.runs.map(r=>[r.id,r]));
    if(runs.size!==backup.runs.length||new Set(backup.jobs.map(j=>j.id)).size!==backup.jobs.length||new Set(backup.jobs.map(j=>j.noteId)).size!==backup.jobs.length||new Set(backup.segments.map(s=>`${s.runId}/${s.sequence}`)).size!==backup.segments.length)throw new Error('Duplicate session capture records in backup.');
    for(const segment of backup.segments)if(!runs.has(segment.runId))throw new Error('A transcript has no session capture.');
    for(const run of backup.runs){const rows=backup.segments.filter(s=>s.runId===run.id).sort((a,b)=>a.sequence-b.sequence);if(rows.some((s,i)=>s.sequence!==i+1)||run.lastQueuedSequence>rows.length)throw new Error('The capture transcript sequence is incomplete.');const existing=this.store.connection.prepare('SELECT payload FROM capture_runs WHERE id=?').get(run.id);if(existing){const old=json<CaptureRun>(existing);if(old.characterId!==run.characterId||old.sessionId!==run.sessionId||old.campaignId!==run.campaignId)throw new Error('A capture ID belongs to another session.');}}
    for(const run of backup.runs){
      const jobs=backup.jobs.filter(job=>job.runId===run.id),intervals=jobs.filter(job=>!job.final).sort((a,b)=>a.fromSequence-b.fromSequence);let next=1;
      for(const job of intervals){if(job.fromSequence!==next)throw new Error('Summary ranges overlap or omit transcript text.');next=job.toSequence+1;}
      if(next-1!==run.lastQueuedSequence||jobs.filter(job=>job.final).length>1)throw new Error('Invalid capture summary checkpoint.');
    }
    for(const job of backup.jobs){
      if(!runs.has(job.runId)||job.toSequence>backup.segments.filter(s=>s.runId===job.runId).length||(!job.final&&(job.fromSequence<1||job.fromSequence>job.toSequence)))throw new Error('Invalid summary range in backup.');
      const existing=this.store.connection.prepare('SELECT payload FROM capture_jobs WHERE id=?').get(job.id);
      if(existing){const old=json<CaptureJob>(existing);if(old.runId!==job.runId||old.noteId!==job.noteId)throw new Error('A summary job ID belongs to another capture.');}
    }
    return backup;
  }
  async importBackup(value:unknown){const backup=this.validateBackup(value);return this.transaction(async()=>{
    const added=new Set<string>();
    for(const run of backup.runs){if(this.store.connection.prepare('SELECT id FROM capture_runs WHERE id=?').get(run.id))continue;await this.validate(run);this.putRun({...run,held:true,state:run.state==='ended'?'ended':run.state==='finalising'?'finalising':'interrupted',error:run.state==='ended'?'':'Imported capture. Resume listening or retry summaries when ready.'});added.add(run.id);}
    for(const segment of backup.segments)if(added.has(segment.runId))this.store.connection.prepare('INSERT INTO capture_segments VALUES(?,?,?)').run(segment.runId,segment.sequence,JSON.stringify(segment));
    for(const run of backup.runs){
      if(!added.has(run.id))continue;
      for(const job of backup.jobs.filter(job=>job.runId===run.id).sort((a,b)=>Number(a.final)-Number(b.final)||a.fromSequence-b.fromSequence)){
        const note=await this.workspace.get('note',job.noteId);
        if(note&&(note.data.kind!=='note'||note.data.sessionId!==run.sessionId||note.data.campaignId!==run.campaignId))throw new Error('A recap note belongs to another session.');
        if(job.state==='complete'&&!note)throw new Error('A completed recap is missing its journal note.');
        this.putJob({...job,state:job.state==='complete'?'complete':'pending',retryAt:0});
      }
    }
    return added.size;
  });}
  async close(){this.closed=true;if(this.timer)clearInterval(this.timer);this.abort?.abort();await this.serial(async()=>{const run=this.active();if(run?.state==='listening')await this.stopListening(run.id,'interrupted','Listening stopped when Rivet closed.');else this.flush();});await this.work;}
  async settled(){await this.tail;await this.work;}
}
