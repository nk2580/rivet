import { app,BrowserWindow,ipcMain,net,protocol,shell,Menu,dialog,clipboard,powerMonitor,powerSaveBlocker,systemPreferences,nativeImage,nativeTheme } from 'electron';
import { mkdirSync,existsSync,readFileSync,statSync } from 'node:fs';
import { join,resolve,relative,isAbsolute,extname,dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { SQLiteStore } from './sqlite';
import { Workspace } from '../src/storage/workspace';
import { migrateLegacy } from '../src/storage/import';
import { RulesDatabase,searchRulesSchema } from './rules';
import { ChatGPTAuth } from './auth';
import {MacCredentials,NativeAuthBridge} from './credentials';
import { AssistantRuntime } from './assistant';
import {CaptureRuntime} from './capture';
import {NativeSpeech} from './capture-speech';
import {captureSummariser} from './capture-summary';
import {captureCommandSchema} from '../src/domain/session-capture';
import {appearanceCommandSchema} from '../src/domain/appearance';
import {DesktopAppearance} from './appearance';

protocol.registerSchemesAsPrivileged([{scheme:'rivet',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.setName('Rivet');
if(process.env.RIVET_DATA_DIR){const data=resolve(process.env.RIVET_DATA_DIR);mkdirSync(data,{recursive:true,mode:0o700});app.setPath('userData',data);}
if(!app.requestSingleInstanceLock()){app.quit();}else{
  let store:SQLiteStore,workspace:Workspace,rules:RulesDatabase,auth:ChatGPTAuth,assistant:AssistantRuntime,capture:CaptureRuntime,speech:NativeSpeech;
  let capturePowerBlocker:number|undefined;
  const root=resolve(__dirname,'..'),frontend=join(root,'dist');
  const desktopRuntime=app.isPackaged?join(process.resourcesPath,'app.asar.unpacked','dist-electron'):__dirname;
  const rulesPath=join(desktopRuntime,'rules.sqlite');
  const broadcast=(channel:string,value?:unknown)=>{for(const win of BrowserWindow.getAllWindows())win.webContents.send(channel,value);};
  function window(){
    const win=new BrowserWindow({width:1440,height:940,minWidth:390,minHeight:600,title:'Rivet',backgroundColor:'#faf8f4',...(process.platform==='darwin'?{titleBarStyle:'hidden' as const,trafficLightPosition:{x:12,y:14}}:{}),webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false}});
    win.on('enter-full-screen',()=>win.webContents.send('window-state-changed',{fullScreen:true}));
    win.on('leave-full-screen',()=>win.webContents.send('window-state-changed',{fullScreen:false}));
    win.webContents.setWindowOpenHandler(({url})=>{void openLink(url);return {action:'deny'};});
    win.webContents.on('will-navigate',(event,url)=>{const destination=new URL(url);if(destination.protocol!=='rivet:'||destination.hostname!=='app'){event.preventDefault();void openLink(url);}});
    win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    void win.loadURL('rivet://app/');return win;
  }
  async function openLink(value:string){
    const url=new URL(value);
    if(url.protocol==='rivet:'&&url.hostname==='rules'){const id=decodeURIComponent(url.pathname.slice(1));const entry=rules.get(id);const viewer=new BrowserWindow({width:900,height:800,parent:BrowserWindow.getFocusedWindow()??undefined,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});const html=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Rivet source</title><style>body{font:17px/1.65 system-ui;margin:40px;max-width:75ch;color:#29251f;background:#faf8f4}pre{white-space:pre-wrap;font:inherit}small{color:#6b6056}</style><h1>${escape(entry.name)}</h1><small>${escape(entry.version)} · ${escape(entry.page?'Page '+entry.page:entry.document??'SRD')} · ${escape(entry.license)}</small><pre>${escape(entry.body)}</pre><p>${escape(entry.attribution)}</p>`;await viewer.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));return;}
    if(url.protocol==='rivet:'&&url.hostname==='app'&&url.pathname.startsWith('/rules/')){const file=resolve(frontend,'.'+decodeURIComponent(url.pathname));if(relative(frontend,file).startsWith('..'))return;if(extname(file)==='.pdf'&&existsSync(file)){await shell.openPath(file);return;}}
    if(url.protocol==='https:')await shell.openExternal(url.href);
  }
  const escape=(value:unknown)=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
  const trusted=(event:Electron.IpcMainInvokeEvent)=>{const frame=event.senderFrame;if(!frame||frame.url.split('/').slice(0,3).join('/')!=='rivet://app'||frame!==event.sender.mainFrame)throw new Error('This request is not from the Rivet workspace.');};
  app.whenReady().then(async()=>{
    const data=app.getPath('userData');mkdirSync(data,{recursive:true,mode:0o700});
    store=new SQLiteStore(join(data,'workspace.sqlite'));workspace=new Workspace(store.asWorkspaceStore(),'local',true);rules=new RulesDatabase(rulesPath);
    const appearance=new DesktopAppearance(store,join(desktopRuntime,'icons'),{
      systemDark:()=>nativeTheme.shouldUseDarkColors,
      setIcon:path=>{
        if(process.platform!=='darwin')return;
        const selected=nativeImage.createFromPath(path);
        const icon=selected.isEmpty()?nativeImage.createFromPath(join(desktopRuntime,'rivet-icon.png')):selected;
        if(!icon.isEmpty())app.dock?.setIcon(icon);
      },
      changed:value=>broadcast('appearance-changed',value),
    });
    await appearance.initialize();
    nativeTheme.on('updated',()=>appearance.refresh());
    ipcMain.handle('appearance',async(event,input)=>{trusted(event);const command=appearanceCommandSchema.parse(input);return command.action==='get'?appearance.state():appearance.set(command.value);});
    auth=new ChatGPTAuth(store,()=>broadcast('assistant-event',{type:'account'}),process.platform==='darwin'?new MacCredentials(store,new NativeAuthBridge(join(desktopRuntime,'rivet-auth'))):undefined);
    assistant=new AssistantRuntime(store,workspace,auth,{exec:process.execPath,mcp:join(desktopRuntime,'mcp.cjs'),rules:rulesPath},event=>{broadcast('assistant-event',event);if(event.type==='character-changed')broadcast('storage-changed');});
    const captureChanged=()=>{const listening=capture?.status().run?.state==='listening';if(listening&&capturePowerBlocker===undefined)capturePowerBlocker=powerSaveBlocker.start('prevent-app-suspension');if(!listening&&capturePowerBlocker!==undefined){powerSaveBlocker.stop(capturePowerBlocker);capturePowerBlocker=undefined;}broadcast('capture-event');};
    speech=new NativeSpeech(store,data,desktopRuntime,captureChanged);
    capture=new CaptureRuntime(store,workspace,{speech,summarise:captureSummariser(auth),changed:captureChanged,notesChanged:()=>broadcast('storage-changed')});
    powerMonitor.on('suspend',()=>{void capture.interrupt('The computer went to sleep. Speech during sleep was not captured.');});
    powerMonitor.on('resume',()=>{void capture.interrupt('The computer resumed from sleep. Resume listening when the table is ready.');});
    protocol.handle('rivet',async request=>{
      const url=new URL(request.url);if(url.hostname!=='app'||request.method!=='GET')return new Response('Not found',{status:404});
      const pathname=decodeURIComponent(url.pathname),candidate=resolve(frontend,'.'+pathname),rel=relative(frontend,candidate);
      if(rel.startsWith('..')||isAbsolute(rel))return new Response('Not found',{status:404});
      const file=existsSync(candidate)&&statSync(candidate).isFile()?candidate:!extname(candidate)?join(frontend,'index.html'):null;
      if(!file)return new Response('Not found',{status:404});const response=await net.fetch(pathToFileURL(file).href);
      const headers=new Headers(response.headers);headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'");
      return new Response(response.body,{status:response.status,headers});
    });
    ipcMain.handle('workspace',async(event,input)=>{
      trusted(event);const {action,args=[]}=z.object({action:z.string(),args:z.array(z.unknown()).max(8)}).parse(input);let result:unknown;const mutate=!['list','get','exportBackup','tableGet','tableList'].includes(action);
      switch(action){
        case 'list':result=await workspace.list(args[0] as any);break;
        case 'get':result=await workspace.get(args[0] as any,z.string().parse(args[1]));break;
        case 'save':result=await workspace.save(args[0] as any,args[1]===undefined?undefined:z.number().int().min(0).parse(args[1]));break;
        case 'saveMany':result=await workspace.saveMany(args[0] as any);break;
        case 'execute':result=await workspace.execute(z.string().parse(args[0]),args[1] as any,z.number().int().min(0).parse(args[2]),args[3]===undefined?undefined:z.string().parse(args[3]));break;
        case 'undo':result=await workspace.undo(z.string().parse(args[0]));break;
        case 'setDeleted':result=await workspace.setDeleted(args[0] as any,z.string().parse(args[1]),z.boolean().parse(args[2]),z.number().int().min(0).parse(args[3]));break;
        case 'exportBackup':result=await store.transaction(async()=>({...await workspace.exportBackup(),desktopGuide:assistant.exportBackup(),desktopCapture:capture.exportBackup()}));break;
        case 'importRecords':result=await store.transaction(async()=>{if(args[4])assistant.validateBackup(args[4]);if(args[5])capture.validateBackup(args[5]);const count=await workspace.importRecords(args[0] as any,args[1] as any,args[2] as any,args[3] as any);if(args[4])await assistant.importBackup(args[4]);if(args[5])await capture.importBackup(args[5]);return count;});broadcast('capture-event');break;
        case 'tableGet':case 'tableList':{
          const name=z.enum(['documents','activity','conflicts','meta']).parse(args[0]);
          if(name==='meta'){if(action==='tableList')result=(await store.meta.toArray()).filter(row=>/^(?:draft|journal-active|source|recovery)\//.test(row.key));else{const key=z.string().parse(args[1]);if(!/^(?:draft|journal-active|source|recovery)\//.test(key))throw new Error('This metadata is private to the desktop process.');result=await store.meta.get(key);}}
          else result=action==='tableGet'?await store.table(name).get(z.string().parse(args[1])):await store.table(name).toArray();break;
        }
        case 'metaPut':case 'metaDelete':{
          if(args[0]!=='meta')throw new Error('Only draft metadata can be edited directly.');const key=action==='metaPut'?z.object({key:z.string(),value:z.unknown()}).parse(args[1]).key:z.string().parse(args[1]);
          if(!/^(?:draft|journal-active)\//.test(key))throw new Error('This metadata cannot be edited directly.');
          result=action==='metaPut'?await store.meta.put(args[1] as any):await store.meta.delete(key);break;
        }
        default:throw new Error('Unknown workspace action.');
      }
      if(mutate)broadcast('storage-changed');return result;
    });
    ipcMain.handle('system-info',event=>{trusted(event);return {dataPath:join(data,'workspace.sqlite'),rulesEntries:rules.count(),version:app.getVersion()};});
    ipcMain.handle('session-capture',async(event,input)=>{
      trusted(event);const command=captureCommandSchema.parse(input);
      switch(command.action){
        case 'status':return capture.status();case 'runs':return capture.runs(command.sessionId);case 'settings':return speech.settings();case 'devices':return speech.devices();case 'install-model':return speech.installModel();case 'select-device':return speech.selectDevice(command.deviceId);
        case 'start':{
          if(!speech.ready())throw new Error('Download the English speech model in Settings → Session capture first.');
          if(process.platform==='darwin'&&!await systemPreferences.askForMediaAccess('microphone'))throw new Error('Allow Rivet in System Settings → Privacy & Security → Microphone, then start listening again.');
          return capture.start(command.characterId,command.sessionId);
        }
        case 'pause':return capture.pause(command.runId);case 'end':return capture.end(command.runId);case 'summarise':return capture.summarise(command.runId);case 'retry':return capture.retry(command.runId);case 'quick-note':return capture.quickNote(command.runId,command.text);case 'transcript':return capture.transcript(command.runId,command.after);
      }
    });
    ipcMain.handle('window-state',event=>{trusted(event);return {fullScreen:BrowserWindow.fromWebContents(event.sender)?.isFullScreen()??false};});
    ipcMain.handle('align-window-buttons',(event,input)=>{
      trusted(event);
      const {sidebarWidth}=z.object({sidebarWidth:z.number().finite().min(60).max(400)}).strict().parse(input);
      const win=BrowserWindow.fromWebContents(event.sender);
      if(process.platform!=='darwin'||!win||win.isFullScreen())return;
      // Native controls span 60 points on this macOS title bar; DOM measurements use CSS pixels.
      const railWidth=sidebarWidth*win.webContents.getZoomFactor();
      win.setWindowButtonPosition({x:Math.max(0,Math.round((railWidth-60)/2)),y:14});
    });
    ipcMain.handle('new-window',event=>{trusted(event);window();});
    ipcMain.handle('portrait-chatgpt',async(event,input)=>{trusted(event);const prompt=z.string().trim().min(1).max(1000).parse(input);clipboard.writeText(prompt);await shell.openExternal('https://chatgpt.com/');});
    ipcMain.handle('rules',(event,{action,args})=>{trusted(event);if(action==='search')return rules.search(searchRulesSchema.parse(args));if(action==='get')return rules.get(z.string().parse(args));if(action==='sources')return rules.sources();throw new Error('Unknown rules action.');});
    ipcMain.handle('assistant',async(event,{action,args})=>{trusted(event);switch(action){
      case 'status':return auth.status();case 'unlock-connection':return auth.unlock(z.enum(['migrate','reconnect']).parse(args?.mode??'migrate'));case 'cancel-unlock':return auth.cancelUnlock();case 'login':assistant.stopAll();return auth.login(args?.profileId);case 'cancel-login':return auth.cancel();case 'select-account':assistant.stopAll();return auth.select(z.string().parse(args?.id));case 'logout':assistant.stopAll();return auth.logout();case 'models':return auth.models();
      case 'model-preference':return auth.modelPreference();case 'select-model':return auth.selectModel(z.string().parse(args?.model));
      case 'sessions':return assistant.list(z.string().parse(args?.characterId));case 'messages':return assistant.messages(z.string().parse(args?.sessionId));case 'new-session':return assistant.create(z.string().parse(args?.characterId),z.string().max(150).parse(args?.title??''));
      case 'delete-session':return assistant.deleteSession(z.string().uuid().parse(args?.sessionId),z.string().min(1).parse(args?.characterId));
      case 'send':return assistant.send(z.string().parse(args?.sessionId),z.string().parse(args?.text),z.string().parse(args?.model));case 'stop':return assistant.stop(z.string().parse(args?.sessionId));
      case 'lookup':return assistant.lookup(z.string().max(300).parse(args?.query),z.enum(['5e-2014','5e-2024','3.5e']).parse(args?.edition));
      case 'apply-proposal':{const result=await assistant.applyProposal(z.string().parse(args?.id));broadcast('storage-changed');return result;}
      case 'undo-action':return assistant.undoAction(z.string().uuid().parse(args?.id));
      default:throw new Error('Unknown guide action.');
    }});
    if(process.env.RIVET_IMPORT_BACKUP){const filename=resolve(process.env.RIVET_IMPORT_BACKUP);if(readFileSync(filename).byteLength>20*1024*1024)throw new Error('Migration backup is too large.');const backup=JSON.parse(readFileSync(filename,'utf8'));if(backup.schemaVersion===1){const migrated=await migrateLegacy(backup);await workspace.importRecords(migrated.records,[migrated.source]);}else if(backup.format==='rivet-workspace'&&backup.schemaVersion===2){await workspace.importRecords(backup.records,backup.sourceArchives??[],backup.recoveryCopies??[],backup.archivedRecords??[]);}else throw new Error('Migration backup format not recognized.');}
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Rivet',submenu:[{role:'about'},{type:'separator'},{role:'quit'}]},{label:'File',submenu:[{label:'New window',accelerator:'CmdOrCtrl+N',click:()=>window()},{role:'close'}]},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]));
    window();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)window();});
  }).catch(error=>{dialog.showErrorBox('Rivet could not open',error instanceof Error?error.message:'Local workspace initialization failed.');app.quit();});
  app.on('second-instance',()=>{const win=BrowserWindow.getAllWindows()[0];if(win){if(win.isMinimized())win.restore();win.focus();}});
  app.on('window-all-closed',()=>app.quit());
  let quitting=false;
  app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;void(async()=>{try{await capture?.close();await assistant?.close();}finally{auth?.close();if(capturePowerBlocker!==undefined)powerSaveBlocker.stop(capturePowerBlocker);rules?.close();store?.close();app.quit();}})();});
}
