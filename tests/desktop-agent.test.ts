import { afterEach,describe,expect,it,vi } from 'vitest';
import { resolve } from 'node:path';
import { SQLiteStore } from '../desktop/sqlite';
import { Workspace } from '../src/storage/workspace';
import { createCharacter } from '../src/domain/character';
import { recordBase } from '../src/domain/schema';
import { AssistantRuntime } from '../desktop/assistant';

afterEach(()=>vi.unstubAllGlobals());
const streamed=(output:unknown[],text?:string)=>new Response(new ReadableStream({start(controller){const encode=new TextEncoder();if(text)controller.enqueue(encode.encode(`data: ${JSON.stringify({type:'response.output_text.delta',delta:text})}\n\n`));controller.enqueue(encode.encode(`data: ${JSON.stringify({type:'response.completed',response:{output}})}\n\n`));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});
const fn=(name:string,args:unknown)=>({type:'function_call',id:crypto.randomUUID(),call_id:crypto.randomUUID(),name,arguments:JSON.stringify(args)});
const streamedItemsOnly=(output:unknown[],text?:string)=>new Response(new ReadableStream({start(controller){const encoder=new TextEncoder();for(const item of output)controller.enqueue(encoder.encode(`data: ${JSON.stringify({type:'response.output_item.done',item})}\n\n`));if(text)controller.enqueue(encoder.encode(`data: ${JSON.stringify({type:'response.output_text.delta',delta:text})}\n\n`));controller.enqueue(encoder.encode(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[]}})}\n\n`));controller.close();}}));
const paths={exec:process.execPath,mcp:resolve('dist-electron/mcp.cjs'),rules:resolve('dist-electron/rules.sqlite')};
describe('local agent loop with actual SQLite and MCP',()=>{
  it('runs multiple real local MCP lookups, streams citations, keeps private notes out, and persists a resumable session',async()=>{
    const store=new SQLiteStore(':memory:'),workspace=new Workspace(store.asWorkspaceStore(),'local',true),character=createCharacter('Guide fixture','5e-2024');character.notes='PRIVATE-CHARACTER-SENTINEL';character.portrait={dataUrl:'data:image/png;base64,UExPQ0FMLVBPUlRSQUlULVNFTlRJTkVM'};
    await workspace.save(character,0);await workspace.save({...recordBase('Private note'),kind:'note',noteType:'note',campaignId:null,characterId:character.id,sessionId:null,body:'PRIVATE-NOTE-SENTINEL',tags:[],linkedIds:[],status:'open',shareWithGuide:false,carryForward:false},0);
    const requests:any[]=[];let call=0;
    vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{expect(url).toBe('https://api.openai.com/v1/responses');const request=JSON.parse(String(options.body));requests.push(request);expect(request.store).toBe(false);expect(request.stream).toBe(true);expect(request.instructions).not.toContain('PRIVATE-CHARACTER-SENTINEL');expect(request.instructions).not.toContain('PRIVATE-NOTE-SENTINEL');expect(request.instructions).not.toContain(character.portrait!.dataUrl);
      if(call++===0)return streamedItemsOnly([fn('search_rules',{query:'Guiding Bolt',edition:'5e-2024',kind:'spell',limit:1})]);
      if(call===2)return streamedItemsOnly([fn('get_rule',{id:'5e-2024:spell:guiding-bolt'})]);
      return streamedItemsOnly([{type:'message',id:'answer',role:'assistant',content:[{type:'output_text',text:'Source checked.'}]}],'Use an action. [Guiding Bolt](rivet://rules/5e-2024%3Aspell%3Aguiding-bolt)');
    }));
    const runtime=new AssistantRuntime(store,workspace,{token:async()=> 'synthetic-oauth',status:async()=>({active:'fixture-account'})} as any,paths,()=>{});
    try{const session=await runtime.create(character.id,'Spell help');await runtime.send(session.id,'Explain Guiding Bolt','account-model');await vi.waitFor(()=>expect(runtime.messages(session.id).running).toBe(false),{timeout:5000});
      const messages=runtime.messages(session.id).messages as any[];expect(messages.filter(message=>message.role==='tool'&&message.status==='complete')).toHaveLength(2);expect(messages.find(message=>message.role==='assistant')).toMatchObject({status:'complete',text:expect.stringContaining('rivet://rules/')});
      expect(requests[2].input.some((item:any)=>item.type==='function_call_output'&&item.output.includes('4d6 Radiant'))).toBe(true);expect(runtime.list(character.id)).toHaveLength(1);expect(store.connection.prepare('SELECT history FROM chat_sessions WHERE id=?').get(session.id)?.history).toContain('function_call_output');
      const backup=runtime.exportBackup(),secondStore=new SQLiteStore(':memory:'),secondWorkspace=new Workspace(secondStore.asWorkspaceStore(),'local',true);await secondWorkspace.save(character,0);await secondWorkspace.setDeleted('character',character.id,true,1);
      const restored=new AssistantRuntime(secondStore,secondWorkspace,{token:async()=> 'synthetic-oauth'} as any,paths,()=>{});
      try{expect(await restored.importBackup(backup)).toBe(1);expect(restored.messages(session.id).messages).toEqual(runtime.messages(session.id).messages);expect(await restored.importBackup(backup)).toBe(0);expect(JSON.stringify(backup)).not.toContain('synthetic-oauth');}finally{await restored.close();secondStore.close();}
    }finally{await runtime.close();store.close();}
  });
  it('rejects wrong-edition lookups, never applies a proposal automatically, and refuses a stale review',async()=>{
    const store=new SQLiteStore(':memory:'),workspace=new Workspace(store.asWorkspaceStore(),'local',true),character=createCharacter('Review fixture','5e-2024');await workspace.save(character,0);let round=0;const outputs:any[]=[];
    vi.stubGlobal('fetch',vi.fn(async(_url:string,options:RequestInit)=>{const request=JSON.parse(String(options.body));outputs.push(request);if(round++===0)return streamed([fn('search_rules',{query:'Guiding Bolt',edition:'3.5e',kind:'spell',limit:1})]);if(round===2)return streamed([fn('propose_character_action',{command:{type:'heal',amount:2},reason:'Requested test heal'})]);return streamed([{type:'message',role:'assistant',content:[{type:'output_text',text:'Review the proposed change.'}]}]);}));
    const runtime=new AssistantRuntime(store,workspace,{token:async()=> 'synthetic-oauth',status:async()=>({active:'fixture-account'})} as any,paths,()=>{});
    try{const session=await runtime.create(character.id,'Review');await runtime.send(session.id,'Please heal my character by two resolved hit points.','account-model');await vi.waitFor(()=>expect(runtime.messages(session.id).running).toBe(false),{timeout:5000});
      expect(outputs[1].input.some((item:any)=>item.type==='function_call_output'&&item.output.includes('only its character'))).toBe(true);
      const proposal=(runtime.messages(session.id).messages as any[]).find(message=>message.role==='proposal');expect(proposal.status).toBe('pending');expect((await workspace.get('character',character.id))?.localRevision).toBe(1);
      await workspace.execute(character.id,{type:'damage',amount:1},1);await expect(runtime.applyProposal(proposal.details.id)).rejects.toThrow('changed');expect((await workspace.get('character',character.id))?.data).toMatchObject({hp:9});
    }finally{await runtime.close();store.close();}
  });
});
