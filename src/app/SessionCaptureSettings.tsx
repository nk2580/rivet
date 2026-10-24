import {useEffect,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {sessionCapture} from '@/hooks/use-session-capture';
import type {CaptureSettings,CaptureDevice} from '@/domain/session-capture';
import {friendlyError} from '@/lib/errors';

export function SessionCaptureSettings(){
  const [settings,setSettings]=useState<CaptureSettings|null>(null),[devices,setDevices]=useState<CaptureDevice[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let alive=true;const refresh=()=>{void sessionCapture.settings().then(value=>{if(alive)setSettings(value);}).catch(error=>{if(alive)setError(friendlyError(error));});};refresh();const unsubscribe=window.rivet?.onCaptureEvent(refresh);return()=>{alive=false;unsubscribe?.();};},[]);
  const act=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();setSettings(await sessionCapture.settings());}catch(error){setError(friendlyError(error));}finally{setBusy(false);}};
  return <section className="settings-section" aria-labelledby="capture-settings-heading"><h3 id="capture-settings-heading">Session capture</h3><p>Listen locally and save a text recap to the journal every ten minutes. Only transcript text and quick notes go to ChatGPT. Audio is discarded after recognition.</p>
    {(error||settings?.error)&&<p className="notice error" role="alert">{error||settings?.error}</p>}
    <p className="small-print" role="status">{!settings?'Checking speech setup…':settings.ready?'English speech model is ready on this computer.':settings.installing?`Downloading English model… ${Math.round(settings.downloadedBytes/1024/1024)} MB`:'Download the English speech model once, about 40 MB. It uses roughly 300 MB of memory while listening.'}</p>
    {settings&&!settings.ready&&<Button variant="outline" disabled={busy||settings.installing||!settings.helperAvailable} onClick={()=>{void act(async()=>{await sessionCapture.installModel();});}}><Download size={17}/>{settings.installing?'Downloading…':'Download English model'}</Button>}
    {settings&&!settings.helperAvailable&&<p className="field-help">The speech helper is missing from this build. Rebuild or reinstall Rivet.</p>}
    <div className="capture-device-settings"><label className="field">Microphone<select value={settings?.deviceId??''} disabled={busy} onChange={event=>{const id=event.target.value;void act(()=>sessionCapture.selectDevice(id));}}><option value="">System default</option>{settings?.deviceId&&!devices.some(d=>d.id===settings.deviceId)&&<option value={settings.deviceId}>{settings.deviceId}</option>}{devices.map(device=><option key={device.id} value={device.id}>{device.name}{device.isDefault?' (default)':''}</option>)}</select></label><Button variant="outline" disabled={busy||!settings?.helperAvailable} onClick={()=>{void act(async()=>setDevices(await sessionCapture.devices()));}}><RefreshCw size={16}/>Find microphones</Button></div>
    <p className="small-print">Use the microphone beside your character’s name to start. Names and overlapping voices can be missed; add corrections as quick notes in the journal. DM follow-ups use the same events as the group recap.</p>
  </section>;
}
