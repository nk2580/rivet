import { useEffect,useRef,useState,type FormEvent } from 'react';
import { Maximize2,Minimize2,BookOpen,Compass,MessageCircle,ArrowUp,Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { rulesetNames,type Character } from '@/domain/schema';
import { friendlyError } from '@/lib/errors';
import { ChatMarkdown } from '@/components/ChatMarkdown';
import { GuideConversationPicker } from './GuideConversationPicker';
import { GuideActionReceipt } from './GuideActionReceipt';
import type {AssistantSettingsController} from '@/hooks/use-assistant-settings';
import './guide.css';
import {ConnectionUnlockButton} from './ConnectionUnlock';

type Session={id:string;title:string;model:string};
type Message={id:string;role:string;text:string;status:string;details:any};
export function Guide({character,connection,compact=false,onExpand,onCollapse}:{character:Character;connection:AssistantSettingsController;compact?:boolean;onExpand?:()=>void;onCollapse?:()=>void}){
  const [sessions,setSessions]=useState<Session[]>([]),[sessionId,setSessionId]=useState(''),[messages,setMessages]=useState<Message[]>([]),[running,setRunning]=useState(false),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const messagesPane=useRef<HTMLDivElement>(null),keepAtBottom=useRef(true),currentSession=useRef(''),currentCharacter=useRef(character.id),deletedSessions=useRef(new Set<string>()),listVersion=useRef(0),messageVersion=useRef(0);currentCharacter.current=character.id;
  const api=async(action:string,args?:unknown)=>{if(!window.rivet)throw new Error('Open Rivet Desktop to use the guide.');return window.rivet.assistant(action,args);};
  const selectSession=(id:string)=>{
    currentSession.current=id;messageVersion.current++;setSessionId(id);setMessages([]);setRunning(false);setError('');
    if(id)localStorage.setItem(`rivet:guide:${character.id}`,id);else localStorage.removeItem(`rivet:guide:${character.id}`);
  };
  const refreshSessions=async()=>{const version=++listVersion.current;const rows=(await api('sessions',{characterId:character.id}) as Session[]).filter(row=>!deletedSessions.current.has(row.id));if(currentCharacter.current===character.id&&listVersion.current===version)setSessions(rows);return rows;};
  const refreshMessages=async(id:string)=>{
    const version=++messageVersion.current;
    const active=()=>currentCharacter.current===character.id&&currentSession.current===id&&!deletedSessions.current.has(id)&&messageVersion.current===version;
    try{const value=await api('messages',{sessionId:id});if(active()){setMessages(value.messages);setRunning(value.running);}}catch(failure){if(active())throw failure;}
  };
  const forgetSession=async(id:string)=>{
    if(currentCharacter.current!==character.id)return;
    deletedSessions.current.add(id);setSessions(previous=>previous.filter(session=>session.id!==id));
    if(currentSession.current===id)selectSession('');
    try{const rows=await refreshSessions();if(currentCharacter.current===character.id&&!currentSession.current)selectSession(rows[0]?.id??'');}catch(failure){if(currentCharacter.current===character.id)setError(friendlyError(failure));}
  };
  const attempt=async(action:()=>Promise<unknown>)=>{setError('');setBusy(true);try{await action();}catch(failure){setError(friendlyError(failure));}finally{setBusy(false);}};
  useEffect(()=>{let alive=true;const saved=localStorage.getItem(`rivet:guide:${character.id}`);setSessions([]);selectSession('');void(async()=>{try{const rows=await refreshSessions();if(alive)selectSession(rows.find(row=>row.id===saved)?.id??rows[0]?.id??'');}catch(failure){if(alive)setError(friendlyError(failure));}})();return()=>{alive=false;};},[character.id]);
  useEffect(()=>{if(sessionId)void refreshMessages(sessionId).catch(failure=>setError(friendlyError(failure)));},[sessionId,character.id]);
  useEffect(()=>window.rivet?.onAssistantEvent(event=>{if(event.type==='account'||event.characterId!==character.id)return;if(event.type==='session-deleted'){void forgetSession(event.sessionId);return;}if(deletedSessions.current.has(event.sessionId))return;if(event.sessionId===currentSession.current){if(event.type==='delta')setMessages(previous=>previous.map(message=>message.role==='assistant'&&message.status==='streaming'?{...message,text:event.text}:message));else void refreshMessages(event.sessionId).catch(failure=>setError(friendlyError(failure)));}void refreshSessions().catch(()=>{});}),[character.id]);
  useEffect(()=>window.rivet?.onStorageChanged(()=>{if(currentSession.current)void refreshMessages(currentSession.current).catch(failure=>setError(friendlyError(failure)));}),[character.id]);
  useEffect(()=>{const pane=messagesPane.current;if(pane&&keepAtBottom.current)pane.scrollTop=pane.scrollHeight;},[messages,running]);
  useEffect(()=>{keepAtBottom.current=true;},[sessionId]);
  const create=async()=>{const session=await api('new-session',{characterId:character.id,title:'Questions for '+character.name});await refreshSessions();if(currentCharacter.current===character.id)selectSession(session.id);return session.id as string;};
  const send=(event:FormEvent)=>{event.preventDefault();if(!text.trim()||running||busy||connection.busy||connection.loading||!connection.connected||!connection.model)return;void attempt(async()=>{const id=sessionId||await create();await api('send',{sessionId:id,text,model:connection.model});if(currentSession.current===id&&!deletedSessions.current.has(id)){setText('');setRunning(true);await refreshMessages(id);}});};
  return <section id="character-guide" className={`guide-content desktop-guide ${compact?'compact-guide':'expanded-guide'}`} aria-label="Oracle Chats">
    <div className="guide-title"><Compass size={24}/><div>{compact?<h2>Oracle Chats</h2>:<h1>Oracle Chats</h1>}<small>{character.name} · {rulesetNames[character.ruleset]}</small></div><Button variant="ghost" size="icon" aria-label={compact?'Expand chat':'Collapse chat'} title={compact?'Expand chat':'Return to character sheet'} onClick={compact?onExpand:onCollapse}>{compact?<Maximize2 size={20}/>:<Minimize2 size={20}/>}</Button></div>
    <GuideConversationPicker key={character.id} sessions={sessions} sessionId={sessionId} onSelect={selectSession} busy={busy} onNew={()=>{void attempt(create);}} onDelete={async id=>{await api('delete-session',{sessionId:id,characterId:character.id});await forgetSession(id);}}/>
    {error&&<div className="notice error" role="alert">{error}</div>}
    <div ref={messagesPane} onScroll={event=>{const pane=event.currentTarget;keepAtBottom.current=pane.scrollHeight-pane.scrollTop-pane.clientHeight<100;}} className="guide-messages" role="log" aria-label="Guide conversation" aria-live="polite" aria-relevant="additions">
      {!messages.length&&<div className="guide-welcome"><MessageCircle size={26}/><h3>A clearer next move.</h3><p>Ask how a spell works, compare your options or look up a rule. The guide searches your edition’s local SRD and shows its sources.</p><Button size="sm" variant="outline" onClick={()=>setText('Explain what I can do on my turn, in simple steps. Look up the rules for my edition.')}>What can I do on my turn?</Button></div>}
      {messages.map(message=>message.role==='tool'?<details className="guide-tool" key={message.id}><summary><BookOpen size={14}/>{message.text.replaceAll('_',' ')}<span>{message.status==='running'?'Looking up…':message.status==='error'?'Needs attention':'Complete'}</span></summary><pre>{JSON.stringify(message.details,null,2)}</pre></details>:message.role==='action'?<GuideActionReceipt key={message.id} summary={message.text} reminders={message.details?.reminders??[]} undone={message.status==='undone'} canUndo={!!message.details?.canUndo} busy={busy||running} onUndo={()=>{void attempt(async()=>{await api('undo-action',{id:message.id});await refreshMessages(sessionId);});}}/>:message.role==='proposal'?<article className="guide-proposal" key={message.id}><strong>Review character change</strong><p>{message.text}</p><p className="small-print">{message.details?.reason}</p><details><summary>Proposed values</summary><pre>{JSON.stringify(message.details?.command,null,2)}</pre></details><Button size="sm" variant="outline" disabled={busy||message.status==='applied'||message.status==='interrupted'||message.status==='stale'} onClick={()=>{void attempt(async()=>{await api('apply-proposal',{id:message.details.id});await refreshMessages(sessionId);});}}>{message.status==='applied'?'Applied':message.status==='stale'?'Sheet changed; ask Oracle to refresh':message.status==='interrupted'?'Ask again to propose this change':'Apply to '+character.name}</Button></article>:<article className={`guide-message guide-message-${message.role}`} key={message.id}><small className={message.role==='user'?'sr-only':undefined}>{message.role==='user'?'You':message.role==='assistant'?'Rivet Guide':'Session status'}{message.status==='streaming'?' · Thinking…':''}</small><MessageText text={message.text||(message.status==='complete'?'No answer was returned for this request.':'')}/>{message.status==='error'||message.status==='interrupted'?<small className="muted">Response incomplete. You can ask a follow-up.</small>:null}</article>)}
    </div>
    <ConnectionUnlockButton connection={connection}/>
    <form className="guide-composer" onSubmit={send}>
      <label className="guide-message-field"><span className="sr-only">Message Rivet Guide</span><textarea value={text} maxLength={20000} onChange={event=>setText(event.target.value)} placeholder="Ask about your character or a rule…" rows={1} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.altKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}}}/></label>
      <div className="guide-compose-actions">{running?<Button className="guide-submit" type="button" size="icon" aria-label="Stop response" title="Stop response" onClick={()=>{void attempt(()=>api('stop',{sessionId}));}}><Square size={16} fill="currentColor" aria-hidden="true"/></Button>:<Button className="guide-submit" type="submit" size="icon" aria-label="Send message" title="Send message (Enter). Shift+Enter for a new line." disabled={!connection.connected||!connection.model||connection.loading||connection.busy||!text.trim()||busy}><ArrowUp size={22} strokeWidth={2.5} aria-hidden="true"/></Button>}</div>
    </form>

  </section>;
}
function MessageText({text}:{text:string}){
  return <ChatMarkdown text={text}/>;
}
