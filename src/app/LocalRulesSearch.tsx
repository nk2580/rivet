import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ExternalLink,Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {rulesetNames,type RulesetId} from '@/domain/schema';
import {friendlyError} from '@/lib/errors';
import type {RuleSearchResult} from '../../desktop/rules';

export function LocalRulesSearch({edition,onClose,onReturnFocus}:{edition:RulesetId;onClose:()=>void;onReturnFocus:()=>void}){
  const [query,setQuery]=useState(''),[submitted,setSubmitted]=useState('');
  const [results,setResults]=useState<RuleSearchResult[]|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useRef(0);
  useEffect(()=>()=>{request.current++;},[]);
  const search=async(event:FormEvent)=>{
    event.preventDefault();if(!query.trim()||busy)return;
    const current=++request.current;
    setBusy(true);setError('');setResults(null);setSubmitted(query.trim());
    try{
      const response=await window.rivet!.assistant('lookup',{query:query.trim(),edition});
      const content=response.content?.find((item:{type:string;text?:string})=>item.type==='text')?.text;
      if(response.isError)throw new Error(content||'The local rules search could not finish. Try again.');
      const matches=JSON.parse(content??'null');
      if(!Array.isArray(matches))throw new Error('The local rules search returned an unreadable result. Try again.');
      if(current===request.current)setResults(matches);
    }catch(failure){if(current===request.current)setError(friendlyError(failure));}
    finally{if(current===request.current)setBusy(false);}
  };
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}} onCloseAutoFocus={event=>{event.preventDefault();onReturnFocus();}} title="Search SRD locally" description={rulesetNames[edition]+' spells, equipment, character options and rules. Works offline without a ChatGPT connection.'}>
    <form className="local-rules-search-form" onSubmit={event=>{void search(event);}}>
      <label className="field"><span className="sr-only">Local SRD search</span>
        <input autoFocus value={query} onChange={event=>setQuery(event.target.value)} maxLength={300} required placeholder="Guiding Bolt, grappling, armour…"/>
      </label>
      <Button type="submit" disabled={busy||!query.trim()}><Search size={17}/>{busy?'Searching…':'Search'}</Button>
    </form>
    {busy&&<p role="status" className="small-print">Searching your local rules library…</p>}
    {error&&<div className="notice error" role="alert">{error}</div>}
    {results!==null&&<p role="status" className="small-print">{results.length?results.length+' results for “'+submitted+'”':'No matches for “'+submitted+'”. Try a shorter phrase.'}</p>}
    <div className="local-rules-results">{results?.map(result=><article className="local-rule-result" key={result.id}>
      <h3><a href={result.uri} target="_blank" rel="noreferrer">{result.name}<ExternalLink size={14}/></a></h3>
      <p className="small-print">{result.version} · {result.page?'Page '+result.page:result.document} · {result.kind}</p>
      <p>{result.excerpt}</p>
    </article>)}</div>
  </Dialog>;
}
