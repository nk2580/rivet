import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import { findSpell,packSchema,spellFromReference,type SpellPack } from '../src/rules/spells';
import { createCharacter } from '../src/domain/character';
import { applyCharacterCommand } from '../src/domain/commands';
describe('source-backed edition spell packs',()=>{
  it('inventories all 319 SRD 5.1 and 339 SRD 5.2.1 spell entries with complete casting metadata',async()=>{
    for(const [version,edition,count] of [['5.1','5e-2014',319],['5.2.1','5e-2024',339]] as const){
      const pack:SpellPack=JSON.parse(await readFile(`public/rules/srd-${version}-spells.json`,'utf8'));
      expect(pack.edition).toBe(edition);expect(pack.spells).toHaveLength(count);expect(new Set(pack.spells.map(spell=>spell.id)).size).toBe(count);
      expect(pack.license).toBe('CC-BY-4.0');expect(pack.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      for(const spell of pack.spells){expect(spell.classes.length,spell.name).toBeGreaterThan(0);expect(spell.description.trim().length,spell.name).toBeGreaterThan(10);expect(spell.components,spell.name).not.toBe('');expect(spell.range,spell.name).not.toBe('');expect(spell.duration,spell.name).not.toBe('');expect(spell.description).not.toContain('System Reference Document');expect(spell.description).not.toContain('Berserker Axe');}
    }
  });
  it('preserves edition changes instead of reusing the 2014 text for a 2024 sheet',async()=>{
    const old:SpellPack=JSON.parse(await readFile('public/rules/srd-5.1-spells.json','utf8')),modern:SpellPack=JSON.parse(await readFile('public/rules/srd-5.2.1-spells.json','utf8'));
    expect(old.spells.find(spell=>spell.id==='cure-wounds')?.description).toContain('1d8');expect(modern.spells.find(spell=>spell.id==='cure-wounds')?.description).toContain('2d8');
    expect(old.spells.find(spell=>spell.id==='spiritual-weapon')?.concentration).toBe(false);expect(modern.spells.find(spell=>spell.id==='spiritual-weapon')?.concentration).toBe(true);
    expect(modern.spells.find(spell=>spell.id==='guiding-bolt')).toMatchObject({page:138,components:'V, S',duration:'1 round',description:expect.stringContaining('Using a Higher-Level Spell Slot.')});
  });
  it('retains all 605 archived core 3.5e spells, class levels, variant bases, tables and the original license',async()=>{
    const pack=packSchema.parse(JSON.parse(await readFile('public/rules/srd-3.5-spells.json','utf8')));
    expect(pack.spells).toHaveLength(605);expect(new Set(pack.spells.map(s=>s.id)).size).toBe(605);
    expect(pack.license).toBe('OGL-1.0a');
    expect(findSpell(pack,'Mass Cure Critical Wounds')).toMatchObject({baseSpellId:'cure-light-wounds-mass',castingTime:'1 standard action',classLevels:{cleric:8,druid:9,'domain:healing':8}});
    expect(findSpell(pack,'Bear’s Endurance, Mass')).toMatchObject({baseSpellId:'bear-s-endurance',duration:'1 min./level'});
    expect(findSpell(pack,'Scrying')).toMatchObject({duration:'1 min./level',metadata:{Effect:'Magical sensor'}});
    expect(findSpell(pack,'Magic Aura')?.metadata?.Target).toBe('One touched object weighing up to 5 lb./level');
    expect(findSpell(pack,'Overland Flight')).toMatchObject({baseSpellId:'fly',castingTime:'1 standard action'});
    const missing=pack.spells.flatMap(s=>['castingTime','range','components','duration'].filter(key=>!s[key as keyof typeof s]).map(key=>[s.name,key]));
    // This one omission exists in the source; do not invent a source value.
    expect(missing).toEqual([['Confusion, Lesser','castingTime']]);
    for(const spell of pack.spells){if(spell.baseSpellId)expect(findSpell(pack,spell.baseSpellId),spell.name).toBeDefined();expect(spell.description.length,spell.name).toBeGreaterThan(15);}
    expect(findSpell(pack,'Scrying')?.blocks?.some(block=>block.type==='table')).toBe(true);
    const license=await readFile('public/rules/OGL-1.0a.txt','utf8');expect(license).toContain('OPEN GAME LICENSE');expect(license).toContain('COPYRIGHT NOTICE');
  });
  it('uses the selected 3.5e casting class level and keeps preparation, removal and duplicate boundaries deterministic',async()=>{
    const pack=packSchema.parse(JSON.parse(await readFile('public/rules/srd-3.5-spells.json','utf8'))),reference=findSpell(pack,'Cure Light Wounds')!;
    expect(()=>spellFromReference(reference,'wizard')).toThrow('casting class');
    const spell=spellFromReference(reference,'ranger');expect(spell).toMatchObject({level:2,castingClass:'ranger',prepared:false,sourceId:'cure-light-wounds'});
    const c=createCharacter('Aster','3.5e'),added=applyCharacterCommand(c,{type:'spell-add',spell}).character;
    expect(()=>applyCharacterCommand(added,{type:'spell-add',spell:{...spell,id:'duplicate'}})).toThrow('already');
    const ready=applyCharacterCommand(added,{type:'spell-prepare',spellId:spell.id,prepared:true}).character;expect(ready.spells[0].prepared).toBe(true);expect(added.spells[0].prepared).toBe(false);
    expect(applyCharacterCommand(ready,{type:'spell-remove',spellId:spell.id}).character.spells).toEqual([]);
  });
});
