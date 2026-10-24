import {useCallback,useEffect,useRef,useState} from 'react';
import {friendlyError} from '@/lib/errors';

type Account={id:string;label:string;connected:boolean};
type Connection={active:string|null;pending:boolean;error:string;profiles:Account[];lock?:{locked:boolean;available:boolean;touchID:boolean;migration:boolean;hasSavedConnection:boolean}};
type Model={id:string;name:string};

export function useAssistantSettings(){
  const [account,setAccount]=useState<Connection|null>(null);
  const [models,setModels]=useState<Model[]>([]);
  const [model,setModel]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [unlockOpen,setUnlockOpen]=useState(false),[unlockPending,setUnlockPending]=useState(false);
  const unlockVersion=useRef(0);
  const unlockTrigger=useRef<HTMLElement|null>(null);
  const refreshVersion=useRef(0);
  const refresh=useCallback(async()=>{
    const version=++refreshVersion.current;
    setLoading(true);
    try{
      const state:Connection=await window.rivet!.assistant('status');
      if(version!==refreshVersion.current)return;
      setAccount(state);setError(state.error||'');
      if(state.profiles.some(profile=>profile.id===state.active&&profile.connected)){
        const [choices,preference]:[Model[],{model:string}]=await Promise.all([
          window.rivet!.assistant('models'),window.rivet!.assistant('model-preference'),
        ]);
        if(version!==refreshVersion.current)return;
        setModels(choices);
        setModel(choices.some(choice=>choice.id===preference.model)?preference.model:choices[0]?.id??'');
      }else{setModels([]);setModel('');}
    }catch(failure){
      if(version===refreshVersion.current){setModels([]);setModel('');setError(friendlyError(failure));}
    }finally{if(version===refreshVersion.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    void refresh();
    const unsubscribe=window.rivet!.onAssistantEvent(event=>{if(event.type==='account')void refresh();});
    return()=>{refreshVersion.current++;unsubscribe();};
  },[refresh]);
  const run=async(action:()=>Promise<unknown>)=>{
    setError('');setNotice('');setBusy(true);
    try{await action();}catch(failure){setError(friendlyError(failure));}finally{setBusy(false);}
  };
  const changeModel=(next:string)=>run(async()=>{
    await window.rivet!.assistant('select-model',{model:next});
    await refresh();
  });
  const connect=(profileId?:string)=>run(async()=>{
    await window.rivet!.assistant('login',{profileId});
    await refresh();
  });
  const selectAccount=(id:string)=>run(async()=>{
    await window.rivet!.assistant('select-account',{id});
    await refresh();
  });
  const disconnect=()=>run(async()=>{
    const result:{message:string}=await window.rivet!.assistant('logout');
    await refresh();setNotice(result.message);
  });
  const cancel=()=>run(async()=>{await window.rivet!.assistant('cancel-login');await refresh();});
  const openUnlock=(trigger:HTMLElement)=>{unlockTrigger.current=trigger;setError('');setUnlockOpen(true);};
  const restoreUnlockFocus=(event:Event)=>{if(unlockTrigger.current?.isConnected){event.preventDefault();unlockTrigger.current.focus();}};
  const closeUnlock=()=>{
    unlockVersion.current++;setUnlockOpen(false);setUnlockPending(false);setBusy(false);setError('');
    if(unlockPending)void window.rivet!.assistant('cancel-unlock').then(()=>refresh()).catch(()=>{});
  };
  const unlock=async(mode:'migrate'|'reconnect'='migrate')=>{
    const version=++unlockVersion.current;setBusy(true);setUnlockPending(true);setError('');setNotice('');
    try{
      await window.rivet!.assistant('unlock-connection',{mode});
      if(version!==unlockVersion.current)return;
      setUnlockOpen(false);setUnlockPending(false);
      if(mode==='reconnect')await window.rivet!.assistant('login');
      await refresh();
    }catch(failure){if(version===unlockVersion.current)setError(friendlyError(failure));}
    finally{if(version===unlockVersion.current){setBusy(false);setUnlockPending(false);}}
  };
  const connected=account?.profiles.some(profile=>profile.id===account.active&&profile.connected)??false;
  return {account,models,model,loading,busy,error,notice,connected,refresh,changeModel,connect,selectAccount,disconnect,cancel,openUnlock,closeUnlock,restoreUnlockFocus,unlockOpen,unlockPending,unlock};
}
export type AssistantSettingsController=ReturnType<typeof useAssistantSettings>;
