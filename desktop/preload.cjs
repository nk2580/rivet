const {contextBridge,ipcRenderer}=require('electron');
const subscribe=(channel,callback)=>{const handler=(_event,value)=>callback(value);ipcRenderer.on(channel,handler);return()=>ipcRenderer.removeListener(channel,handler);};
contextBridge.exposeInMainWorld('rivet',Object.freeze({
  platform:process.platform,
  appearance:command=>ipcRenderer.invoke('appearance',command),
  onAppearanceChanged:callback=>subscribe('appearance-changed',callback),
  windowState:()=>ipcRenderer.invoke('window-state'),
  alignWindowButtons:sidebarWidth=>ipcRenderer.invoke('align-window-buttons',{sidebarWidth}),
  onWindowStateChanged:callback=>subscribe('window-state-changed',callback),
  workspace:(action,args)=>ipcRenderer.invoke('workspace',{action,args}),
  onStorageChanged:callback=>subscribe('storage-changed',callback),
  systemInfo:()=>ipcRenderer.invoke('system-info'),
  assistant:(action,args)=>ipcRenderer.invoke('assistant',{action,args}),
  onAssistantEvent:callback=>subscribe('assistant-event',callback),
  sessionCapture:command=>ipcRenderer.invoke('session-capture',command),
  onCaptureEvent:callback=>subscribe('capture-event',callback),
  rules:(action,args)=>ipcRenderer.invoke('rules',{action,args}),
  newWindow:()=>ipcRenderer.invoke('new-window'),
  openPortraitChatGPT:prompt=>ipcRenderer.invoke('portrait-chatgpt',prompt)
}));
