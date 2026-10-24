import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { chmodSync } from 'node:fs';
import type { RivetDatabase } from '../src/storage/database';
import { recordSchema } from '../src/domain/schema';
import { requireReadableVersion } from '../src/storage/version';

type Row={key:string;[key:string]:unknown};
const tables=['documents','activity','meta','conflicts','outbox'] as const;
export type TableName=typeof tables[number];
export class SQLiteStore {
  readonly connection:DatabaseSync;
  readonly documents:SQLiteTable;readonly activity:SQLiteTable;readonly meta:SQLiteTable;readonly conflicts:SQLiteTable;readonly outbox:SQLiteTable;
  private tail:Promise<unknown>=Promise.resolve();
  private context=new AsyncLocalStorage<boolean>();
  constructor(filename:string){
    this.connection=new DatabaseSync(filename);
    if(filename!==':memory:')chmodSync(filename,0o600);
    this.connection.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
    for(const table of tables)this.connection.exec(`CREATE TABLE IF NOT EXISTS ${table}(key TEXT PRIMARY KEY,payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;`);
    this.documents=new SQLiteTable(this,'documents');this.activity=new SQLiteTable(this,'activity');this.meta=new SQLiteTable(this,'meta');this.conflicts=new SQLiteTable(this,'conflicts');this.outbox=new SQLiteTable(this,'outbox');
    this.connection.exec("PRAGMA user_version=1;");
  }
  /** The legacy domain workspace uses this small table API; data lives only in SQLite. */
  asWorkspaceStore(){return this as unknown as RivetDatabase;}
  table(name:unknown){if(!tables.includes(name as TableName))throw new Error('Unknown workspace table.');return this[name as TableName];}
  transaction<T>(...args:unknown[]):Promise<T>{
    const action=args.at(-1) as ()=>Promise<T>;
    if(this.context.getStore())return action();
    const run=this.tail.then(()=>this.context.run(true,async()=>{this.connection.exec('BEGIN IMMEDIATE');try{const value=await action();this.connection.exec('COMMIT');return value;}catch(error){this.connection.exec('ROLLBACK');throw error;}}));
    this.tail=run.catch(()=>{});return run;
  }
  close(){this.connection.close();}
}
class SQLiteTable {
  constructor(private db:SQLiteStore,readonly name:TableName){}
  private parse(payload:string):Row{const row=JSON.parse(payload);if(this.name==='documents'||this.name==='outbox'){requireReadableVersion(row.writerVersion);row.data=recordSchema.parse(row.data);}return row;}
  async get(key:string){const row=this.db.connection.prepare(`SELECT payload FROM ${this.name} WHERE key=?`).get(key) as {payload:string}|undefined;return row?this.parse(row.payload):undefined;}
  async put(row:Row){this.db.connection.prepare(`INSERT INTO ${this.name}(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload`).run(row.key,JSON.stringify(row));return row.key;}
  async add(row:Row){this.db.connection.prepare(`INSERT INTO ${this.name}(key,payload) VALUES(?,?)`).run(row.key,JSON.stringify(row));return row.key;}
  async delete(key:string){this.db.connection.prepare(`DELETE FROM ${this.name} WHERE key=?`).run(key);}
  async toArray(){return (this.db.connection.prepare(`SELECT payload FROM ${this.name} ORDER BY key`).all() as {payload:string}[]).map(row=>this.parse(row.payload));}
  where(field:string){return new SQLiteQuery(this,field);}
}
class SQLiteQuery {
  private filter:(row:Row)=>boolean=()=>true;private reversed=false;
  constructor(private table:SQLiteTable,private field:string){}
  equals(value:unknown){this.filter=row=>this.field.startsWith('[')?JSON.stringify(this.field.slice(1,-1).split('+').map(key=>row[key]))===JSON.stringify(value):row[this.field]===value;return this;}
  startsWith(prefix:string){this.filter=row=>typeof row[this.field]==='string'&&String(row[this.field]).startsWith(prefix);return this;}
  reverse(){this.reversed=!this.reversed;return this;}
  async toArray(){const rows=(await this.table.toArray()).filter(this.filter);return this.reversed?rows.reverse():rows;}
  async sortBy(field:string){const rows=(await this.table.toArray()).filter(this.filter).sort((a,b)=>String(a[field]).localeCompare(String(b[field])));return this.reversed?rows.reverse():rows;}
}
