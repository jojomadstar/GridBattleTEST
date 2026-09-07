// Original procedural Foley. Regenerates the entire bank without external assets or packages.
const fs = require('node:fs');
const path = require('node:path');
const RATE = 44100;
const TAU = Math.PI * 2;
const VERSION = '20260906-a';
const root = path.join(__dirname, '..', 'sounds');

function random(seed) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function makeSound(duration, seed) {
  const rng = random(seed);
  const channels = [new Float64Array(Math.ceil(duration * RATE)), new Float64Array(Math.ceil(duration * RATE))];
  function layer(at, dur, gain, signal, envelope, pan = 0, sweep = 0) {
    const start = Math.round(at * RATE), count = Math.ceil(dur * RATE);
    for (let i = 0; i < count && start + i < channels[0].length; i++) {
      const t = i / RATE, u = t / dur;
      const fade = Math.min(1, t / 0.001, (dur - t) / 0.009);
      const v = signal(t, u) * envelope(t, u) * Math.max(0, fade) * gain;
      const p = Math.max(-0.8, Math.min(0.8, pan + (u - 0.5) * sweep));
      channels[0][start + i] += v * Math.cos((p + 1) * Math.PI / 4);
      channels[1][start + i] += v * Math.sin((p + 1) * Math.PI / 4);
    }
  }
  function air(at, dur, gain, from, to, shape = 'hit', pan = 0, sweep = 0) {
    let low = 0, high = 0;
    layer(at, dur, gain, (t, u) => {
      const f = from * Math.pow(to / from, u);
      const white = rng() * 2 - 1;
      low += (white - low) * (1 - Math.exp(-TAU * Math.min(15000, f * 1.9) / RATE));
      high += (low - high) * (1 - Math.exp(-TAU * Math.max(35, f * 0.38) / RATE));
      return (low - high) * 2.5;
    }, (t, u) => shape === 'swell' ? Math.pow(Math.sin(Math.PI * u), 1.3)
      : shape === 'rise' ? Math.pow(u, 1.4) * Math.min(1, (1 - u) * 25)
      : Math.exp(-u * 6), pan, sweep);
  }
  function tone(at, dur, gain, from, to, grit = 0, pan = 0, shape = 'hit') {
    let phase = rng() * 0.15;
    layer(at, dur, gain, (t, u) => {
      phase += TAU * (from * Math.pow(to / from, u)) / RATE;
      return Math.tanh((Math.sin(phase) + grit * 0.3 * Math.sin(phase * 2.013)) * (1 + grit)) / (1 + grit * 0.35);
    }, (t, u) => shape === 'rise' ? Math.pow(u, 0.7) * Math.min(1, (1 - u) * 25) : Math.exp(-u * 5), pan);
  }
  function metal(at, dur, gain, freq, pan = 0, soft = false) {
    const modes = soft ? [1, 2.01, 3.99, 6.04] : [1, 1.483, 2.137, 2.917, 4.071, 5.423, 7.11];
    modes.forEach((ratio, i) => {
      const f = freq * ratio * (0.991 + rng() * 0.018);
      if (f > 16000) return;
      layer(at, dur, gain / (1 + i * 1.25), t => Math.sin(TAU * f * t + 0.3 * Math.sin(TAU * 27 * t)),
        (t, u) => Math.exp(-u * (5 + i * 2.4)), pan);
    });
  }
  function blow(at, scale = 1, pan = 0) {
    air(at, 0.035, 0.62 * scale, 2600, 800, 'hit', pan);
    air(at + 0.003, 0.11, 0.85 * scale, 720, 140, 'hit', pan);
    tone(at + 0.002, 0.21, 0.8 * scale, 180 + rng() * 35, 63, 1.8, pan);
    air(at + 0.016, 0.048, 0.36 * scale, 1100, 280, 'hit', pan);
  }
  function blade(at, dur = 0.19, scale = 1, pan = 0, sweep = 0.9) {
    air(at, dur, 0.8 * scale, 850, 6500, 'swell', pan, sweep);
    air(at, dur * 0.7, 0.38 * scale, 2100, 850, 'hit', pan);
    metal(at + dur * 0.28, dur + 0.14, 0.12 * scale, 1850 + rng() * 170, pan);
  }
  function needle(at, scale = 1, pan = 0) {
    air(at, 0.018, 0.6 * scale, 2800, 7000, 'hit', pan);
    metal(at, 0.09, 0.22 * scale, 2700 + rng() * 900, pan);
    air(at + 0.012, 0.075, 0.45 * scale, 7200, 1800, 'swell', pan, 0.5);
  }
  function boom(at, scale = 1) {
    air(at, 0.11, 0.95 * scale, 5200, 340, 'hit');
    tone(at, 0.85, 1.1 * scale, 123, 33, 2.4);
    air(at + 0.022, 1.15, 0.62 * scale, 760, 65, 'hit', 0, 0.8);
    metal(at + 0.014, 0.75, 0.19 * scale, 113);
    for (let i = 0; i < 13; i++) air(at + 0.035 + rng() * 0.48, 0.025 + rng() * 0.075, 0.2 * scale * (1 - i / 18), 900 + rng() * 3400, 280, 'hit', rng() * 1.3 - 0.65);
  }
  function render(peak, room = 0.055) {
    // Short, asymmetric early reflections keep fast attacks crisp. No long reverb baked into basics.
    for (const [delay, level] of [[0.019, room], [0.037, room * 0.65], [0.067, room * 0.35]]) {
      const n = Math.round(delay * RATE);
      for (let i = channels[0].length - 1; i >= n; i--) {
        channels[0][i] += channels[1][i - n] * level;
        channels[1][i] += channels[0][i - n] * level * 0.83;
      }
    }
    let max = 0;
    for (const data of channels) {
      let lastIn = 0, lastOut = 0;
      for (let i = 0; i < data.length; i++) {
        const value = data[i] - lastIn + 0.995 * lastOut;
        lastIn = data[i]; lastOut = value;
        const endFade = Math.min(1, (data.length - 1 - i) / (RATE * 0.025));
        data[i] = Math.tanh(value * 0.82) * Math.max(0, endFade);
        max = Math.max(max, Math.abs(data[i]));
      }
    }
    const gain = peak / Math.max(max, 1e-9);
    return channels.map(data => Float32Array.from(data, x => x * gain));
  }
  return { air, tone, metal, blow, blade, needle, boom, render, rng };
}

