import {safeStorage} from 'electron';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {SQLiteStore} from './sqlite';

export type CredentialStatus={locked:boolean;available:boolean;touchID:boolean;migration:boolean;hasSavedConnection:boolean};
export type UnlockMode='migrate'|'reconnect';
export interface CredentialStore {
  status():Promise<CredentialStatus>;
  unlock(mode?:UnlockMode):Promise<void>;
  read():Promise<string|null>;
  write(value:string):Promise<void>;
  close():void;
}
const legacyKey='chatgpt/vault',deviceKey='chatgpt/vault-device';
const bytes=(length:number)=>z.string().base64().refine(value=>Buffer.from(value,'base64').length===length);
const envelopeSchema=z.object({keyBlob:z.string().base64().min(1).max(24000),publicKey:bytes(65),salt:bytes(32),sealedKey:bytes(60)}).strict();
type Envelope=z.infer<typeof envelopeSchema>;
const payloadSchema=z.object({version:z.literal(1),envelope:envelopeSchema,iv:bytes(12),tag:bytes(16),ciphertext:z.string().base64().max(1500000)}).strict();
const aad=Buffer.from('com.rivet.desktop.connection.v1');
export interface AuthBridge {request(input:unknown):Promise<any>;close():void;}

/** Native helper owns system UI. Only an authenticated key crosses its private pipe. */
export class NativeAuthBridge implements AuthBridge {
  private children=new Set<ChildProcessWithoutNullStreams>();
  constructor(private executable:string){}
  request(input:unknown):Promise<any>{
    return new Promise((resolve,reject)=>{
      const child=spawn(this.executable,[],{stdio:'pipe'});this.children.add(child);
      let output='',settled=false;
      const finish=(error?:Error,value?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);this.children.delete(child);error?reject(error):resolve(value);};
      const timer=setTimeout(()=>{child.kill();finish(new Error('Mac authentication timed out. Try unlocking Oracle again.'));},120000);
      child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>65536){child.kill();finish(new Error('Invalid response from Mac authentication.'));}});
      child.stderr.resume();child.stdin.on('error',()=>{});
      child.on('error',()=>finish(new Error('Mac authentication could not start. Reinstall Rivet and try again.')));
      child.on('close',code=>{
        if(settled)return;
        try{if(code!==0)throw new Error();const response=JSON.parse(output);if(response.error){const message=z.string().max(400).parse(response.message);finish(new Error(message));}else finish(undefined,response);}
        catch{finish(new Error('Mac authentication could not complete. Try again.'));}
      });
      child.stdin.end(JSON.stringify(input));
    });
  }
  close(){for(const child of this.children)child.kill();this.children.clear();}
}

/** Existing OS encryption remains the adapter for platforms outside macOS. */
export class LegacyCredentials implements CredentialStore {
  constructor(private store:SQLiteStore){}
  async status(){return {locked:false,available:safeStorage.isEncryptionAvailable(),touchID:false,migration:false,hasSavedConnection:!!await this.store.meta.get(legacyKey)};}
  async unlock(){}
  async read(){const saved=await this.store.meta.get(legacyKey);if(!saved)return null;if(!safeStorage.isEncryptionAvailable())throw new Error('The system credential store is unavailable. The assistant connection is locked.');return safeStorage.decryptString(Buffer.from(String(saved.value),'base64'));}
  async write(value:string){if(!safeStorage.isEncryptionAvailable())throw new Error('The operating system credential store is unavailable. Rivet will not save ChatGPT tokens without encryption.');await this.store.meta.put({key:legacyKey,value:safeStorage.encryptString(value).toString('base64')});}
  close(){}
}

/** AES-GCM vault key is wrapped by an authentication-bound Secure Enclave key. */
export class MacCredentials implements CredentialStore {
  private key:Buffer|null=null;private envelope:Envelope|null=null;private value:string|null=null;
  private pending:Promise<void>|null=null;private capabilities:Promise<{available:boolean;touchID:boolean}>|null=null;
  private generation=0;private replace=false;
  constructor(private store:SQLiteStore,private bridge:AuthBridge){}
  async status():Promise<CredentialStatus>{
    const [saved,legacy]=await Promise.all([this.store.meta.get(deviceKey),this.store.meta.get(legacyKey)]);
    const capability=await (this.capabilities??=this.bridge.request({action:'status'}).then(value=>z.object({available:z.boolean(),touchID:z.boolean()}).parse(value)).catch(()=>({available:false,touchID:false})));
    return {locked:!this.key,...capability,migration:!saved&&!!legacy,hasSavedConnection:!!saved||!!legacy};
  }
  unlock(mode:UnlockMode='migrate'):Promise<void>{
    if(this.key)return Promise.resolve();
    if(this.pending)return this.pending;
    const generation=this.generation;
    this.pending=(async()=>{
      const stored=await this.store.meta.get(deviceKey);
      let key:Buffer|null=null;
      try{
        let value:string|null=null,envelope:Envelope;
        if(stored&&mode!=='reconnect'){
          const saved=payloadSchema.parse(stored.value);
          const response=await this.bridge.request({action:'open',envelope:saved.envelope});
          key=Buffer.from(bytes(32).parse(response.key),'base64');envelope=saved.envelope;
          const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(saved.iv,'base64'));
          decipher.setAAD(aad);decipher.setAuthTag(Buffer.from(saved.tag,'base64'));
          value=Buffer.concat([decipher.update(Buffer.from(saved.ciphertext,'base64')),decipher.final()]).toString('utf8');
        }else{
          const response=await this.bridge.request({action:'create'});
          key=Buffer.from(bytes(32).parse(response.key),'base64');envelope=envelopeSchema.parse(response.envelope);
          if(mode==='migrate')value=await new LegacyCredentials(this.store).read();
        }
        if(generation!==this.generation)throw new Error('Oracle was locked before authentication completed.');
        this.key=key;this.envelope=envelope;this.value=value;this.replace=!!stored&&mode==='reconnect';
      }catch(error){key?.fill(0);throw error;}
    })().finally(()=>{this.pending=null;});
    return this.pending;
  }
  async read(){if(!this.key)throw new Error('Unlock Oracle with Touch ID or your Mac password first.');return this.value;}
  async write(value:string){
    if(!this.key||!this.envelope)throw new Error('Unlock Oracle before saving the connection.');
    const generation=this.generation;
    if(Buffer.byteLength(value)>1000000)throw new Error('The saved connection is too large.');
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(aad);
    const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    const payload=payloadSchema.parse({version:1,envelope:this.envelope,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')});
    await this.store.transaction('rw',this.store.meta,async()=>{
      if(generation!==this.generation||!this.key)throw new Error('Oracle was locked before the connection could be saved.');
      if(this.replace){const previous=await this.store.meta.get(deviceKey);if(previous)await this.store.meta.put({key:`chatgpt/vault-device-recovery/${randomUUID()}`,value:previous.value});}
      await this.store.meta.put({key:deviceKey,value:payload});
    });
    if(generation!==this.generation)throw new Error('Oracle was locked before the connection could be saved.');
    this.value=value;this.replace=false;
  }
  close(){this.generation++;this.key?.fill(0);this.key=null;this.envelope=null;this.value=null;this.bridge.close();}
}
