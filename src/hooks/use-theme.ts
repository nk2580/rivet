import {useCallback,useEffect,useState,type Dispatch,type SetStateAction} from 'react';
import {mainColours,type MainColour,type Theme} from '@/domain/appearance';
export {mainColours,type MainColour,type Theme} from '@/domain/appearance';
const mainColourKey='rivet:main-colour',themeKey='rivet:theme';
const readMainColour=(value:string|null):MainColour=>mainColours.find(colour=>colour.id===value)?.id??'crimson';
const readTheme=(value:string|null):Theme=>value==='dark'||value==='light'?value:'system';
const syncNative=()=>{void window.rivet?.appearance?.({action:'set',value:{theme:readTheme(localStorage.getItem(themeKey)),mainColour:readMainColour(localStorage.getItem(mainColourKey))}}).catch(()=>{});};

export function useTheme(){
  const [theme,updateTheme]=useState<Theme>(()=>readTheme(localStorage.getItem(themeKey)));
  const [mainColour,updateColour]=useState<MainColour>(()=>readMainColour(localStorage.getItem(mainColourKey)));
  const [systemDark,setSystemDark]=useState(()=>matchMedia('(prefers-color-scheme: dark)').matches);
  const resolvedTheme=theme==='system'?(systemDark?'dark':'light'):theme;
  const setTheme:Dispatch<SetStateAction<Theme>>=useCallback(value=>{
    const next=typeof value==='function'?value(readTheme(localStorage.getItem(themeKey))):value;
    localStorage.setItem(themeKey,next);updateTheme(next);syncNative();
  },[]);
  const setMainColour:Dispatch<SetStateAction<MainColour>>=useCallback(value=>{
    const next=typeof value==='function'?value(readMainColour(localStorage.getItem(mainColourKey))):value;
    localStorage.setItem(mainColourKey,next);updateColour(next);syncNative();
  },[]);
  useEffect(()=>{
    const media=matchMedia('(prefers-color-scheme: dark)'),update=()=>setSystemDark(media.matches);
    update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
  },[]);
  useEffect(()=>{syncNative();},[]);
  useEffect(()=>{
    document.documentElement.classList.toggle('dark',resolvedTheme==='dark');
    document.documentElement.style.colorScheme=resolvedTheme;
    document.documentElement.dataset.mainColour=mainColour;
    const path=`/app-icons/${mainColour}-${resolvedTheme}.png`;
    for(const link of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"],link[rel="apple-touch-icon"]')){
      link.href=path;if(link.rel==='icon')link.type='image/png';
    }
  },[resolvedTheme,mainColour]);
  useEffect(()=>{
    const sync=(event:StorageEvent)=>{
      if(event.storageArea!==localStorage)return;
      if(event.key===themeKey||event.key===null)updateTheme(readTheme(localStorage.getItem(themeKey)));
      if(event.key===mainColourKey||event.key===null)updateColour(readMainColour(localStorage.getItem(mainColourKey)));
    };
    window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
  },[]);
  const toggleTheme=()=>setTheme(current=>current==='system'?(systemDark?'light':'dark'):current==='dark'?'light':'dark');
  return {theme,setTheme,resolvedTheme,toggleTheme,mainColour,setMainColour};
}
