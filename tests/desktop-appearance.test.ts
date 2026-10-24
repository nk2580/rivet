import {describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DesktopAppearance} from '../desktop/appearance';
import {SQLiteStore} from '../desktop/sqlite';
import {mainColours,type Appearance} from '../src/domain/appearance';

const fixture=()=>{
  const store=new SQLiteStore(':memory:');let dark=true;
  const native={systemDark:()=>dark,setIcon:vi.fn(),changed:vi.fn()};
  return {store,native,runtime:new DesktopAppearance(store,'/bundled/icons',native),setDark:(value:boolean)=>{dark=value;}};
};
describe('Desktop icon appearance',()=>{
  it('uses the system mode on first launch without touching other workspace metadata',async()=>{
    const f=fixture();
    try{
      await f.store.meta.put({key:'unrelated',value:'keep'});
      expect(await f.runtime.initialize()).toEqual({theme:'system',mainColour:'crimson',resolvedTheme:'dark'});
      expect(f.native.setIcon).toHaveBeenLastCalledWith('/bundled/icons/crimson-dark.png');
      expect(await f.store.meta.toArray()).toEqual([{key:'unrelated',value:'keep'}]);
    }finally{f.store.close();}
  });
  for(const colour of mainColours)for(const theme of ['light','dark'] as const)it(`loads the ${colour.id} ${theme} icon`,async()=>{
    const f=fixture();
    try{
      await f.runtime.initialize();
      const value={mainColour:colour.id,theme};
      expect(await f.runtime.set(value)).toEqual({...value,resolvedTheme:theme});
      expect(f.native.setIcon).toHaveBeenLastCalledWith(`/bundled/icons/${colour.id}-${theme}.png`);
      expect((await f.store.meta.get('appearance/icon'))?.value).toEqual(value);
    }finally{f.store.close();}
  });
  it('restores the last icon immediately after an actual SQLite restart',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'rivet-appearance-')),file=join(directory,'workspace.sqlite');
    let store=new SQLiteStore(file);
    const native={systemDark:()=>true,setIcon:vi.fn(),changed:vi.fn()};
    try{
      let runtime=new DesktopAppearance(store,'/bundled/icons',native);await runtime.initialize();
      await runtime.set({theme:'light',mainColour:'sapphire'});store.close();
      store=new SQLiteStore(file);native.setIcon.mockClear();
      runtime=new DesktopAppearance(store,'/bundled/icons',native);
      expect(await runtime.initialize()).toEqual({theme:'light',mainColour:'sapphire',resolvedTheme:'light'});
      expect(native.setIcon).toHaveBeenCalledExactlyOnceWith('/bundled/icons/sapphire-light.png');
    }finally{store.close();await rm(directory,{recursive:true,force:true});}
  });
  it('follows system changes only in system mode and skips redundant icon redraws',async()=>{
    const f=fixture();
    try{
      await f.runtime.initialize();f.native.setIcon.mockClear();
      f.setDark(false);f.runtime.refresh();
      expect(f.native.setIcon).toHaveBeenCalledExactlyOnceWith('/bundled/icons/crimson-light.png');
      f.runtime.refresh();expect(f.native.setIcon).toHaveBeenCalledTimes(1);
      await f.runtime.set({theme:'light',mainColour:'crimson'});f.native.setIcon.mockClear();
      f.setDark(true);f.runtime.refresh();expect(f.native.setIcon).not.toHaveBeenCalled();
      await f.runtime.set({theme:'system',mainColour:'forest'});
      expect(f.native.setIcon).toHaveBeenLastCalledWith('/bundled/icons/forest-dark.png');
      f.setDark(false);f.runtime.refresh();
      expect(f.native.setIcon).toHaveBeenLastCalledWith('/bundled/icons/forest-light.png');
      expect((await f.store.meta.get('appearance/icon'))?.value).toEqual({theme:'system',mainColour:'forest'});
    }finally{f.store.close();}
  });
  it('serializes rapid preference changes and retains the final choice',async()=>{
    const f=fixture();
    try{
      await f.runtime.initialize();
      const choices:Appearance[]=[{theme:'light',mainColour:'amber'},{theme:'dark',mainColour:'teal'},{theme:'light',mainColour:'violet'}];
      await Promise.all(choices.map(value=>f.runtime.set(value)));
      expect(f.runtime.state()).toEqual({...choices[2],resolvedTheme:'light'});
      expect(f.native.setIcon).toHaveBeenLastCalledWith('/bundled/icons/violet-light.png');
      expect((await f.store.meta.get('appearance/icon'))?.value).toEqual(choices[2]);
    }finally{f.store.close();}
  });
  it('preserves the prior icon on a failed preference write, then accepts a retry',async()=>{
    const f=fixture();
    try{
      await f.runtime.initialize();f.native.setIcon.mockClear();
      const put=vi.spyOn(f.store.meta,'put').mockRejectedValueOnce(new Error('Synthetic full disk'));
      await expect(f.runtime.set({theme:'light',mainColour:'amber'})).rejects.toThrow('Synthetic full disk');
      expect(f.native.setIcon).not.toHaveBeenCalled();expect(f.runtime.state().mainColour).toBe('crimson');
      put.mockRestore();await f.runtime.set({theme:'light',mainColour:'amber'});
      expect(f.native.setIcon).toHaveBeenLastCalledWith('/bundled/icons/amber-light.png');
    }finally{f.store.close();}
  });
  it('rejects unexpected fields, unknown themes and path-shaped colour values',async()=>{
    const f=fixture();
    try{
      await f.runtime.initialize();f.native.setIcon.mockClear();
      for(const input of [{theme:'dark',mainColour:'../../other'},{theme:'automatic',mainColour:'crimson'},{theme:'light',mainColour:'teal',path:'/tmp/other.png'}])expect(()=>f.runtime.set(input)).toThrow();
      expect(f.native.setIcon).not.toHaveBeenCalled();expect(await f.store.meta.get('appearance/icon')).toBeUndefined();
    }finally{f.store.close();}
  });
});