// Durations include tails; the first transient is immediate except intentional windups.
const specs = {
  dartThrow: [0.19, 0.49, 3, s => s.needle(0)],
  nailThrow: [0.4, 0.63, 1, s => { s.metal(0, 0.14, 0.4, 780); s.needle(0.025, 1.2); s.tone(0, 0.09, 0.22, 380, 130, 1); }],
  machineBox: [0.48, 0.65, 1, s => { s.metal(0, 0.09, 0.45, 470); for(let i=0;i<12;i++) s.needle(0.018+i*0.024, 0.6, (i%2 ? 1 : -1)*0.32); }],
  silkArmor: [0.95, 0.49, 1, s => { s.air(0, 0.35, 0.5, 1800, 4200, 'swell'); [660,990,1320].forEach((f,i)=>s.metal(i*0.055,0.7,0.22,f,0,true)); }],
  needleRain: [0.87, 0.74, 1, s => { s.metal(0,0.2,0.4,390); for(let i=0;i<30;i++) s.needle(i*0.021,0.5+s.rng()*0.3,s.rng()*1.4-0.7); s.air(0.025,0.65,0.3,7000,2600,'swell'); }],
  dartImpact: [0.22, 0.55, 3, s => { s.air(0,0.045,0.75,4200,1200); s.metal(0.003,0.15,0.27,2300); s.tone(0,0.1,0.5,310,130,1); }],
  swordSwing: [0.34, 0.55, 3, s => s.blade(0)],
  swordImpact: [0.45, 0.7, 3, s => { s.air(0,0.055,0.9,7500,1000); s.metal(0,0.4,0.48,1250); s.blow(0,0.52); }],
  swordBeam: [0.66, 0.75, 1, s => { s.blade(0,0.11,1.3,0,1.4); s.air(0,0.23,0.8,5400,300); s.metal(0.006,0.58,0.33,810); s.tone(0,0.29,0.65,220,58,1); }],
  crossCut: [0.64, 0.74, 1, s => { s.blade(0,0.17,1.2,-0.2,1.1); s.blade(0.1,0.14,0.9,0.2,-1.1); s.metal(0.06,0.47,0.28,960); s.tone(0.055,0.25,0.5,170,60,1.5); }],
  thrust: [0.46, 0.65, 1, s => { s.blade(0,0.1,1); s.metal(0.02,0.24,0.34,2420); s.air(0.03,0.08,0.7,4700,640); s.metal(0.12,0.24,0.21,1150); }],
  counterStance: [0.68, 0.49, 1, s => { s.air(0,0.12,0.35,2600,1100); s.metal(0.01,0.56,0.6,740); s.metal(0.07,0.48,0.3,1110); }],
  counterHit: [0.78, 0.79, 1, s => { s.metal(0,0.67,0.6,1370); s.air(0,0.03,0.9,6200,2000); s.blade(0.045,0.16,1.4); s.blow(0.04,0.7); }],
  boxerDash: [0.24, 0.48, 3, s => { s.air(0,0.065,0.5,1300,350); s.air(0.005,0.18,0.7,460,2300,'swell',0,1); }],
  punchSwing: [0.16, 0.41, 3, s => s.air(0,0.135,0.8,540,1800,'swell',0,0.6)],
  punch: [0.27, 0.73, 3, s => s.blow(0)],
  palmPush: [0.64, 0.73, 1, s => { s.blow(0,0.85); s.air(0,0.48,0.75,1600,120,'hit',0,1); s.tone(0.005,0.43,0.9,190,38,2); }],
  dragonPull: [0.54, 0.64, 1, s => { s.air(0,0.31,0.8,210,2800,'rise',0,-1.3); s.tone(0,0.28,0.3,95,310,0.7,0,'rise'); s.blow(0.29,0.8); }],
  meridianLock: [0.47, 0.68, 1, s => { s.blow(0,0.6); s.blow(0.065,0.9); s.metal(0.071,0.24,0.18,1680); }],
  channelStart: [0.32, 0.54, 1, s => { s.air(0,0.26,0.6,230,1500,'rise'); s.tone(0,0.26,0.5,110,245,1,0,'rise'); }],
  channelTick: [0.17, 0.52, 3, s => { s.air(0,0.018,0.7,2200,900); s.tone(0,0.145,0.9,210+s.rng()*40,82,2,s.rng()*0.4-0.2); s.air(0.005,0.09,0.9,850,260); }],
  channelFinish: [0.92, 0.86, 1, s => { s.blow(0,1.4); s.tone(0,0.63,1.2,162,34,2.6); s.air(0.02,0.6,0.7,1100,85); s.metal(0,0.42,0.21,320); }],
  breathing: [0.85, 0.48, 1, s => { s.air(0,0.66,0.55,600,2300,'swell'); [440,660,880].forEach((f,i)=>s.metal(0.1+i*0.13,0.43,0.27,f,0,true)); }],
  dragonCharge: [2, 0.64, 1, s => { s.air(0,1.99,0.68,95,4400,'rise',0,0.8); s.tone(0,1.99,0.46,62,195,1.3,0,'rise'); for(let i=0;i<8;i++) { const at=0.1+i*0.3-i*i*0.009; s.metal(at,0.23,0.09+i*0.035,200+i*73); } }],
  dragonBurst: [1.55, 0.9, 1, s => { s.boom(0,1.3); s.air(0.005,0.42,0.85,5500,160,'hit',0,1.6); }],
  hitLight: [0.18, 0.49, 3, s => { s.air(0,0.065,0.9,1700,550); s.tone(0,0.13,0.6,290,110,1); }],
  hitHeavy: [0.4, 0.7, 3, s => { s.blow(0,1.15); s.air(0.013,0.26,0.34,780,140); }],
  critAccent: [0.42, 0.59, 1, s => { s.air(0,0.024,0.5,8200,2300); s.metal(0,0.35,0.32,2100); s.tone(0,0.13,0.2,360,125,1); }],
  launcher: [0.71, 0.8, 1, s => { s.blow(0,1); s.air(0.02,0.4,0.8,380,4800,'swell',0,1.3); s.metal(0,0.5,0.3,850); }],
  enemyShot: [0.26, 0.49, 3, s => { s.air(0,0.18,0.9,1800,320,'swell',0.25,-0.6); s.tone(0,0.17,0.5,260,80,1.8); }],
  enemyTelegraph: [0.28, 0.51, 1, s => { s.metal(0,0.12,0.5,580); s.metal(0.12,0.13,0.6,580); }],
  teleport: [0.46, 0.65, 1, s => { s.air(0,0.12,0.9,6200,320,'hit',0,-1.2); s.air(0.06,0.26,0.55,220,3800,'swell',0,1.2); s.metal(0,0.33,0.25,410); }],
  enemyCleave: [0.81, 0.8, 1, s => { s.blade(0,0.19,1.15,0,-1.2); s.metal(0.02,0.64,0.42,450); s.blow(0.01,1); s.air(0.015,0.52,0.6,1900,85); }],
  fieldOmen: [0.91, 0.56, 1, s => { s.metal(0,0.78,0.6,166); s.tone(0,0.74,0.5,108,55,1.4); s.metal(0.23,0.57,0.3,249); }],
  tileBurst: [0.38, 0.55, 3, s => { s.air(0,0.08,0.8,2100,350); s.tone(0,0.3,0.7,125,44,2); for(let i=0;i<5;i++) s.air(0.025+i*0.04,0.05,0.23,1200+s.rng()*1800,350,'hit',s.rng()-0.5); }],
  waveSweep: [0.43, 0.58, 1, s => { s.air(0,0.34,0.9,400,2700,'swell',0.15,-1.1); s.tone(0,0.28,0.45,155,58,1.8); }],
  dartVolley: [0.63, 0.62, 1, s => { for(let i=0;i<15;i++) s.needle(i*0.029,0.75,s.rng()*1.2-0.6); s.air(0,0.45,0.5,1800,4600,'swell'); }],
  counterBurst: [0.82, 0.76, 1, s => { s.boom(0,0.8); s.metal(0,0.5,0.43,365); }],
  playerHurt: [0.33, 0.7, 3, s => { s.blow(0,1.15); s.air(0,0.21,0.4,850,130); }],
  shieldBlock: [0.48, 0.65, 1, s => { s.air(0,0.026,0.6,4500,1500); s.metal(0,0.41,0.65,1050); s.tone(0,0.12,0.25,320,155,1); }],
  drawCard: [0.34, 0.39, 1, s => { s.air(0,0.11,0.7,2400,4700,'swell'); s.air(0.085,0.027,0.5,3400,1100); s.metal(0.085,0.21,0.24,1760,0,true); }],
  aimOn: [0.14, 0.28, 1, s => { s.air(0,0.012,0.5,2900,1200); s.metal(0,0.12,0.4,1300,0,true); }],
  aimOff: [0.13, 0.22, 1, s => { s.air(0,0.023,0.4,1600,650); s.metal(0,0.11,0.25,690,0,true); }],
  pause: [0.17, 0.26, 1, s => { s.metal(0,0.075,0.4,880,0,true); s.metal(0.065,0.09,0.23,660,0,true); }],
  victory: [1.64, 0.55, 1, s => { [523.25,659.25,783.99,1046.5].forEach((f,i)=>s.metal(i*0.13,1.05,0.4,f,0,true)); s.metal(0.39,1.14,0.35,261.6); }],
  defeat: [1.85, 0.51, 1, s => { [392,329.63,261.63,196].forEach((f,i)=>s.metal(i*0.19,1.12,0.33,f,0,true)); s.tone(0.57,1.17,0.45,98,49,0.7); }]
};

