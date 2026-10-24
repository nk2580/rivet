import {build} from 'esbuild';
import {mkdir,copyFile,writeFile,cp} from 'node:fs/promises';
await mkdir('dist-electron',{recursive:true});
await build({entryPoints:['desktop/main.ts','desktop/mcp.ts','desktop/build-rules.ts'],bundle:true,outdir:'dist-electron',platform:'node',target:'node24',format:'cjs',outExtension:{'.js':'.cjs'},external:['electron','node:sqlite'],logLevel:'info'});
await copyFile('desktop/preload.cjs','dist-electron/preload.cjs');
await copyFile('desktop/assets/rivet-icon.png','dist-electron/rivet-icon.png');
await cp('desktop/assets/icons','dist-electron/icons',{recursive:true});
await import('./build-native-auth.mjs');
await import('./build-capture.mjs');
