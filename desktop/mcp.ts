import { McpServer,ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { RulesDatabase,searchRulesSchema } from './rules';

const filename=process.env.RIVET_RULES_DB;
if(!filename)throw new Error('RIVET_RULES_DB must identify the local Rivet rules database.');
const rules=new RulesDatabase(filename);
const server=new McpServer({name:'rivet-srd',version:'1.0.0'});
const output=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
server.registerTool('search_rules',{title:'Search edition-specific SRD',description:'Search the local SQLite full-text SRD index. Always specify the character’s edition. Returns source IDs, excerpts, original pages/documents and resource URIs. Use get_rule for full rules before answering.',inputSchema:searchRulesSchema.shape,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async input=>output(rules.search(input)));
server.registerTool('get_rule',{title:'Read a complete SRD entry',description:'Read a rule, spell, item, class, feat or source section using an exact ID returned by search_rules. Includes original source/edition/licence and structured tables when present.',inputSchema:{id:z.string().min(1).max(300)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({id})=>output(rules.get(id)));
server.registerTool('list_sources',{title:'List bundled SRD sources',description:'List locally indexed editions, version hashes, licences and attribution.',inputSchema:{},annotations:{readOnlyHint:true,openWorldHint:false}},async()=>output(rules.sources()));
server.registerResource('sources','rivet://sources',{title:'Rivet SRD source manifest',mimeType:'application/json'},async uri=>({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(rules.sources())}]}));
server.registerResource('rule',new ResourceTemplate('rivet://rules/{id}',{list:undefined}),{title:'Full SRD rule',mimeType:'application/json'},async(uri,variables)=>({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(rules.get(decodeURIComponent(String(variables.id))))}]}));
process.on('exit',()=>rules.close());
void server.connect(new StdioServerTransport());
