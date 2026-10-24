import {describe,expect,it,vi} from 'vitest';
import {RULESETS,type Character} from '../src/domain/schema';
import {oracleFixture,toolCall,toolStream,oracleAnswer,sameSheet} from './fixtures/oracle';

describe('Oracle tools, cancellation and recovery',()=>{
  for(const edition of RULESETS)it(`${edition}: searches, reads, cites and lists actual local SRDs without mutating the sheet`,async()=>{
    const f=await oracleFixture(edition);let id='',uri='';
    try{
      const result=await f.turn((request,round)=>{
        if(round===0)return [toolCall('search_rules',{query:'Cure Wounds',edition,kind:'spell',limit:1})];
        if(round===1){
          const output=JSON.parse(request.input.findLast((entry:any)=>entry.type==='function_call_output').output);
          const entry=JSON.parse(output.content[0].text)[0];expect(entry.edition).toBe(edition);id=entry.id;uri=entry.uri;
          return [toolCall('get_rule',{id})];
        }
        if(round===2)return [toolCall('read_rule_resource',{uri})];
        if(round===3)return [toolCall('list_sources',{})];
        if(round===4)return [toolCall('get_character',{})];
        return [oracleAnswer];
      },'Explain Cure Wounds and show its source. Do not change my sheet.');
      const tools=result.messages.filter((m:any)=>m.role==='tool');
      expect(tools.map((m:any)=>m.text)).toEqual(['search_rules','get_rule','read_rule_resource','list_sources','get_character']);
      expect(tools.every((m:any)=>m.status==='complete')).toBe(true);
      expect(JSON.stringify(tools[1].details.result)).toContain('Cure');
      expect(JSON.stringify(tools[2].details.result)).toContain(edition);
      expect(sameSheet((await f.workspace.get('character',f.character.id))!.data as Character)).toEqual(sameSheet(f.character));
      expect(await f.store.activity.toArray()).toEqual([]);
    }finally{await f.close();}
  });

  it.each([
    ['search_rules',{query:'Cure Wounds',edition:'3.5e',kind:'spell',limit:1}],
    ['get_rule',{id:'3.5e:spell:cure-light-wounds'}],
    ['read_rule_resource',{uri:'rivet://rules/3.5e%3Aspell%3Acure-light-wounds'}],
    ['read_rule_resource',{uri:'https://example.com/rules'}],
    ['read_rule_resource',{uri:'rivet://rules/%broken'}],
    ['unknown_tool',{}],
  ])('rejects an unavailable or wrong-edition %s request',async(name,args)=>{
    const f=await oracleFixture();
    try{
      const result=await f.turn((_request,round)=>round===0?[toolCall(String(name),args)]:[oracleAnswer]);
      expect(result.messages.find((m:any)=>m.role==='tool')?.status).toBe('error');
      expect(await f.store.activity.toArray()).toEqual([]);
    }finally{await f.close();}
  });

  it.each([false,true])('stopping an answer preserves only committed updates (committed=%s)',async(commitFirst)=>{
    const f=await oracleFixture();let round=0,waiting=false;
    try{
      vi.stubGlobal('fetch',vi.fn(async(_url:string,options:RequestInit)=>{
        if(commitFirst&&round++===0)return toolStream([toolCall('apply_character_action',{command:{type:'damage',amount:10},expectedRevision:1,reason:'Explicitly requested resolved damage.'})]);
        return new Response(new ReadableStream({start(controller){waiting=true;options.signal?.addEventListener('abort',()=>controller.error(new Error('Aborted test stream')),{once:true});}}),{headers:{'Content-Type':'text/event-stream'}});
      }));
      await f.runtime.send(f.session.id,'Record 10 damage, then explain it.','synthetic-model');
      await vi.waitFor(()=>expect(waiting).toBe(true),{timeout:5000});
      f.runtime.stop(f.session.id);
      await vi.waitFor(()=>expect(f.runtime.messages(f.session.id).running).toBe(false),{timeout:5000});
      expect(f.runtime.messages(f.session.id).messages.find((m:any)=>m.role==='assistant')?.status).toBe('stopped');
      expect(await f.store.activity.toArray()).toHaveLength(commitFirst?1:0);
      await f.restart();
      expect(((await f.workspace.get('character',f.character.id))!.data as Character).hp).toBe(commitFirst?24:30);
      if(commitFirst){const action=f.runtime.messages(f.session.id).messages.find((m:any)=>m.role==='action')!;await f.runtime.undoAction(String(action.id));}
      expect(sameSheet((await f.workspace.get('character',f.character.id))!.data as Character)).toEqual(sameSheet(f.character));
    }finally{await f.close();}
  });

  it.each([401,429,500])('a provider %s failure leaves the character unchanged and allows a follow-up',async(status)=>{
    const f=await oracleFixture();
    try{
      vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status})));
      await f.runtime.send(f.session.id,'Record 10 damage.','synthetic-model');
      await vi.waitFor(()=>expect(f.runtime.messages(f.session.id).running).toBe(false),{timeout:5000});
      expect(f.runtime.messages(f.session.id).messages.find((m:any)=>m.role==='assistant')?.status).toBe('error');
      expect(await f.store.activity.toArray()).toEqual([]);
      await f.turn(()=>[oracleAnswer],'Continue without making a sheet change.');
      expect(f.runtime.messages(f.session.id).messages.filter((m:any)=>m.role==='assistant').at(-1)?.status).toBe('complete');
      expect(sameSheet((await f.workspace.get('character',f.character.id))!.data as Character)).toEqual(sameSheet(f.character));
    }finally{await f.close();}
  });

  it('recovers from a network failure after committed updates without replaying them',async()=>{
    const f=await oracleFixture();
    try{
      let round=0;
      vi.stubGlobal('fetch',vi.fn(async()=>{
        if(round++===0)return toolStream([toolCall('apply_character_action',{command:{type:'temporary-hp',amount:8},expectedRevision:1,reason:'Grant eight temporary HP.'})]);
        if(round===2)return toolStream([toolCall('apply_character_action',{command:{type:'damage',amount:10},expectedRevision:2,reason:'Record ten damage.'})]);
        throw new TypeError('fetch failed');
      }));
      await f.runtime.send(f.session.id,'Gain 8 temporary HP, take 10 damage, then heal 4.','synthetic-model');
      await vi.waitFor(()=>expect(f.runtime.messages(f.session.id).running).toBe(false),{timeout:5000});
      expect(f.runtime.messages(f.session.id).messages.find((m:any)=>m.role==='assistant')).toMatchObject({status:'error'});
      expect((await f.workspace.get('character',f.character.id))!.data).toMatchObject({hp:28,tempHp:0});
      await f.restart();
      await f.turn((request,next)=>{
        if(next===0)return [toolCall('get_character',{})];
        if(next===1){const read=JSON.parse(request.input.findLast((i:any)=>i.type==='function_call_output').output);expect(read.character.hp).toBe(28);return [toolCall('apply_character_action',{command:{type:'heal',amount:4},expectedRevision:read.revision,reason:'Only the missing healing.'})];}
        return [oracleAnswer];
      },'Apply only the missing four HP healing.');
      expect((await f.workspace.get('character',f.character.id))!.data).toMatchObject({hp:32,tempHp:0});
      expect(await f.store.activity.toArray()).toHaveLength(3);
      expect(f.runtime.messages(f.session.id).messages.filter((m:any)=>m.role==='action')).toHaveLength(3);
    }finally{await f.close();}
  });

  it('retries transient connection failures without repeating a sheet update',async()=>{
    const f=await oracleFixture();let request=0;
    try{
      vi.stubGlobal('fetch',vi.fn(async()=>{
        if(request++<2)throw new TypeError('fetch failed');
        if(request===3)return toolStream([toolCall('apply_character_action',{command:{type:'damage',amount:10},expectedRevision:1,reason:'Record ten damage.'})]);
        return toolStream([oracleAnswer]);
      }));
      await f.runtime.send(f.session.id,'Record 10 damage.','synthetic-model');
      await vi.waitFor(()=>expect(f.runtime.messages(f.session.id).running).toBe(false),{timeout:5000});
      expect(f.runtime.messages(f.session.id).messages.find((m:any)=>m.role==='assistant')?.status).toBe('complete');
      expect(await f.store.activity.toArray()).toHaveLength(1);expect(request).toBe(4);
      expect((await f.workspace.get('character',f.character.id))!.data).toMatchObject({hp:24,tempHp:0});
    }finally{await f.close();}
  });

  it('stopping during connection retry cancels the wait and prevents another request',async()=>{
    const f=await oracleFixture();let attempts=0;
    try{
      vi.stubGlobal('fetch',vi.fn(async()=>{attempts++;throw new TypeError('fetch failed');}));
      await f.runtime.send(f.session.id,'Record 10 damage.','synthetic-model');
      await vi.waitFor(()=>expect(attempts).toBe(1),{timeout:5000,interval:5});
      f.runtime.stop(f.session.id);
      await vi.waitFor(()=>expect(f.runtime.messages(f.session.id).running).toBe(false),{timeout:5000});
      expect(attempts).toBe(1);expect(await f.store.activity.toArray()).toEqual([]);
    }finally{await f.close();}
  });

  it.each([502,503,504])('retries a temporary gateway %s response without creating any sheet action',async(status)=>{
    const f=await oracleFixture();let attempts=0;
    try{
      vi.stubGlobal('fetch',vi.fn(async()=>attempts++===0?new Response('',{status}):toolStream([oracleAnswer])));
      await f.runtime.send(f.session.id,'Explain my options without changing the sheet.','synthetic-model');
      await vi.waitFor(()=>expect(f.runtime.messages(f.session.id).running).toBe(false),{timeout:5000});
      expect(f.runtime.messages(f.session.id).messages.find((m:any)=>m.role==='assistant')?.status).toBe('complete');
      expect(attempts).toBe(2);expect(await f.store.activity.toArray()).toEqual([]);
    }finally{await f.close();}
  });
});
