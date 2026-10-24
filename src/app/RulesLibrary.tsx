import { useEffect,useMemo,useState } from 'react';
import { BookOpen,ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { rulesetNames,type RulesetId } from '@/domain/schema';
import { loadReferenceDocument,referenceExcerpt,searchReference,useReferencePack,type ReferenceDocument,type ReferenceEntry } from '@/rules/reference';
import '@/rules/reference.css';

export function RulesLibraryButton({edition}:{edition:RulesetId}){
  const [open,setOpen]=useState(false);
  return <><Button variant="outline" size="sm" onClick={()=>setOpen(true)}><BookOpen size={16}/>Rules library</Button>{open&&<RulesLibrary edition={edition} onClose={()=>setOpen(false)}/>}</>;
}

export function RulesLibrary({edition,onClose}:{edition:RulesetId;onClose:()=>void}){
  const {pack,error,retry}=useReferencePack(edition);const [query,setQuery]=useState(''),[limit,setLimit]=useState(20),[selected,setSelected]=useState<ReferenceEntry|null>(null);
  const matches=useMemo(()=>pack?searchReference(pack,query):[],[pack,query]);
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}} title="Rules library" description={`${rulesetNames[edition]} source rules. Search the complete reference and read the original text, including tables.`}>
    {selected?<><Button variant="outline" size="sm" onClick={()=>setSelected(null)}>Back to results</Button><h3>{selected.title}</h3><SourceDocument entry={selected}/></>:<>
      <label className="field"><span className="sr-only">Search rules library</span><input autoFocus maxLength={200} placeholder="Extra attack, grappling, carrying capacity…" value={query} onChange={event=>{setQuery(event.target.value);setLimit(20);}}/></label>
      {error&&<div className="notice error" role="alert">{error}<Button size="sm" variant="outline" onClick={retry}>Retry</Button></div>}
      {!pack&&!error&&<p role="status">Opening the rules library…</p>}
      {pack&&<p className="small-print">{matches.length} matching {edition==='3.5e'?'documents':'pages'} · Available offline after Rivet’s offline-ready notice.</p>}
      <div className="rules-results">{matches.slice(0,limit).map(entry=><article className="catalogue-entry" key={entry.id}><h3>{entry.title}</h3><p className="small-print">{entry.page?`Page ${entry.page}`:entry.document}</p><p>{referenceExcerpt(entry,query)}</p>{entry.documentPath?<Button size="sm" variant="outline" onClick={()=>setSelected(entry)}><BookOpen size={15}/>Read source</Button>:<a className="source-link" href={`${pack?.pdfPath}#page=${entry.page}`} target="_blank" rel="noreferrer">Read original page<ExternalLink size={13}/></a>}</article>)}</div>
      {matches.length>limit&&<Button variant="outline" onClick={()=>setLimit(value=>value+20)}>Show more results ({limit} / {matches.length})</Button>}
      {pack&&matches.length===0&&<p className="muted">No source pages match all these words. Try a shorter phrase.</p>}
    </>}
    {pack&&<details className="reference-attribution"><summary>Rules source and attribution</summary><p>{pack.attribution}</p><p>{pack.modifications}</p><a href={pack.licenseUrl} target="_blank" rel="noreferrer">Read {pack.license}</a></details>}
  </Dialog>;
}
function SourceDocument({entry}:{entry:ReferenceEntry}){
  const [document,setDocument]=useState<ReferenceDocument|null>(null),[error,setError]=useState('');
  useEffect(()=>{let cancelled=false;void loadReferenceDocument(entry).then(value=>{if(!cancelled)setDocument(value);}).catch(failure=>{if(!cancelled)setError(failure instanceof Error?failure.message:'Source unavailable.');});return()=>{cancelled=true;};},[entry]);
  if(error)return <p role="alert" className="notice error">{error}</p>;
  if(!document)return <p role="status">Opening source document…</p>;
  return <div className="reference-body">{document.blocks.map((block,index)=>block.type==='paragraph'?<p key={index}>{block.text}</p>:<div className="reference-table" key={index} role="region" aria-label={`${entry.title} table ${index+1}`} tabIndex={0}><table><tbody>{block.rows.map((row,rowIndex)=><tr key={rowIndex}>{row.map((cell,column)=>rowIndex===0?<th key={column} scope="col">{cell}</th>:<td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>)}</div>;
}
