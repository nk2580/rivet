import {useEffect,useState} from 'react';
import type {CaptureClient,CaptureCommand,CaptureStatus} from '@/domain/session-capture';
const invoke=<T>(command:CaptureCommand)=>{
  if(!window.rivet?.sessionCapture)return Promise.reject<T>(new Error('Open the updated Rivet desktop app to use session capture.'));
  return window.rivet.sessionCapture(command) as Promise<T>;
};
export const sessionCapture:CaptureClient={
  status:()=>invoke({action:'status'}),settings:()=>invoke({action:'settings'}),devices:()=>invoke({action:'devices'}),installModel:()=>invoke({action:'install-model'}),selectDevice:deviceId=>invoke({action:'select-device',deviceId}),
  runs:sessionId=>invoke({action:'runs',sessionId}),start:(characterId,sessionId)=>invoke({action:'start',characterId,sessionId}),pause:runId=>invoke({action:'pause',runId}),end:runId=>invoke({action:'end',runId}),summarise:runId=>invoke({action:'summarise',runId}),retry:runId=>invoke({action:'retry',runId}),quickNote:(runId,text)=>invoke({action:'quick-note',runId,text}),transcript:(runId,after=0)=>invoke({action:'transcript',runId,after}),
};
export const emptyCaptureStatus:CaptureStatus={run:null,pendingSegments:0,pendingJobs:0,summarising:false,nextSummarySeconds:600,busy:false};
export function useSessionCapture(){
  const [status,setStatus]=useState<CaptureStatus>(emptyCaptureStatus),[error,setError]=useState('');
  useEffect(()=>{let alive=true,sequence=0;const refresh=()=>{const current=++sequence;void sessionCapture.status().then(value=>{if(alive&&current===sequence){setStatus(value);setError('');}}).catch(error=>{if(alive)setError(error instanceof Error?error.message:'Session capture is unavailable.');});};refresh();const unsubscribe=window.rivet?.onCaptureEvent(refresh);return()=>{alive=false;unsubscribe?.();};},[]);
  return {status,error};
}
