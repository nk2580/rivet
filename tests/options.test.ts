import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import { optionsPackSchema,searchOptions } from '../src/rules/options';
describe('versioned character-option source boundaries',()=>{
  it('inventories every core class and feat, including 3.5 headings with inconsistent font sizes',async()=>{
    for(const [version,classes,prestige,species,backgrounds,feats] of [['5.1',12,0,9,1,1],['5.2.1',12,0,9,4,17],['3.5',11,15,7,0,110]] as const){const pack=optionsPackSchema.parse(JSON.parse(await readFile(`public/rules/srd-${version}-options.json`,'utf8')));expect(pack.classes).toHaveLength(classes);expect(pack.prestigeClasses).toHaveLength(prestige);expect(pack.species).toHaveLength(species);expect(pack.backgrounds).toHaveLength(backgrounds);expect(pack.feats).toHaveLength(feats);for(const group of ['classes','prestigeClasses','species','backgrounds','feats'] as const){expect(new Set(pack[group].map(item=>item.id)).size).toBe(pack[group].length);for(const item of pack[group])expect(item.description.length,item.name).toBeGreaterThan(10);}
      if(version==='3.5'){expect(searchOptions(pack.feats,'Cleave').some(item=>item.name==='Cleave [General]')).toBe(true);expect(pack.feats.find(item=>item.name==='Acrobatic [General]')?.description).not.toContain('AGILE [GENERAL]');expect(pack.feats.find(item=>item.name==='Maximize Spell [Metamagic]')?.description).not.toContain('MOBILITY [GENERAL]');}
      if(version==='5.1')expect(pack.classes.find(item=>item.id==='wizard')?.description).not.toContain('Beyond 1st Level');
      if(version==='5.2.1'){expect(pack.species.find(item=>item.id==='human')?.description).not.toContain('Fiendish Legacies');expect(pack.species.find(item=>item.id==='tiefling')?.description).toContain('Infernal You have Resistance to Fire damage');}
    }
  });
});
