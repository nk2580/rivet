import { useState,type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EQUIPMENT_CATEGORIES,EQUIPMENT_SLOTS,inventoryItemSchema,type InventoryItem } from '@/domain/schema';
import { friendlyError } from '@/lib/errors';

export const equipmentCategories={weapon:'Weapon',armor:'Armour',shield:'Shield',ammunition:'Ammunition',tool:'Tool',gear:'Adventuring gear',treasure:'Treasure'};
export const equipmentSlots={carried:'Readied','main-hand':'Main hand','off-hand':'Off hand','two-hands':'Both hands',body:'Body',worn:'Worn'};
export function defaultEquipmentSlot(item:InventoryItem):InventoryItem['equipSlot']{return item.category==='armor'?'body':item.category==='shield'?'off-hand':item.category==='weapon'?(item.weapon?.properties.toLowerCase().includes('two-handed')?'two-hands':'main-hand'):'worn';}

export function EquipmentEditor({initial,isNew,fifth,busy,error,onClose,onSave}:{initial:InventoryItem;isNew:boolean;fifth:boolean;busy:boolean;error:string;onClose:()=>void;onSave:(item:InventoryItem)=>void}){
  const [category,setCategory]=useState(initial.category),[slot,setSlot]=useState(initial.equipSlot==='carried'?defaultEquipmentSlot(initial):initial.equipSlot),[localError,setLocalError]=useState('');
  const submit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setLocalError('');const form=new FormData(event.currentTarget);
    const value=(name:string)=>String(form.get(name)??'');const n=(name:string)=>Number(form.get(name));const checked=(name:string)=>form.get(name)==='on';
    try{
      const weapon=category==='weapon'?{...initial.weapon,damage:value('damage'),smallDamage:!fifth?value('smallDamage'):undefined,critical:!fifth?value('critical'):undefined,damageType:value('damageType'),properties:value('properties'),range:value('range'),ability:value('ability'),proficient:checked('proficient'),bonus:n('bonus')}:undefined;
      const armor=category==='armor'||category==='shield'?{...initial.armor,baseAC:n('baseAC'),dexCap:value('dexCap')==='full'?null:n('dexCap'),strengthRequirement:fifth?n('strengthRequirement'):0,stealthDisadvantage:fifth&&checked('stealthDisadvantage'),checkPenalty:!fifth?n('checkPenalty'):0,arcaneFailure:!fifth?n('arcaneFailure'):0,speed30:!fifth&&value('speed30')!==''?n('speed30'):null,speed20:!fifth&&value('speed20')!==''?n('speed20'):null}:undefined;
      onSave(inventoryItemSchema.parse({...initial,name:value('name').trim(),category,quantity:n('quantity'),weight:n('weight'),weightKnown:checked('weightKnown'),location:value('location'),equipSlot:value('slot'),attuned:fifth&&checked('attuned'),notes:value('notes'),weapon,armor}));
    }catch(failure){setLocalError(friendlyError(failure));}
  };
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}} title={isNew?'Add equipment':`Edit ${initial.name}`} description="Record your item’s source values. Damage notation describes the weapon; resolve outcomes at the table.">
    <form onSubmit={submit}>
      {(localError||error)&&<div role="alert" className="notice error">{localError||error}</div>}
      <label className="field">Item name<input name="name" required maxLength={200} defaultValue={initial.name} autoFocus/></label>
      <label className="field">Category<select value={category} onChange={event=>{const next=event.target.value as InventoryItem['category'];setCategory(next);setSlot(defaultEquipmentSlot({...initial,category:next}));}}>{EQUIPMENT_CATEGORIES.map(value=><option key={value} value={value}>{equipmentCategories[value]}</option>)}</select></label>
      <div className="form-grid"><label className="field">Quantity<input name="quantity" type="number" min={0} max={99999} step={1} required defaultValue={initial.quantity}/></label><label className="field">Weight per item (lb)<input name="weight" type="number" min={0} max={99999} step="any" required defaultValue={initial.weight}/></label></div>
      <label className="check-field"><input type="checkbox" name="weightKnown" defaultChecked={initial.weightKnown}/>Weight has been confirmed</label>
      <div className="form-grid"><label className="field">Location<select name="location" defaultValue={initial.location}><option value="carried">Carried</option><option value="stored">Stored elsewhere</option></select></label><label className="field">Equipped slot<select name="slot" value={slot} onChange={event=>setSlot(event.target.value as InventoryItem['equipSlot'])}>{EQUIPMENT_SLOTS.map(value=><option key={value} value={value}>{equipmentSlots[value]}</option>)}</select></label></div>
      {category==='weapon'&&<fieldset><legend>Weapon details</legend><div className="form-grid">
        <label className="field">{fifth?'Damage expression':'Medium damage'}<input name="damage" maxLength={200} defaultValue={initial.weapon?.damage||''} placeholder="For example, 1d8"/></label>
        {!fifth&&<><label className="field">Small damage<input name="smallDamage" maxLength={200} defaultValue={initial.weapon?.smallDamage||''}/></label><label className="field">Critical<input name="critical" maxLength={200} defaultValue={initial.weapon?.critical||''} placeholder="For example, 19–20/x2"/></label></>}
        <label className="field">Damage type<input name="damageType" maxLength={200} defaultValue={initial.weapon?.damageType||''} placeholder="For example, slashing"/></label>
        <label className="field">Range / reach<input name="range" maxLength={200} defaultValue={initial.weapon?.range||''}/></label>
        <label className="field">Attack ability<select name="ability" defaultValue={initial.weapon?.ability||'str'}><option value="str">Strength</option><option value="dex">Dexterity</option><option value="finesse">Finesse choice (best of STR / DEX)</option></select></label>
        <label className="field">Item bonus<input name="bonus" type="number" min={-20} max={20} required defaultValue={initial.weapon?.bonus||0}/></label>
      </div><label className="field">Properties<input name="properties" maxLength={2000} defaultValue={initial.weapon?.properties||''} placeholder="Finesse, light, versatile…"/></label><label className="check-field"><input type="checkbox" name="proficient" defaultChecked={initial.weapon?.proficient}/>Proficient with this weapon</label></fieldset>}
      {(category==='armor'||category==='shield')&&<fieldset><legend>Armour details</legend><div className="form-grid">
        <label className="field">{category==='shield'?'Shield AC bonus':fifth?'Base AC':'Armour AC bonus'}<input name="baseAC" type="number" min={0} max={99} required defaultValue={initial.armor?.baseAC??(category==='shield'?2:fifth?10:0)}/></label>
        <label className="field">Dexterity allowance<select name="dexCap" defaultValue={initial.armor?.dexCap??'full'}><option value="full">Full modifier</option>{(fifth?[0,2]:Array.from({length:21},(_,i)=>i)).map(value=><option key={value} value={value}>{value===0&&fifth?'No Dexterity modifier':`Maximum +${value}`}</option>)}</select></label>
        {fifth?<label className="field">Strength required<input name="strengthRequirement" type="number" min={0} max={100} defaultValue={initial.armor?.strengthRequirement||0}/></label>:<>
          <label className="field">Armour check penalty<input name="checkPenalty" type="number" min={-20} max={0} required defaultValue={initial.armor?.checkPenalty??0}/></label>
          <label className="field">Arcane spell failure (%)<input name="arcaneFailure" type="number" min={0} max={100} required defaultValue={initial.armor?.arcaneFailure??0}/></label>
          <label className="field">Armoured speed (base 30 ft)<input name="speed30" type="number" min={0} max={30} defaultValue={initial.armor?.speed30??''} placeholder="Unchanged"/></label>
          <label className="field">Armoured speed (base 20 ft)<input name="speed20" type="number" min={0} max={20} defaultValue={initial.armor?.speed20??''} placeholder="Unchanged"/></label>
        </>}
      </div>{fifth&&<label className="check-field"><input name="stealthDisadvantage" type="checkbox" defaultChecked={initial.armor?.stealthDisadvantage}/>Disadvantage on Stealth</label>}</fieldset>}
      {fifth&&<label className="check-field"><input type="checkbox" name="attuned" defaultChecked={initial.attuned}/>Attuned to this item</label>}
      <label className="field">Description and table notes<textarea name="notes" maxLength={10000} defaultValue={initial.notes} placeholder="Full item description, special properties, and rulings…"/></label>
      <div className="dialog-actions"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy?'Saving…':isNew?'Add item':'Save item'}</Button></div>
    </form>
  </Dialog>;
}
