import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import { calculate,createCharacter } from '../src/domain/character';
import { applyCharacterCommand } from '../src/domain/commands';
import { characterSchema,type Character } from '../src/domain/schema';
import { equipmentPackSchema,itemFromReference } from '../src/rules/equipment';
async function equipped(version:string,id:string,slot:'body'|'off-hand'|'main-hand'|'two-hands'='body'){
  const pack=equipmentPackSchema.parse(JSON.parse(await readFile(`public/rules/srd-${version}-equipment.json`,'utf8')));
  return {...itemFromReference(pack.items.find(i=>i.id===id)!),equipped:true,equipSlot:slot};
}
describe('edition-specific equipped gear calculations',()=>{
  it('handles medium armour Dexterity limits, negative Dexterity and heavy armour speed requirements',async()=>{
    let c:Character=createCharacter('Mira','5e-2024');c.abilities.dex=18;c.abilities.str=12;
    c.inventory=[await equipped('5.2.1','half-plate-armor'),await equipped('5.2.1','shield','off-hand')];
    expect(calculate(c,'armorClass').total).toBe(19);
    c.abilities.dex=8;expect(calculate(c,'armorClass').total).toBe(16);
    c.inventory[0]=await equipped('5.2.1','plate-armor');expect(calculate(c,'armorClass').total).toBe(20);expect(calculate(c,'speed').total).toBe(20);
    c.abilities.str=15;expect(calculate(c,'speed').total).toBe(30);
    c.overrides.push({id:'dm-ac',target:'armorClass',value:23,reason:'DM-approved magic armour',source:'Session ruling'});
    expect(calculate(c,'armorClass')).toMatchObject({total:23,terms:[{label:'DM-approved magic armour',source:'Session ruling'}]});
  });
  it('applies shield training and dwarf heavy-armour exceptions only in the correct edition',async()=>{
    for(const edition of ['5e-2014','5e-2024'] as const){
      const version=edition==='5e-2014'?'5.1':'5.2.1',c=createCharacter('Torren',edition);c.species='Dwarf';c.abilities.str=10;c.armorTraining=[];
      c.inventory=[await equipped(version,edition==='5e-2014'?'plate':'plate-armor'),await equipped(version,'shield','off-hand')];
      expect(calculate(c,'armorClass').total).toBe(edition==='5e-2014'?20:18);
      expect(calculate(c,'speed').total).toBe(edition==='5e-2014'?30:20);
    }
  });
  it('uses 3.5 armour bonuses, negative Dexterity, touch and flat-footed rules without fifth edition formulas',async()=>{
    const c=createCharacter('Aster','3.5e');c.abilities.dex=18;c.inventory=[await equipped('3.5','full-plate'),await equipped('3.5','shield-tower','off-hand')];
    expect(calculate(c,'armorClass').total).toBe(23);expect(calculate(c,'touchArmorClass').total).toBe(11);expect(calculate(c,'flatFootedArmorClass').total).toBe(22);expect(calculate(c,'speed').total).toBe(20);
    c.abilities.dex=6;expect(calculate(c,'armorClass').total).toBe(20);expect(calculate(c,'flatFootedArmorClass').total).toBe(20);expect(calculate(c,'touchArmorClass').total).toBe(8);
  });
  it('preserves manually reviewed sheets through schema migration and stowing gear changes only equipment calculations',async()=>{
    const c=createCharacter('Legacy','5e-2024');c.armorClass=18;c.inventory=[await equipped('5.2.1','leather-armor')];
    const old=structuredClone(c) as Partial<Character>;delete old.equipmentRules;delete old.armorTraining;
    const imported=characterSchema.parse(old);expect(calculate(imported,'armorClass').total).toBe(18);
    const enabled=applyCharacterCommand(imported,{type:'equipment-rules',enabled:true,armorTraining:[]}).character;expect(calculate(enabled,'armorClass').total).toBe(11);
    const stowed=applyCharacterCommand(enabled,{type:'inventory-equip',itemId:enabled.inventory[0].id,equipped:false,slot:'body',replaceIds:[]}).character;expect(calculate(stowed,'armorClass').total).toBe(10);expect(stowed.armorClass).toBe(18);
  });
  it('uses proficiency correctly for fifth edition attacks and the 3.5 nonproficiency penalty',async()=>{
    for(const [edition,version] of [['5e-2024','5.2.1'],['3.5e','3.5']] as const){
      const c=createCharacter('Vale',edition);c.abilities.str=16;c.inventory=[await equipped(version,'longsword','main-hand')];
      expect(calculate(c,`weapon-attack:${c.inventory[0].id}`).total).toBe(edition==='3.5e'?0:3);
      c.inventory[0].weapon!.proficient=true;expect(calculate(c,`weapon-attack:${c.inventory[0].id}`).total).toBe(edition==='3.5e'?4:5);
    }
  });
});
