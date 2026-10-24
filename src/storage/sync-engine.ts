import { liveQuery } from 'dexie';
import { recordSchema, type AppRecord } from '@/domain/schema';
import { documentKey, type PendingEntry, type RivetDatabase } from './database';
import { CLIENT_DATA_VERSION,requireReadableVersion } from './version';

export type SyncStatus = {state:'offline'|'syncing'|'synced'|'pending'|'conflict'|'error';message:string};
export type CloudRecord = {data:AppRecord;revision:number;operationId:string;deleted:boolean;timestamp?:number;writerVersion?:number};
export type CommitResult = {accepted:true;record:CloudRecord}|{accepted:false;record:CloudRecord|null};
/** Cloud writes compare revisions. Browser data is always committed locally first. */
export interface CloudTransport {
  listen(since:number|undefined,receive:(records:CloudRecord[])=>void,fail:(error:unknown)=>void):()=>void;
  commit(pending:PendingEntry):Promise<CommitResult>;
}
export type SyncEnvironment = {online:()=>boolean;onReconnect:(callback:()=>void)=>()=>void;delay:number};
const browserEnvironment:SyncEnvironment={online:()=>navigator.onLine,onReconnect:callback=>{window.addEventListener('online',callback);return()=>window.removeEventListener('online',callback);},delay:900};

