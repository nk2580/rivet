import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SQLiteStore} from '../desktop/sqlite';
const electron=vi.hoisted(()=>({decrypt:vi.fn((value:Buffer)=>Buffer.from(value).reverse().toString()),encrypt:vi.fn((value:string)=>Buffer.from(value).reverse())}));
vi.mock('electron',()=>({shell:{openExternal:vi.fn()},safeStorage:{isEncryptionAvailable:()=>true,encryptString:electron.encrypt,decryptString:electron.decrypt}}));
import {MacCredentials,type AuthBridge} from '../desktop/credentials';
import {ChatGPTAuth} from '../desktop/auth';

const vault={active:'account',profiles:[{id:'account',email:'fixture@example.test',subject:'subject',clientId:'test-client',accessToken:'synthetic-access-token',refreshToken:'synthetic-refresh-token',idToken:'synthetic-id-token',expiresAt:Date.now()+3600000,scopes:['resource.invoke','chatgpt.tokens.use.direct']}]};
const key=Buffer.alloc(32,7).toString('base64');
const envelope={keyBlob:Buffer.alloc(64,2).toString('base64'),publicKey:Buffer.alloc(65,3).toString('base64'),salt:Buffer.alloc(32,4).toString('base64'),sealedKey:Buffer.alloc(60,5).toString('base64')};
const bridge=()=>({request:vi.fn(async(input:any)=>input.action==='status'?{available:true,touchID:true}:input.action==='create'?{key,envelope}:{key}),close:vi.fn()});
async function seed(db:SQLiteStore){const row={key:'chatgpt/vault',value:Buffer.from(JSON.stringify(vault)).reverse().toString('base64')};await db.meta.put(row);return row;}
afterEach(()=>{electron.decrypt.mockReset();electron.decrypt.mockImplementation(value=>Buffer.from(value).reverse().toString());electron.encrypt.mockClear();});

