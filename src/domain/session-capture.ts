import {z} from 'zod';

export const CAPTURE_INTERVAL_MS=10*60*1000;
export const captureStateSchema=z.enum(['listening','paused','interrupted','finalising','ended']);
export const captureRunSchema=z.object({
  id:z.string().uuid(),campaignId:z.string().min(1).max(120),sessionId:z.string().min(1).max(120),characterId:z.string().min(1).max(120),
  title:z.string().max(200),state:captureStateSchema,createdAt:z.string().datetime(),endedAt:z.string().datetime().nullable(),
  activeMs:z.number().nonnegative(),nextSummaryMs:z.number().nonnegative(),lastQueuedSequence:z.number().int().nonnegative(),
  error:z.string().max(2000),held:z.boolean(),
});
export type CaptureRun=z.infer<typeof captureRunSchema>;
export const captureSegmentSchema=z.object({
  runId:z.string().uuid(),sequence:z.number().int().positive(),kind:z.enum(['speech','note','gap']),text:z.string().min(1).max(12000),
  at:z.string().datetime(),startMs:z.number().nonnegative(),endMs:z.number().nonnegative(),uncertain:z.boolean(),
});
export type CaptureSegment=z.infer<typeof captureSegmentSchema>;
export const captureJobSchema=z.object({
  id:z.string().uuid(),runId:z.string().uuid(),noteId:z.string().uuid(),fromSequence:z.number().int().nonnegative(),toSequence:z.number().int().nonnegative(),
  final:z.boolean(),state:z.enum(['pending','running','complete']),attempts:z.number().int().nonnegative(),retryAt:z.number().nonnegative(),createdAt:z.string().datetime(),
});
export type CaptureJob=z.infer<typeof captureJobSchema>;
export const captureBackupSchema=z.object({version:z.literal(1),runs:z.array(captureRunSchema).max(10000),segments:z.array(captureSegmentSchema).max(250000),jobs:z.array(captureJobSchema).max(50000)});
export type CaptureBackup=z.infer<typeof captureBackupSchema>;
export type CaptureStatus={run:CaptureRun|null;pendingSegments:number;pendingJobs:number;summarising:boolean;nextSummarySeconds:number;busy:boolean};
export type CaptureSettings={ready:boolean;installing:boolean;downloadedBytes:number;error:string;deviceId:string;helperAvailable:boolean};
export type CaptureDevice={id:string;name:string;isDefault:boolean};
export type CaptureTranscript={segments:CaptureSegment[];hasMore:boolean};
export const captureCommandSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('status')}),z.object({action:z.literal('settings')}),z.object({action:z.literal('devices')}),z.object({action:z.literal('install-model')}),
  z.object({action:z.literal('select-device'),deviceId:z.string().max(200)}),
  z.object({action:z.literal('runs'),sessionId:z.string().max(120)}),
  z.object({action:z.literal('start'),characterId:z.string().min(1).max(120),sessionId:z.string().min(1).max(120)}),
  ...(['pause','end','summarise','retry'] as const).map(action=>z.object({action:z.literal(action),runId:z.string().uuid()})),
  z.object({action:z.literal('quick-note'),runId:z.string().uuid(),text:z.string().trim().min(1).max(4000)}),
  z.object({action:z.literal('transcript'),runId:z.string().uuid(),after:z.number().int().nonnegative().default(0)}),
]);
export type CaptureCommand=z.infer<typeof captureCommandSchema>;
export interface CaptureClient {
  status():Promise<CaptureStatus>;
  settings():Promise<CaptureSettings>;
  devices():Promise<CaptureDevice[]>;
  installModel():Promise<CaptureSettings>;
  selectDevice(deviceId:string):Promise<void>;
  runs(sessionId:string):Promise<CaptureRun[]>;
  start(characterId:string,sessionId:string):Promise<CaptureStatus>;
  pause(runId:string):Promise<CaptureStatus>;
  end(runId:string):Promise<CaptureStatus>;
  summarise(runId:string):Promise<CaptureStatus>;
  retry(runId:string):Promise<CaptureStatus>;
  quickNote(runId:string,text:string):Promise<void>;
  transcript(runId:string,after?:number):Promise<CaptureTranscript>;
}
export function recapBody(group:string,dm:string){return `## Group recap\n\n${group.trim()}\n\n## DM follow-ups\n\n${dm.trim()}`;}
/** Read the saved note, including the user's edits. Missing headings never fall back to the other audience's text. */
export function recapSection(body:string,audience:'group'|'dm'){
  const heading=audience==='group'?'Group recap':'DM follow-ups';
  return body.match(new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`,'m'))?.[1].trim()??'';
}
export function captureClock(ms:number){const seconds=Math.max(0,Math.floor(ms/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
