import {useEffect, useRef, useState, type FormEvent} from 'react';
import {Camera, ExternalLink, Sparkles, Trash2, Upload} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {CharacterAvatar} from '@/components/CharacterAvatar';
import type {Character} from '@/domain/schema';
import {PORTRAIT_PROMPT_LIMIT, portraitPrompt, type CharacterPortrait} from '@/domain/portrait';
import {readPortraitFile} from '@/lib/portrait-image';
import {friendlyError} from '@/lib/errors';
import './portrait.css';

export function CharacterPortraitDialog({character, revision, onSave, onClose, onReturnFocus}: {
  character: Character; revision: number;
  onSave: (portrait: CharacterPortrait | null, revision: number) => Promise<void>;
  onClose: () => void; onReturnFocus: () => void;
}) {
  const [initialRevision] = useState(revision);
  const [portrait, setPortrait] = useState(character.portrait ?? null);
  const [prompt, setPrompt] = useState(() => (localStorage.getItem(`rivet:portrait-prompt:${character.id}`) ?? portraitPrompt(character)).slice(0, PORTRAIT_PROMPT_LIMIT));
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null), alive = useRef(true), request = useRef(0);
  useEffect(() => {alive.current = true; return () => {alive.current = false; request.current++;};}, []);
  useEffect(() => {localStorage.setItem(`rivet:portrait-prompt:${character.id}`, prompt);}, [character.id, prompt]);
  const changed = portrait?.dataUrl !== character.portrait?.dataUrl;
  const choose = async (file: File) => {
    const current = ++request.current;
    setError(''); setNotice(''); setReading(true);
    try {const next = await readPortraitFile(file); if (alive.current && current === request.current) setPortrait(next);}
    catch (failure) {if (alive.current && current === request.current) setError(friendlyError(failure));}
    finally {if (alive.current && current === request.current) setReading(false);}
  };
  const handoff = async () => {
    setError(''); setNotice(''); setBusy(true);
    try {
      if (!window.rivet) throw new Error('Open Rivet Desktop to copy the prompt and open ChatGPT.');
      await window.rivet.openPortraitChatGPT(prompt.trim());
      if (alive.current) setNotice('Prompt copied. Paste it into ChatGPT, generate your portrait, then upload the saved image here.');
    } catch (failure) {if (alive.current) setError(friendlyError(failure));}
    finally {if (alive.current) setBusy(false);}
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!changed || reading || busy) return;
    setError(''); setBusy(true);
    try {await onSave(portrait, initialRevision); if (alive.current) onClose();}
    catch (failure) {if (alive.current) setError(friendlyError(failure));}
    finally {if (alive.current) setBusy(false);}
  };
  return <Dialog open onOpenChange={open => {if (!open && !busy) onClose();}} title="Character portrait" description={`Choose a portrait for ${character.name}, or create one in ChatGPT.`} onCloseAutoFocus={event => {event.preventDefault(); onReturnFocus();}}>
    <form className="portrait-editor" onSubmit={save}>
      <div className="portrait-upload">
        <div className="portrait-preview" role="img" aria-label={portrait ? 'Preview of your chosen character portrait' : 'Character initial, no portrait selected'}><CharacterAvatar name={character.name} portrait={portrait} size="preview"/></div>
        <div><h3><Camera size={18} aria-hidden="true"/>Your portrait</h3><p>PNG, JPEG or WebP, up to 10 MB. Images are cropped to a square.</p><div className="button-row"><Button variant="outline" disabled={busy || reading} onClick={() => input.current?.click()}><Upload size={17}/>{reading ? 'Reading image…' : 'Choose image'}</Button>{portrait && <Button variant="ghost" disabled={busy || reading} onClick={() => {request.current++; setPortrait(null); setError(''); setNotice('');}}><Trash2 size={16}/>Remove</Button>}</div></div>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose portrait image" hidden onChange={event => {const file = event.target.files?.[0]; if (file) void choose(file); event.target.value = '';}}/>
      <section className="portrait-generation" aria-labelledby="portrait-generation-heading">
        <h3 id="portrait-generation-heading"><Sparkles size={18} aria-hidden="true"/>Create in ChatGPT</h3>
        <p>Edit the suggested prompt, then copy it to ChatGPT. Upload the image you generate to use it here.</p>
        <label className="field">Portrait prompt<textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={PORTRAIT_PROMPT_LIMIT} rows={4} disabled={busy}/></label>
        <div className="portrait-prompt-actions"><Button variant="outline" disabled={busy || reading || !prompt.trim()} onClick={() => {void handoff();}}>Copy prompt & open ChatGPT<ExternalLink size={16}/></Button><Button variant="ghost" disabled={busy} onClick={() => {setPrompt(portraitPrompt(character)); setNotice('');}}>Reset prompt</Button></div>
      </section>
      {reading && <p className="small-print" role="status">Preparing a local portrait preview…</p>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {notice && <p className="portrait-handoff-notice" role="status">{notice}</p>}
      <p className="small-print">Your portrait is saved on this computer and included in character backups.</p>
      <div className="dialog-actions"><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={!changed || busy || reading}>{busy ? 'Please wait…' : 'Save portrait'}</Button></div>
    </form>
  </Dialog>;
}
