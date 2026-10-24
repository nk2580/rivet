import { useRef,useState } from 'react';
import { ChevronDown,MessageCircle,SquarePen,Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { friendlyError } from '@/lib/errors';
import { DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuLabel,DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuItem,DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

export function GuideConversationPicker({sessions,sessionId,onSelect,onNew,onDelete,busy}:{sessions:{id:string;title:string}[];sessionId:string;onSelect:(id:string)=>void;onNew:()=>void;onDelete:(id:string)=>Promise<void>;busy:boolean}){
  const selected=sessions.find(session=>session.id===sessionId),title=selected?.title??'New chat';
  const trigger=useRef<HTMLButtonElement>(null);
  const [target,setTarget]=useState<{id:string;title:string}|null>(null),[deleting,setDeleting]=useState(false),[error,setError]=useState('');
  const remove=async()=>{
    if(!target||deleting)return;
    setDeleting(true);setError('');
    try{await onDelete(target.id);setTarget(null);}catch(failure){setError(friendlyError(failure));}finally{setDeleting(false);}
  };
  return <><div className="guide-session-bar">
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild><Button ref={trigger} className="guide-session-trigger" variant="ghost" aria-label={'Conversation history: '+title} title={title} disabled={busy||deleting}><span>{title}</span><ChevronDown size={15} aria-hidden="true"/></Button></DropdownMenuTrigger>
      <DropdownMenuContent className="guide-history-menu" align="start" aria-label="Recent chats">
        <DropdownMenuLabel>Recent chats</DropdownMenuLabel>
        {sessions.length?<DropdownMenuRadioGroup value={sessionId} onValueChange={onSelect}>{sessions.map(session=><DropdownMenuRadioItem key={session.id} value={session.id}><MessageCircle size={17} aria-hidden="true"/><span className="dropdown-menu-text">{session.title}</span></DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>:<p className="guide-history-empty">Your conversations will appear here.</p>}
        {selected&&<><DropdownMenuSeparator/><DropdownMenuItem className="dropdown-menu-item-destructive" onSelect={()=>{setError('');setTarget(selected);}}><Trash2 size={17} aria-hidden="true"/>Delete chat…</DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
    <Button className="guide-new-chat" variant="ghost" aria-label="New chat" title="New chat" disabled={busy||deleting} onClick={onNew}><SquarePen size={18} aria-hidden="true"/><span>New chat</span></Button>
  </div>
    <Dialog open={!!target} onOpenChange={open=>{if(!open&&!deleting)setTarget(null);}} onCloseAutoFocus={event=>{event.preventDefault();trigger.current?.focus();}} title="Delete chat?" description="This permanently deletes the chat, its messages and pending proposals. Character sheet changes are kept.">
      <p className="guide-delete-title">{target?.title}</p>
      {error&&<p className="notice error" role="alert">{error}</p>}
      <div className="guide-delete-actions"><Button variant="outline" disabled={deleting} onClick={()=>setTarget(null)}>Cancel</Button><Button variant="destructive" disabled={deleting} onClick={()=>{void remove();}}>{deleting?'Deleting…':'Delete chat'}</Button></div>
    </Dialog>
  </>;
}
