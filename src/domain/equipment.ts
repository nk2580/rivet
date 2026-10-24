import type { Character,InventoryItem } from './schema';
import type { Calculation } from './character';
type Term=Calculation['terms'][number];
const modifier=(value:number)=>Math.floor((value-10)/2);
const term=(label:string,value:number,source:string):Term=>({label,value,source});
const worn=(c:Character)=>c.inventory.filter(item=>item.equipped&&item.quantity>0&&item.location==='carried');
export function equipmentArmor(c:Character,target:string):Term[]{
  const items=worn(c),armor=items.find(item=>item.category==='armor'&&item.equipSlot==='body'&&item.armor);
  const shields=items.filter(item=>item.category==='shield'&&item.armor&&(!isBuckler(item)||!items.some(other=>other.equipSlot==='two-hands'||(other.category==='weapon'&&other.equipSlot==='off-hand'))));
  const shield=shields.sort((a,b)=>b.armor!.baseAC-a.armor!.baseAC)[0];
  const dex=modifier(c.abilities.dex);const terms:Term[]=[];
  if(c.ruleset==='3.5e'){
    terms.push(term('Base',10,c.rulesVersion));
    const caps=[armor?.armor?.dexCap,shield?.armor?.dexCap].filter((n):n is number=>n!==null&&n!==undefined);
    let allowance=caps.length?Math.min(dex,...caps):dex;
    if(target==='flatFootedArmorClass')allowance=Math.min(0,allowance);
    terms.push(term('Dexterity after armour limits',allowance,c.rulesVersion));
    if(target!=='touchArmorClass'){
      if(armor)terms.push(term(armor.name,armor.armor!.baseAC,c.rulesVersion));
      if(shield)terms.push(term(shield.name,shield.armor!.baseAC,c.rulesVersion));
    }
  }else{
    terms.push(term(armor?.name||'Unarmoured base',armor?.armor?.baseAC??10,c.rulesVersion));
    const cap=armor?.armor?.dexCap??null;
    // Heavy armour ignores both positive and negative Dexterity modifiers.
    terms.push(term('Dexterity allowance',cap===0?0:cap===null?dex:Math.min(dex,cap),c.rulesVersion));
    if(shield&&(c.ruleset==='5e-2014'||c.armorTraining.includes('shield')))terms.push(term(shield.name,shield.armor!.baseAC,c.rulesVersion));
  }
  return terms;
}
function isBuckler(item:InventoryItem){return item.sourceId==='buckler'||item.name.toLowerCase()==='buckler';}
export function equipmentMovement(c:Character):Term[]{
  const armor=worn(c).find(item=>item.category==='armor'&&item.equipSlot==='body'&&item.armor);
  if(!armor)return [];
  if(c.ruleset==='3.5e'){
    // Preserve a reviewed unusual speed rather than invent a conversion.
    const reduced=c.speed===30?armor.armor!.speed30:c.speed===20?armor.armor!.speed20:null;
    return reduced!==null&&reduced!==undefined&&reduced<c.speed?[term(armor.name,reduced-c.speed,c.rulesVersion)]:[];
  }
  if(c.ruleset==='5e-2014'&&/\bdwarf\b/i.test(c.species))return [];
  return c.abilities.str<armor.armor!.strengthRequirement?[term(`${armor.name}: below Strength requirement`,-10,c.rulesVersion)]:[];
}
export function inventoryLoad(c:Character){
  const items=c.inventory.filter(item=>item.location==='carried'&&item.quantity>0);
  return {weight:items.filter(item=>item.weightKnown).reduce((sum,item)=>sum+item.quantity*item.weight,0),unweighed:items.filter(item=>!item.weightKnown).length};
}
export function weaponAttack(c:Character,itemId:string):Term[]{
  const item=c.inventory.find(item=>item.id===itemId);
  if(!item?.weapon)throw new Error('This inventory item has no weapon statistics.');
  const w=item.weapon,str=modifier(c.abilities.str),dex=modifier(c.abilities.dex);
  const ability=w.ability==='finesse'?(dex>str?'dex':'str'):w.ability;
  const terms=[term(ability.toUpperCase(),ability==='dex'?dex:str,c.rulesVersion)];
  if(c.ruleset==='3.5e'){
    terms.push(term('Base attack bonus',c.baseAttackBonus,c.rulesVersion));
    if(!w.proficient)terms.push(term('Not proficient',-4,c.rulesVersion));
  }else if(w.proficient)terms.push(term('Proficiency',2+Math.floor((c.classes.reduce((sum,cl)=>sum+cl.level,0)-1)/4),c.rulesVersion));
  if(w.bonus)terms.push(term('Item bonus',w.bonus,item.name));
  return terms;
}
