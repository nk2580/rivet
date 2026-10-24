import {packager} from '@electron/packager';
import {copyFile,cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
if(process.platform==='darwin')await import('./build-app-icon.mjs');
const staging=resolve('.local/desktop-package');await rm(staging,{recursive:true,force:true});await mkdir(staging,{recursive:true});
const source=JSON.parse(await readFile('package.json','utf8'));
// Keep the product version while giving every local package a newer build.
// Reusing 0.1.0 for every binary lets macOS retain stale application metadata.
const buildState=resolve('.local/desktop-build.json');
const versions=[source.version];
try{versions.push(JSON.parse(await readFile(buildState,'utf8')).buildVersion);}catch(error){if(error.code!=='ENOENT')throw error;}
try{versions.push((await run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion','/Applications/Rivet.app/Contents/Info.plist'])).stdout.trim());}catch{}
const candidates=versions.filter(value=>typeof value==='string'&&/^\d{1,4}\.\d{1,2}\.\d{1,2}$/.test(value)).map(value=>value.split('.').map(Number));
if(!candidates.length)throw new Error('No valid desktop build version.');
candidates.sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);
const next=[...candidates.at(-1)];if(++next[2]>99){next[2]=0;if(++next[1]>99){next[1]=0;next[0]++;}}
if(next[0]>9999)throw new Error('Desktop build version exhausted.');
const buildVersion=next.join('.');
const iconName=process.platform==='darwin'?`Rivet-${createHash('sha256').update(await readFile('desktop/assets/Rivet.icns')).digest('hex').slice(0,12)}.icns`:'Rivet.icns';
await copyFile('desktop/assets/rivet-icon.png','dist-electron/rivet-icon.png');
await cp('desktop/assets/icons','dist-electron/icons',{recursive:true});
await writeFile(staging+'/package.json',JSON.stringify({name:source.name,version:source.version,description:source.description,author:source.author,main:source.main},null,2));
for(const path of ['dist','dist-electron','LICENSE','THIRD_PARTY_NOTICES.md'])await cp(path,staging+'/'+path,{recursive:true});
for(const name of ['icon.svg','icon-192.png','icon-512.png'])await copyFile('public/'+name,staging+'/dist/'+name);
await cp('public/app-icons',staging+'/dist/app-icons',{recursive:true});
const apps=await packager({dir:staging,name:'Rivet',appBundleId:'com.rivet.desktop',appVersion:source.version,buildVersion,appCopyright:'Copyright © 2026 Rivet',appCategoryType:'public.app-category.games',icon:resolve(process.platform==='darwin'?'desktop/assets/Rivet.icns':'desktop/assets/rivet-icon.png'),darwinDarkModeSupport:true,extendInfo:{CFBundleDisplayName:'Rivet',CFBundleIconFile:iconName,NSHighResolutionCapable:true,NSMicrophoneUsageDescription:'Rivet turns table speech into local text for session journal recaps. Audio is not saved or uploaded.'},platform:process.platform,arch:process.arch,electronVersion:source.devDependencies.electron,asar:{unpackDir:'dist-electron'},out:'release',overwrite:true,prune:false});
if(process.platform==='darwin')for(const path of apps){
  const app=resolve(path,'Rivet.app');
  await rm(resolve(app,'Contents/Resources/electron.icns'),{force:true});
  await run('/usr/bin/codesign',['--force','--sign','-','--identifier','com.rivet.desktop.auth',resolve(app,'Contents/Resources/app.asar.unpacked/dist-electron/rivet-auth')]);
  await run('/usr/bin/codesign',['--force','--sign','-',resolve(app,'Contents/Resources/app.asar.unpacked/dist-electron/libvosk.dylib')]);
  await run('/usr/bin/codesign',['--force','--sign','-','--identifier','com.rivet.desktop.capture',resolve(app,'Contents/Resources/app.asar.unpacked/dist-electron/rivet-capture')]);
  await run('/usr/bin/codesign',['--force','--deep','--sign','-',app]);
  await run('/usr/bin/codesign',['--verify','--deep','--strict',app]);
}
await writeFile(buildState,JSON.stringify({buildVersion},null,2)+'\n');
console.log(apps.join('\n'));
console.log(`Build ${buildVersion}; application icon ${iconName}`);
