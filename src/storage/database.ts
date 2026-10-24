import Dexie, { type EntityTable } from 'dexie';
import { recordSchema, type AppRecord, type Character, type RecordKind } from '@/domain/schema';
import { requireReadableVersion } from './version';

export type DocumentEntry = {
  key: string; ownerUid: string; kind: RecordKind; id: string; data: AppRecord;
  localRevision: number; cloudRevision: number; dirty: boolean; deleted: boolean;
  undoHead?: string;
  submittedOperations?: {operationId: string; baseRevision: number}[];
  writerVersion?:number;
};
export type PendingEntry = {key: string; ownerUid: string; operationId: string; baseRevision: number; localRevision: number; data: AppRecord; deleted: boolean;writerVersion?:number};
export type ActivityEntry = {key: string; ownerUid: string; characterId: string; commandId: string; commandSignature?: string; parentUndoKey?: string; summary: string; reminders: string[]; before: Character; resultingRevision: number; at: string; undone: boolean};
export type ConflictEntry = {key: string; ownerUid: string; local: AppRecord; remote: AppRecord | null; remoteRevision: number; at: string};
export type MetaEntry = {key: string; value: unknown};
export class RivetDatabase extends Dexie {
  documents!: EntityTable<DocumentEntry, 'key'>;
  outbox!: EntityTable<PendingEntry, 'key'>;
  activity!: EntityTable<ActivityEntry, 'key'>;
  conflicts!: EntityTable<ConflictEntry, 'key'>;
  meta!: EntityTable<MetaEntry, 'key'>;
  constructor(name = 'rivet-workspace-v2') {
    super(name);
    this.version(1).stores({
      documents: 'key, ownerUid, [ownerUid+kind], [ownerUid+id]',
      outbox: 'key, ownerUid', activity: 'key, ownerUid, [ownerUid+characterId], at',
      conflicts: 'key, ownerUid', meta: 'key',
    });
    // Parse additive defaults at every read, including an offline first launch
    // after an app update. No database reset or destructive migration is needed.
    this.documents.hook('reading',entry=>{if(!entry)return entry;requireReadableVersion(entry.writerVersion);return {...entry,data:recordSchema.parse(entry.data)};});
    this.outbox.hook('reading',entry=>{if(!entry)return entry;requireReadableVersion(entry.writerVersion);return {...entry,data:recordSchema.parse(entry.data)};});
  }
}
export const database = new RivetDatabase();
export { Workspace,documentKey,StaleRevisionError,CommandIdentityError } from './workspace';
export type { RecoveryCopy } from './workspace';
