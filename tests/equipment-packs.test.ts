import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import { equipmentPackSchema,findEquipmentReference,itemFromReference } from '../src/rules/equipment';
const read=async(version:string)=>equipmentPackSchema.parse(JSON.parse(await readFile(`public/rules/srd-${version}-equipment.json`,'utf8')));
describe('source-backed equipment catalogues',()=>{
  it('shows SRD descriptions for imported names independently of their personal notes or legacy source marker',async()=>{
    const modern=await read('5.2.1');
    for(const [name,id,content] of [['Plate armour','plate-armor','Armor Class'],['Holy symbol','holy-symbol','Spellcasting Focus'],['Smith’s tools','smith-s-tools','Craft:'],['Goggles of the Night','goggles-of-night','Darkvision']] as const){
      const reference=findEquipmentReference(modern,{name,sourceId:'legacy-equipment'});expect(reference,name).toMatchObject({id,description:expect.stringContaining(content)});
    }
    expect(findEquipmentReference(modern,{name:'Goggles of the Night'})?.description).not.toContain('Hammer of Thunderbolts');
    expect(findEquipmentReference(await read('5.1'),{name:'Plate armour'})).toMatchObject({id:'plate'});
    const third=findEquipmentReference(await read('3.5'),{name:'Goggles of the Night'});expect(third).toMatchObject({document:'MagicItemsV.rtf',description:expect.stringContaining('12,000 gp')});expect(third?.description).not.toContain('Hammer of Thunderbolts');
    expect(findEquipmentReference(modern,{name:'A completely custom item'})).toBeUndefined();
  });
  it('inventories the parsed source rows without splitting long prices or full waterskin weights',async()=>{
    for(const [version,count,weapons,armor] of [['5.1',191,37,13],['5.2.1',182,38,13],['3.5',207,73,18]] as const){
      const pack=await read(version);expect(pack.items).toHaveLength(count);expect(new Set(pack.items.map(i=>i.id)).size).toBe(count);
      expect(pack.items.filter(i=>i.category==='weapon')).toHaveLength(weapons);expect(pack.items.filter(i=>['armor','shield'].includes(i.category))).toHaveLength(armor);
      expect(pack.items.find(i=>i.id==='spyglass')).toMatchObject({name:'Spyglass',costGp:1000,weight:1});
      expect(pack.items.find(i=>i.id==='waterskin')).toMatchObject({name:'Waterskin',weight:version==='3.5'?4:5});
      for(const reference of pack.items){expect(reference.description.length,reference.name).toBeGreaterThan(10);expect(itemFromReference(reference),reference.name).toMatchObject({equipped:false,location:'carried',quantity:1,sourceId:reference.id});}
    }
  });
  it('keeps fifth edition and 3.5e armour, damage, criticals and footnotes separate',async()=>{
    const old=await read('5.1'),modern=await read('5.2.1'),third=await read('3.5');
    expect(old.items.find(i=>i.id==='plate')).toMatchObject({name:'Plate',costGp:1500,armor:{baseAC:18,dexCap:0,strengthRequirement:15}});
    expect(modern.items.find(i=>i.id==='plate-armor')).toMatchObject({armor:{baseAC:18}});
    expect(third.items.find(i=>i.id==='full-plate')).toMatchObject({weight:50,armor:{baseAC:8,dexCap:1,checkPenalty:-6,arcaneFailure:35,speed30:20}});
    expect(third.items.find(i=>i.id==='shield-tower')).toMatchObject({armor:{baseAC:4,dexCap:2}});
    expect(third.items.find(i=>i.id==='bolas')).toMatchObject({weapon:{damage:'1d4',smallDamage:'1d3',properties:'Nonlethal'}});
    expect(third.items.find(i=>i.id==='shield-light')).toMatchObject({weightKnown:false,costGp:null});
    expect(modern.items.find(i=>i.id==='trident')?.weapon?.damage).toBe('1d8');expect(old.items.find(i=>i.id==='trident')?.weapon?.damage).toBe('1d6');
    expect(modern.items.find(i=>i.id==='longsword')?.description).toContain('Disadvantage');
    expect(old.items.find(i=>i.id==='longsword')?.description).toContain('two hands');
    expect(modern.items.find(i=>i.id==='musket')).toMatchObject({weight:10,costGp:500,weapon:{properties:expect.stringContaining('Two-Handed')}});
    expect(modern.items.find(i=>i.id==='entertainer-s-pack')).toMatchObject({weight:58.5});
    expect(old.items.find(i=>i.id==='crossbow-bolts-20')).toMatchObject({weight:1.5});
    expect(modern.items.find(i=>i.id==='bolts-20')).toMatchObject({weight:1.5,category:'ammunition'});
    expect(old.items.find(i=>i.id==='priest-s-pack')).toMatchObject({costGp:19,weightKnown:false});expect(modern.items.find(i=>i.id==='priest-s-pack')).toMatchObject({costGp:33,weightKnown:true});
  });
});
