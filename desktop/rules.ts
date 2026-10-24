import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
export const editionSchema=z.enum(['5e-2014','5e-2024','3.5e']);
export const searchRulesSchema=z.object({query:z.string().trim().min(1).max(300),edition:editionSchema,kind:z.enum(['all','spell','equipment','magic-item','class','feature','species','background','feat','rule']).default('all'),limit:z.number().int().min(1).max(20).default(8)});
export type SearchRules=z.infer<typeof searchRulesSchema>;
export type RuleSearchResult={id:string;edition:string;kind:string;name:string;page:number|null;document:string|null;version:string;license:string;source_url:string;source_hash:string;excerpt:string;uri:string};
export function buildRulesDatabase(filename:string,directory:string){
  const db=new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=DELETE; BEGIN; DROP TABLE IF EXISTS entries_fts; DROP TABLE IF EXISTS entries; DROP TABLE IF EXISTS sources;
    CREATE TABLE sources(edition TEXT PRIMARY KEY,version TEXT NOT NULL,source_url TEXT NOT NULL,source_hash TEXT NOT NULL,license TEXT NOT NULL,attribution TEXT NOT NULL);
    CREATE TABLE entries(id TEXT UNIQUE NOT NULL,edition TEXT NOT NULL REFERENCES sources(edition),kind TEXT NOT NULL,name TEXT NOT NULL,body TEXT NOT NULL,page INTEGER,document TEXT,payload TEXT NOT NULL);
    CREATE INDEX entries_edition_kind ON entries(edition,kind);
    CREATE VIRTUAL TABLE entries_fts USING fts5(name,body,content='entries',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2');`);
  const insert=db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?)');
  for(const [version,edition] of [['5.1','5e-2014'],['5.2.1','5e-2024'],['3.5','3.5e']]){
    const read=(name:string)=>JSON.parse(readFileSync(join(directory,`srd-${version}-${name}.json`),'utf8'));
    const spells=read('spells'),equipment=read('equipment'),options=read('options'),reference=read('reference');
    db.prepare('INSERT INTO sources VALUES(?,?,?,?,?,?)').run(edition,spells.version,spells.sourceUrl,spells.sourceSha256,spells.license,spells.attribution);
    const add=(kind:string,item:any)=>insert.run(`${edition}:${kind}:${item.id}`,edition,kind,item.name??item.title,item.description??item.text??'',item.page??null,item.document??null,JSON.stringify(item));
    for(const spell of spells.spells)add('spell',spell);
    for(const item of equipment.items)add('equipment',item);
    for(const item of equipment.references??[])add(item.group==='Equipment reference'?'equipment':'magic-item',item);
    for(const group of ['classes','prestigeClasses','species','backgrounds','feats'])for(const item of options[group]??[]){
      add(({classes:'class',prestigeClasses:'class',species:'species',backgrounds:'background',feats:'feat'} as Record<string,string>)[group],item);
      for(const feature of item.features??[])add('feature',{...feature,name:`${item.name}: ${feature.name}`,classId:item.id});
    }
    for(const page of reference.pages){
      if(!page.documentPath){add('rule',{...page,name:`Source page ${page.page}`});continue;}
      const document=JSON.parse(readFileSync(join(directory,page.documentPath.replace('/rules/','')),'utf8'));
      let chunk='',part=0;
      const flush=()=>{if(chunk){add('rule',{id:`${page.id}-${++part}`,name:`${page.title} · section ${part}`,text:chunk,document:page.document,sourceSha256:page.sourceSha256});chunk='';}};
      for(const block of document.blocks){const text=block.type==='paragraph'?block.text:block.rows.map((row:string[])=>row.join(' | ')).join('\n');if(chunk.length+text.length>7000)flush();chunk+=(chunk?'\n\n':'')+text;}flush();
    }
  }
  db.exec("INSERT INTO entries_fts(entries_fts) VALUES('rebuild'); COMMIT; PRAGMA user_version=1;");
  const count=(db.prepare('SELECT count(*) AS count FROM entries').get() as {count:number}).count;db.close();return count;
}
export class RulesDatabase {
  readonly db:DatabaseSync;
  constructor(filename:string){this.db=new DatabaseSync(filename,{readOnly:true});this.db.exec('PRAGMA query_only=ON;');}
  sources(){return this.db.prepare('SELECT * FROM sources ORDER BY edition').all();}
  count(){return (this.db.prepare('SELECT count(*) AS count FROM entries').get() as {count:number}).count;}
  search(input:SearchRules){
    const {query,edition,kind,limit}=searchRulesSchema.parse(input);
    const tokens=query.normalize('NFKC').match(/[\p{L}\p{N}]+/gu)?.slice(0,20)??[];if(!tokens.length)return [];
    const match=tokens.map(token=>'"'+token.replaceAll('"','""')+'"').join(' AND ');
    const rows=this.db.prepare(`SELECT e.id,e.edition,e.kind,e.name,e.page,e.document,s.version,s.license,s.source_url,s.source_hash,
      snippet(entries_fts,1,'','', ' … ',48) AS excerpt
      FROM entries_fts JOIN entries e ON e.rowid=entries_fts.rowid JOIN sources s ON s.edition=e.edition
      WHERE entries_fts MATCH ? AND e.edition=? AND (?='all' OR e.kind=?)
      ORDER BY CASE WHEN lower(e.name)=lower(?) THEN 0 ELSE 1 END,bm25(entries_fts,8,1),length(e.body) LIMIT ?`).all(match,edition,kind,kind,query,limit) as unknown as RuleSearchResult[];
    return rows.map(row=>({...row,uri:`rivet://rules/${encodeURIComponent(String(row.id))}`}));
  }
  get(id:string){
    if(!id||id.length>300)throw new Error('Invalid rule identifier.');
    const row=this.db.prepare('SELECT e.*,s.version,s.license,s.attribution,s.source_url,s.source_hash FROM entries e JOIN sources s ON s.edition=e.edition WHERE e.id=?').get(id) as any;
    if(!row)throw new Error('Rule not found. Search for an entry in the selected edition.');
    const {payload,...result}=row;const {description,text,...data}=JSON.parse(payload);
    if(data.features)data.features=data.features.map(({id:featureId,name,level,page}:any)=>({id:`${row.edition}:feature:${featureId}`,name,level,page}));
    return {...result,data,uri:`rivet://rules/${encodeURIComponent(id)}`};
  }
  close(){this.db.close();}
}
export function rulesSourceDigest(directory:string){return createHash('sha256').update(readdirSync(directory).filter(file=>file.endsWith('.json')).sort().map(file=>readFileSync(join(directory,file))).reduce((all,value)=>Buffer.concat([all,value]),Buffer.alloc(0))).digest('hex');}
