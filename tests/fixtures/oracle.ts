import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {vi,expect} from 'vitest';
import {SQLiteStore} from '../../desktop/sqlite';
import {AssistantRuntime} from '../../desktop/assistant';
import {Workspace} from '../../src/storage/workspace';
import {createCharacter} from '../../src/domain/character';
import {inventoryItemSchema,type Character,type RulesetId} from '../../src/domain/schema';
import {castingCharacter} from './casting';

export const oracleItem=(id:string,fields:Record<string,unknown>={})=>inventoryItemSchema.parse({id,name:id,quantity:1,weight:2,equipped:false,notes:'PRIVATE ITEM NOTE',...fields});
export const oraclePaths={exec:process.execPath,mcp:resolve('dist-electron/mcp.cjs'),rules:resolve('dist-electron/rules.sqlite')};
export const oracleAuth={token:async()=>'synthetic-test-token',status:async()=>({active:'synthetic-account'})};
export const toolCall=(name:string,args:unknown,callId=crypto.randomUUID())=>({type:'function_call',id:crypto.randomUUID(),call_id:callId,name,arguments:JSON.stringify(args)});
export const toolStream=(output:unknown[])=>new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output}})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
export const oracleAnswer={type:'message',role:'assistant',content:[{type:'output_text',text:'Test turn complete.'}]};

export function oracleCharacter(edition:RulesetId):Character{
  const c=createCharacter('Oracle acceptance fixture',edition),spells=castingCharacter().spells;
  c.hp=30;c.maxHp=48;c.tempHp=4;
  c.copper=3;c.silver=10;c.electrum=2;c.gold=25;c.platinum=1;
  c.spells=spells;c.spells[2].notes='PRIVATE SPELL NOTE';
  c.slots=[{level:1,maximum:4,spent:1},{level:3,maximum:2,spent:1},{level:4,maximum:1,spent:0}];
  c.resources=[{id:'channel',name:'Channel Divinity',maximum:2,spent:1,reset:'short',shortRecovery:1}];
  c.conditions=['Poisoned'];
  c.inventory=[oracleItem('sword',{equipped:true,equipSlot:'main-hand',category:'weapon'}),oracleItem('shield',{equipped:true,equipSlot:'off-hand',category:'shield'}),oracleItem('rope',{quantity:2}),oracleItem('plate',{category:'armor',armor:{baseAC:18,dexCap:0,strengthRequirement:15,stealthDisadvantage:true}}),oracleItem('greatsword',{category:'weapon'})];
  if(edition!=='3.5e'){
    c.concentration='Bless';c.effects=[{id:'bless',name:'Bless',source:'fixture',duration:'1 minute',notes:'',modifiers:[],concentration:true,spellId:'bless',slotLevel:1}];
    if(c.ruleset!=='3.5e')c.deathSaves={successes:1,failures:1};
  }
  return c;
}

export async function oracleFixture(edition:RulesetId='5e-2024'){
  const directory=await mkdtemp(join(tmpdir(),'rivet-oracle-acceptance-')),filename=join(directory,'workspace.sqlite');
  let store=new SQLiteStore(filename),workspace=new Workspace(store.asWorkspaceStore(),'local',true);
  const events:any[]=[],requests:any[]=[],character=oracleCharacter(edition);
  await workspace.save(character,0);
  const other=createCharacter('Unrelated character','5e-2024');await workspace.save(other,0);
  const makeRuntime=()=>new AssistantRuntime(store,workspace,oracleAuth as any,oraclePaths,event=>events.push(event));
  let runtime=makeRuntime();const session=await runtime.create(character.id,'Oracle acceptance');
  return {
    directory,filename,character,other,events,requests,session,
    get store(){return store;},get workspace(){return workspace;},get runtime(){return runtime;},
    async turn(output:(request:any,round:number)=>unknown[],prompt='Perform the explicitly requested acceptance action.'){
      let round=0;
      vi.stubGlobal('fetch',vi.fn(async(_url:string,options:RequestInit)=>{
        const request=JSON.parse(String(options.body));requests.push(request);
        return toolStream(output(request,round++));
      }));
      await runtime.send(session.id,prompt,'synthetic-model');
      await vi.waitFor(()=>expect(runtime.messages(session.id).running).toBe(false),{timeout:10000,interval:10});
      return runtime.messages(session.id);
    },
    async restart(){await runtime.close();store.close();store=new SQLiteStore(filename);workspace=new Workspace(store.asWorkspaceStore(),'local',true);runtime=makeRuntime();},
    async close(){await runtime.close();store.close();await rm(directory,{recursive:true,force:true});vi.unstubAllGlobals();},
  };
}
export const sameSheet=(character:Character)=>({...character,updatedAt:'ignored'});
