import { describe, expect, it } from 'vitest';
import { defaultState } from '../legacy/dist/model.js';
import { migrateLegacy } from '../src/storage/import';
import { recordSchema } from '../src/domain/schema';
describe('non-destructive original Rivet migration',()=>{
  it('preserves character values, sessions, sharing flags and the original source',async()=>{
    const input=defaultState();const result=await migrateLegacy(input);
    const c=result.records.find(r=>r.kind==='character');
    expect(c).toMatchObject({kind:'character',name:'Torren Stonehand',ruleset:'5e-2024',hp:48,maxHp:48,armorClass:18,equipmentRules:false,armorTraining:[],reviewed:false});
    expect(result.records.filter(r=>r.kind==='session')).toHaveLength(1);
    expect(result.records.filter(r=>r.kind==='note')).toHaveLength(3);
    expect(result.records.find(r=>r.kind==='note'&&r.noteType==='ruling')).toMatchObject({shareWithGuide:true,carryForward:true});
    expect(result.source.original).toEqual(input);
    for(const record of result.records)expect(()=>recordSchema.parse(record)).not.toThrow();
  });
  it('uses stable IDs so importing the same backup cannot duplicate records',async()=>{
    const input=defaultState();
    const a=await migrateLegacy(input),b=await migrateLegacy(input);
    expect(a.records.map(r=>r.id)).toEqual(b.records.map(r=>r.id));
  });
  it('rejects corrupt original saves before creating records',async()=>{
    await expect(migrateLegacy({schemaVersion:1,character:{name:'Broken'}})).rejects.toThrow();
  });
});
