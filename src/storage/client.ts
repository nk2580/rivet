import { useEffect,useState,type DependencyList } from 'react';
import type { AppRecord,RecordKind } from '@/domain/schema';
import type { CharacterCommand } from '@/domain/commands';
import type { DocumentEntry,ActivityEntry,ConflictEntry,MetaEntry } from './database';

let listeners=new Set<()=>void>();
export const storageChanged=()=>listeners.forEach(listener=>listener());
if(typeof window!=='undefined')window.rivet?.onStorageChanged(storageChanged);
export function useLiveQuery<T>(query:()=>Promise<T>,dependencies:DependencyList=[]){
  const [value,setValue]=useState<T>();
  useEffect(()=>{let alive=true,sequence=0;const run=()=>{const current=++sequence;void query().then(next=>{if(alive&&current===sequence)setValue(next);}).catch(error=>{console.error('Workspace read failed',error);});};listeners.add(run);run();return()=>{alive=false;listeners.delete(run);};},dependencies);
  return value;
}
async function invoke<T>(action:string,args:unknown[]=[]):Promise<T>{
  if(!window.rivet)throw new Error('Open Rivet Desktop to use the local SQLite workspace.');
  return window.rivet.workspace(action,args) as Promise<T>;
}
class Table<T extends {key:string}> {
  constructor(private name:string){}
  get(key:string){return invoke<T|undefined>('tableGet',[this.name,key]);}
  async put(row:T){const result=await invoke<string>('metaPut',[this.name,row]);storageChanged();return result;}
  async delete(key:string){await invoke('metaDelete',[this.name,key]);storageChanged();}
  toArray(){return invoke<T[]>('tableList',[this.name]);}
  where(field:string){let filter:(row:T)=>boolean=()=>true,reversed=false;const api={equals(value:unknown){filter=row=>field.startsWith('[')?JSON.stringify(field.slice(1,-1).split('+').map(key=>(row as Record<string,unknown>)[key]))===JSON.stringify(value):(row as Record<string,unknown>)[field]===value;return api;},startsWith(prefix:string){filter=row=>String((row as Record<string,unknown>)[field]??'').startsWith(prefix);return api;},reverse(){reversed=!reversed;return api;},toArray:async()=>{const rows=(await this.toArray()).filter(filter);return reversed?rows.reverse():rows;},sortBy:async(key:string)=>{const rows=(await this.toArray()).filter(filter).sort((a,b)=>String((a as Record<string,unknown>)[key]).localeCompare(String((b as Record<string,unknown>)[key])));return reversed?rows.reverse():rows;}};return api;}
}
export const database={documents:new Table<DocumentEntry>('documents'),activity:new Table<ActivityEntry>('activity'),meta:new Table<MetaEntry>('meta'),conflicts:new Table<ConflictEntry>('conflicts')};
export class Workspace {
  readonly ownerUid='local';
  constructor(readonly db=database){}
  list<T extends AppRecord=AppRecord>(kind:T['kind']){return invoke<DocumentEntry[]>('list',[kind]);}
  get(kind:RecordKind,id:string){return invoke<DocumentEntry|undefined>('get',[kind,id]);}
  private async change<T>(action:string,args:unknown[]){const result=await invoke<T>(action,args);storageChanged();return result;}
  save(data:AppRecord,revision?:number){return this.change<DocumentEntry>('save',[data,revision]);}
  saveMany(changes:{data:AppRecord;expectedRevision:number}[]){return this.change<DocumentEntry[]>('saveMany',[changes]);}
  execute(id:string,command:CharacterCommand,revision:number,commandId?:string){return this.change<ActivityEntry>('execute',[id,command,revision,commandId]);}
  undo(key:string){return this.change<void>('undo',[key]);}
  setDeleted(kind:RecordKind,id:string,deleted:boolean,revision:number){return this.change<DocumentEntry>('setDeleted',[kind,id,deleted,revision]);}
  exportBackup(){return invoke<{format:string;schemaVersion:number;records:AppRecord[]}>('exportBackup');}
  importRecords(records:unknown[],sources:unknown[]=[],recovery:unknown[]=[],archived:unknown[]=[],desktopGuide?:unknown,desktopCapture?:unknown){return this.change<number>('importRecords',[records,sources,recovery,archived,desktopGuide,desktopCapture]);}
}
