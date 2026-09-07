const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { create } = require('../combat-audio.js');
const manifest = require('../sounds/manifest.js');
const root = path.join(__dirname, '..');

async function main() {
  const hashes = new Set();
  let files = 0;
  for (const [name, spec] of Object.entries(manifest.sounds)) {
    for (const file of spec.files) {
      const bytes = fs.readFileSync(path.join(root, 'sounds', file));
      assert.equal(bytes.toString('ascii',0,4),'RIFF');
      assert.equal(bytes.toString('ascii',8,12),'WAVE');
      assert.equal(bytes.readUInt16LE(20),1);
      assert.equal(bytes.readUInt16LE(22),2);
      assert.equal(bytes.readUInt32LE(24),44100);
      assert.equal(bytes.readUInt16LE(34),16);
      assert.equal(bytes.readUInt32LE(40),bytes.length-44);
      let peak=0, squares=0, dc=0, onset=-1;
      for(let i=44;i<bytes.length;i+=2) {
        const v=bytes.readInt16LE(i)/32768;
        peak=Math.max(peak,Math.abs(v)); squares+=v*v; dc+=v;
        if(onset<0 && Math.abs(v)>0.003) onset=(i-44)/4/44100;
      }
      assert(peak<0.92 && peak>0.15,`${file}: unclipped peak ${peak}`);
      assert(Math.sqrt(squares/((bytes.length-44)/2))>0.006,`${file}: audible signal`);
      assert(Math.abs(dc/((bytes.length-44)/2))<0.005,`${file}: DC offset`);
      assert(onset>=0 && onset<(name==='dragonCharge'?0.18:0.065),`${file}: late onset ${onset}`);
      assert.equal(bytes.readInt16LE(bytes.length-2),0,`${file}: faded ending`);
      const hash=crypto.createHash('sha256').update(bytes).digest('hex');
      assert(!hashes.has(hash),`${file}: duplicate asset`); hashes.add(hash); files++;
    }
  }
  const game=fs.readFileSync(path.join(root,'game.js'),'utf8');
  const block=game.slice(game.indexOf('const SFX = {'),game.indexOf('// Generated Foley bank'));
  for(const match of block.matchAll(/^  (\w+)\([^\n]*\) \{/gm)) assert(manifest.sounds[match[1]],`Missing event ${match[1]}`);
  for(const match of game.matchAll(/SFX\.(\w+)\(/g)) assert(manifest.sounds[match[1]],`Missing call ${match[1]}`);
  console.log(`PASS ${files} distinct stereo WAVs: headers, headroom, onset, DC, tails and complete SFX coverage`);

  const sources=[];
  const context={ state:'running',currentTime:0,
    decodeAudioData:async bytes=>({duration:bytes.byteLength/176400,bytes}),
    createBufferSource() {
      const src={playbackRate:{value:1},connect(){},disconnect(){this.disconnected=true;},
        start(){this.started=true;},stop(){this.stopped=true;this.onended?.();}};
      sources.push(src);return src;
    },
    createGain:()=>({gain:{value:1},connect(){},disconnect(){this.disconnected=true;}})
  };
  let fetches=0, pending=0, maxPending=0;
  const fetcher=async url=>{
    fetches++; pending++;maxPending=Math.max(maxPending,pending);
    await Promise.resolve();pending--;
    const name=url.split('/').at(-1).split('?')[0];
    const b=fs.readFileSync(path.join(root,'sounds',name));
    return {ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
  };
  const bank=create({manifest,fetcher,random:()=>0.5,maxVoices:5});
  assert.equal(bank.play('punch'),false);
  await bank.preload(); assert(maxPending<=4);
  await Promise.all([bank.load(context,{}),bank.load(context,{})]);
  assert.equal(fetches,files,'loads once');
  assert.equal(bank.status().loaded,46);
  assert(bank.play('punch',1.15));
  const first=sources.at(-1).buffer;
  assert.equal(bank.play('punch'),true);assert.equal(sources.length,1,'same-frame deduplication');
  context.currentTime+=0.1; bank.play('punch');assert.notEqual(sources.at(-1).buffer,first,'no adjacent identical variant');
  bank.play('dragonCharge');assert.equal(sources.at(-1).playbackRate.value,1,'charge timing is fixed');
  for(let i=0;i<30;i++){context.currentTime+=0.05;bank.play('tileBurst');}
  assert(bank.status().active<=5);
  bank.play('dragonBurst');assert.equal(sources.at(-1).started,true,'priority cue admitted');
  bank.stop('dragonCharge');assert(sources.find(s=>s.buffer===first));
  bank.stopAll();assert.equal(bank.status().active,0);assert(sources.every(s=>s.disconnected));
  context.state='suspended';assert.equal(bank.play('punch'),false);context.state='running';
  assert.equal(bank.play('nonexistent'),false);
  const broken=create({manifest,fetcher:async()=>({ok:false})});
  await broken.load(context,{});assert.equal(broken.status().loaded,0);assert.equal(broken.play('punch'),false);
  console.log('PASS bounded preload, idempotent decode, variants, debounce, fixed cast timing, voice budget, cleanup and fallback');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
