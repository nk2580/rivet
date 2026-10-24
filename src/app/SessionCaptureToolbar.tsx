import {useRef,useState} from 'react';
import {FileText,Hourglass,Mic,MicOff,Square} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tooltip} from '@/components/ui/tooltip';
import {Dialog} from '@/components/ui/dialog';
import type {CaptureStatus} from '@/domain/session-capture';
import {sessionCapture} from '@/hooks/use-session-capture';
import {friendlyError} from '@/lib/errors';

export function SessionCaptureToolbar({status,characterId,sessionId,onSetup,onNeedsSession,notify}:{status:CaptureStatus;characterId:string;sessionId:string|null;onSetup:()=>void;onNeedsSession:()=>void;notify:(text:string)=>void}){
  const [busy,setBusy]=useState(false),[ending,setEnding]=useState(false);
  const microphone=useRef<HTMLButtonElement>(null),secondary=useRef<HTMLButtonElement>(null),cancel=useRef<HTMLButtonElement>(null);
  const confirmedEnd=useRef(false);
  const run=status.run,belongs=!!run&&run.characterId===characterId;
  const listening=belongs&&run.state==='listening',finalising=belongs&&run.state==='finalising';
  const unavailable=!!run&&!belongs&&['listening','paused','interrupted'].includes(run.state);
  const locked=busy||status.busy||finalising||unavailable;
  const microphoneLabel=listening?'Pause listening':belongs?'Resume listening':'Start listening';
  const secondaryLabel=finalising?'Final recap pending':listening?'Summarise now':'End session';
  const disabled=locked||(!listening&&!belongs)||(listening&&(status.pendingSegments===0||status.summarising));
  const action=async(work:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);try{await work();}catch(error){notify(friendlyError(error));}finally{setBusy(false);}};
  const toggle=()=>{void action(async()=>{
    if(listening){await sessionCapture.pause(run.id);return;}
    if(!(await sessionCapture.settings()).ready){onSetup();notify('Download the English speech model in Session capture settings, then start listening.');return;}
    const target=belongs?run.sessionId:sessionId;
    if(!target){onNeedsSession();notify('Create or choose the current session in your journal, then start listening.');return;}
    await sessionCapture.start(characterId,target);
  });};
  return <>
    <Tooltip compact content={unavailable?`Capture belongs to ${run.title}. Open its character to control it.`:microphoneLabel}>
      <span className="icon-tooltip-target" tabIndex={locked?0:undefined}><Button ref={microphone} variant="ghost" size="icon" className={listening?'listening-button is-listening':'listening-button'} aria-label={microphoneLabel} aria-pressed={listening} disabled={locked} onClick={toggle}>{belongs&&!listening?<MicOff size={20} aria-hidden="true"/>:<Mic size={20} aria-hidden="true"/>}</Button></span>
    </Tooltip>
    <Tooltip compact content={listening&&status.summarising?'Summary in progress':listening&&status.pendingSegments===0?'No new material to summarise':secondaryLabel}>
      <span className="icon-tooltip-target" tabIndex={disabled?0:undefined}><Button ref={secondary} variant="ghost" size="icon" aria-label={secondaryLabel} disabled={disabled} onClick={()=>{if(listening)void action(()=>sessionCapture.summarise(run.id));else setEnding(true);}}>{finalising?<Hourglass size={20} aria-hidden="true"/>:listening?<FileText size={20} aria-hidden="true"/>:<Square size={19} aria-hidden="true"/>}</Button></span>
    </Tooltip>
    <Dialog open={ending} onOpenChange={open=>{if(!busy)setEnding(open);}} title="End this session?" description="Finish this session and create the final recap. Your transcript and journal entries will be kept."
      onOpenAutoFocus={event=>{event.preventDefault();cancel.current?.focus();}}
      onCloseAutoFocus={event=>{event.preventDefault();const tools=microphone.current?.closest('.sheet-header-tools');const fallback=tools?.querySelector<HTMLButtonElement>('button:not(:disabled)');const search=tools?.querySelector<HTMLButtonElement>('button[aria-label="Search SRD locally"]');const target=confirmedEnd.current?search??fallback:secondary.current&&!secondary.current.disabled?secondary.current:microphone.current&&!microphone.current.disabled?microphone.current:fallback;confirmedEnd.current=false;target?.focus();}}>
      <div className="dialog-actions"><Button ref={cancel} variant="outline" onClick={()=>setEnding(false)} disabled={busy}>Keep session open</Button><Button disabled={busy} onClick={()=>{if(!run||!belongs)return;void action(async()=>{await sessionCapture.end(run.id);confirmedEnd.current=true;setEnding(false);notify('Session ended. The final recap will appear in your journal when ChatGPT is available.');});}}>End session</Button></div>
    </Dialog>
  </>;
}
