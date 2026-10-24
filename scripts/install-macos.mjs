import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,mkdir,rename,rm,utimes} from 'node:fs/promises';
import {resolve,join} from 'node:path';

if(process.platform!=='darwin')throw new Error('This installer is for macOS.');
const run=promisify(execFile),source=resolve(`release/Rivet-darwin-${process.arch}/Rivet.app`);
const destination='/Applications/Rivet.app',staged=`/Applications/.Rivet-install-${process.pid}.app`;
const registrar='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
try{
  await run('/usr/bin/pgrep',['-x','Rivet']);
  throw new Error('Quit Rivet before installing an update.');
}catch(error){if(error.code!==1)throw error;}
const exists=async path=>{try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const bundleID=async app=>(await run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',join(app,'Contents/Info.plist')])).stdout.trim();
if(await bundleID(source)!=='com.rivet.desktop')throw new Error('The source is not the Rivet desktop application.');
await run('/usr/bin/codesign',['--verify','--deep','--strict',source]);
const previous=await exists(destination);
if(previous&&(previous.isSymbolicLink()||await bundleID(destination)!=='com.rivet.desktop'))throw new Error('An unrelated application or symlink already occupies /Applications/Rivet.app.');
if(await exists(staged))throw new Error('An installation staging folder already exists.');
let backup;
try{
  await run('/usr/bin/ditto',[source,staged]);
  await run('/usr/bin/codesign',['--verify','--deep','--strict',staged]);
  if(previous){
    const folder=resolve('.local/installed-app-backups');await mkdir(folder,{recursive:true});
    backup=join(folder,`Rivet-${new Date().toISOString().replaceAll(':','-')}.app`);
    await rename(destination,backup);
  }
  try{await rename(staged,destination);}catch(error){if(backup)await rename(backup,destination);throw error;}
  if(backup)await run(registrar,['-u',backup]).catch(()=>{});
  await run(registrar,['-u',source]).catch(()=>{});
  const now=new Date();await utimes(destination,now,now);
  await run(registrar,['-f',destination]);
  await run('/usr/bin/mdimport',['-i',destination]);
  console.log(`Installed ${destination}. Registered with Launch Services and requested Spotlight indexing.`);
  if(backup)console.log(`Previous application retained at ${backup}.`);
}finally{if(await exists(staged))await rm(staged,{recursive:true,force:true});}
