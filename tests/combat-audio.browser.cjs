const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const server = http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(file,(err,data)=>{
      if(err){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.wav')?'audio/wav':file.endsWith('.css')?'text/css':'text/html');
      res.end(data);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
    const page=await browser.newPage({hasTouch:true});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{localStorage.setItem('pulsedeck.muted','0');window.requestAnimationFrame=()=>0;});
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.locator('canvas').first().click();
    try { await page.waitForFunction(()=>soundBank.status().loaded===46, null, {polling:50}); }
    catch (error) {
      console.log(await page.evaluate(()=>({bank:soundBank?.status(),audioBroken,audioState:audioCtx?.state,requests:performance.getEntriesByType('resource').filter(r=>r.name.includes('.wav')).map(r=>({name:r.name,size:r.transferSize}))})));
      console.log(errors);throw error;
    }
    const result=await page.evaluate(async()=>{
      soundBank.stopAll();
      const captured={};
      const original=audioCtx.createBufferSource.bind(audioCtx);
      let cue='';
      audioCtx.createBufferSource=()=>{const source=original(); captured[cue]=source;return source;};
      for(const name of Object.keys(COMBAT_SOUND_MANIFEST.sounds)) {
        cue=name;SFX[name]();soundBank.stopAll();
      }
      audioCtx.createBufferSource=original;
      const allDecoded=Object.keys(captured).filter(name=>captured[name].buffer).length;
      const offline=new OfflineAudioContext(2,44100*5,44100);
      const master=offline.createGain(); master.gain.value=MASTER_VOL;
      const limiter=offline.createDynamicsCompressor();limiter.threshold.value=-10;limiter.knee.value=8;limiter.ratio.value=4;limiter.attack.value=.002;limiter.release.value=.14;
      const clip=offline.createWaveShaper();const curve=new Float32Array(2048);
      for(let i=0;i<curve.length;i++)curve[i]=Math.tanh(i/(curve.length-1)*2-1);
      clip.curve=curve;clip.oversample='4x';master.connect(limiter);limiter.connect(clip);clip.connect(offline.destination);
      const schedule=[['swordSwing',0],['swordImpact',.18],['dartThrow',.6],['dartImpact',.76],['punch',1.1],['channelTick',1.45],['channelTick',1.65],['channelFinish',1.85],['dragonBurst',2.8],['enemyCleave',2.8],['tileBurst',2.8],['critAccent',2.8],['teleport',3.6]];
      for(const [name,at]of schedule){const source=offline.createBufferSource();source.buffer=captured[name].buffer;source.connect(master);source.start(at);}
      const rendered=await offline.startRendering();
      let peak=0,sum=0;
      for(let c=0;c<2;c++)for(const value of rendered.getChannelData(c)){peak=Math.max(peak,Math.abs(value));sum+=value*value;}
      const brightness=name=>{const data=captured[name].buffer.getChannelData(0);let diff=0,total=0;for(let i=1;i<data.length;i++){diff+=(data[i]-data[i-1])**2;total+=data[i]**2;}return diff/total;};
      SFX.dragonCharge();togglePause();const pauseVoices=soundBank.status().active;
      togglePause();restartGame();const afterRestart=soundBank.status().active;
      SFX.punch();toggleMute();SFX.dragonBurst();const mutedVoices=soundBank.status().active;toggleMute();
      return {allDecoded,peak,rms:Math.sqrt(sum/(rendered.length*2)),swordBrightness:brightness('swordImpact'),fistBrightness:brightness('punch'),pauseVoices,afterRestart,mutedVoices,status:soundBank.status()};
    });
    const cardEvents=await page.evaluate(()=>{
      const events=[],originals={...SFX},results={};
      for(const name of Object.keys(SFX))SFX[name]=(...args)=>{events.push(name);return originals[name](...args);};
      for(const [classId,definition] of Object.entries(classes))for(const card of definition.deck){
        selectedClass=classId;restartGame();events.length=0;state.player.hand[0]=card;resolveCard(0);results[card.id]=events.slice();
      }
      Object.assign(SFX,originals);restartGame();return results;
    });
    const expected={'bone-nail':'nailThrow','thousand-machine':'machineBox','silk-armor':'silkArmor','pear-blossom':'needleRain','sword-qi':'swordBeam','cross-cut':'crossCut','thrust':'thrust','moon-arc':'counterStance','driving-palm':'palmPush','dragon-pull':'dragonPull','meridian-lock':'meridianLock','hundred-fist':'channelStart','breathing':'breathing','dragon-regret':'dragonCharge'};
    for(const [id,cue] of Object.entries(expected))assert(cardEvents[id]?.includes(cue),`${id} should trigger ${cue}`);
    assert.equal(result.allDecoded,46);assert(result.peak<0.95 && result.rms>.025);
    assert(result.swordBrightness>result.fistBrightness*1.5,'metal and flesh should have distinct spectra');
    assert(result.pauseVoices<=1);assert.equal(result.afterRestart,0);assert.equal(result.mutedVoices,0);
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{selectedClass='boxer';restartGame();state.enemy.row=state.player.row;});
    await page.locator('canvas').first().tap();
    assert(await page.evaluate(()=>Boolean(state.player.boxerStrike)),'mobile tap starts boxer attack');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify(result,null,2));
    console.log('PASS browser decode/playback for all 46 events and 14 cards, real offline mix, distinct impact spectra, pause/restart/mute, mobile attack, no JS errors');
  } finally {
    await browser?.close();await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
