import {ExternalLink,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {AssistantSettingsController} from '@/hooks/use-assistant-settings';
import {ConnectionUnlockButton} from './ConnectionUnlock';

export function AssistantSettings({connection:c}:{connection:AssistantSettingsController}){
  return <section className="settings-section assistant-settings" aria-labelledby="assistant-settings-heading">
    <div className="section-heading">
      <h3 id="assistant-settings-heading">ChatGPT guide</h3>
      <span className={'assistant-connection-status '+(c.connected?'connected':'')}>
        <span className="status-dot"/>{c.account?.lock?.locked?'Locked':c.account?.pending?'Sign-in in progress':c.connected?'Connected':c.loading?'Checking connection…':'Not connected'}
      </span>
    </div>
    <p>Use your ChatGPT plan for live guidance. Your connection is kept in this computer’s protected storage.</p>
    <ConnectionUnlockButton connection={c}/>
    {!c.account?.lock?.locked&&<>
    {(c.account?.profiles.length??0)>0&&<label className="field">ChatGPT account
      <select value={c.account?.active??''} disabled={c.busy||c.account?.pending} onChange={event=>{void c.selectAccount(event.target.value);}}>
        <option value="" disabled>Choose an account</option>
        {c.account?.profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.label}{profile.connected?'':' · Sign-in needed'}</option>)}
      </select>
    </label>}
    <label className="field">ChatGPT model
      <select aria-label="ChatGPT model" value={c.model} disabled={c.busy||c.loading||!c.models.length} onChange={event=>{void c.changeModel(event.target.value);}}>
        <option value="">{c.loading?'Loading models…':'Choose model'}</option>
        {c.models.map(model=><option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
      <span className="field-help">Applies to your next message, including in existing conversations.</span>
    </label>
    <div className="button-row">
      <Button disabled={c.busy||c.account?.pending} onClick={()=>{void c.connect(c.account?.active??undefined);}}>{c.connected?'Reconnect ChatGPT':'Continue with ChatGPT'}<ExternalLink size={15}/></Button>
      {(c.account?.profiles.length??0)>0&&<Button variant="ghost" disabled={c.busy||c.account?.pending} onClick={()=>{void c.connect();}}>Add account</Button>}
      {c.account?.pending&&<Button variant="outline" disabled={c.busy} onClick={()=>{void c.cancel();}}>Cancel sign-in</Button>}
      {c.connected&&<Button variant="ghost" disabled={c.busy||c.account?.pending} onClick={()=>{void c.disconnect();}}>Disconnect</Button>}
      {c.connected&&<Button variant="ghost" size="icon" aria-label="Refresh ChatGPT models" title="Refresh models" disabled={c.busy||c.loading} onClick={()=>{void c.refresh();}}><RefreshCw size={16}/></Button>}
    </div>
    {c.account?.pending&&<p role="status">Finish sign-in and permission review in your browser.</p>}
    </>}
    {c.error&&<div className="notice error" role="alert">{c.error}</div>}
    {c.notice&&<p role="status">{c.notice}</p>}
    <p className="small-print">Only the selected character and notes marked “Share with guide” accompany your question. Changing accounts stops current responses.</p>
    <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer" className="source-link">Manage ChatGPT plan usage<ExternalLink size={13}/></a>
  </section>;
}
