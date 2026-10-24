import { afterEach,describe,expect,it,vi } from 'vitest';
import { exportJWK,generateKeyPair,SignJWT } from 'jose';
import { SQLiteStore } from '../desktop/sqlite';
const electron=vi.hoisted(()=>({openExternal:vi.fn(async(_url:string)=>{}),available:true}));
vi.mock('electron',()=>({shell:{openExternal:electron.openExternal},safeStorage:{isEncryptionAvailable:()=>electron.available,encryptString:(value:string)=>Buffer.from(value).reverse(),decryptString:(value:Buffer)=>Buffer.from(value).reverse().toString()}}));
import { ChatGPTAuth } from '../desktop/auth';
const originalFetch=globalThis.fetch;
afterEach(()=>{vi.unstubAllGlobals();electron.openExternal.mockClear();electron.available=true;});
describe('official local ChatGPT authorization lifecycle',()=>{
  it('checks state/nonce/signature, encrypts credentials, keeps the host stable and serializes rotating refreshes',async()=>{
    const db=new SQLiteStore(':memory:'),auth=new ChatGPTAuth(db,()=>{});
    const {privateKey,publicKey}=await generateKeyPair('ES256'),publicJwk={...await exportJWK(publicKey),kid:'test-key',alg:'ES256'};let nonce='',refreshCount=0;
    vi.stubGlobal('fetch',vi.fn(async(input:any,init?:RequestInit)=>{
      const url=String(input);
      if(url.startsWith('http://127.0.0.1:'))return originalFetch(input,init);
      if(url.endsWith('/.well-known/openid-configuration'))return Response.json({issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/jwks',revocation_endpoint:'https://auth.openai.com/revoke'});
      if(url.endsWith('/jwks'))return Response.json({keys:[publicJwk]});
      if(url.endsWith('/oauth/token')){
        const form=new URLSearchParams(String(init?.body)),refresh=form.get('grant_type')==='refresh_token';if(refresh)refreshCount++;
        expect(form.get('client_id')).toBe('oaiapp_rivet_test');expect(form.get('resource')).toBe('https://api.openai.com/v1');
        const token=await new SignJWT({nonce,email:'fixture@example.test'}).setProtectedHeader({alg:'ES256',kid:'test-key'}).setIssuer('https://auth.openai.com').setAudience('oaiapp_rivet_test').setSubject('synthetic-account').setExpirationTime('5m').sign(privateKey);
        return Response.json({access_token:refresh?'synthetic-renewed-access':'synthetic-initial-access',refresh_token:refresh?'synthetic-rotated-refresh':'synthetic-initial-refresh',id_token:token,token_type:'Bearer',expires_in:refresh?3600:1,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'});
      }
      if(url.endsWith('/revoke'))return new Response(null,{status:200});
      if(url.endsWith('/v1/models'))return Response.json({models:[
        {slug:'fixture-original',display_name:'Original model',visibility:'list'},
        {slug:'fixture-selected',display_name:'Selected model',visibility:'list'},
        {slug:'fixture-hidden',display_name:'Hidden model',visibility:'hidden'},
      ]});
      throw new Error('Unexpected network request in isolated auth test.');
    }));
    try{
      await auth.login();const authorization=new URL(electron.openExternal.mock.calls[0][0]);nonce=authorization.searchParams.get('nonce')!;
      expect(authorization.searchParams.get('client_id')).toBe('dynamic_agent_client');expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');expect(authorization.searchParams.get('agent_name_hint')).toBe('Rivet');
      const host=authorization.searchParams.get('ext_agent_host_id');expect(host).toMatch(/^urn:uuid:/);
      const callback=new URL(authorization.searchParams.get('redirect_uri')!);callback.searchParams.set('code','synthetic-code');callback.searchParams.set('client_id','oaiapp_rivet_test');callback.searchParams.set('state','wrong-state');expect((await originalFetch(callback)).status).toBe(400);
      callback.searchParams.set('state',authorization.searchParams.get('state')!);expect((await originalFetch(callback)).status).toBe(200);
      const status=await auth.status();expect(status.profiles[0].connected).toBe(true);expect(JSON.stringify(status)).not.toContain('synthetic-initial');expect(JSON.stringify(await db.meta.get('chatgpt/vault'))).not.toContain('synthetic-initial');
      expect(await Promise.all([auth.token(),auth.token(),auth.token()])).toEqual(Array(3).fill('synthetic-renewed-access'));expect(refreshCount).toBe(1);
      const reopened=new ChatGPTAuth(db,()=>{});expect((await reopened.status()).active).toBe(status.active);expect(await reopened.token()).toBe('synthetic-renewed-access');
      db.connection.exec("CREATE TABLE chat_sessions(model TEXT,updated_at TEXT);INSERT INTO chat_sessions VALUES('fixture-original','2026-10-23T01:00:00Z')");
      expect((await reopened.modelPreference()).model).toBe('fixture-original');
      await reopened.selectModel('fixture-selected');
      expect((await new ChatGPTAuth(db,()=>{}).modelPreference()).model).toBe('fixture-selected');
      await expect(reopened.selectModel('fixture-hidden')).rejects.toThrow('available');
      expect((await reopened.modelPreference()).model).toBe('fixture-selected');
      expect((await reopened.logout()).revoked).toBe(true);await reopened.login(status.active!);const returning=new URL(electron.openExternal.mock.calls[1][0]);expect(returning.searchParams.get('client_id')).toBe('oaiapp_rivet_test');expect(returning.searchParams.get('ext_agent_host_id')).toBe(host);expect(returning.searchParams.has('agent_name_hint')).toBe(false);expect(returning.searchParams.has('id_token_hint')).toBe(false);reopened.close();
    }finally{auth.close();db.close();}
  });
  it('does not start sign-in when protected operating-system storage is unavailable',async()=>{
    const db=new SQLiteStore(':memory:'),auth=new ChatGPTAuth(db,()=>{});electron.available=false;await expect(auth.login()).rejects.toThrow('credential store');expect(electron.openExternal).not.toHaveBeenCalled();auth.close();db.close();
  });
});
