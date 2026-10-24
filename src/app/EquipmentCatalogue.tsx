import { useState } from 'react';
import { BookOpen,ExternalLink,Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EQUIPMENT_CATEGORIES,rulesetNames,type InventoryItem,type RulesetId } from '@/domain/schema';
import { itemFromReference,useEquipmentPack } from '@/rules/equipment';

export function EquipmentCatalogue({edition,busy,error,onClose,onAdd}:{edition:RulesetId;busy:boolean;error:string;onClose:()=>void;onAdd:(item:InventoryItem)=>void}){
  const {pack,error:loadError,retry}=useEquipmentPack(edition);const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[limit,setLimit]=useState(25);
  const items=pack?.items.filter(item=>(category==='all'||item.category===category)&&[item.name,item.group].join(' ').toLowerCase().includes(query.toLowerCase()))??[];
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}} title="Equipment catalogue" description={`${rulesetNames[edition]} source equipment. Add a carried item, then confirm proficiency and equip it in Inventory.`}>
    <div className="notebook-filters"><label className="field"><span className="sr-only">Search equipment catalogue</span><input autoFocus placeholder="Search equipment…" value={query} onChange={event=>{setQuery(event.target.value);setLimit(25);}}/></label><label className="field"><span className="sr-only">Catalogue category</span><select value={category} onChange={event=>{setCategory(event.target.value);setLimit(25);}}><option value="all">All equipment</option>{EQUIPMENT_CATEGORIES.map(value=><option value={value} key={value}>{value==='armor'?'Armour':value.charAt(0).toUpperCase()+value.slice(1)}</option>)}</select></label></div>
    {(error||loadError)&&<div className="notice error" role="alert">{error||loadError}{loadError&&<Button onClick={retry} variant="outline" size="sm">Retry</Button>}</div>}
    {!pack&&!loadError&&<p role="status">Opening your edition’s equipment…</p>}
    {edition==='3.5e'&&<p className="small-print">Weights and weapon damage use Medium size. Small-size damage and the original size notes are included in item details.</p>}
    {pack&&<p className="small-print">{items.length} entries · Prices are reference values. Adding an item keeps your gold unchanged.</p>}
    <div className="catalogue-results">{items.slice(0,limit).map(item=><article className="catalogue-entry" key={item.id}><div className="section-heading"><div><h3>{item.name}</h3><p className="small-print">{item.group} · {item.weightKnown?`${item.weight} lb`:'Weight varies'} · {item.cost}</p></div><Button size="sm" variant="outline" disabled={busy} aria-label={`Add ${item.name} to inventory`} onClick={()=>onAdd(itemFromReference(item))}><Plus size={15}/>Add</Button></div>
      <details className="reference-description"><summary><BookOpen size={15}/><span>Full item details</span></summary>{item.weapon&&<dl className="reference-metadata"><div><dt>Medium damage</dt><dd>{item.weapon.damage} {item.weapon.damageType}</dd></div>{item.weapon.smallDamage&&<div><dt>Small damage</dt><dd>{item.weapon.smallDamage}</dd></div>}{item.weapon.critical&&<div><dt>Critical</dt><dd>{item.weapon.critical}</dd></div>}<div><dt>Properties / mastery</dt><dd>{[item.weapon.properties,item.mastery].filter(Boolean).join(' · ')||'None'}</dd></div></dl>}<p className="preserve-text reference-body">{item.description}</p><a className="source-link" href={`${pack?.sourceUrl}${item.page?`#page=${item.page}`:''}`} target="_blank" rel="noreferrer">{pack?.version} · {item.page?`page ${item.page}`:item.document}<ExternalLink size={13}/></a></details>
    </article>)}</div>
    {items.length>limit&&<Button variant="outline" onClick={()=>setLimit(value=>value+25)}>Show more equipment ({Math.min(limit,items.length)} / {items.length})</Button>}
    {pack&&items.length===0&&<p className="muted">No equipment matches this search.</p>}
    {pack&&<details className="reference-attribution"><summary>Rules source and attribution</summary><p>{pack.attribution}</p><p>{pack.modifications}</p><a href={pack.licenseUrl} target="_blank" rel="noreferrer">Read {pack.license}</a></details>}
  </Dialog>;
}
