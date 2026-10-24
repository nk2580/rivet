import {Fingerprint,LockKeyhole,ShieldCheck,ExternalLink} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import type {AssistantSettingsController} from '@/hooks/use-assistant-settings';
import './connection-unlock.css';
import {useRef} from 'react';

export function ConnectionUnlockButton({connection:c}:{connection:AssistantSettingsController}){
  if(!c.account?.lock?.locked)return null;
  return <div className="connection-locked"><LockKeyhole size={18} aria-hidden="true"/><span>Oracle is locked</span><Button variant="outline" size="sm" disabled={c.loading||c.busy} onClick={event=>c.openUnlock(event.currentTarget)}>Unlock Oracle</Button></div>;
}
export function ConnectionUnlockDialog({connection:c}:{connection:AssistantSettingsController}){
  const lock=c.account?.lock;
  const migration=lock?.migration;
  const continueButton=useRef<HTMLButtonElement>(null);
  return <Dialog open={c.unlockOpen} onOpenChange={open=>{if(!open)c.closeUnlock();}} onOpenAutoFocus={event=>{if(lock?.available){event.preventDefault();continueButton.current?.focus();}}} onCloseAutoFocus={c.restoreUnlockFocus} title={migration?'Update connection protection':'Unlock Oracle'} description={lock?.hasSavedConnection?'Verify it’s you to use your saved ChatGPT connection.':'Verify it’s you before connecting ChatGPT on this Mac.'}>
    <div className={`connection-unlock-body ${migration?'is-migrating':''}`} aria-busy={c.unlockPending}>
      <div className="connection-fingerprint" aria-hidden="true">{lock?.touchID?<Fingerprint size={48} strokeWidth={1.5}/>:<LockKeyhole size={44} strokeWidth={1.5}/>}</div>
      {(!migration||c.unlockPending)&&<><h3>{c.unlockPending?'Confirm on your Mac':lock?.touchID?'Unlock with Touch ID':'Protected by your Mac'}</h3>
      <p role={c.unlockPending?'status':undefined}>{c.unlockPending?'The secure macOS dialog is open. Use Touch ID or choose Use Mac Password.':lock?.touchID?'Use Touch ID to unlock your connection for this Rivet session.':'Use your Mac login password in the secure macOS dialog.'}</p>
      {lock?.touchID&&!c.unlockPending&&<p className="small-print">Prefer a password? Choose “Use Mac Password” in the macOS dialog.</p>}</>}
      {migration&&!c.unlockPending&&<div className="connection-migration"><p>Move your saved connection once, or sign in to ChatGPT again. Moving it may ask for the old Keychain password one last time.</p><p>Both choices use Touch ID or your Mac password. Your characters and chats stay here.</p></div>}
      {!lock?.available&&<div className="notice error" role="alert">Mac authentication is unavailable. You can keep using your sheet and local rules.</div>}
      {c.error&&<div className="notice error" role="alert">{c.error}</div>}{c.error&&!migration&&<p className="small-print">You can sign in to ChatGPT again to replace the saved connection. Your sheet and chats stay here.</p>}
      <div className="connection-unlock-actions"><Button ref={continueButton} disabled={c.unlockPending||!lock?.available} onClick={()=>{void c.unlock();}}>{lock?.touchID?<Fingerprint size={18}/>:<LockKeyhole size={18}/>} {c.unlockPending?'Waiting for your Mac…':migration?'Move saved connection':lock?.touchID?'Continue with Touch ID':'Continue with Mac password'}</Button>{(migration||!!c.error)&&<Button variant="outline" disabled={c.unlockPending||!lock?.available} onClick={()=>{void c.unlock('reconnect');}}>Sign in again<ExternalLink size={15}/></Button>}<Button variant="ghost" onClick={c.closeUnlock}>{c.unlockPending?'Cancel':'Keep using my sheet'}</Button></div>
      <p className="connection-unlock-assurance"><ShieldCheck size={16} aria-hidden="true"/><span>Your fingerprint and Mac password stay with macOS.</span></p>
    </div>
  </Dialog>;
}