export class SyncEngine {
  private stopped=true;
  private running=false;
  private cloudReady=false;
  private listenerFailed=false;
  private retries=0;
  private lastError='';
  private timer:ReturnType<typeof setTimeout>|undefined;
  private stopCloud=()=>{};
  private stopPending=()=>{};
  private stopConnectivity=()=>{};
  private inbound:Promise<void>=Promise.resolve();
  private readonly checkpointKey:string;
  constructor(private db:RivetDatabase,private cloud:CloudTransport,private uid:string,private report:(status:SyncStatus)=>void,private environment:SyncEnvironment=browserEnvironment){this.checkpointKey=`sync-cursor/${uid}`;}
  start(){
    if(!this.stopped)return;
    this.stopped=false;
    void this.openListener();
    const subscription=liveQuery(async()=>({pending:await this.db.outbox.where('ownerUid').equals(this.uid).count(),conflicts:await this.db.conflicts.where('ownerUid').equals(this.uid).count()})).subscribe({next:counts=>{
      if(this.stopped)return;
      void this.refreshStatus();
      if(counts.pending>counts.conflicts&&!this.running&&!this.lastError)this.schedule(this.environment.delay);
    },error:error=>this.failed(error)});
    this.stopPending=()=>subscription.unsubscribe();
    this.stopConnectivity=this.environment.onReconnect(()=>{this.lastError='';this.retries=0;void this.flush();});
  }
  private async openListener(){
    try{
      const checkpoint=await this.db.meta.get(this.checkpointKey);
      if(this.stopped)return;
      this.stopCloud();this.listenerFailed=false;
      this.stopCloud=this.cloud.listen(typeof checkpoint?.value==='number'?checkpoint.value:undefined,records=>{
        this.inbound=this.inbound.then(async()=>{
          if(this.stopped)return;
          for(const record of records)await this.applyRemote(record);
          const timestamps=records.flatMap(record=>record.timestamp===undefined?[]:[record.timestamp]);
          if(timestamps.length)await this.db.transaction('rw',this.db.meta,async()=>{
            const previous=await this.db.meta.get(this.checkpointKey);
            await this.db.meta.put({key:this.checkpointKey,value:Math.max(typeof previous?.value==='number'?previous.value:0,...timestamps)});
          });
          this.cloudReady=true;this.lastError='';this.retries=0;await this.refreshStatus();
        }).catch(error=>{this.listenerFailed=true;this.failed(error);});
      },error=>{this.listenerFailed=true;this.failed(error);});
    }catch(error){this.listenerFailed=true;this.failed(error);}
  }
  private schedule(delay:number){
    if(this.stopped)return;
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.timer=undefined;void this.flush();},delay);
  }
  private failed(error:unknown){
    if(this.stopped)return;
    const code=(error as {code?:string})?.code;
    this.lastError=code==='resource-exhausted'?'Cloud quota reached. Work is saved here; synchronization will retry.':code==='permission-denied'?'Cloud access was denied. Work is saved here; check your account and database rules.':error instanceof Error?error.message:'Synchronization was interrupted. Local work is retained.';
    this.retries++;
    void this.refreshStatus();
    this.schedule(code==='resource-exhausted'||code==='permission-denied'?300000:Math.min(60000,2000*2**Math.min(this.retries-1,5)));
  }
  private async refreshStatus(){
    if(this.stopped)return;
    const [pending,conflicts]=await Promise.all([this.db.outbox.where('ownerUid').equals(this.uid).count(),this.db.conflicts.where('ownerUid').equals(this.uid).count()]);
    if(this.stopped)return;
    if(!this.environment.online())this.report({state:'offline',message:'Offline · saved on this device'});
    else if(conflicts)this.report({state:'conflict',message:'Review changes from another device'});
    else if(this.lastError)this.report({state:'error',message:this.lastError});
    else if(this.running)this.report({state:'syncing',message:'Syncing changes…'});
    else if(pending)this.report({state:'pending',message:'Saved here · waiting to sync'});
    else this.report(this.cloudReady?{state:'synced',message:'Synced with cloud'}:{state:'pending',message:'Saved here · connecting to cloud'});
  }
  async flush(){
    if(this.running||this.stopped)return;
    if(!this.environment.online()){await this.refreshStatus();return;}
    this.running=true;
    clearTimeout(this.timer);
    try{
      if(this.listenerFailed)await this.openListener();
      await this.inbound;
      for(const pending of await this.db.outbox.where('ownerUid').equals(this.uid).toArray()){
        if(this.stopped)break;
        if(await this.db.conflicts.get(pending.key))continue;
        this.report({state:'syncing',message:'Syncing changes…'});
        await this.push(pending);
      }
      if(!this.listenerFailed){this.lastError='';this.retries=0;}
    }catch(error){this.failed(error);}
    finally{
      this.running=false;await this.refreshStatus();
      if(!this.stopped&&!this.lastError){
        const pending=await this.db.outbox.where('ownerUid').equals(this.uid).toArray();
        for(const entry of pending)if(!await this.db.conflicts.get(entry.key)){this.schedule(this.environment.delay);break;}
      }
    }
  }
  private async push(pending:PendingEntry){
    if(new TextEncoder().encode(JSON.stringify(pending.data)).byteLength>200000)throw new Error(`${pending.data.name} is too large for cloud storage. Export a backup and split longer content.`);
    const send=await this.db.transaction('rw',this.db.documents,this.db.outbox,this.db.conflicts,async()=>{
      const queued=await this.db.outbox.get(pending.key),entry=await this.db.documents.get(pending.key);
      if(!entry||queued?.operationId!==pending.operationId||await this.db.conflicts.get(pending.key))return false;
      const submitted=entry.submittedOperations??[];
      if(!submitted.some(operation=>operation.operationId===pending.operationId))submitted.push({operationId:pending.operationId,baseRevision:pending.baseRevision});
      await this.db.documents.put({...entry,submittedOperations:submitted});return true;
    });
    if(!send)return;
    const result=await this.cloud.commit(pending);
    if(result.accepted)await this.applyRemote(result.record);
    else await this.db.transaction('rw',this.db.documents,this.db.conflicts,async()=>{
      const current=await this.db.documents.get(pending.key);
      const existing=await this.db.conflicts.get(pending.key),remote=result.record;
      if(current?.dirty&&(!existing||(remote?.revision??0)>=existing.remoteRevision))await this.db.conflicts.put({key:pending.key,ownerUid:this.uid,local:current.data,remote:remote&&!remote.deleted?remote.data:null,remoteRevision:remote?.revision??0,at:new Date().toISOString()});
    });
  }
  private async applyRemote(record:CloudRecord){
    requireReadableVersion(record.writerVersion);
    const data=recordSchema.parse(record.data);
    if(!Number.isSafeInteger(record.revision)||record.revision<1||typeof record.deleted!=='boolean'||!record.operationId)throw new Error('Unsupported cloud record. Local work was retained.');
    const key=documentKey(this.uid,data.kind,data.id);
    await this.db.transaction('rw',this.db.documents,this.db.outbox,this.db.conflicts,async()=>{
      const local=await this.db.documents.get(key),pending=await this.db.outbox.get(key);
      if(local&&record.revision<=local.cloudRevision)return;
      if(local?.dirty){
        const sent=local.submittedOperations?.find(operation=>operation.operationId===record.operationId&&operation.baseRevision===record.revision-1);
        if(pending?.operationId===record.operationId||sent){
          const unchanged=pending?.operationId===record.operationId;
          await this.db.documents.put({...local,cloudRevision:record.revision,dirty:!!pending&&!unchanged,submittedOperations:[]});
          if(unchanged)await this.db.outbox.delete(key);
          else if(pending)await this.db.outbox.put({...pending,baseRevision:record.revision});
          return;
        }
        const conflict=await this.db.conflicts.get(key);
        if(!conflict||record.revision>=conflict.remoteRevision)await this.db.conflicts.put({key,ownerUid:this.uid,local:local.data,remote:record.deleted?null:data,remoteRevision:record.revision,at:new Date().toISOString()});
        return;
      }
      await this.db.documents.put({key,ownerUid:this.uid,kind:data.kind,id:data.id,data,writerVersion:record.writerVersion??2,localRevision:(local?.localRevision??0)+1,cloudRevision:record.revision,dirty:false,deleted:record.deleted});
    });
  }
  async resolve(key:string,choice:'local'|'cloud'){
    await this.db.transaction('rw',this.db.documents,this.db.outbox,this.db.conflicts,this.db.meta,async()=>{
      const conflict=await this.db.conflicts.get(key),entry=await this.db.documents.get(key);
      if(!conflict||conflict.ownerUid!==this.uid||entry?.ownerUid!==this.uid)throw new Error('This conflict is no longer available.');
      await this.db.meta.put({key:`recovery/${this.uid}/${crypto.randomUUID()}`,value:{...conflict,local:entry.data}});
      const {undoHead:_undoHead,submittedOperations:_submitted,...base}=entry;
      if(choice==='cloud'){
        await this.db.documents.put({...base,data:conflict.remote??entry.data,deleted:!conflict.remote,cloudRevision:conflict.remoteRevision,localRevision:entry.localRevision+1,dirty:false});
        await this.db.outbox.delete(key);
      }else{
        await this.db.documents.put({...base,cloudRevision:conflict.remoteRevision,localRevision:entry.localRevision+1,dirty:true});
        await this.db.outbox.put({key,ownerUid:this.uid,operationId:crypto.randomUUID(),baseRevision:conflict.remoteRevision,localRevision:entry.localRevision+1,data:entry.data,deleted:entry.deleted,writerVersion:CLIENT_DATA_VERSION});
      }
      await this.db.conflicts.delete(key);
    });
    await this.flush();
  }
  stop(){this.stopped=true;clearTimeout(this.timer);this.stopCloud();this.stopPending();this.stopConnectivity();}
}
