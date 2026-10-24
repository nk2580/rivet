import { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, Timestamp, where, type Firestore } from 'firebase/firestore';
import { recordSchema } from '@/domain/schema';
import type { PendingEntry, RivetDatabase } from './database';
import { SyncEngine, type CloudRecord, type CloudTransport, type CommitResult, type SyncStatus } from './sync-engine';
import { CLIENT_DATA_VERSION,requireReadableVersion } from './version';
export type { SyncStatus } from './sync-engine';

function decodeCloud(raw:Record<string,unknown>,id:string):CloudRecord{
  requireReadableVersion(raw.writerVersion);
  if(raw.schemaVersion!==2||typeof raw.payload!=='string'||typeof raw.revision!=='number'||typeof raw.operationId!=='string'||typeof raw.deleted!=='boolean')throw new Error('An unsupported cloud record was found. Local work was retained.');
  const data=recordSchema.parse(JSON.parse(raw.payload));
  if(raw.kind!==data.kind||id!==`${data.kind}__${data.id}`)throw new Error('Cloud record identity mismatch.');
  return {data,revision:raw.revision,operationId:raw.operationId,deleted:raw.deleted,writerVersion:typeof raw.writerVersion==='number'?raw.writerVersion:2,...(raw.updatedAt instanceof Timestamp?{timestamp:raw.updatedAt.toMillis()}:{})};
}
export class FirestoreTransport implements CloudTransport{
  constructor(private firestore:Firestore,private uid:string){}
  listen(since:number|undefined,receive:(records:CloudRecord[])=>void,fail:(error:unknown)=>void){
    const records=collection(this.firestore,'users',this.uid,'records');
    // Retained tombstones let this durable cursor resume without reading every sheet.
    const source=since===undefined?records:query(records,where('updatedAt','>=',Timestamp.fromMillis(since)),orderBy('updatedAt'));
    return onSnapshot(source,{includeMetadataChanges:true},snapshot=>{
      if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)return;
      try{receive(snapshot.docChanges({includeMetadataChanges:true}).filter(change=>change.type!=='removed').map(change=>decodeCloud(change.doc.data(),change.doc.id)));}catch(error){fail(error);}
    },fail);
  }
  async commit(pending:PendingEntry):Promise<CommitResult>{
    const ref=doc(this.firestore,'users',this.uid,'records',`${pending.data.kind}__${pending.data.id}`);
    return runTransaction(this.firestore,async transaction=>{
      const snapshot=await transaction.get(ref),raw=snapshot.exists()?snapshot.data():null;
      const remote=raw?decodeCloud(raw,ref.id):null;
      if(remote?.operationId===pending.operationId)return {accepted:true,record:remote};
      if((remote?.writerVersion??2)>(pending.writerVersion??2))return {accepted:false,record:remote};
      if((remote?.revision??0)!==pending.baseRevision)return {accepted:false,record:remote};
      const revision=(remote?.revision??0)+1;
      transaction.set(ref,{schemaVersion:2,writerVersion:CLIENT_DATA_VERSION,kind:pending.data.kind,payload:JSON.stringify(pending.data),revision,updatedAt:serverTimestamp(),deleted:pending.deleted,operationId:pending.operationId});
      return {accepted:true,record:{data:pending.data,revision,deleted:pending.deleted,operationId:pending.operationId,writerVersion:CLIENT_DATA_VERSION}};
    });
  }
}
export class FirestoreSynchronizer extends SyncEngine{
  constructor(db:RivetDatabase,firestore:Firestore,uid:string,report:(status:SyncStatus)=>void){super(db,new FirestoreTransport(firestore,uid),uid,report);}
}
