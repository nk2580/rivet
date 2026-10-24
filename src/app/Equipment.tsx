import { useState } from 'react';
import { Backpack, Plus, Pencil, Shield, Swords, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EQUIPMENT_CATEGORIES, inventoryItemSchema, type Character, type InventoryItem } from '@/domain/schema';
import type { CharacterCommand } from '@/domain/commands';
import { friendlyError } from '@/lib/errors';
import { signed } from '@/lib/utils';
import { EquipmentCatalogue } from './EquipmentCatalogue';
import { EquipmentCalculations } from './EquipmentCalculations';
import { calculate } from '@/domain/character';
import { EquipmentItemDetails } from './EquipmentItemDetails';
import { EquipmentEditor, equipmentCategories as categories, equipmentSlots as slots, defaultEquipmentSlot as defaultSlot } from './EquipmentEditor';
import { useEquipmentPack } from '@/rules/equipment';
import {CurrencyPurse} from './CurrencyPurse';

function blankItem():InventoryItem{return {id:crypto.randomUUID(),name:'',quantity:1,weight:0,equipped:false,notes:'',location:'carried',weightKnown:true,category:'gear',equipSlot:'carried',attuned:false};}
function blockers(character:Character,item:InventoryItem,slot:InventoryItem['equipSlot']){return character.inventory.filter(other=>other.id!==item.id&&other.equipped&&(['body','main-hand','off-hand','two-hands'].includes(slot))&&(other.equipSlot===slot||(slot==='two-hands'&&['main-hand','off-hand'].includes(other.equipSlot))||(['main-hand','off-hand'].includes(slot)&&other.equipSlot==='two-hands')));}
type Run=(command:CharacterCommand,expectedRevision?:number)=>Promise<unknown>;
export function Equipment({character:c,revision,run}:{character:Character;revision:number;run:Run}){
  const {pack:referencePack,error:referenceError,retry:retryReference}=useEquipmentPack(c.ruleset);
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('all');
  const [catalogue,setCatalogue]=useState(false);
  const [editing,setEditing]=useState<{item:InventoryItem;revision:number;isNew:boolean}|null>(null);
  const [removing,setRemoving]=useState<InventoryItem|null>(null),[importing,setImporting]=useState(false);
  const [equipping,setEquipping]=useState<{item:InventoryItem;slot:InventoryItem['equipSlot'];revision:number}|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [reviewRevision,setReviewRevision]=useState(revision);
  const imported=c.notes.match(/Imported equipment\n([\s\S]*?)(?:\n\n|$)/)?.[1].split('\n').map(line=>line.trim()).filter(Boolean)??[];
  const hasConverted=c.inventory.some(item=>item.sourceId==='legacy-equipment');
  const weight=c.inventory.filter(item=>item.location==='carried'&&item.weightKnown).reduce((total,item)=>total+item.quantity*item.weight,0);
  const unweighed=c.inventory.filter(item=>item.location==='carried'&&!item.weightKnown).length;
  const items=c.inventory.filter(item=>(filter==='all'||(filter==='equipped'?item.equipped:filter==='carried'?item.location==='carried':item.category===filter))&&[item.name,item.notes,item.weapon?.properties].join(' ').toLowerCase().includes(query.toLowerCase())).sort((a,b)=>Number(b.equipped)-Number(a.equipped)||a.name.localeCompare(b.name));
  const apply=async(command:CharacterCommand,expected=revision)=>{if(busy)return;setBusy(true);setError('');try{await run(command,expected);setEditing(null);setRemoving(null);setEquipping(null);setImporting(false);setCatalogue(false);}catch(failure){setError(friendlyError(failure));}finally{setBusy(false);}};
  const equip=async(item:InventoryItem)=>{
    const slot=item.equipSlot==='carried'?defaultSlot(item):item.equipSlot;
    if(!item.equipped&&blockers(c,item,slot).length){setError('');setEquipping({item,slot,revision});return;}
    await apply({type:'inventory-equip',itemId:item.id,equipped:!item.equipped,slot,replaceIds:[]});
  };
  return <div><div className="section-heading"><div><h2>Equipment</h2><p className="small-print">{c.inventory.filter(item=>item.equipped).length} equipped · {Number(weight.toFixed(2))} lb carried{unweighed?` + ${unweighed} unweighed`:''}</p></div><Button size="sm" onClick={()=>{setError('');setEditing({item:blankItem(),revision,isNew:true});}}><Plus size={16}/>Add item</Button></div>
    <CurrencyPurse key={c.id} character={c} revision={revision} run={run}/>
    <Button variant="outline" size="sm" onClick={()=>{setError('');setCatalogue(true);}}>Browse SRD equipment</Button>
    <EquipmentCalculations character={c} busy={busy} onChange={command=>{void apply(command);}}/>
    <div className="notebook-filters"><label className="field"><span className="sr-only">Search inventory</span><input placeholder="Find a weapon or item…" value={query} onChange={event=>setQuery(event.target.value)}/></label><label className="field"><span className="sr-only">Filter inventory</span><select value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">All items</option><option value="equipped">Equipped</option><option value="carried">Carried</option>{EQUIPMENT_CATEGORIES.map(category=><option key={category} value={category}>{categories[category]}</option>)}</select></label></div>
    {error&&!editing&&!equipping&&!removing&&!importing&&<div role="alert" className="notice error">{error}</div>}
    {imported.length>0&&!hasConverted&&<div className="notice"><strong>Your imported equipment list</strong><ul>{imported.map((line,index)=><li key={index}>{line}</li>)}</ul><p>Equipped status and weights were not recorded in the original list. Review them before relying on your loadout.</p><Button size="sm" variant="outline" onClick={()=>{setError('');setReviewRevision(revision);setImporting(true);}}>Review imported list</Button></div>}
    <div className="equipment-list">{items.map(item=><article key={item.id} className="equipment-entry"><div className="section-heading"><div><h3>{item.category==='weapon'?<Swords size={17}/>:item.category==='armor'||item.category==='shield'?<Shield size={17}/>:<Backpack size={17}/>} {item.name}</h3><p className="small-print">{categories[item.category]} · Qty {item.quantity} · {item.weightKnown?`${item.weight} lb each`:'Weight unconfirmed'}</p></div><span className={`tag ${item.equipped?'equipped-tag':''}`}>{item.equipped?`Equipped · ${slots[item.equipSlot]}`:item.location==='stored'?'Stored':'Carried'}</span></div>
      {item.weapon&&<p className="weapon-summary"><strong>{item.weapon.damage} {item.weapon.damageType}</strong><span>Attack modifier {signed(calculate(c,`weapon-attack:${item.id}`).total)}</span>{item.weapon.range&&<span>{item.weapon.range}</span>}{item.weapon.bonus!==0&&<span>{signed(item.weapon.bonus)} item bonus</span>}</p>}
      <div className="equipment-actions"><Button variant={item.equipped?'secondary':'outline'} size="sm" disabled={busy||(!item.equipped&&(item.quantity===0||item.location==='stored'))} onClick={()=>{void equip(item);}}>{item.equipped?'Stow':'Equip'}</Button><Button size="sm" variant="ghost" onClick={()=>{setError('');setEditing({item,revision,isNew:false});}}><Pencil size={14}/>Edit</Button><Button size="icon" variant="ghost" aria-label={`Remove ${item.name}`} onClick={()=>{setError('');setReviewRevision(revision);setRemoving(item);}}><Trash2 size={16}/></Button>{item.attuned&&<span className="tag">Attuned</span>}</div>
      <EquipmentItemDetails character={c} item={item} pack={referencePack} referenceError={referenceError} retryReference={retryReference}/>
    </article>)}</div>
    {!items.length&&<div className="quiet-empty"><Backpack size={28}/><div><strong>{query?'No matching items':'Pack for the road ahead.'}</strong><p>{query?'Try another name or filter.':'Add your weapons, armour, tools, and supplies. Equipped items are clearly marked.'}</p></div></div>}
    {referencePack&&<details className="reference-attribution"><summary>Rules source and attribution</summary><p>{referencePack.attribution}</p><p>{referencePack.modifications}</p><a href={referencePack.licenseUrl} target="_blank" rel="noreferrer">Read {referencePack.license}</a></details>}
    {editing&&<EquipmentEditor initial={editing.item} isNew={editing.isNew} fifth={c.ruleset!=='3.5e'} busy={busy} error={error} onClose={()=>setEditing(null)} onSave={item=>{void apply({type:editing.isNew?'inventory-add':'inventory-update',item},editing.revision);}}/>}
    {catalogue&&<EquipmentCatalogue edition={c.ruleset} busy={busy} error={error} onClose={()=>setCatalogue(false)} onAdd={item=>{void apply({type:'inventory-add',item});}}/>}
    <Dialog open={!!removing} onOpenChange={open=>{if(!open)setRemoving(null);}} title="Remove this item?" description={`Remove ${removing?.quantity??''} × ${removing?.name??'this item'} from this character’s inventory. You can undo this action in Details.`}>{error&&<div role="alert" className="notice error">{error}</div>}<div className="dialog-actions"><Button variant="outline" onClick={()=>setRemoving(null)}>Keep item</Button><Button disabled={busy} onClick={()=>{if(removing)void apply({type:'inventory-remove',itemId:removing.id},reviewRevision);}}>Remove item</Button></div></Dialog>
    <Dialog open={!!equipping} onOpenChange={open=>{if(!open)setEquipping(null);}} title={`Equip ${equipping?.item.name??'item'}?`} description={`Using ${equipping?slots[equipping.slot].toLowerCase():'this slot'} will stow ${equipping?blockers(c,equipping.item,equipping.slot).map(item=>item.name).join(', '):''}.`}>{error&&<div role="alert" className="notice error">{error}</div>}<div className="dialog-actions"><Button variant="outline" onClick={()=>setEquipping(null)}>Keep loadout</Button><Button disabled={busy} onClick={()=>{if(equipping)void apply({type:'inventory-equip',itemId:equipping.item.id,equipped:true,slot:equipping.slot,replaceIds:blockers(c,equipping.item,equipping.slot).map(item=>item.id)},equipping.revision);}}>Equip and stow</Button></div></Dialog>
    <Dialog open={importing} onOpenChange={setImporting} title="Review the imported list" description="These entries will become carried items. Nothing will be equipped automatically, and unknown weights stay clearly marked."><ul>{imported.map((line,index)=><li key={index}>{line}</li>)}</ul>{error&&<div role="alert" className="notice error">{error}</div>}<div className="dialog-actions"><Button variant="outline" onClick={()=>setImporting(false)}>Keep original list</Button><Button disabled={busy} onClick={()=>{void apply({type:'inventory-import',items:imported.map(name=>inventoryItemSchema.parse({id:crypto.randomUUID(),name,quantity:1,weight:0,weightKnown:false,equipped:false,notes:'Imported from the original equipment list. Confirm the item, weight, properties and equipped status with your DM.',sourceId:'legacy-equipment'}))},reviewRevision);}}>Add carried items</Button></div></Dialog>
  </div>;
}