function wav(channels) {
  const length = channels[0].length, data = Buffer.alloc(44 + length * 4);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8,4); data.write('WAVEfmt ',8);
  data.writeUInt32LE(16,16); data.writeUInt16LE(1,20); data.writeUInt16LE(2,22);
  data.writeUInt32LE(RATE,24); data.writeUInt32LE(RATE*4,28); data.writeUInt16LE(4,32); data.writeUInt16LE(16,34);
  data.write('data',36); data.writeUInt32LE(length*4,40);
  for(let i=0;i<length;i++) for(let c=0;c<2;c++) data.writeInt16LE(Math.round(Math.max(-1,Math.min(1,channels[c][i]))*32767),44+i*4+c*2);
  return data;
}
function generate() {
  fs.mkdirSync(root,{recursive:true});
  const manifest = { version: VERSION, sampleRate: RATE, sounds: {} };
  let seed=173, count=0, bytes=0;
  for(const [name,[duration,peak,variants,build]] of Object.entries(specs)) {
    const files=[];
    for(let v=0;v<variants;v++) {
      const s=makeSound(duration,seed++); build(s);
      const data=wav(s.render(peak));
      const file=`${name}${v ? '-'+(v+1) : ''}.wav`;
      fs.writeFileSync(path.join(root,file),data); files.push(file); count++; bytes+=data.length;
    }
    const ui=['aimOn','aimOff','pause','drawCard'].includes(name);
    manifest.sounds[name]={files, gain: 0.92, vary: variants>1 ? 0.028 : 0,
      limit: name==='tileBurst' ? 2 : name==='channelTick' ? 3 : 4,
      cooldown: name==='tileBurst' ? 0.045 : ui ? 0.045 : 0.012,
      priority: ['dragonBurst','channelFinish','enemyTelegraph','teleport','victory','defeat'].includes(name) ? 2 : ui ? 0 : 1 };
  }
  fs.writeFileSync(path.join(root,'manifest.js'),`// Generated by scripts/generate-sounds.cjs.\n(function(root) {\n  const manifest = ${JSON.stringify(manifest,null,2)};\n  if (typeof module === 'object' && module.exports) module.exports = manifest;\n  else root.COMBAT_SOUND_MANIFEST = manifest;\n})(globalThis);\n`);
  console.log(`${Object.keys(specs).length} sound events, ${count} WAV files, ${(bytes/1048576).toFixed(2)} MiB`);
}
if(require.main===module) generate();
module.exports={specs,makeSound,wav,generate};
