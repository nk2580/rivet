import {CheckCircle2, Undo2} from 'lucide-react';
import {Button} from '@/components/ui/button';

export function GuideActionReceipt({summary,reminders=[],undone,canUndo,busy,onUndo}:{summary:string;reminders?:string[];undone:boolean;canUndo:boolean;busy:boolean;onUndo:()=>void}){
  return <article className="guide-action-receipt" aria-label={undone?'Character update undone':'Character updated'}>
    <div className="guide-action-heading"><CheckCircle2 size={17} aria-hidden="true"/><strong>{undone?'Change undone':'Sheet updated'}</strong></div>
    <p>{summary}</p>
    {!!reminders.length&&<ul>{reminders.map((reminder,index)=><li key={index}>{reminder}</li>)}</ul>}
    {!undone&&<Button variant="ghost" size="sm" disabled={busy||!canUndo} title={canUndo?'Undo this character update':'A newer sheet edit prevents undoing this change.'} onClick={onUndo}><Undo2 size={15}/>Undo</Button>}
  </article>;
}
