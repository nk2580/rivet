import { Backpack,ChevronDown,ExternalLink } from 'lucide-react';
import { calculate } from '@/domain/character';
import type { Character,InventoryItem } from '@/domain/schema';
import { signed } from '@/lib/utils';
import { findEquipmentReference,type EquipmentPack } from '@/rules/equipment';
import { Button } from '@/components/ui/button';

export function EquipmentItemDetails({character:c,item,pack,referenceError,retryReference}:{character:Character;item:InventoryItem;pack:EquipmentPack|null;referenceError:string;retryReference:()=>void}){
  const reference=pack?findEquipmentReference(pack,item):undefined;
  const third=c.ruleset==='3.5e';const armor=item.armor,weapon=item.weapon;
  const values:[string,string|number][]=[];
  if(weapon){values.push(['Damage',`${weapon.damage} ${weapon.damageType}`],['Range / reach',weapon.range||'See weapon source'],['Properties',weapon.properties||'None recorded'],['Proficiency',weapon.proficient?'Proficient':'Not marked proficient']);if(third&&weapon.smallDamage)values.push(['Small-size damage',weapon.smallDamage]);if(weapon.critical)values.push(['Critical',weapon.critical]);}
  if(armor){values.push([item.category==='shield'?'Shield AC bonus':third?'Armour AC bonus':'Base armour class',armor.baseAC],['Dexterity allowance',armor.dexCap===null?'Full modifier':!third&&armor.dexCap===0?'No Dexterity modifier':`Maximum +${armor.dexCap}`]);
    if(third)values.push(['Armour check penalty',signed(armor.checkPenalty)],['Arcane spell failure',`${armor.arcaneFailure}%`],['Armoured speed (base 30 / 20 ft)',`${armor.speed30??'Unchanged'} / ${armor.speed20??'Unchanged'}`]);
    else values.push(['Strength required',armor.strengthRequirement||'None'],['Stealth',armor.stealthDisadvantage?'Disadvantage':'No armour disadvantage']);
  }
  return <details className="reference-description"><summary><Backpack size={16}/><span>{reference?'SRD description & item details':'Item details'}</span><ChevronDown size={16}/></summary>
    {values.length>0&&<dl className="reference-metadata">{values.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}
    {weapon&&<details><summary>Attack modifier calculation</summary><ul className="calculation-terms">{calculate(c,`weapon-attack:${item.id}`).terms.map((t,index)=><li key={index}><span>{t.label}</span><span>{signed(t.value)}</span></li>)}</ul></details>}
    {reference&&pack&&<section className="inventory-source-description"><h4>SRD description · {reference.name}</h4><div className="preserve-text reference-body">{reference.description}</div><a className="source-link" href={`${pack.sourceUrl}${reference.page?`#page=${reference.page}`:''}`} target="_blank" rel="noreferrer">{pack.version.replace('SRD-','SRD ')} · {reference.page?`page ${reference.page}`:reference.document}<ExternalLink size={13}/></a></section>}
    {!reference&&<p className="small-print">{referenceError||(!pack?'Loading the edition’s SRD description…':'No exact SRD reference matches this item’s name. Record a custom description in your notes or check the item’s name.')}{referenceError&&<Button variant="outline" size="sm" onClick={retryReference}>Retry reference</Button>}</p>}
    <h4>Your item notes</h4><p className="preserve-text">{item.notes||'No personal notes recorded.'}</p>
  </details>;
}
