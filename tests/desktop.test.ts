import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { afterEach,describe,expect,it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SQLiteStore } from '../desktop/sqlite';
import { RulesDatabase } from '../desktop/rules';
import { Workspace } from '../src/storage/workspace';
import { createCharacter } from '../src/domain/character';
import { responseEvents } from '../desktop/stream';

const temporary:string[]=[];
afterEach(()=>{for(const path of temporary.splice(0))rmSync(path,{recursive:true,force:true});});
describe('local desktop SQLite workspace',()=>{
  it('persists actions and undo across restarts, rejects stale edits, and never queues cloud writes',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'rivet-sqlite-test-'));temporary.push(directory);const filename=join(directory,'workspace.sqlite');
    let db=new SQLiteStore(filename),workspace=new Workspace(db.asWorkspaceStore(),'local',true);const c=createCharacter('Desktop test','5e-2024');
    await workspace.save(c,0);const receipt=await workspace.execute(c.id,{type:'damage',amount:3},1,'resolved-damage');
    expect((await workspace.execute(c.id,{type:'damage',amount:3},1,'resolved-damage')).key).toBe(receipt.key);
    expect((await workspace.get('character',c.id))?.data).toMatchObject({hp:7});expect(await db.outbox.toArray()).toEqual([]);
    await expect(workspace.save({...c,name:'Stale'},1)).rejects.toThrow('changed');db.close();
    db=new SQLiteStore(filename);workspace=new Workspace(db.asWorkspaceStore(),'local',true);await workspace.undo(receipt.key);
    expect((await workspace.get('character',c.id))?.data).toMatchObject({hp:10});await workspace.setDeleted('character',c.id,true,3);const backup=await workspace.exportBackup();expect(backup.records).toHaveLength(0);expect(backup.archivedRecords).toHaveLength(1);
    await workspace.setDeleted('character',c.id,false,4);expect(await workspace.list('character')).toHaveLength(1);db.close();
  });
  it('rolls an entire compound change back when one revision is stale',async()=>{
    const db=new SQLiteStore(':memory:'),workspace=new Workspace(db.asWorkspaceStore(),'local',true),a=createCharacter('First','3.5e'),b=createCharacter('Second','5e-2014');
    await workspace.saveMany([{data:a,expectedRevision:0},{data:b,expectedRevision:0}]);
    await expect(workspace.saveMany([{data:{...a,name:'Do not retain'},expectedRevision:1},{data:b,expectedRevision:0}])).rejects.toThrow('changed');
    expect((await workspace.get('character',a.id))?.data.name).toBe('First');db.close();
  });
  it('serializes simultaneous window commands and rolls back nested import failures',async()=>{
    const db=new SQLiteStore(':memory:'),first=new Workspace(db.asWorkspaceStore(),'local',true),second=new Workspace(db.asWorkspaceStore(),'local',true),c=createCharacter('Two windows','5e-2024');await first.save(c,0);
    const results=await Promise.allSettled([first.execute(c.id,{type:'damage',amount:2},1),second.execute(c.id,{type:'damage',amount:3},1)]);expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
    const other=createCharacter('Atomic import','3.5e');await expect(db.transaction(async()=>{await first.importRecords([other]);throw new Error('Invalid guide attachment');})).rejects.toThrow('Invalid guide');expect(await first.get('character',other.id)).toBeUndefined();db.close();
  });
});
describe('local SQLite SRD and actual MCP transport',()=>{
  it('searches edition-separated sources with citations and treats SQL/FTS syntax as text',()=>{
    const rules=new RulesDatabase('dist-electron/rules.sqlite');expect(rules.count()).toBeGreaterThan(5000);
    const modern=rules.search({query:'Cure Wounds',edition:'5e-2024',kind:'spell',limit:8}),old=rules.search({query:'Cure Wounds',edition:'5e-2014',kind:'spell',limit:8});
    expect(rules.get(String(modern[0].id)).body).toContain('2d8');expect(rules.get(String(old[0].id)).body).toContain('1d8');
    const feat=rules.search({query:'Power Attack',edition:'3.5e',kind:'feat',limit:8});expect(feat.some((entry:any)=>entry.name==='Power Attack [General]')).toBe(true);
    expect(rules.get(String(feat[0].id))).toMatchObject({edition:'3.5e',license:'OGL-1.0a',document:'Feats.rtf'});
    const syntax=rules.search({query:"\" OR 1=1; DROP TABLE sources; --",edition:'5e-2024',kind:'all',limit:8});expect(syntax.every(row=>row.edition==='5e-2024')).toBe(true);expect(rules.sources()).toHaveLength(3);expect(rules.count()).toBeGreaterThan(5000);rules.close();
  });
  it('discovers tools, calls SQLite lookup and reads the matching MCP source resource over stdio',async()=>{
    const client=new Client({name:'rivet-acceptance',version:'1.0.0'}),transport=new StdioClientTransport({command:process.execPath,args:[resolve('dist-electron/mcp.cjs')],env:{RIVET_RULES_DB:resolve('dist-electron/rules.sqlite')},stderr:'pipe'});
    try{await client.connect(transport);expect((await client.listTools()).tools.map(tool=>tool.name)).toEqual(['search_rules','get_rule','list_sources']);
      const result=await client.callTool({name:'search_rules',arguments:{query:'Guiding Bolt',edition:'5e-2024',kind:'spell',limit:3}});const entries=JSON.parse((result.content as any[])[0].text);expect(entries[0].version).toBe('SRD-5.2.1');
      const source=await client.readResource({uri:entries[0].uri});expect(JSON.parse((source.contents[0] as any).text)).toMatchObject({name:'Guiding Bolt',edition:'5e-2024',body:expect.stringContaining('Radiant')});
      const invalid=await client.callTool({name:'search_rules',arguments:{query:'test',edition:'not-an-edition'}});expect(invalid.isError).toBe(true);
    }finally{await client.close();}
  });
});
describe('assistant streaming boundaries',()=>{
  it('parses frames split at arbitrary bytes and preserves non-ASCII text',async()=>{
    const data=new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"café"}\r\n\r\ndata: {"type":"response.completed","response":{"output":[]}}\n\n');
    const stream=new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<data.length;i++)controller.enqueue(data.slice(i,i+1));controller.close();}}),events=[];
    for await(const event of responseEvents(stream))events.push(event);expect(events).toEqual([{type:'response.output_text.delta',delta:'café'},{type:'response.completed',response:{output:[]}}]);
  });
});
