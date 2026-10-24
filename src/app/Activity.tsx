import type { Workspace } from '@/storage/client';
import { useLiveQuery } from '@/storage/client';
import { History, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DocumentEntry } from '@/storage/database';
import { friendlyError } from '@/lib/errors';

export function Activity({workspace,entry,notify}:{workspace:Workspace;entry:DocumentEntry;notify:(message:string)=>void}) {
  const receipts=useLiveQuery(()=>workspace.db.activity.where('[ownerUid+characterId]').equals([workspace.ownerUid,entry.id]).reverse().sortBy('at'),[workspace,entry.id]);
  return <section className="sheet-section"><div className="section-heading"><h2><History size={20}/>Recent activity</h2></div>
    <p className="muted">Actions on this device. Undo works backwards through recent actions until another edit or cloud update changes the sheet.</p>
    {!receipts?.length&&<p className="muted">Your character’s next action will appear here.</p>}
    {receipts?.slice(0,30).map(receipt=><div className="information-row" key={receipt.key}><div><strong>{receipt.summary}{receipt.undone?' · Undone':''}</strong><small>{new Date(receipt.at).toLocaleString()}</small>{receipt.reminders.map((reminder,index)=><p className="small-print" key={index}>{reminder}</p>)}</div>{!receipt.undone&&entry.undoHead===receipt.key&&<Button variant="outline" size="sm" onClick={()=>{void workspace.undo(receipt.key).then(()=>notify('Action undone.')).catch(error=>notify(friendlyError(error)));}}><Undo2 size={15}/>Undo</Button>}</div>)}
  </section>;
}
