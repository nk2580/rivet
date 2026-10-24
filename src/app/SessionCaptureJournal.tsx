import {useEffect,useState} from 'react';
import {Copy,Download,Mic} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {database} from '@/storage/client';
import {sessionCapture,useSessionCapture} from '@/hooks/use-session-capture';
import {captureClock,recapSection,type CaptureRun,type CaptureSegment} from '@/domain/session-capture';
import type {Note} from '@/domain/schema';
import {friendlyError} from '@/lib/errors';

export function RecapCopyActions({note,notify}:{note:Note;notify:(text:string)=>void}){
  const copy=async(audience:'group'|'dm')=>{try{const text=recapSection(note.body,audience);if(!text)throw new Error('Keep the Group recap and DM follow-ups headings to copy each section separately.');await navigator.clipboard.writeText(text);notify(audience==='group'?'Group recap copied.':'DM follow-ups copied.');}catch(error){notify(friendlyError(error));}};
  return <><Button variant="ghost" size="sm" disabled={!recapSection(note.body,'group')} onClick={()=>{void copy('group');}}><Copy size={14}/>Group</Button><Button variant="ghost" size="sm" disabled={!recapSection(note.body,'dm')} onClick={()=>{void copy('dm');}}><Copy size={14}/>DM</Button></>;
}
export function SessionCaptureJournal({sessionId,notes,notify}:{sessionId:string;notes:Note[];notify:(text:string)=>void}){
  const {status}=useSessionCapture();
  const [runs,setRuns]=useState<CaptureRun[]>([]),[selected,setSelected]=useState(''),[open,setOpen]=useState(false),[segments,setSegments]=useState<CaptureSegment[]>([]),[after,setAfter]=useState(0),[more,setMore]=useState(false),[follow,setFollow]=useState(true),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false);
  const run=runs.find(run=>run.id===selected)??runs[0];
  const active=!!run&&['listening','paused','interrupted'].includes(run.state);
  useEffect(()=>{let alive=true;const refresh=()=>{void sessionCapture.runs(sessionId).then(value=>{if(alive)setRuns(value);}).catch(error=>{if(alive)notify(friendlyError(error));});};setSelected('');setOpen(false);setSegments([]);setAfter(0);setFollow(true);refresh();const unsubscribe=window.rivet?.onCaptureEvent(refresh);return()=>{alive=false;unsubscribe?.();};},[sessionId]);
  useEffect(()=>{let alive=true;setDraft('');if(run)void database.meta.get(`draft/capture/${run.id}`).then(row=>{if(alive)setDraft(typeof row?.value==='string'?row.value:'');});return()=>{alive=false;};},[run?.id]);
  useEffect(()=>{
    if(!open||!run)return;let alive=true;
    const last=status.run?.id===run.id?status.run.lastQueuedSequence+status.pendingSegments:run.lastQueuedSequence;
    const cursor=follow?Math.max(0,last-100):after;
    void sessionCapture.transcript(run.id,cursor).then(value=>{if(alive){setSegments(value.segments);setMore(value.hasMore);if(follow)setAfter(cursor);}}).catch(error=>{if(alive)notify(friendlyError(error));});return()=>{alive=false;};
  },[open,run?.id,run?.lastQueuedSequence,status,follow,follow?0:after]);
  if(!run)return null;
  const act=async(work:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);try{await work();}catch(error){notify(friendlyError(error));}finally{setBusy(false);}};
  const recaps=notes.filter(note=>note.sessionId===sessionId&&note.tags.includes('session-recap')).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const exportSession=()=>{const text=`# ${run.title}\n\n${recaps.map(note=>`# ${note.name}\n\n${note.body}`).join('\n\n---\n\n')}`;const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`${run.title.replace(/[^a-z0-9_-]+/gi,'-').slice(0,80)||'session'}-recap.md`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <section className="session-capture-journal" aria-label="Session capture"><div className="section-heading"><h3><Mic size={18}/>Session capture</h3><span className="tag">{run.state==='listening'?'Listening':run.state==='finalising'?'Final recap pending':run.state==='interrupted'?'Interrupted':run.state==='ended'?'Ended':'Paused'}</span></div>
    <p className="small-print">{captureClock(run.activeMs)} captured. Audio is discarded; transcript text and quick notes are used for journal recaps.</p>
    {runs.length>1&&<label className="field">Capture<select value={run.id} onChange={event=>{setSelected(event.target.value);setFollow(true);setAfter(0);}}>{runs.map(run=><option key={run.id} value={run.id}>{new Date(run.createdAt).toLocaleString()} · {run.state}</option>)}</select></label>}
    {run.error&&<div className="notice warning"><p>{run.error}</p><Button variant="outline" size="sm" disabled={busy||status.summarising} onClick={()=>{void act(()=>sessionCapture.retry(run.id));}}>Retry queued recaps</Button></div>}
    {active&&<form onSubmit={event=>{event.preventDefault();const text=draft;void act(async()=>{await sessionCapture.quickNote(run.id,text);setDraft('');await database.meta.delete(`draft/capture/${run.id}`);notify('Quick note saved for the next recap.');});}}><label className="field">Quick note or correction<textarea maxLength={4000} rows={2} value={draft} placeholder="A name, a decision, or a correction to something the microphone missed…" onChange={event=>{const text=event.target.value;setDraft(text);void database.meta.put({key:`draft/capture/${run.id}`,value:text}).catch(error=>notify(friendlyError(error)));}}/></label><Button variant="outline" size="sm" type="submit" disabled={busy||!draft.trim()}>Add quick note</Button></form>}
    <details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>Transcript and quick notes</summary>{open&&<><ol className="capture-transcript">{segments.map(segment=><li key={segment.sequence}><time>{captureClock(segment.startMs)}</time><span>{segment.kind==='note'&&<strong>Quick note · </strong>}{segment.kind==='gap'&&<strong>Capture gap · </strong>}{segment.text}{segment.uncertain&&<small>Recognition uncertain</small>}</span></li>)}</ol>{!segments.length&&<p className="small-print">Speech and saved quick notes will appear here.</p>}<div className="button-row"><Button variant="ghost" size="sm" disabled={after===0} onClick={()=>{setFollow(false);setAfter(Math.max(0,after-100));}}>Earlier text</Button><Button variant="ghost" size="sm" disabled={!more} onClick={()=>{setFollow(false);setAfter(segments.at(-1)?.sequence??after);}}>Later text</Button><Button variant="ghost" size="sm" disabled={follow} onClick={()=>setFollow(true)}>Latest text</Button></div></>}</details>
    {recaps.length>0&&<Button variant="ghost" size="sm" onClick={exportSession}><Download size={16}/>Export session recap</Button>}
  </section>;
}
