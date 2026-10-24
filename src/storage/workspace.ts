import { z } from 'zod';
import { recordSchema,type AppRecord,type Character,type RecordKind } from '@/domain/schema';
import { applyCharacterCommand,characterCommandSchema,type CharacterCommand } from '@/domain/commands';
import { validateSourceArchive } from './import';
import { CLIENT_DATA_VERSION } from './version';
import type { RivetDatabase,DocumentEntry,ActivityEntry,ConflictEntry } from './database';
const recoveryArchiveSchema=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),local:recordSchema,remote:recordSchema.nullable(),remoteRevision:z.number().int().min(0),at:z.string().datetime()}).refine(copy=>!copy.remote||(copy.remote.id===copy.local.id&&copy.remote.kind===copy.local.kind),'Recovery records must refer to the same document.');
export type RecoveryCopy=z.infer<typeof recoveryArchiveSchema>;

export const documentKey = (ownerUid: string, kind: RecordKind, id: string) => `${ownerUid}/${kind}/${id}`;
export class StaleRevisionError extends Error { constructor() {super('This record changed. Review the current version before applying your change.'); this.name = 'StaleRevisionError';} }
export class CommandIdentityError extends Error { constructor() {super('That action ID was already used for a different request.'); this.name = 'CommandIdentityError';} }

