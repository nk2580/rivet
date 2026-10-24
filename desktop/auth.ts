import { createServer,type Server } from 'node:http';
import { createHash,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { shell } from 'electron';
import { createRemoteJWKSet,jwtVerify,type JWTPayload } from 'jose';
import { z } from 'zod';
import type { SQLiteStore } from './sqlite';
import {LegacyCredentials,type CredentialStore,type UnlockMode} from './credentials';

const authority='https://auth.openai.com',resource='https://api.openai.com/v1';
const tokenSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().optional(),id_token:z.string().optional(),expires_in:z.number().positive(),scope:z.string().optional(),token_type:z.string().refine(value=>value.toLowerCase()==='bearer')});
type Profile={id:string;email:string;subject:string;clientId:string;accessToken?:string;refreshToken?:string;idToken?:string;expiresAt:number;scopes:string[]};
type Vault={active:string|null;profiles:Profile[]};
const vaultSchema=z.object({active:z.string().nullable(),profiles:z.array(z.object({id:z.string(),email:z.string(),subject:z.string(),clientId:z.string(),accessToken:z.string().optional(),refreshToken:z.string().optional(),idToken:z.string().optional(),expiresAt:z.number(),scopes:z.array(z.string())})).max(100)});
const requiredScopes=['resource.invoke','chatgpt.tokens.use.direct'];
const random=()=>randomBytes(32).toString('base64url');
export class ChatGPTAuth {
  private vault:Vault={active:null,profiles:[]};private initialized=false;
  private pending:{server:Server;timer:ReturnType<typeof setTimeout>;id:string}|null=null;
  private refreshes=new Map<string,Promise<string>>();
  private discoveryPromise:Promise<any>|null=null;private lastError='';
  private unlocking:Promise<void>|null=null;
  constructor(private store:SQLiteStore,private changed:()=>void,private credentials:CredentialStore=new LegacyCredentials(store)){}
  async init(){if((await this.credentials.status()).locked)throw new Error('Unlock Oracle with Touch ID or your Mac password first.');if(this.initialized)return;const saved=await this.credentials.read();if(saved)this.vault=vaultSchema.parse(JSON.parse(saved));this.initialized=true;}
  private async persist(){await this.credentials.write(JSON.stringify(this.vault));this.changed();}
  async status(){const lock=await this.credentials.status();if(lock.locked)return {active:null,pending:false,error:'',profiles:[],lock};await this.init();return {active:this.vault.active,pending:!!this.pending,error:this.lastError,lock,profiles:this.vault.profiles.map(({id,email,clientId,accessToken,scopes})=>({id,email,label:`${email} · ${clientId.slice(-8)}`,connected:!!accessToken&&requiredScopes.every(scope=>scopes.includes(scope))}))};}
  async unlock(mode:UnlockMode='migrate'){
    const work=this.unlocking??=(async()=>{
      try{await this.credentials.unlock(mode);this.initialized=false;this.vault={active:null,profiles:[]};await this.init();await this.persist();}
      catch(error){this.credentials.close();this.initialized=false;this.vault={active:null,profiles:[]};throw error;}
    })().finally(()=>{this.unlocking=null;});
    await work;return this.status();
  }
  cancelUnlock(){if(this.unlocking){this.credentials.close();this.initialized=false;this.vault={active:null,profiles:[]};}}
  private async discovery(){return this.discoveryPromise??=(async()=>{const response=await fetch(`${authority}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('OpenAI sign-in discovery is unavailable.');const value=await response.json() as any;if(value.issuer!==authority||new URL(value.jwks_uri).origin!==authority)throw new Error('OpenAI sign-in discovery failed its issuer check.');return value;})().catch(error=>{this.discoveryPromise=null;throw error;});}
  private async verify(idToken:string,clientId:string,nonce?:string){const discovery=await this.discovery();const {payload}=await jwtVerify(idToken,createRemoteJWKSet(new URL(discovery.jwks_uri)),{issuer:authority,audience:clientId});if(!payload.sub||(nonce&&payload.nonce!==nonce))throw new Error('The ChatGPT identity did not match this sign-in attempt.');return payload;}
  private async exchange(values:Record<string,string>){const response=await fetch(`${authority}/api/accounts/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...values,resource}),signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(response.status===400||response.status===401?'ChatGPT authorization expired or was declined. Continue with ChatGPT again.':'OpenAI sign-in is temporarily unavailable. Try again.');return tokenSchema.parse(await response.json());}
  async login(profileId?:string){
    await this.init();if(this.pending)throw new Error('A ChatGPT sign-in is already open. Complete or cancel it first.');this.lastError='';
    if(!(await this.credentials.status()).available)throw new Error('Enable your system credential store before connecting ChatGPT.');
    const selected=profileId?this.vault.profiles.find(profile=>profile.id===profileId):undefined;if(profileId&&!selected)throw new Error('Saved ChatGPT account not found.');
    let host=await this.store.meta.get('chatgpt/host');if(!host){host={key:'chatgpt/host',value:`urn:uuid:${randomUUID()}`};await this.store.meta.put(host);}
    const state=random(),nonce=random(),verifier=random(),attempt=randomUUID();
    const server=createServer();
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
    const address=server.address();if(!address||typeof address==='string')throw new Error('The local sign-in callback could not start.');
    const redirect=`http://127.0.0.1:${address.port}/auth/callback`;
    const stop=()=>{if(this.pending?.id===attempt){clearTimeout(this.pending.timer);this.pending=null;}server.close();this.changed();};
    const timer=setTimeout(()=>{this.lastError='ChatGPT sign-in timed out. Continue with ChatGPT to try again.';stop();},5*60*1000);this.pending={server,timer,id:attempt};
    let consumed=false;
    server.on('request',(request,response)=>{void(async()=>{
      const url=new URL(request.url??'/',redirect);
      if(request.method!=='GET'||url.pathname!=='/auth/callback'){response.writeHead(404).end();return;}
      const returned=Buffer.from(url.searchParams.get('state')??''),expected=Buffer.from(state);
      if(consumed||returned.length!==expected.length||!timingSafeEqual(returned,expected)){response.writeHead(400).end('Sign-in state mismatch. Return to Rivet and try again.');return;}
      consumed=true;
      try{
        if(url.searchParams.has('error'))throw new Error('ChatGPT sign-in was declined.');
        const code=url.searchParams.get('code'),returnedClient=url.searchParams.get('client_id'),clientId=selected?.clientId??returnedClient;
        if(!code||!clientId||clientId==='dynamic_agent_client'||(selected&&returnedClient&&returnedClient!==selected.clientId))throw new Error('The ChatGPT registration did not match this sign-in.');
        const tokens=await this.exchange({grant_type:'authorization_code',client_id:clientId,code,code_verifier:verifier,redirect_uri:redirect});
        if(!tokens.id_token)throw new Error('OpenAI did not return a verifiable identity.');
        const identity=await this.verify(tokens.id_token,clientId,nonce);
        if(selected&&identity.sub!==selected.subject)throw new Error('This sign-in belongs to a different ChatGPT account. Add it as a new account.');
        const scopes=(tokens.scope??'').split(/\s+/).filter(Boolean);
        if(!requiredScopes.every(scope=>scopes.includes(scope)))throw new Error('ChatGPT plan usage was not authorized. Enable it when connecting Rivet.');
        const id=createHash('sha256').update(clientId+':'+identity.sub).digest('hex').slice(0,32);
        const profile:Profile={id,email:String(identity.email??'ChatGPT account'),subject:identity.sub!,clientId,accessToken:tokens.access_token,refreshToken:tokens.refresh_token,idToken:tokens.id_token,expiresAt:Date.now()+tokens.expires_in*1000,scopes};
        const previous=this.vault;this.vault={active:id,profiles:[...previous.profiles.filter(p=>p.id!==id),profile]};
        try{await this.persist();}catch(error){this.vault=previous;throw error;}
        response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'",'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).end('<h1>Rivet is connected</h1><p>You can close this tab and return to Rivet Desktop.</p>');
      }catch(error){this.lastError=error instanceof Error?error.message:'Sign-in failed. Return to Rivet.';response.writeHead(400,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).end(this.lastError);}
      finally{stop();}
    })().catch(()=>{response.writeHead(500).end('Sign-in failed. Return to Rivet.');stop();});});
    const params=new URLSearchParams({client_id:selected?.clientId??'dynamic_agent_client',ext_agent_host_id:String(host.value),response_type:'code',redirect_uri:redirect,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',resource,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')});
    if(selected?.idToken)params.set('id_token_hint',selected.idToken);
    if(selected?.email)params.set('login_hint',selected.email);
    if(!selected)params.set('agent_name_hint','Rivet');
    try{await shell.openExternal(`${authority}/api/accounts/authorize?${params}`);}catch(error){stop();throw error;}
    this.changed();return {pending:true};
  }
  cancel(){if(this.pending){clearTimeout(this.pending.timer);this.pending.server.close();this.pending=null;this.changed();}}
  async select(id:string){await this.init();if(!this.vault.profiles.some(p=>p.id===id))throw new Error('ChatGPT account not found.');this.vault.active=id;await this.persist();}
  async token(profileId?:string){await this.init();const profile=this.vault.profiles.find(p=>p.id===(profileId??this.vault.active));if(!profile?.accessToken)throw new Error('Continue with ChatGPT to connect your plan.');if(profile.expiresAt>Date.now()+90000)return profile.accessToken;let pending=this.refreshes.get(profile.id);if(!pending){pending=(async()=>{if(!profile.refreshToken)throw new Error('Continue with ChatGPT again to renew the connection.');const tokens=await this.exchange({grant_type:'refresh_token',client_id:profile.clientId,refresh_token:profile.refreshToken});if(tokens.id_token){const identity=await this.verify(tokens.id_token,profile.clientId);if(identity.sub!==profile.subject)throw new Error('ChatGPT refresh returned a different identity.');}
      const scopes=tokens.scope?tokens.scope.split(/\s+/):profile.scopes;if(!requiredScopes.every(scope=>scopes.includes(scope)))throw new Error('ChatGPT plan access needs authorization again.');
      Object.assign(profile,{accessToken:tokens.access_token,refreshToken:tokens.refresh_token??profile.refreshToken,idToken:tokens.id_token??profile.idToken,scopes,expiresAt:Date.now()+tokens.expires_in*1000});await this.persist();return profile.accessToken!;})();this.refreshes.set(profile.id,pending);pending.finally(()=>this.refreshes.delete(profile.id)).catch(()=>{});}return pending;}
  async models(){const token=await this.token();const response=await fetch(`${resource}/models`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`ChatGPT model lookup failed (${response.status}). Reconnect your plan if needed.`);const value=await response.json() as any;return z.array(z.object({slug:z.string(),display_name:z.string(),visibility:z.string()})).parse(value.models).filter(model=>model.visibility==='list').map(model=>({id:model.slug,name:model.display_name}));}
  async modelPreference(){
    await this.init();if(!this.vault.active)return {model:''};
    const saved=await this.store.meta.get('chatgpt/model/'+this.vault.active);
    if(saved)return {model:z.string().parse(saved.value)};
    // Preserve the model already used before the picker moved into Settings.
    const hasSessions=this.store.connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_sessions'").get();
    const last=hasSessions?this.store.connection.prepare("SELECT model FROM chat_sessions WHERE model<>'' ORDER BY updated_at DESC LIMIT 1").get():null;
    return {model:typeof last?.model==='string'?last.model:''};
  }
  async selectModel(value:string){
    await this.init();const accountId=this.vault.active;if(!accountId)throw new Error('Connect ChatGPT before choosing a model.');
    const model=z.string().min(1).max(150).parse(value),choices=await this.models();
    if(this.vault.active!==accountId)throw new Error('The ChatGPT account changed. Choose the model again.');
    if(!choices.some(choice=>choice.id===model))throw new Error('Choose a model available to this ChatGPT account.');
    await this.store.meta.put({key:'chatgpt/model/'+accountId,value:model});this.changed();return {model};
  }
  async logout(){await this.init();this.cancel();const profile=this.vault.profiles.find(p=>p.id===this.vault.active);let revoked=false;if(profile?.refreshToken){try{const discovery=await this.discovery(),url=new URL(discovery.revocation_endpoint);if(url.origin!==authority)throw new Error('Invalid revocation authority.');const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:profile.refreshToken,token_type_hint:'refresh_token',client_id:profile.clientId}),signal:AbortSignal.timeout(20000)});revoked=response.status===200;}catch{}}
    if(profile){delete profile.accessToken;delete profile.refreshToken;delete profile.idToken;profile.expiresAt=0;this.vault.active=null;await this.persist();}return {revoked,message:revoked?'Signed out of ChatGPT.':'Signed out locally. Remote revocation was not confirmed; disconnect Rivet in ChatGPT Settings if needed.'};
  }
  close(){this.cancel();this.credentials.close();this.vault={active:null,profiles:[]};this.initialized=false;}
}
