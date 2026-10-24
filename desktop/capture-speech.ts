import {spawn,execFile,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {unzipSync} from 'fflate';
import {z} from 'zod';
import type {SQLiteStore} from './sqlite';
import type {SpeechSource,SpeechText} from './capture';
import type {CaptureSettings,CaptureDevice} from '../src/domain/session-capture';

export const ENGLISH_MODEL={name:'vosk-model-small-en-us-0.15',url:'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip',sha256:'30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498'};
const devicesSchema=z.array(z.object({id:z.string().max(200),name:z.string().max(200),isDefault:z.boolean()})).max(100);
export class NativeSpeech implements SpeechSource {
  private child:ChildProcessWithoutNullStreams|null=null;
  private stopped:Promise<void>|null=null;
  private installing:Promise<CaptureSettings>|null=null;
  private downloadedBytes=0;
  private error='';
  private stopping=false;
  private model:string;
  private helper:string;
  private library:string;
  constructor(private store:SQLiteStore,private data:string,runtime:string,private changed:()=>void){
    this.model=join(data,'speech-models',ENGLISH_MODEL.name);this.helper=join(runtime,process.platform==='win32'?'rivet-capture.exe':'rivet-capture');this.library=join(runtime,process.platform==='darwin'?'libvosk.dylib':process.platform==='win32'?'libvosk.dll':'libvosk.so');
  }
  ready(){return existsSync(this.helper)&&existsSync(this.library)&&existsSync(join(this.model,'.complete'))&&existsSync(join(this.model,'am','final.mdl'));}
  async settings():Promise<CaptureSettings>{return {ready:this.ready(),installing:!!this.installing,downloadedBytes:this.downloadedBytes,error:this.error,deviceId:String((await this.store.meta.get('capture/device'))?.value??''),helperAvailable:existsSync(this.helper)&&existsSync(this.library)};}
  async selectDevice(deviceId:string){if(this.child)throw new Error('Pause listening before changing the microphone.');if(deviceId&&!(await this.devices()).some(device=>device.id===deviceId))throw new Error('Choose an available microphone.');await this.store.transaction(async()=>{await this.store.meta.put({key:'capture/device',value:deviceId});});this.changed();}
  async devices():Promise<CaptureDevice[]>{if(!existsSync(this.helper))throw new Error('The speech helper is missing. Rebuild or reinstall Rivet.');const {stdout}=await promisify(execFile)(this.helper,['--devices'],{timeout:15000,maxBuffer:512*1024,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1'}});const result=JSON.parse(stdout.trim());if(result.type!=='devices')throw new Error(result.message??'Microphones could not be listed.');return devicesSchema.parse(result.devices);}
  installModel():Promise<CaptureSettings>{if(this.installing)return this.installing;if(this.ready())return this.settings();this.installing=this.install().finally(()=>{this.installing=null;this.changed();});this.changed();return this.installing;}
  private async install(){
    if(this.child)throw new Error('Pause listening before installing the speech model.');
    if(!existsSync(this.helper))throw new Error('The speech helper is missing. Rebuild or reinstall Rivet.');
    this.error='';this.downloadedBytes=0;const parent=join(this.data,'speech-models');await mkdir(parent,{recursive:true,mode:0o700});const temporary=await mkdtemp(join(parent,'.english-'));
    try{
      const response=await fetch(ENGLISH_MODEL.url,{signal:AbortSignal.timeout(5*60*1000)});if(!response.ok||!response.body)throw new Error(`The English model download failed (${response.status}).`);
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let last=0;const hash=createHash('sha256');
      for(;;){const {done,value}=await reader.read();if(done)break;this.downloadedBytes+=value.length;if(this.downloadedBytes>55*1024*1024){await reader.cancel();throw new Error('The speech download exceeded its expected size.');}chunks.push(value);hash.update(value);if(Date.now()-last>500){last=Date.now();this.changed();}}
      if(hash.digest('hex')!==ENGLISH_MODEL.sha256)throw new Error('The English model failed its checksum. Try the download again.');
      const archive=Buffer.concat(chunks);const files=unzipSync(archive);let total=0;
      for(const [name,bytes] of Object.entries(files)){
        if(!name.startsWith(ENGLISH_MODEL.name+'/'))throw new Error('Unexpected speech model archive.');
        const child=name.slice(ENGLISH_MODEL.name.length+1);if(!child||name.endsWith('/'))continue;
        const file=resolve(temporary,child),rel=relative(temporary,file);if(rel.startsWith('..')||isAbsolute(rel)||child.includes('\\'))throw new Error('Invalid speech model path.');
        total+=bytes.length;if(total>160*1024*1024)throw new Error('The speech model expanded beyond its size limit.');
        await mkdir(resolve(file,'..'),{recursive:true,mode:0o700});await writeFile(file,bytes,{mode:0o600});
      }
      if(!existsSync(join(temporary,'am','final.mdl')))throw new Error('The speech model is incomplete.');
      await writeFile(join(temporary,'.complete'),ENGLISH_MODEL.sha256,{mode:0o600});
      // Only this versioned, application-owned model directory can be replaced.
      await rm(this.model,{recursive:true,force:true});await rename(temporary,this.model);return this.settings();
    }catch(error){this.error=error instanceof Error?error.message:'The English model could not be installed.';throw error;}
    finally{await rm(temporary,{recursive:true,force:true});this.changed();}
  }
  async start(text:(text:SpeechText)=>void,failed:(message:string)=>void){
    if(this.child)throw new Error('The microphone is already in use by this session.');if(!this.ready())throw new Error('Download the English speech model in Settings first.');
    const device=String((await this.store.meta.get('capture/device'))?.value??'');this.stopping=false;
    const child=spawn(this.helper,['--listen',this.library,this.model,device],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1',VECLIB_MAXIMUM_THREADS:'1'}});this.child=child;
    child.stdin.on('error',()=>{}); // A disconnected device can close stdin before Stop is delivered.
    let ready=false,reported=false,buffer='';const decoder=new StringDecoder('utf8');let resolveReady:()=>void,rejectReady:(error:Error)=>void;
    const startup=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
    const failure=(message:string)=>{if(reported)return;reported=true;if(!ready)rejectReady(new Error(message));else if(!this.stopping)failed(message);};
    const timeout=setTimeout(()=>{failure('Speech recognition took too long to start.');child.stdin.end('stop\n');child.kill();},60000);
    this.stopped=new Promise(resolve=>{child.once('close',code=>{clearTimeout(timeout);if(!ready)failure('The microphone could not start. Check system permissions.');else if(!this.stopping&&!reported)failure(`The microphone stopped unexpectedly (${code??'signal'}). Speech during the interruption was not captured.`);if(this.child===child)this.child=null;resolve();});});
    child.once('error',error=>failure(error.message));
    // Vosk logging is disabled. Always drain stderr without retaining audio or unbounded logs.
    child.stderr.resume();
    child.stdout.on('data',(data:Buffer)=>{
      buffer+=decoder.write(data);if(buffer.length>128*1024){failure('The speech helper exceeded its message limit.');child.stdin.end('stop\n');child.kill();return;}
      let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{
        const event=JSON.parse(line);
        if(event.type==='ready'){ready=true;clearTimeout(timeout);resolveReady();}
        else if(event.type==='error')failure(String(event.message).slice(0,1000));
        else if(event.type==='speech'){
          const value=z.object({startMs:z.number().nonnegative(),endMs:z.number().nonnegative(),result:z.object({text:z.string().max(12000),result:z.array(z.object({conf:z.number().optional()})).optional()})}).parse(event);
          if(value.result.text.trim())text({text:value.result.text,startMs:value.startMs,endMs:value.endMs,uncertain:value.result.result?.some(word=>(word.conf??1)<0.6)??false});
        }
      }catch{failure('The speech helper returned an invalid event.');child.stdin.end('stop\n');child.kill();}}
    });
    try{await startup;}catch(error){await this.stop();throw error;}
  }
  async stop(){const child=this.child;if(!child)return;this.stopping=true;if(!child.stdin.destroyed)child.stdin.end('stop\n');let forced=false;const timeout=setTimeout(()=>{forced=true;child.kill('SIGKILL');},6000);try{await this.stopped;if(forced)throw new Error('The recorder had to stop before its final speech could be processed. Previously saved text is kept.');}finally{clearTimeout(timeout);if(this.child===child)this.child=null;this.stopped=null;}}
}