export class Workspace {
  constructor(readonly db: RivetDatabase, readonly ownerUid: string, readonly localOnly=false) { if (!ownerUid) throw new Error('A workspace identity is required.'); }
  async list<T extends AppRecord = AppRecord>(kind: T['kind']): Promise<DocumentEntry[]> {
    return (await this.db.documents.where('[ownerUid+kind]').equals([this.ownerUid, kind]).toArray()).filter(d => !d.deleted);
  }
  async get(kind: RecordKind, id: string) { return this.db.documents.get(documentKey(this.ownerUid, kind, id)); }
  async save(input: AppRecord, expectedRevision?: number) {
    const data = recordSchema.parse(input);
    return this.db.transaction('rw', this.db.documents, this.db.outbox, async () => this.putWithinTransaction(data, expectedRevision));
  }
  async saveMany(changes:{data:AppRecord;expectedRevision:number}[]) {
    const parsed=changes.map(change=>({...change,data:recordSchema.parse(change.data)}));
    if(new Set(parsed.map(change=>`${change.data.kind}/${change.data.id}`)).size!==parsed.length)throw new Error('A record cannot be changed twice in the same action.');
    return this.db.transaction('rw',this.db.documents,this.db.outbox,async()=>{
      const saved:DocumentEntry[]=[];
      for(const change of parsed)saved.push(await this.putWithinTransaction(change.data,change.expectedRevision));
      return saved;
    });
  }
  private async putWithinTransaction(data: AppRecord, expectedRevision?: number, undoHead?: string, deleted=false): Promise<DocumentEntry> {
    data=recordSchema.parse(data);
    const key = documentKey(this.ownerUid, data.kind, data.id);
    const previous = await this.db.documents.get(key);
    if (expectedRevision !== undefined && (previous?.localRevision ?? 0) !== expectedRevision) throw new StaleRevisionError();
    const entry: DocumentEntry = {key, ownerUid: this.ownerUid, kind: data.kind, id: data.id, data,writerVersion:CLIENT_DATA_VERSION,localRevision: (previous?.localRevision ?? 0) + 1, cloudRevision: previous?.cloudRevision ?? 0, dirty: !this.localOnly, deleted, ...(undoHead ? {undoHead} : {}), ...(previous?.submittedOperations ? {submittedOperations: previous.submittedOperations} : {})};
    await this.db.documents.put(entry);
    if(!this.localOnly)await this.db.outbox.put({key, ownerUid: this.ownerUid, operationId: crypto.randomUUID(), baseRevision: entry.cloudRevision, localRevision: entry.localRevision, data, deleted,writerVersion:CLIENT_DATA_VERSION});
    return entry;
  }
  async execute(characterId: string, command: CharacterCommand, expectedRevision: number, commandId: string = crypto.randomUUID()) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(commandId)) throw new Error('Invalid action ID.');
    const parsedCommand = characterCommandSchema.parse(command);
    const commandSignature = JSON.stringify(parsedCommand);
    return this.db.transaction('rw', this.db.documents, this.db.outbox, this.db.activity, async () => {
      const receiptKey = `${this.ownerUid}/${commandId}`;
      const existing = await this.db.activity.get(receiptKey);
      if (existing) {
        if (existing.characterId !== characterId || existing.commandSignature !== commandSignature) throw new CommandIdentityError();
        return existing;
      }
      const entry = await this.get('character', characterId);
      if (!entry || entry.deleted || entry.data.kind !== 'character') throw new Error('Character not found.');
      if (entry.localRevision !== expectedRevision) throw new StaleRevisionError();
      await this.validateCharacterReferences(parsedCommand);
      const result = applyCharacterCommand(entry.data, parsedCommand);
      const saved = await this.putWithinTransaction(result.character, expectedRevision, receiptKey);
      const receipt: ActivityEntry = {key: receiptKey, ownerUid: this.ownerUid, characterId, commandId, commandSignature, ...(entry.undoHead ? {parentUndoKey: entry.undoHead} : {}), summary: result.summary, reminders: result.reminders, before: entry.data, resultingRevision: saved.localRevision, at: new Date().toISOString(), undone: false};
      await this.db.activity.add(receipt);
      return receipt;
    });
  }
  async validateCharacterReferences(command:CharacterCommand){
    if(command.type==='character-update'&&command.changes.campaignId){
      const campaign=await this.get('campaign',command.changes.campaignId);
      if(!campaign||campaign.deleted)throw new Error('Choose an active campaign in this workspace.');
    }
  }
  async undo(receiptKey: string) {
    return this.db.transaction('rw', this.db.documents, this.db.outbox, this.db.activity, async () => {
      const receipt = await this.db.activity.get(receiptKey);
      if (!receipt || receipt.ownerUid !== this.ownerUid || receipt.undone) throw new Error('That change cannot be undone.');
      const current = await this.get('character', receipt.characterId);
      if (!current || current.deleted || (current.undoHead !== receipt.key && !(current.undoHead === undefined && receipt.commandSignature === undefined && current.localRevision === receipt.resultingRevision))) throw new Error('A newer edit exists. Undo is available only for the latest action on this character.');
      await this.putWithinTransaction({...receipt.before, updatedAt: new Date().toISOString()}, current.localRevision, receipt.parentUndoKey);
      await this.db.activity.put({...receipt, undone: true});
    });
  }
  async setDeleted(kind: RecordKind, id: string, deleted: boolean, expectedRevision: number) {
    return this.db.transaction('rw', this.db.documents, this.db.outbox, async () => {
      const current = await this.get(kind, id);
      if (!current || current.localRevision !== expectedRevision) throw new StaleRevisionError();
      if (current.deleted === deleted) return current;
      return this.putWithinTransaction({...current.data, updatedAt: new Date().toISOString()}, expectedRevision, undefined, deleted);
    });
  }
  async exportBackup() {
    return this.db.transaction('r',this.db.documents,this.db.meta,async()=>{
      const documents=await this.db.documents.where('ownerUid').equals(this.ownerUid).toArray();
      const records=documents.filter(d=>!d.deleted).map(d=>d.data),archivedRecords=documents.filter(d=>d.deleted).map(d=>d.data);
      const sourceArchives=(await this.db.meta.where('key').startsWith(`source/${this.ownerUid}/`).toArray()).map(entry=>validateSourceArchive(entry.value));
      const recoveryCopies=(await this.db.meta.where('key').startsWith(`recovery/${this.ownerUid}/`).toArray()).map(entry=>recoveryArchiveSchema.parse({...(entry.value as ConflictEntry),id:entry.key.split('/').at(-1)}));
      return {format:'rivet-workspace',schemaVersion:2,exportedAt:new Date().toISOString(),records,archivedRecords,sourceArchives,recoveryCopies};
    });
  }
  async importRecords(records: unknown[], sourceArchives:unknown[] = [],recoveryCopies:unknown[]=[],archivedRecords:unknown[]=[]) {
    if (!Array.isArray(records)||!Array.isArray(archivedRecords)||records.length+archivedRecords.length>10000) throw new Error('This backup has too many records.');
    if(!Array.isArray(sourceArchives)||sourceArchives.length>100)throw new Error('Invalid source archives in backup.');
    if(!Array.isArray(recoveryCopies)||recoveryCopies.length>10000)throw new Error('Invalid recovery copies in backup.');
    const parsed = [...records.map(record=>({data:recordSchema.parse(record),deleted:false})),...archivedRecords.map(record=>({data:recordSchema.parse(record),deleted:true}))];
    const sources=sourceArchives.map(validateSourceArchive);
    const recoveries=recoveryCopies.map(copy=>recoveryArchiveSchema.parse(copy));
    const keys = new Set(parsed.map(({data}) => `${data.kind}/${data.id}`));
    if (keys.size !== parsed.length) throw new Error('The backup contains duplicate records.');
    return this.db.transaction('rw', this.db.documents, this.db.outbox, this.db.meta, async () => {
      let imported = 0;
      for(const source of sources){
        const key=`source/${this.ownerUid}/${source.id}`;
        const existing=await this.db.meta.get(key);
        if(existing){if(JSON.stringify(validateSourceArchive(existing.value).original)!==JSON.stringify(source.original))throw new Error('A source archive ID already belongs to a different backup.');}
        else await this.db.meta.put({key,value:source});
      }
      for(const copy of recoveries){
        const key=`recovery/${this.ownerUid}/${copy.id}`;
        if(!await this.db.meta.get(key))await this.db.meta.put({key,value:{key:documentKey(this.ownerUid,copy.local.kind,copy.local.id),ownerUid:this.ownerUid,local:copy.local,remote:copy.remote,remoteRevision:copy.remoteRevision,at:copy.at}});
      }
      for (const {data:record,deleted} of parsed) {
        const current = await this.get(record.kind, record.id);
        if (current) continue; // Existing records and deletion decisions are never replaced by import.
        await this.putWithinTransaction(record, 0,undefined,deleted); imported++;
      }
      return imported;
    });
  }
}
