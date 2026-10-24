import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir} from 'node:fs/promises';
if(process.platform==='darwin'){
  await mkdir('dist-electron',{recursive:true});
  await promisify(execFile)('xcrun',['swiftc','desktop/native/RivetAuth.swift','-O','-o','dist-electron/rivet-auth','-module-cache-path','.local/swift-module-cache','-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker','desktop/native/Info.plist']);
}
