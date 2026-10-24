import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {unzipSync} from 'fflate';
const run=promisify(execFile),cache=resolve('.local/capture-deps'),out=resolve('dist-electron');
await mkdir(cache,{recursive:true});await mkdir(out,{recursive:true});
await mkdir(join(out,'speech-licenses'),{recursive:true});
await copyFile('desktop/native/licenses/Apache-2.0.txt',join(out,'speech-licenses','Apache-2.0.txt'));
await copyFile('node_modules/fflate/LICENSE',join(out,'speech-licenses','fflate-MIT.txt'));
const targets={
  darwin:{name:'vosk-osx',version:'0.3.42',sha:'65395f196c9d0583d79949142b25560acaf9c295f36284e18433097f3adb0ea1',library:'libvosk.dylib'},
  linux:{name:'vosk-linux-x86_64',version:'0.3.45',sha:'bbdc8ed85c43979f6443142889770ea95cbfbc56cffb5c5dcd73afa875c5fbb2',library:'libvosk.so'},
  win32:{name:'vosk-win64',version:'0.3.45',sha:'f1dcc9cca460630f81ea8f71794f69c80bed6556d2a4e6237b5785e1d2dff34b',library:'libvosk.dll'},
};
const target=targets[process.platform];
if(!target||(process.platform!=='darwin'&&process.arch!=='x64')||(process.platform==='darwin'&&!['arm64','x64'].includes(process.arch)))throw new Error(`Offline speech build is not supported for ${process.platform}/${process.arch}.`);
async function dependency(filename,url,sha){
  const file=join(cache,filename);let bytes;
  if(existsSync(file))bytes=await readFile(file);
  else {console.log(`Downloading pinned speech dependency ${filename}`);const response=await fetch(url);if(!response.ok)throw new Error(`Speech dependency download failed (${response.status}).`);bytes=Buffer.from(await response.arrayBuffer());}
  if(createHash('sha256').update(bytes).digest('hex')!==sha)throw new Error(`Speech dependency checksum mismatch: ${filename}`);
  await writeFile(file,bytes);return bytes;
}
await dependency('miniaudio.h','https://raw.githubusercontent.com/mackron/miniaudio/0.11.23/miniaudio.h','7e4f3f13c8fe66df2080ac3dd12a89193e3c2463cb7f067c798abd7331cd8ee6');
const archive=await dependency(process.platform==='darwin'?'vosk-osx.zip':process.platform==='linux'?'vosk-linux.zip':'vosk-win.zip',`https://github.com/alphacep/vosk-api/releases/download/v${target.version}/${target.name}-${target.version}.zip`,target.sha);
const files=unzipSync(archive,{filter:entry=>/\.(?:dll|dylib|so)$/.test(entry.name)});
for(const [name,data]of Object.entries(files))await writeFile(join(out,basename(name)),data);
const binary=join(out,process.platform==='win32'?'rivet-capture.exe':'rivet-capture');
const source=resolve('desktop/native/session-capture.cpp');
if(process.platform==='win32')await run(process.env.CXX??'cl',['/nologo','/O2','/MT','/std:c++17','/EHsc',`/I${cache}`,source,`/Fe:${binary}`,'/link','ole32.lib','uuid.lib','psapi.lib']);
else await run(process.env.CXX??'c++',['-std=c++17','-O2','-pthread','-I',cache,source,'-o',binary,...(process.platform==='darwin'?['-framework','CoreAudio','-framework','AudioToolbox','-framework','CoreFoundation']:['-ldl','-lm'])],{maxBuffer:8*1024*1024});
if(process.platform==='darwin'){
  await run('/usr/bin/codesign',['--force','--sign','-',join(out,target.library)]);
  await run('/usr/bin/codesign',['--force','--sign','-','--identifier','com.rivet.desktop.capture',binary]);
}
console.log(`Built offline speech helper for ${process.platform}/${process.arch}`);
