import { ExternalLink } from 'lucide-react';
import { findSpell,type SpellPack,type SpellReference } from '@/rules/spells';

export function SpellDescription({reference,pack,ancestors=[]}:{reference:SpellReference;pack:SpellPack;ancestors?:string[]}){
  const base=reference.baseSpellId&&!ancestors.includes(reference.baseSpellId)?findSpell(pack,reference.baseSpellId):undefined;
  const metadata=[['School',reference.school],['Casting time',reference.castingTime||'Not specified in the source'],['Range',reference.range],['Components',reference.components],['Duration',reference.duration],...Object.entries(reference.metadata??{}).filter(([key])=>!['Components','Casting Time','Range','Duration'].includes(key))];
  return <><dl className="reference-metadata">{metadata.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
    {reference.blocks?<div className="reference-body">{reference.blocks.map((block,index)=>block.type==='paragraph'?<p key={index}>{block.text}</p>:<div className="reference-table" key={index} role="region" aria-label={`${reference.name} table ${index+1}`} tabIndex={0}><table><tbody>{block.rows.map((row,rowIndex)=><tr key={rowIndex}>{row.map((cell,cellIndex)=>rowIndex===0?<th key={cellIndex} scope="col">{cell}</th>:<td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>)}</div>:<div className="preserve-text reference-body">{reference.description}</div>}
    {base&&<details className="reference-base"><summary>Base spell: {base.name}</summary><p className="small-print">This variant refers to {base.name}. Apply the variant’s changes above.</p><SpellDescription reference={base} pack={pack} ancestors={[...ancestors,reference.id]}/></details>}
    <a className="source-link" href={`${pack.sourceUrl}${reference.page?`#page=${reference.page}`:''}`} target="_blank" rel="noreferrer">{pack.version.replace('SRD-','SRD ')} · {reference.page?`page ${reference.page}`:reference.document||'Original source archive'}<ExternalLink size={13}/></a>
  </>;
}
