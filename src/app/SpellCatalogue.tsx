import { useState } from 'react';
import { BookOpen,Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { rulesetNames,type Character,type CharacterSpell } from '@/domain/schema';
import { spellFromReference,type SpellPack } from '@/rules/spells';
import { SpellDescription } from './SpellDescription';

const className=(value:string)=>value.replace('domain:','Domain: ').replace(/\b[a-z]/g,letter=>letter.toUpperCase());
export function SpellCatalogue({character:c,pack,busy,error,onClose,onAdd}:{character:Character;pack:SpellPack;busy:boolean;error:string;onClose:()=>void;onAdd:(spell:CharacterSpell)=>void}){
  const classes=[...new Set(pack.spells.flatMap(spell=>spell.classes.map(value=>value.toLowerCase())))].sort();
  const [query,setQuery]=useState(''),[castingClass,setCastingClass]=useState(c.classes.find(cl=>classes.includes(cl.classId))?.classId||''),[level,setLevel]=useState('all'),[limit,setLimit]=useState(20),[localError,setLocalError]=useState('');
  const spells=pack.spells.filter(spell=>(!castingClass||spell.classes.some(value=>value.toLowerCase()===castingClass))&&(level==='all'||(spell.classLevels?.[castingClass]??spell.level)===Number(level))&&[spell.name,...spell.aliases].join(' ').toLowerCase().includes(query.toLowerCase()));
  const add=(reference:SpellPack['spells'][number],sourceClass:string)=>{try{setLocalError('');onAdd(spellFromReference(reference,sourceClass));}catch(failure){setLocalError(failure instanceof Error?failure.message:'Choose a casting class.');}};
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}} title="Spell catalogue" description={`${rulesetNames[c.ruleset]} SRD spells. Confirm your class’s spell access, known spells and preparation limits before readying a spell.`}>
    <label className="field"><span className="sr-only">Search spell catalogue</span><input autoFocus placeholder="Search spell names…" value={query} onChange={event=>{setQuery(event.target.value);setLimit(20);}}/></label>
    <div className="form-grid"><label className="field">Casting class<select value={castingClass} onChange={event=>{setCastingClass(event.target.value);setLimit(20);}}><option value="">All classes</option>{classes.map(value=><option key={value} value={value}>{className(value)}</option>)}</select></label><label className="field">Spell level<select value={level} onChange={event=>{setLevel(event.target.value);setLimit(20);}}><option value="all">All levels</option>{Array.from({length:10},(_,i)=><option key={i} value={i}>{i===0?'Cantrips / level 0':`Level ${i}`}</option>)}</select></label></div>
    {(error||localError)&&<div className="notice error" role="alert">{error||localError}</div>}
    <p className="small-print">{spells.length} spells · New spells start unprepared.</p>
    {spells.slice(0,limit).map(reference=>{
      const sourceClass=castingClass||c.classes.find(cl=>reference.classLevels?.[cl.classId]!==undefined)?.classId||Object.keys(reference.classLevels??{})[0]||'';
      return <article key={reference.id} className="catalogue-entry"><div className="section-heading"><div><h3>{reference.name}</h3><p className="small-print">{reference.school} · Level {reference.classLevels?.[sourceClass]??reference.level}{reference.classLevels?` · ${className(sourceClass)}`:''}</p></div><Button variant="outline" size="sm" disabled={busy} aria-label={`Add ${reference.name} to spellbook`} onClick={()=>add(reference,sourceClass)}><Plus size={15}/>Add</Button></div><details className="reference-description"><summary><BookOpen size={16}/><span>Full spell description</span></summary><SpellDescription reference={reference} pack={pack}/></details></article>;
    })}
    {spells.length>limit&&<Button variant="outline" onClick={()=>setLimit(value=>value+20)}>Show more spells ({limit} / {spells.length})</Button>}
    {!spells.length&&<p className="muted">No spells match these filters.</p>}
    <details className="reference-attribution"><summary>Rules source and attribution</summary><p>{pack.attribution}</p><a href={pack.licenseUrl} target="_blank" rel="noreferrer">Read {pack.license}</a></details>
  </Dialog>;
}
