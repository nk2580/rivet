// Synthetic UI acceptance only. Never opens a microphone, signs in, or uses the normal workspace.
import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {_electron as electron,expect} from '@playwright/test';
const run=promisify(execFile),directory=resolve('.local',`session-capture-qa-${Date.now()}`);await mkdir(directory,{recursive:true});
const seed=join(directory,'seed.mjs');await build({entryPoints:['tests/fixtures/session-capture-qa.ts'],outfile:seed,bundle:true,platform:'node',target:'node24',format:'esm',external:['node:sqlite']});
await run(process.execPath,[seed],{env:{...process.env,RIVET_CAPTURE_QA_DIR:directory}});
const fixture=JSON.parse(await readFile(join(directory,'fixture.json'),'utf8'));
const executable=process.env.RIVET_QA_EXECUTABLE;
const app=await electron.launch({...(executable?{executablePath:resolve(executable)}:{}),args:executable?[]:['.'],cwd:process.cwd(),env:{...process.env,RIVET_DATA_DIR:directory},timeout:30000});
const page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.getByRole('button',{name:'Resume listening',exact:true}).waitFor();
  await expect(page.getByRole('group',{name:'Session and rules tools'}).getByRole('button')).toHaveCount(3);
  await page.getByRole('button',{name:'End session',exact:true}).click();await expect(page.getByRole('dialog',{name:'End this session?'})).toBeVisible();
  await page.screenshot({path:join(directory,'end-confirmation.png')});
  await expect(page.getByRole('button',{name:'Keep session open'})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'End session',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'End session',exact:true}).click();await page.getByRole('button',{name:'Keep session open'}).click();await expect(page.getByRole('button',{name:'Resume listening',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Search SRD locally',exact:true}).click();await expect(page.getByRole('dialog',{name:'Search SRD locally'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Search SRD locally',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Search SRD locally',exact:true}).focus();await page.getByRole('tooltip').waitFor();await expect(page.getByRole('tooltip')).toContainText('Search SRD locally');await page.keyboard.press('Escape');
  for(const [width,height] of [[1440,940],[960,900],[390,844]]){
    await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setSize(width,height),{width,height});
    for(const dark of [false,true]){
      await page.evaluate(dark=>{document.documentElement.classList.toggle('dark',dark);document.documentElement.style.colorScheme=dark?'dark':'light';},dark);
      await page.waitForTimeout(200); // Let the app's 160 ms colour transitions settle before visual capture.
      await page.screenshot({path:join(directory,`sheet-${width}-${dark?'dark':'light'}.png`)});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const boxes=await page.getByRole('group',{name:'Session and rules tools'}).getByRole('button').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
      for(const box of boxes){expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);}
    }
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,940));
  const divider=page.getByRole('separator');await divider.focus();await page.keyboard.press('End');
  await expect(page.getByRole('group',{name:'Session and rules tools'})).toBeInViewport();await page.screenshot({path:join(directory,'wide-chat.png')});await page.keyboard.press('Home');
  await page.getByRole('button',{name:'Expand chat',exact:true}).click();await expect(page.getByRole('button',{name:'Search SRD locally',exact:true})).toHaveCount(1);await page.getByRole('button',{name:'Search SRD locally',exact:true}).click();await expect(page.getByRole('dialog',{name:'Search SRD locally'})).toBeVisible();await page.keyboard.press('Escape');await page.screenshot({path:join(directory,'expanded-chat.png')});await page.getByRole('button',{name:'Collapse chat',exact:true}).click();
  await page.getByRole('button',{name:'Journal',exact:true}).first().click();await page.getByText('Transcript and quick notes',{exact:true}).click();await expect(page.getByLabel('Session capture')).toContainText('The party discovered');await page.screenshot({path:join(directory,'journal.png')});
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__captureCopiedText=text;}}});});
  await page.getByRole('button',{name:'Group',exact:true}).click();expect(await page.evaluate(()=>window.__captureCopiedText)).toContain('discovered the old tower');
  await page.getByRole('button',{name:'DM',exact:true}).click();expect(await page.evaluate(()=>window.__captureCopiedText)).toContain('Prepare the locked upper room');
  await page.getByRole('button',{name:'Play',exact:true}).first().click();
  // Exercise the actual offline end path before replacing capture IPC for microphone-free state coverage.
  await page.getByRole('button',{name:'End session',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'End session',exact:true}).click();await expect(page.getByRole('button',{name:'Final recap pending',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Search SRD locally',exact:true})).toBeFocused();
  // Replace only the capture IPC handler inside this isolated test process to exercise listening UI without a real microphone.
  await app.evaluate(({ipcMain,BrowserWindow},{fixture})=>{
    let status={run:{id:fixture.runId,characterId:fixture.characterId,sessionId:fixture.sessionId,campaignId:'synthetic',title:'The old tower',state:'paused',activeMs:600000,nextSummaryMs:1200000,lastQueuedSequence:1,createdAt:new Date().toISOString(),endedAt:null,error:'',held:false},pendingSegments:1,pendingJobs:0,summarising:false,nextSummarySeconds:600,busy:false};
    ipcMain.removeHandler('session-capture');ipcMain.handle('session-capture',(_event,command)=>{if(command.action==='settings')return {ready:true,helperAvailable:true,installing:false,downloadedBytes:0,deviceId:'',error:''};if(command.action==='status')return status;if(command.action==='start')status={...status,run:{...status.run,state:'listening'}};if(command.action==='pause')status={...status,run:{...status.run,state:'paused'}};if(command.action==='summarise')status={...status,pendingSegments:0};if(command.action==='end')status={...status,run:{...status.run,state:'finalising'}};for(const win of BrowserWindow.getAllWindows())win.webContents.send('capture-event');return status;});
    for(const win of BrowserWindow.getAllWindows())win.webContents.send('capture-event');
  },{fixture});
  await page.getByRole('button',{name:'Play',exact:true}).first().click();await page.getByRole('button',{name:'Resume listening',exact:true}).click();await expect(page.getByRole('button',{name:'Pause listening',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'Summarise now',exact:true})).toBeEnabled();await page.screenshot({path:join(directory,'listening.png')});
  await page.getByRole('button',{name:'Summarise now',exact:true}).click();await expect(page.getByRole('button',{name:'Summarise now',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Pause listening',exact:true}).click();await page.getByRole('button',{name:'End session',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'End session',exact:true}).click();await expect(page.getByRole('button',{name:'Final recap pending',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Search SRD locally',exact:true})).toBeFocused();
  expect(errors).toEqual([]);await writeFile(join(directory,'result.json'),JSON.stringify({passed:true,screenshots:directory,checks:['toolbar order','confirmation cancel/Escape/focus','offline SRD modal','keyboard tooltip','44px targets','long-name/narrow/light/dark layout','journal transcript','listening/paused/summary/finalising states'],note:'Capture UI states are synthetic; no live microphone or GPT request is used.'},null,2));console.log(directory);
}finally{await app.close();}
