export {};
declare global {
  interface Window {rivet?:{
    platform:string;
    appearance:(command:import('../domain/appearance').AppearanceCommand)=>Promise<import('../domain/appearance').AppearanceState>;
    onAppearanceChanged:(callback:(state:import('../domain/appearance').AppearanceState)=>void)=>()=>void;
    windowState:()=>Promise<{fullScreen:boolean}>;
    alignWindowButtons:(sidebarWidth:number)=>Promise<void>;
    onWindowStateChanged:(callback:(state:{fullScreen:boolean})=>void)=>()=>void;
    workspace:(action:string,args:unknown[])=>Promise<unknown>;
    onStorageChanged:(callback:()=>void)=>()=>void;
    systemInfo:()=>Promise<{dataPath:string;rulesEntries:number;version:string}>;
    assistant:(action:string,args?:unknown)=>Promise<any>;
    onAssistantEvent:(callback:(event:any)=>void)=>()=>void;
    sessionCapture:(command:import('../domain/session-capture').CaptureCommand)=>Promise<unknown>;
    onCaptureEvent:(callback:()=>void)=>()=>void;
    rules:(action:string,args:unknown)=>Promise<any>;
    newWindow:()=>Promise<void>;
    openPortraitChatGPT:(prompt:string)=>Promise<void>;
  };}
}
