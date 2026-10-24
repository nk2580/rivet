import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {copyFile,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Compass} from 'lucide-react';

if(process.platform!=='darwin')throw new Error('Building the macOS icon requires AppKit, Swift and iconutil.');
const run=promisify(execFile),assets=resolve('desktop/assets');
const iconset=resolve('.local/Rivet.iconset'),output=resolve('desktop/assets/Rivet.icns');
const raster=resolve('.local/icon-raster'),cache=resolve('.local/icon-module-cache');

// Derive every variant from the real CSS tokens, including each colour's light
// and dark chroma. Keep the tile full-size; inset only the compass by one unit.
const css=await readFile('src/styles.css','utf8'),appearance=await readFile('src/app/appearance.css','utf8');
const variables=block=>Object.fromEntries([...block.matchAll(/(--[\w-]+):([^;{}]+)/g)].map(match=>[match[1],match[2].trim()]));
const block=(text,pattern)=>{const match=text.match(pattern);if(!match)throw new Error('Missing app theme block.');return variables(match[1]);};
const light=block(css,/:root\{([^}]+)\}/),dark=block(css,/\.dark\{([^}]+)\}/);
const brand=block(appearance,/:root\[data-main-colour\]\{([^}]+)\}/),darkBrand=block(appearance,/:root\.dark\[data-main-colour\]\{([^}]+)\}/);
const choices=[...appearance.matchAll(/:root\[data-main-colour='([^']+)'\]\{([^}]+)\}/g)].map(match=>({id:match[1],values:variables(match[2])}));
const colour=(value,tokens)=>{
  value=value.replace(/var\((--[\w-]+)\)/g,(_match,name)=>{if(!tokens[name])throw new Error(`Missing theme token ${name}`);return tokens[name];});
  value=value.match(/^oklch\(([^)]+)\)$/)?.[1];
  if(!value)throw new Error('Expected an OKLCH app colour.');
  const [lightness,chroma,hue]=value.trim().split(/\s+/).map(Number),angle=hue*Math.PI/180;
  if(![lightness,chroma,hue].every(Number.isFinite))throw new Error('Invalid app colour.');
  const a=chroma*Math.cos(angle),b=chroma*Math.sin(angle);
  const l=(lightness+.3963377774*a+.2158037573*b)**3;
  const m=(lightness-.1055613458*a-.0638541728*b)**3;
  const s=(lightness-.0894841775*a-1.291485548*b)**3;
  const rgb=[4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s];
  return '#'+rgb.map(channel=>Math.round(255*Math.max(0,Math.min(1,channel<=.0031308?12.92*channel:1.055*channel**(1/2.4)-.055)))).map(channel=>channel.toString(16).padStart(2,'0')).join('');
};
const iconSvg=(background,foreground)=>renderToStaticMarkup(createElement(Compass,{width:1024,height:1024,color:foreground}))
  .replace(/(<svg[^>]*>)/,`$1<rect width="24" height="24" rx="5.25" fill="${background}" stroke="none"/><g transform="translate(1 1) scale(0.9166666667)">`)
  .replace('</svg>','</g></svg>');
await mkdir(assets,{recursive:true});await mkdir(raster,{recursive:true});await mkdir(cache,{recursive:true});
const variantAssets=resolve(assets,'icons'),webVariants=resolve('public/app-icons');
await mkdir(variantAssets,{recursive:true});await mkdir(webVariants,{recursive:true});
const manifest=[];
for(const choice of choices)for(const theme of ['light','dark']){
  const tokens={...light,...brand,...choice.values,...(theme==='dark'?{...dark,...darkBrand}:{})};
  const background=colour(tokens['--surface'],tokens),foreground=colour(tokens['--primary'],tokens),name=`${choice.id}-${theme}`;
  const directory=resolve(raster,name);await mkdir(directory,{recursive:true});
  const vector=resolve(directory,'icon.svg');await writeFile(vector,iconSvg(background,foreground)+'\n');
  await run('/usr/bin/swift',['-module-cache-path',cache,resolve('scripts/render-app-icon.swift'),vector,directory,'1024']);
  await copyFile(resolve(directory,'icon-1024.png'),resolve(variantAssets,name+'.png'));
  await copyFile(resolve(directory,'icon-1024.png'),resolve(webVariants,name+'.png'));
  manifest.push({mainColour:choice.id,theme,background,foreground,file:name+'.png'});
}
if(manifest.length!==12)throw new Error('Expected all six app colours in both modes.');
await writeFile(resolve(variantAssets,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const defaults=manifest.find(value=>value.mainColour==='crimson'&&value.theme==='dark');
const {background,foreground}=defaults,svg=iconSvg(background,foreground);
await writeFile(resolve(assets,'rivet-icon.svg'),svg+'\n');
await run('/usr/bin/swift',['-module-cache-path',cache,resolve('scripts/render-app-icon.swift'),resolve(assets,'rivet-icon.svg'),raster]);
await rm(iconset,{recursive:true,force:true});await mkdir(iconset,{recursive:true});
for(const size of [16,32,128,256,512])for(const scale of [1,2]){
  const pixels=size*scale,filename=`${iconset}/icon_${size}x${size}${scale===2?'@2x':''}.png`;
  await copyFile(`${raster}/icon-${pixels}.png`,filename);
}
for(const filename of ['rivet-icon.png','rivet-icon-1024.png'])await copyFile(`${raster}/icon-1024.png`,resolve(assets,filename));
await copyFile(resolve(assets,'rivet-icon.svg'),resolve('public/icon.svg'));
for(const size of [192,512])await copyFile(`${raster}/icon-${size}.png`,resolve(`public/icon-${size}.png`));
await run('/usr/bin/iconutil',['-c','icns',iconset,'-o',output]);
console.log(`${output}\nBuilt 12 light/dark UI variants; full-size tile with an inset compass.`);
