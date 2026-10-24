import type { Workspace } from '@/storage/client';
import { useState } from 'react';
import { useLiveQuery } from '@/storage/client';
import { Archive, ArchiveRestore } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { recordSchema } from '@/domain/schema';
import { friendlyError } from '@/lib/errors';
import type { ConflictEntry, DocumentEntry } from '@/storage/database';

export function RecoveryPanel({workspace,notify,onArchived}:{workspace:Workspace;notify:(text:string)=>void;onArchived:(id:string)=>void}){
  const [archiving,setArchiving]=useState<DocumentEntry|null>(null);
  const [busy,setBusy]=useState(false);
  const documents=useLiveQuery(()=>workspace.db.documents.where('ownerUid').equals(workspace.ownerUid).toArray(),[workspace]);
  const recovery=useLiveQuery(()=>workspace.db.meta.where('key').startsWith(`recovery/${workspace.ownerUid}/`).reverse().toArray(),[workspace]);
  const act=async(action:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);try{await action();}catch(error){notify(friendlyError(error));}finally{setBusy(false);}};
  return <>
    <details className="settings-section"><summary>Characters and archive</summary><p className="small-print">Archived characters remain recoverable. Related notes stay in your notebook.</p>
      {documents?.filter(entry=>entry.kind==='character'&&!entry.deleted).map(entry=><div className="information-row" key={entry.key}><div><strong>{entry.data.name}</strong></div><Button variant="ghost" size="sm" onClick={()=>setArchiving(entry)}><Archive size={15}/>Archive</Button></div>)}
      {documents?.filter(entry=>entry.deleted).map(entry=><div className="information-row" key={entry.key}><div><strong>{entry.data.name}</strong><small>Archived {entry.kind}</small></div><Button variant="outline" size="sm" disabled={busy} onClick={()=>{void act(async()=>{await workspace.setDeleted(entry.kind,entry.id,false,entry.localRevision);notify(`Restored ${entry.data.name}.`);});}}><ArchiveRestore size={15}/>Restore</Button></div>)}
    </details>
    <details className="settings-section"><summary>Conflict recovery copies ({recovery?.length??0})</summary><p className="small-print">Both versions from a resolved conflict are kept on this device and in exported backups. Restore either version as a separate copy.</p>
      {recovery?.map(item=>{const copy=item.value as ConflictEntry;return <div className="recovery-copy" key={item.key}><strong>{copy.local.name}</strong><p className="small-print">{new Date(copy.at).toLocaleString()}</p><div className="button-row">{([['Device version',copy.local],['Cloud version',copy.remote]] as const).filter(([,record])=>!!record).map(([label,record])=><Button key={label} variant="outline" size="sm" disabled={busy} onClick={()=>{void act(async()=>{const data=recordSchema.parse({...record,id:crypto.randomUUID(),name:`${record!.name.slice(0,170)} (recovered)`,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});await workspace.save(data,0);notify(`Saved ${label.toLowerCase()} as a separate copy.`);});}}>{label}</Button>)}</div></div>;})}
    </details>
    <Dialog open={!!archiving} onOpenChange={open=>{if(!open)setArchiving(null);}} title={`Archive ${archiving?.data.name??'character'}?`} description="The character will leave your active list. You can restore it from workspace settings; related campaign notes are retained."><div className="dialog-actions"><Button variant="outline" onClick={()=>setArchiving(null)}>Keep character</Button><Button disabled={busy} onClick={()=>{if(archiving)void act(async()=>{await workspace.setDeleted(archiving.kind,archiving.id,true,archiving.localRevision);setArchiving(null);onArchived(archiving.id);notify('Character archived. Restore it from workspace settings.');});}}>Archive character</Button></div></Dialog>
  </>;
}
