import {SpellLevelLabel} from '@/components/SpellLevelLabel';
import { useState } from 'react';
import { BookOpen, ChevronDown,Plus,Pencil,Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { calculate } from '@/domain/character';
import type { Character,CharacterSpell } from '@/domain/schema';
import type { CharacterCommand } from '@/domain/commands';
import { findSpell,useSpellPack } from '@/rules/spells';
import { abilityModifier } from '@/domain/character';
import { signed } from '@/lib/utils';
import { friendlyError } from '@/lib/errors';
import { SpellCatalogue } from './SpellCatalogue';
import { SpellEditor } from './SpellEditor';
import { SpellDescription } from './SpellDescription';
import '@/rules/reference.css';

export function Spellbook({character:c,revision,run}:{character:Character;revision:number;run:(command:CharacterCommand,expectedRevision?:number)=>Promise<unknown>}){
  const [search,setSearch]=useState(''),[catalogue,setCatalogue]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [editing,setEditing]=useState<{spell:CharacterSpell;isNew:boolean;revision:number}|null>(null),[removing,setRemoving]=useState<{spell:CharacterSpell;revision:number}|null>(null);
  const {pack,error:referenceError,retry}=useSpellPack(c.ruleset);
  const execute=async(command:CharacterCommand,expected=revision)=>{if(busy)return;setBusy(true);setError('');try{await run(command,expected);setCatalogue(false);setEditing(null);setRemoving(null);}catch(failure){setError(friendlyError(failure));}finally{setBusy(false);}};
  const spells=c.spells.filter(spell=>spell.name.toLowerCase().includes(search.toLowerCase()));
  return <div><div className="section-heading"><h2>Spellbook</h2><span className="muted">{c.spells.filter(spell=>spell.prepared).length} prepared</span></div>
    <div className="button-row"><Button size="sm" disabled={!pack} onClick={()=>{setError('');setCatalogue(true);}}><BookOpen size={16}/>Browse SRD spells</Button><Button variant="outline" size="sm" onClick={()=>{setError('');setEditing({spell:{id:crypto.randomUUID(),name:'',level:0,castingTime:'',range:'',concentration:false,prepared:false,notes:''},isNew:true,revision});}}><Plus size={16}/>Custom spell</Button></div>
    {c.ruleset!=='3.5e'&&<p className="spellcasting-summary"><span>Spell attack <strong>{signed(calculate(c,'spellAttack').total)}</strong></span><span>Saving throw DC <strong>{calculate(c,'spellDC').total}</strong></span></p>}
    <label className="field search-field"><span className="sr-only">Search your spells</span><input placeholder="Find a spell…" value={search} onChange={event=>setSearch(event.target.value)}/></label>
    <section className="resource-section" aria-label="Spell slots">{c.slots.map(slot=><div className="information-row" key={slot.level}><div><strong>Level {slot.level} spell slots</strong><small>{slot.maximum-slot.spent} / {slot.maximum} available</small></div><Button variant="ghost" size="sm" disabled={slot.spent===0} onClick={()=>{void execute({type:'slot',level:slot.level,change:-1});}}>Restore</Button><Button variant="outline" size="sm" disabled={slot.spent>=slot.maximum} onClick={()=>{void execute({type:'slot',level:slot.level,change:1});}}>Use</Button></div>)}</section>
    {referenceError&&<div className="notice"><p>{referenceError}</p><Button size="sm" variant="outline" onClick={retry}>Retry reference</Button></div>}
    {error&&!catalogue&&!editing&&!removing&&<div className="notice error" role="alert">{error}</div>}
    {spells.map(spell=>{
      const reference=pack?findSpell(pack,spell.sourceId||spell.name):undefined;
      return <article className="spell-entry" key={spell.id}><div className="section-heading"><h3>{spell.name}</h3><SpellLevelLabel level={spell.level} edition={c.ruleset}/></div><p className="muted">{spell.castingTime||reference?.castingTime} · {spell.range||reference?.range}{(reference?.concentration??spell.concentration)?' · Concentration':''}</p>
        {c.ruleset==='3.5e'&&<p className="small-print">Spell DC {10+spell.level+abilityModifier(c.abilities[c.spellAbility])} · 10 + spell level {spell.level} + {c.spellAbility.toUpperCase()} {signed(abilityModifier(c.abilities[c.spellAbility]))}</p>}
        {spell.notes&&<p><span className="small-print">Sheet note · </span>{spell.notes}</p>}<span className="small-print">{spell.prepared?'Prepared':'Not prepared'}</span>
        <div className="equipment-actions"><Button variant={spell.prepared?'secondary':'outline'} size="sm" disabled={busy} onClick={()=>{void execute({type:'spell-prepare',spellId:spell.id,prepared:!spell.prepared});}}>{spell.prepared?'Unprepare':'Prepare'}</Button><Button variant="ghost" size="sm" onClick={()=>{setError('');setEditing({spell,isNew:false,revision});}}><Pencil size={14}/>Edit</Button><Button variant="ghost" size="icon" aria-label={`Remove ${spell.name}`} onClick={()=>{setError('');setRemoving({spell,revision});}}><Trash2 size={16}/></Button></div>
        <details className="reference-description"><summary aria-label={`Full description of ${spell.name}`}><BookOpen size={16}/><span>Full spell description</span><ChevronDown size={16}/></summary>
          {reference&&pack?<SpellDescription reference={reference} pack={pack}/>:<p className="muted">{pack?'This spell has no exact match in this edition’s SRD. Keep its full source text in your sheet notes; your DM can confirm the version.':referenceError||'Loading the edition’s spell reference…'}</p>}
        </details>
      </article>;
    })}
    {!spells.length&&<div className="quiet-empty"><BookOpen size={28}/><div><strong>{search?'No matching spells':'A little room for magic.'}</strong><p>{search?'Try another spell name.':'Add spells from your edition’s reference as you build your character.'}</p></div></div>}
    {pack&&<details className="reference-attribution"><summary>Rules source and attribution</summary><p>{pack.attribution}</p><p>{pack.modifications}</p><a href={pack.licenseUrl} target="_blank" rel="noreferrer">Read {pack.license}</a></details>}
    {catalogue&&pack&&<SpellCatalogue character={c} pack={pack} busy={busy} error={error} onClose={()=>setCatalogue(false)} onAdd={spell=>{void execute({type:'spell-add',spell});}}/>}
    {editing&&<SpellEditor initial={editing.spell} isNew={editing.isNew} error={error} busy={busy} onClose={()=>setEditing(null)} onSave={spell=>{void execute({type:editing.isNew?'spell-add':'spell-update',spell},editing.revision);}}/>}
    <Dialog open={!!removing} onOpenChange={open=>{if(!open)setRemoving(null);}} title="Remove this spell?" description={`Remove ${removing?.spell.name??'this spell'} from this character’s spellbook. You can undo this action in Details.`}>{error&&<div className="notice error" role="alert">{error}</div>}<div className="dialog-actions"><Button variant="outline" onClick={()=>setRemoving(null)}>Keep spell</Button><Button disabled={busy} onClick={()=>{if(removing)void execute({type:'spell-remove',spellId:removing.spell.id},removing.revision);}}>Remove spell</Button></div></Dialog>
  </div>;
}
