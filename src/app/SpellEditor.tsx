import { useState,type FormEvent } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { spellSchema,type CharacterSpell } from '@/domain/schema';
import { friendlyError } from '@/lib/errors';

export function SpellEditor({initial,isNew,error,busy,onClose,onSave}:{initial:CharacterSpell;isNew:boolean;error:string;busy:boolean;onClose:()=>void;onSave:(spell:CharacterSpell)=>void}){
  const [localError,setLocalError]=useState('');
  const submit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setLocalError('');const form=new FormData(event.currentTarget);const value=(key:string)=>String(form.get(key)??'');
    try{onSave(spellSchema.parse({...initial,name:value('name').trim(),level:Number(form.get('level')),castingTime:value('castingTime'),range:value('range'),castingClass:value('castingClass')||undefined,prepared:form.get('prepared')==='on',concentration:form.get('concentration')==='on',notes:value('notes')}));}catch(failure){setLocalError(friendlyError(failure));}
  };
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}} title={isNew?'Add a custom spell':`Edit ${initial.name}`} description="Record the version and casting values your table uses. Sheet notes stay separate from the published SRD reference."><form onSubmit={submit}>
    {(localError||error)&&<div className="notice error" role="alert">{localError||error}</div>}
    <label className="field">Spell name<input autoFocus name="name" required maxLength={200} defaultValue={initial.name}/></label>
    <div className="form-grid"><label className="field">Spell level<select name="level" defaultValue={initial.level}>{Array.from({length:10},(_,i)=><option key={i} value={i}>{i===0?'Cantrip / level 0':`Level ${i}`}</option>)}</select></label><label className="field">Casting class<input name="castingClass" maxLength={80} defaultValue={initial.castingClass??''} placeholder="For example, cleric"/></label><label className="field">Casting time<input name="castingTime" maxLength={200} defaultValue={initial.castingTime}/></label><label className="field">Range<input name="range" maxLength={200} defaultValue={initial.range}/></label></div>
    <label className="check-field"><input type="checkbox" name="prepared" defaultChecked={initial.prepared}/>Prepared / ready to use</label><label className="check-field"><input type="checkbox" name="concentration" defaultChecked={initial.concentration}/>Requires concentration</label>
    <label className="field">Description and sheet notes<textarea name="notes" maxLength={20000} defaultValue={initial.notes} placeholder="Custom spell text, scaling for your character, and table rulings…"/></label>
    <div className="dialog-actions"><Button onClick={onClose} variant="outline">Cancel</Button><Button type="submit" disabled={busy}>{busy?'Saving…':'Save spell'}</Button></div>
  </form></Dialog>;
}