describe('Mac connection protection (isolated credentials only)',()=>{
  it('checks status repeatedly without decrypting legacy credentials or prompting; token access stays locked',async()=>{
    const db=new SQLiteStore(':memory:'),native=bridge(),credentials=new MacCredentials(db,native),auth=new ChatGPTAuth(db,()=>{},credentials);
    try{
      const original=await seed(db);
      for(let i=0;i<3;i++)expect(await auth.status()).toMatchObject({active:null,profiles:[],lock:{locked:true,migration:true,available:true,touchID:true}});
      await expect(auth.token()).rejects.toThrow('Unlock Oracle');
      expect(native.request.mock.calls).toEqual([[{action:'status'}]]);expect(electron.decrypt).not.toHaveBeenCalled();
      expect(await db.meta.toArray()).toEqual([original]);
    }finally{auth.close();db.close();}
  });
  it('migrates once, stores only encrypted values and unlocks after an actual SQLite reopen',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'rivet-device-vault-')),filename=join(directory,'workspace.sqlite');
    let db=new SQLiteStore(filename),native=bridge(),auth=new ChatGPTAuth(db,()=>{},new MacCredentials(db,native));
    try{
      const original=await seed(db);
      await auth.unlock();expect(await auth.token()).toBe('synthetic-access-token');
      expect(electron.decrypt).toHaveBeenCalledTimes(1);expect(electron.encrypt).not.toHaveBeenCalled();
      const stored=await db.meta.get('chatgpt/vault-device');expect(JSON.stringify(stored)).not.toContain('synthetic-');expect(JSON.stringify(stored)).not.toContain(key);
      expect(await db.meta.get('chatgpt/vault')).toEqual(original);
      const firstIV=(stored!.value as any).iv;
      auth.close();db.close();db=new SQLiteStore(filename);native=bridge();auth=new ChatGPTAuth(db,()=>{},new MacCredentials(db,native));
      expect((await auth.status()).lock).toMatchObject({locked:true,migration:false});
      await auth.unlock();expect(await auth.token()).toBe('synthetic-access-token');
      expect(native.request.mock.calls.some(([input])=>input.action==='open')).toBe(true);
      expect(electron.decrypt).toHaveBeenCalledTimes(1);
      expect(((await db.meta.get('chatgpt/vault-device'))!.value as any).iv).not.toBe(firstIV);
      expect(JSON.stringify(await auth.status())).not.toContain('synthetic-');
    }finally{auth.close();db.close();await rm(directory,{recursive:true,force:true});}
  });
  it('shares one authentication attempt across concurrent unlocks',async()=>{
    const db=new SQLiteStore(':memory:'),native=bridge(),auth=new ChatGPTAuth(db,()=>{},new MacCredentials(db,native));
    try{await seed(db);await Promise.all([auth.unlock(),auth.unlock(),auth.unlock()]);expect(native.request.mock.calls.filter(([input])=>input.action==='create')).toHaveLength(1);expect(electron.decrypt).toHaveBeenCalledTimes(1);}
    finally{auth.close();db.close();}
  });
  it('cancelled authentication never reads the old Keychain or writes a new vault and can be retried',async()=>{
    const db=new SQLiteStore(':memory:'),native=bridge(),auth=new ChatGPTAuth(db,()=>{},new MacCredentials(db,native));
    try{
      const original=await seed(db);
      native.request.mockRejectedValueOnce(new Error('Oracle is still locked.'));
      await expect(auth.unlock()).rejects.toThrow('still locked');expect(electron.decrypt).not.toHaveBeenCalled();expect(await db.meta.toArray()).toEqual([original]);
      expect((await auth.status()).lock.locked).toBe(true);await auth.unlock();expect(await auth.token()).toBe('synthetic-access-token');
    }finally{auth.close();db.close();}
  });
  it('reconnect skips legacy decryption entirely and preserves the encrypted original',async()=>{
    const db=new SQLiteStore(':memory:'),native=bridge(),auth=new ChatGPTAuth(db,()=>{},new MacCredentials(db,native));
    try{
      const original=await seed(db);electron.decrypt.mockImplementation(()=>{throw new Error('Legacy Keychain denied');});
      await auth.unlock('reconnect');expect(electron.decrypt).not.toHaveBeenCalled();
      expect(await auth.status()).toMatchObject({active:null,profiles:[],lock:{locked:false,migration:false}});expect(await db.meta.get('chatgpt/vault')).toEqual(original);
      await expect(auth.token()).rejects.toThrow('Continue with ChatGPT');
    }finally{auth.close();db.close();}
  });
  it('a denied legacy migration or failed write leaves the original intact and the connection locked',async()=>{
    const db=new SQLiteStore(':memory:'),native=bridge(),auth=new ChatGPTAuth(db,()=>{},new MacCredentials(db,native));
    try{
      const original=await seed(db);electron.decrypt.mockImplementationOnce(()=>{throw new Error('Keychain denied');});
      await expect(auth.unlock()).rejects.toThrow('Keychain denied');expect((await auth.status()).lock.locked).toBe(true);expect(await db.meta.toArray()).toEqual([original]);
      db.connection.exec("CREATE TRIGGER fail_vault BEFORE INSERT ON meta WHEN NEW.key='chatgpt/vault-device' BEGIN SELECT RAISE(ABORT,'Storage unavailable'); END;");
      await expect(auth.unlock()).rejects.toThrow('Storage unavailable');expect((await auth.status()).lock.locked).toBe(true);expect(await db.meta.toArray()).toEqual([original]);
    }finally{auth.close();db.close();}
  });
  it('rejects an altered authentication tag without falling back to legacy credentials',async()=>{
    const db=new SQLiteStore(':memory:'),native=bridge();let auth=new ChatGPTAuth(db,()=>{},new MacCredentials(db,native));
    try{
      await seed(db);await auth.unlock();auth.close();
      const saved=(await db.meta.get('chatgpt/vault-device'))!;(saved.value as any).tag=Buffer.alloc(16,99).toString('base64');await db.meta.put(saved);
      auth=new ChatGPTAuth(db,()=>{},new MacCredentials(db,bridge()));await expect(auth.unlock()).rejects.toThrow();
      expect((await auth.status()).lock.locked).toBe(true);expect(electron.decrypt).toHaveBeenCalledTimes(1);expect(await db.meta.get('chatgpt/vault-device')).toEqual(saved);
    }finally{auth.close();db.close();}
  });
  it('cancels a pending unlock without accepting a late native result',async()=>{
    const db=new SQLiteStore(':memory:');let complete!:(value:unknown)=>void;
    const native:AuthBridge={request:input=>(input as any).action==='status'?Promise.resolve({available:true,touchID:true}):new Promise(resolve=>{complete=resolve;}),close:vi.fn()};
    const credentials=new MacCredentials(db,native),auth=new ChatGPTAuth(db,()=>{},credentials);
    try{
      const original=await seed(db),pending=auth.unlock();await vi.waitFor(()=>expect(complete).toBeTypeOf('function'));
      auth.cancelUnlock();complete({key,envelope});await expect(pending).rejects.toThrow('locked');
      expect(await db.meta.toArray()).toEqual([original]);expect((await auth.status()).lock.locked).toBe(true);
    }finally{auth.close();db.close();}
  });
  it('retains a protected recovery copy when a user explicitly reconnects a newer vault',async()=>{
    const db=new SQLiteStore(':memory:');let auth=new ChatGPTAuth(db,()=>{},new MacCredentials(db,bridge()));
    try{
      await seed(db);await auth.unlock();const before=(await db.meta.get('chatgpt/vault-device'))!.value;auth.close();
      auth=new ChatGPTAuth(db,()=>{},new MacCredentials(db,bridge()));await auth.unlock('reconnect');
      expect((await db.meta.toArray()).find(row=>row.key.startsWith('chatgpt/vault-device-recovery/'))?.value).toEqual(before);
    }finally{auth.close();db.close();}
  });
  it('refuses cached token access as soon as credential protection is closed',async()=>{
    const db=new SQLiteStore(':memory:'),credentials=new MacCredentials(db,bridge()),auth=new ChatGPTAuth(db,()=>{},credentials);
    try{await seed(db);await auth.unlock();expect(await auth.token()).toBe('synthetic-access-token');credentials.close();await expect(auth.token()).rejects.toThrow('Unlock Oracle');expect((await auth.status()).profiles).toEqual([]);}
    finally{auth.close();db.close();}
  });
});
