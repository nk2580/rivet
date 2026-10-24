import { useMemo,useState } from 'react';
import { BookOpen,ChevronDown,ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { rulesetNames,type RulesetId } from '@/domain/schema';
import { searchOptions,useOptionsPack,type CharacterOption,type OptionGroup,type OptionsPack } from '@/rules/options';
import '@/rules/reference.css';

export function CharacterOptionsButton({edition}:{edition:RulesetId}){
  const [open,setOpen]=useState(false);
  return <><Button variant="outline" size="sm" onClick={()=>setOpen(true)}><BookOpen size={16}/>Classes, feats & ancestry</Button>{open&&<CharacterOptions edition={edition} onClose={()=>setOpen(false)}/>}</>;
}
function CharacterOptions({edition,onClose}:{edition:RulesetId;onClose:()=>void}){
  const {pack,error,retry}=useOptionsPack(edition);
  const [group,setGroup]=useState<OptionGroup>('classes'),[query,setQuery]=useState(''),[limit,setLimit]=useState(20),[selected,setSelected]=useState<CharacterOption|null>(null);
  const groups:[OptionGroup,string][]=[['classes','Classes'],...(edition==='3.5e'?[['prestigeClasses','Prestige classes'] as [OptionGroup,string]]:[]),['species',edition==='3.5e'?'Races':'Species'],...(edition==='3.5e'?[]:[['backgrounds','Backgrounds'] as [OptionGroup,string]]),['feats','Feats']];
  const matches=useMemo(()=>pack?searchOptions(pack[group],query):[],[pack,group,query]);
  return <Dialog open onOpenChange={value=>{if(!value)onClose();}} title="Character options" description={`${rulesetNames[edition]} SRD. Read prerequisites, traits and features before making a character choice.`}>
    {error&&<div className="notice error" role="alert">{error}<Button size="sm" variant="outline" onClick={retry}>Retry</Button></div>}
    {!pack&&!error&&<p role="status">Opening the character reference…</p>}
    {selected&&pack?<><Button size="sm" variant="outline" onClick={()=>setSelected(null)}>Back to options</Button><h3>{selected.name}</h3>{selected.hitDie&&<p className="small-print">Hit Die: d{selected.hitDie}</p>}<OptionSource option={selected} pack={pack}/>
      {selected.blocks?<div className="reference-body">{selected.blocks.map((block,index)=>block.type==='paragraph'?<p key={index}>{block.text}</p>:<div className="reference-table" key={index} role="region" aria-label={`${selected.name} table ${index+1}`} tabIndex={0}><table><tbody>{block.rows.map((row,ri)=><tr key={ri}>{row.map((cell,ci)=>ri===0?<th key={ci} scope="col">{cell}</th>:<td key={ci}>{cell}</td>)}</tr>)}</tbody></table></div>)}</div>:
        selected.features?.length?<><p className="small-print">Feature sections below retain the source’s wording. Read the original pages for progression tables and the class introduction.</p>{selected.features.map(feature=><details key={feature.id} className="reference-description"><summary><span>{feature.level?`Level ${feature.level}: `:''}{feature.name}</span><ChevronDown size={16}/></summary><div className="preserve-text reference-body">{feature.description}</div>{feature.page&&<a className="source-link" href={`/rules/SRD_CC_v${edition==='5e-2024'?'5.2.1':'5.1'}.pdf#page=${feature.page}`} target="_blank" rel="noreferrer">Original page {feature.page}<ExternalLink size={13}/></a>}</details>)}</>:<div className="preserve-text reference-body">{selected.description}</div>}
    </>:<><div className="form-grid"><label className="field">Reference section<select value={group} onChange={event=>{setGroup(event.target.value as OptionGroup);setLimit(20);}}>{groups.map(([id,label])=><option key={id} value={id}>{label}{pack?` (${pack[id].length})`:''}</option>)}</select></label><label className="field">Search options<input maxLength={200} value={query} onChange={event=>{setQuery(event.target.value);setLimit(20);}} placeholder="Class, feature or prerequisite…"/></label></div>
      {pack&&<p className="small-print">{matches.length} matching options · Source reference, with no changes to your character.</p>}
      <div className="rules-results">{matches.slice(0,limit).map(option=><article key={option.id} className="catalogue-entry"><h3>{option.name}</h3><p>{option.description.slice(0,190).replace(/\s+/g,' ')}{option.description.length>190?'…':''}</p><Button variant="outline" size="sm" onClick={()=>setSelected(option)}><BookOpen size={15}/>Read {option.name}</Button></article>)}</div>
      {pack&&!matches.length&&<p className="muted">No options match these words. Try a shorter phrase.</p>}
      {matches.length>limit&&<Button variant="outline" onClick={()=>setLimit(value=>value+20)}>Show more options ({limit} / {matches.length})</Button>}
    </>}
    {pack&&<details className="reference-attribution"><summary>Rules source and attribution</summary><p>{pack.attribution}</p><p>{pack.modifications}</p><a href={pack.licenseUrl} target="_blank" rel="noreferrer">Read {pack.license}</a></details>}
  </Dialog>;
}
function OptionSource({option,pack}:{option:CharacterOption;pack:OptionsPack}){
  return <a className="source-link" href={option.page?`/rules/SRD_CC_v${pack.edition==='5e-2024'?'5.2.1':'5.1'}.pdf#page=${option.page}`:pack.sourceUrl} target="_blank" rel="noreferrer">{pack.version.replace('SRD-','SRD ')} · {option.page?`page ${option.page}${option.endPage&&option.endPage!==option.page?`–${option.endPage}`:''}`:option.document}<ExternalLink size={13}/></a>;
}
