import {join} from 'node:path';
import {appearanceSchema,resolveAppearance,type Appearance,type AppearanceState} from '../src/domain/appearance';
import type {SQLiteStore} from './sqlite';

/** Mirror the renderer preference for an immediately correct icon on next launch. */
export class DesktopAppearance {
  private preferences:Appearance={theme:'system',mainColour:'crimson'};
  private iconKey='';
  private queue:Promise<unknown>=Promise.resolve();
  constructor(private store:SQLiteStore,private icons:string,private native:{systemDark:()=>boolean;setIcon:(path:string)=>void;changed:(state:AppearanceState)=>void}){}
  state(){return resolveAppearance(this.preferences,this.native.systemDark());}
  async initialize(){
    const saved=appearanceSchema.safeParse((await this.store.meta.get('appearance/icon'))?.value);
    if(saved.success)this.preferences=saved.data;
    this.refresh();return this.state();
  }
  set(input:unknown):Promise<AppearanceState>{
    const value=appearanceSchema.parse(input);
    const operation=this.queue.then(async()=>{
      if(value.theme!==this.preferences.theme||value.mainColour!==this.preferences.mainColour){
        await this.store.meta.put({key:'appearance/icon',value});
        this.preferences=value;
        this.refresh();this.native.changed(this.state());
      }else this.refresh();
      return this.state();
    });
    this.queue=operation.catch(()=>{});return operation;
  }
  refresh(){
    const state=this.state(),key=`${state.mainColour}-${state.resolvedTheme}`;
    if(key===this.iconKey)return;
    this.native.setIcon(join(this.icons,key+'.png'));
    this.iconKey=key;
  }
}
