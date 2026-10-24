import {afterEach, describe, expect, it} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SQLiteStore} from '../desktop/sqlite';
import {Workspace} from '../src/storage/workspace';
import {createCharacter} from '../src/domain/character';
import {characterSchema} from '../src/domain/schema';
import {MAX_PORTRAIT_DATA_LENGTH, portraitPrompt, portraitSchema, validatePortraitFile} from '../src/domain/portrait';

const portrait = {dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII='};
const directories: string[] = [];
afterEach(() => {for (const path of directories.splice(0)) rmSync(path, {recursive: true, force: true});});

describe('local character portraits', () => {
  it('preserves a portrait across SQLite restart, ordinary sheet actions and portable backup restore', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rivet-portrait-')); directories.push(directory);
    const path = join(directory, 'workspace.sqlite');
    const c = createCharacter('Portrait test', '5e-2024');
    let db = new SQLiteStore(path), workspace = new Workspace(db.asWorkspaceStore(), 'local', true);
    await workspace.save({...c, portrait}, 0);
    db.close();
    db = new SQLiteStore(path); workspace = new Workspace(db.asWorkspaceStore(), 'local', true);
    try {
      expect((await workspace.get('character', c.id))?.data).toMatchObject({portrait});
      await workspace.execute(c.id, {type: 'damage', amount: 2}, 1, 'portrait-damage');
      const backup = JSON.parse(JSON.stringify(await workspace.exportBackup()));
      const restoredDb = new SQLiteStore(':memory:');
      try {
        const restored = new Workspace(restoredDb.asWorkspaceStore(), 'local', true);
        await restored.importRecords(backup.records);
        expect((await restored.get('character', c.id))?.data).toMatchObject({hp: 8, portrait});
        await restored.save({...backup.records[0], portrait: null}, 1);
        expect((await restored.get('character', c.id))?.data).toMatchObject({portrait: null});
        expect(await restoredDb.outbox.toArray()).toEqual([]);
      } finally {restoredDb.close();}
      await expect(workspace.save({...c, portrait: null}, 1)).rejects.toThrow('changed');
      expect((await workspace.get('character', c.id))?.data).toMatchObject({hp: 8, portrait});
    } finally {db.close();}
  });
  it('keeps older characters readable and rejects remote, executable or oversized portrait payloads', () => {
    expect(characterSchema.parse(createCharacter('Existing', '3.5e')).portrait).toBeUndefined();
    for (const dataUrl of ['https://example.test/tracker.png', 'file:///private/portrait.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,AAAA', 'data:image/png;base64,' + 'A'.repeat(MAX_PORTRAIT_DATA_LENGTH)]) {
      expect(portraitSchema.safeParse({dataUrl}).success).toBe(false);
    }
    expect(portraitSchema.parse(portrait)).toEqual(portrait);
    expect(() => validatePortraitFile({type: 'image/svg+xml', size: 10})).toThrow('PNG');
    expect(() => validatePortraitFile({type: 'image/png', size: 0})).toThrow('empty');
    expect(() => validatePortraitFile({type: 'image/png', size: 11 * 1024 * 1024})).toThrow('10 MB');
  });
  it('suggests a concise editable prompt from identity, without sending private character details', () => {
    const c = {...createCharacter('Torren Stonehand', '5e-2024'), species: 'Goliath', classes: [{name: 'Cleric', level: 5, classId: 'cleric'}], backstory: 'PRIVATE-BACKSTORY', notes: 'PRIVATE-NOTES'};
    const prompt = portraitPrompt(c);
    expect(prompt).toContain('Torren Stonehand, Goliath Cleric');
    expect(prompt.length).toBeLessThan(400);
    expect(prompt).not.toContain('PRIVATE');
    expect(portraitPrompt({...c, name: 'Long '.repeat(40), species: 'Species '.repeat(40), classes: Array.from({length: 20}, (_, i) => ({name: 'Class ' + i}))}).length).toBeLessThan(400);
  });
});
