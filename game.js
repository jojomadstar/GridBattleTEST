const canvas = document.querySelector("#game");
const classicCharacterArt = new URLSearchParams(location.search).get("art") === "classic";
const reducedCharacterMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const ctx = canvas.getContext("2d");

const chargeFill = document.querySelector("#chargeFill");
const chargeText = document.querySelector("#chargeText");
const playerHpText = document.querySelector("#playerHp");
const enemyHpText = document.querySelector("#enemyHp");
const handEl = document.querySelector("#hand");
const restartButton = document.querySelector("#restart");
const pauseButton = document.querySelector("#pause");
const muteButton = document.querySelector("#mute");
const classButtons = [...document.querySelectorAll(".class-button")];
const meterBlock = document.querySelector(".meter-block");
const mobileInputQuery = window.matchMedia("(pointer: coarse)");

const COLS_PER_SIDE = 4;
const ROWS = 4;
const HAND_SIZE = 4;
const BOARD_TOP_LEFT = { x: 192, y: 206 };
const BOARD_TOP_RIGHT = { x: 944, y: 206 };
const BOARD_BOTTOM_LEFT = { x: 112, y: 458 };
const BOARD_BOTTOM_RIGHT = { x: 1040, y: 458 };
const TANGMEN_MAX_HP = 135;
const SWORDSMAN_MAX_HP = 150;
const BOXER_MAX_HP = 180;
// 同列時普攻輔助鎖定；落點在出拳時固定，命中判定對齊揮拳，收招後返回。
const BOXER_STRIKE_IMPACT = 0.16;
const BOXER_STRIKE_DURATION = 0.42;
const BOXER_ATTACK_CD = 1.0;
const BOXER_BASIC_CHARGE = 90;
const BOXER_BASIC_DAMAGE = 18;
const ENEMY_MAX_HP = 600;
const CRIT_CHANCE = 0.15;
const DAMAGE_VARIANCE = 0.1;

// 敵人壓迫節奏：場地攻擊（field）與招式（special）兩條軌道各自獨立、可同時運作。
const FIELD_ATTACKS = ["heavenlyCircuit", "plumPiles"];
const ENEMY_SPECIALS = ["waveSweep", "dartVolley"];
const FIELD_TILE_DAMAGE = 15;
const PLUM_TILE_DAMAGE = 13;
const WAVE_DAMAGE = 22;
const DART_DAMAGE = 13;
const TELEPORT_DAMAGE = 30;
const ENEMY_SHOT_DAMAGE = 15;
const ENEMY_SHOT_WARNING = 0.22;

// 反身崩罡：專門用來罰「站在準心上不動輸出」的近戰。
// 場地攻擊只打玩家「當下所在格」，而追著敵人跑的近戰本來就一直在移動，
// 反而變成最安全的玩法 —— 這一招補掉那個漏洞。
const COUNTER_CHARGE_TIME = 1.5;   // 貼位多久會被反震
const COUNTER_WARNING = 0.5;       // 預警時間
const COUNTER_DAMAGE = 22;
const COUNTER_COOLDOWN = 2.6;

// ── 武俠水墨配色 ───────────────────────────────────────────────────
const INK = {
  paper: "#e9dcc0",      // 宣紙
  paperDim: "#cdbb98",
  ink: "#141a1f",        // 墨
  inkSoft: "#2b3640",
  cinnabar: "#c8452f",   // 硃砂
  cinnabarLit: "#e8543c",
  gold: "#d8a12f",       // 金
  goldLit: "#f0d692",
  jade: "#4fb8a0",       // 玉青
  jadeDim: "#2c6d63",
  plum: "#8e4b6d",       // 紫檀
  mist: "#b9c9c6"
};

const LOGIC_W = 1152;
const LOGIC_H = 648;

// 毛筆襯線字堆疊：先找 webfont，再退回各平台內建明體，最後才是 serif。
const CJK_SERIF = '"Noto Serif TC", "Source Han Serif TC", "Songti TC", "PMingLiU", "MingLiU", "SimSun", serif';
const BRUSH = '"Ma Shan Zheng", "Noto Serif TC", "Songti TC", "PMingLiU", serif';
const FONT = {
  brush: (size) => `400 ${size}px ${BRUSH}`,
  title: (size) => `900 ${size}px ${CJK_SERIF}`,
  body: (size) => `400 ${size}px ${CJK_SERIF}`,
  strong: (size) => `600 ${size}px ${CJK_SERIF}`,
  num: (size) => `900 ${size}px ${CJK_SERIF}`,
  latin: (size) => `600 ${size}px "Cinzel", ${CJK_SERIF}`
};

let dpr = 1;
let bgCache = null;
let gridCache = null;
let petals = [];

const keys = new Set();
let selectedClass = "tangmen";
let lastTime = performance.now();
let state;
let touchStart = null;
let mobileInputEnabled = detectMobileInput();
let paused = false;
const lastHudCache = { charge: -1, playerHp: -1, playerShield: -1, enemyHp: -1 };

// ═══════════════════════════════════════════════════════════════════
// 音訊引擎
// 原本是「單一振盪器 + 指數衰減」，所有招式聽起來都像電子錶。
// 重寫成多層合成：低頻體感層 + 中頻衝擊層 + 高頻瞬態層 + 金屬泛音層，
// 外加一條程序化產生的殘響匯流排，讓演武場有空間感。
// ═══════════════════════════════════════════════════════════════════

let audioCtx = null;
let masterGain = null;
let reverbBus = null;
let noiseBuf = null;
let brownBuf = null;
let pinkBuf = null;
let audioMuted = false;
let audioBroken = false;   // 建圖失敗就永久關閉音訊，遊戲照樣能玩
let liveVoices = 0;

const MAX_VOICES = 40;
const MODAL_GAIN = 26;   // 模態層的輸出補償，實測校正而來        // 超過就丟掉新的，避免百裂崩拳那種連發把聲音糊成一團
const MASTER_VOL = 0.5;

function initAudio() {
  if (audioBroken) return null;
  if (audioCtx) {
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { audioBroken = true; return null; }
  try {
    audioCtx = new AC();
    buildAudioGraph();
  } catch (err) {
    // 少了任何一個節點就整個關掉音訊，不要讓遊戲跟著掛掉
    audioBroken = true;
    audioCtx = null;
    return null;
  }
  return audioCtx;
}

function buildAudioGraph() {
  masterGain = audioCtx.createGain();
  masterGain.gain.value = audioMuted ? 0 : MASTER_VOL;

  // 壓縮器：把整體動態拉平
  const comp = audioCtx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 8;
  comp.ratio.value = 4;
  comp.attack.value = 0.002;
  comp.release.value = 0.14;

  // 軟削波：壓縮器的起音再快也擋不住瞬態，實測大混戰時峰值會衝到 1.16
  // 而且真的削出 7 個樣本。這一級用 tanh 曲線把上限硬壓在 0.76，
  // 小訊號幾乎不受影響（tanh(x)≈x），大訊號則變成溫和飽和而不是數位爆音。
  const softClip = audioCtx.createWaveShaper();
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i += 1) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x);
  }
  softClip.curve = curve;
  softClip.oversample = "4x";

  masterGain.connect(comp);
  comp.connect(softClip);
  softClip.connect(audioCtx.destination);

  // 殘響：用衰減噪音自己合成一條脈衝響應，不用外部音檔
  const convolver = audioCtx.createConvolver();
  convolver.buffer = makeImpulse(1.9, 3.4);
  reverbBus = audioCtx.createGain();
  reverbBus.gain.value = 0.9;
  reverbBus.connect(convolver);
  // 殘響回程再壓一層低通：反射音本來就比直達音暗
  const wetDamp = audioCtx.createBiquadFilter();
  wetDamp.type = "lowpass";
  wetDamp.frequency.value = 3200;
  wetDamp.Q.value = 0.5;
  const wetTrim = audioCtx.createGain();
  wetTrim.gain.value = 0.42;
  convolver.connect(wetDamp);
  wetDamp.connect(wetTrim);
  wetTrim.connect(masterGain);

  noiseBuf = makeNoise(2, "white");
  brownBuf = makeNoise(2, "brown");
  pinkBuf = makeNoise(2, "pink");
}

// ── 噪音色彩 ─────────────────────────────────────────────────────
// 白噪音聽起來就是「嘶」，很假。真實撞擊的噪音成分偏低頻、而且頻譜會在
// 幾十毫秒內迅速往下塌。所以另外準備棕噪音（低頻能量重）給悶響與轟鳴用。
function makeNoise(seconds, color) {
  const len = Math.floor(audioCtx.sampleRate * seconds);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  if (color === "brown") {
    let last = 0;
    for (let i = 0; i < len; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.022 * white) / 1.022;
      data[i] = last * 3.6;
    }
  } else if (color === "pink") {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.32;
    }
  } else {
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return buf;
}

// 飽和：真實的大音量衝擊都是非線性的，乾淨的正弦聽起來就是合成器
function saturator(amount) {
  const ws = audioCtx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  ws.curve = curve;
  ws.oversample = "2x";
  return ws;
}

// ── 模態合成 ─────────────────────────────────────────────────────
// 金屬被敲擊時不是發出一個頻率，而是一整組「非諧振」的共振模態同時衰減，
// 高頻模態衰減得比低頻快。這才是刀劍聽起來像金屬的原因。
// 用一排高 Q bandpass 並聯、以極短的噪音脈衝激發，就是這個行為的近似。
//
// 比例取自實體振動模型：自由端細長棒（刀身）的模態比是 1 : 2.76 : 5.40 : 8.93 …
const MODES = {
  blade: [
    { r: 1.00, g: 1.00, d: 1.00 }, { r: 2.76, g: 0.68, d: 0.58 },
    { r: 5.40, g: 0.45, d: 0.36 }, { r: 8.93, g: 0.30, d: 0.24 },
    { r: 13.34, g: 0.18, d: 0.15 }, { r: 18.64, g: 0.10, d: 0.09 }
  ],
  // 小金屬件（鏢、釘）：頻率高、模態少、衰減快
  trinket: [
    { r: 1.00, g: 1.00, d: 1.00 }, { r: 2.41, g: 0.55, d: 0.5 },
    { r: 4.72, g: 0.32, d: 0.3 }, { r: 7.88, g: 0.16, d: 0.16 }
  ],
  // 厚重金屬／鑼：模態密、低頻多、尾巴長
  gong: [
    { r: 1.00, g: 1.00, d: 1.00 }, { r: 1.52, g: 0.78, d: 0.9 },
    { r: 2.13, g: 0.62, d: 0.8 }, { r: 2.96, g: 0.5, d: 0.66 },
    { r: 3.84, g: 0.36, d: 0.55 }, { r: 5.21, g: 0.24, d: 0.42 },
    { r: 6.83, g: 0.16, d: 0.3 }
  ]
};

function modal({ at = 0, vol = 0.3, freq = 900, set = "blade", decay = 0.5,
                 excite = 0.004, wet = 0.35, pan = 0, detune = 0.03, bright = 1,
                 q = 24, qStep = 12 }) {
  if (!audioReady()) return;
  const ac = audioCtx;
  const t0 = ac.currentTime + at;
  const out = voice(wet, pan);

  // 激發源：極短的噪音脈衝，等同於「敲一下」
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const ex = ac.createGain();
  ex.gain.setValueAtTime(0.0001, t0);
  ex.gain.exponentialRampToValueAtTime(1, t0 + 0.0004);
  ex.gain.exponentialRampToValueAtTime(0.0001, t0 + excite);
  src.connect(ex);

  const partials = MODES[set] || MODES.blade;
  let longest = 0;
  partials.forEach((p, i) => {
    // 每次敲擊都讓模態頻率稍微偏一點，重複敲不會一模一樣
    const f = freq * p.r * (1 + (Math.random() * 2 - 1) * detune);
    if (f > ac.sampleRate * 0.45) return;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f;
    bp.Q.value = q + i * qStep;
    // 高 Q 帶通只讓極窄一段頻帶通過，輸出天生就很小。
    // 實測：blade vol 0.4 的峰值只有 0.014，而同一個音效裡的衝擊層是 0.6 ——
    // 等於模態層根本聽不到，金屬感全被蓋掉。這裡統一補上輸出增益。
    const qComp = MODAL_GAIN;
    const g = ac.createGain();
    const d = decay * p.d;
    longest = Math.max(longest, d);
    hitEnv(g.gain, t0, vol * p.g * Math.pow(bright, i) * qComp, d, 0.0006);
    ex.connect(bp); bp.connect(g); g.connect(out);
  });

  src.start(t0);
  src.stop(t0 + longest + 0.1);
  releaseVoice(out, t0 + longest + 0.2);
}

// ── 撞擊瞬態 ─────────────────────────────────────────────────────
// 真實撞擊的第一件事是 1-3 毫秒的寬頻「喀」，那是接觸的瞬間。
// 少了這一下，任何打擊聽起來都軟綿綿的。
function crack({ at = 0, vol = 0.4, dur = 0.0025, freq = 6000, pan = 0 }) {
  if (!audioReady()) return;
  const ac = audioCtx;
  const t0 = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const hp = ac.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const out = voice(0.06, pan);
  src.connect(hp); hp.connect(g); g.connect(out);
  src.start(t0); src.stop(t0 + dur + 0.02);
  releaseVoice(out, t0 + dur + 0.05);
}

// ── 衝擊體 ───────────────────────────────────────────────────────
// 濾波器頻率在幾十毫秒內從高塌到低，這是「撞到東西」而不是「一段噪音」的關鍵。
function body({ at = 0, vol = 0.35, dur = 0.12, from = 2600, to = 180,
                q = 1.1, color = "brown", drive = 0, wet = 0.2, pan = 0 }) {
  if (!audioReady()) return;
  const ac = audioCtx;
  const t0 = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = color === "brown" ? brownBuf : (color === "pink" ? pinkBuf : noiseBuf);
  src.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(from, t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
  lp.Q.value = q;
  const g = ac.createGain();
  hitEnv(g.gain, t0, vol, dur, 0.001);
  const out = voice(wet, pan);
  let tail = g;
  src.connect(lp); lp.connect(g);
  if (drive > 0) { const sat = saturator(drive); g.connect(sat); tail = sat; }
  tail.connect(out);
  src.start(t0); src.stop(t0 + dur + 0.05);
  releaseVoice(out, t0 + dur + 0.1);
}

// ── 次低頻悶響 ───────────────────────────────────────────────────
// 拳頭與爆炸的「重量」全部來自這一層：快速下墜的低頻正弦加飽和。
function thump({ at = 0, vol = 0.5, from = 150, to = 38, dur = 0.22,
                 drive = 2.4, wet = 0.14, pan = 0 }) {
  if (!audioReady()) return;
  const ac = audioCtx;
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(18, to), t0 + dur * 0.75);
  const g = ac.createGain();
  hitEnv(g.gain, t0, vol, dur, 0.0015);
  const sat = saturator(drive);
  const out = voice(wet, pan);
  osc.connect(g); g.connect(sat); sat.connect(out);
  osc.start(t0); osc.stop(t0 + dur + 0.1);
  releaseVoice(out, t0 + dur + 0.15);
}

// ── 破空 ─────────────────────────────────────────────────────────
// 揮擊掃過空氣：帶通頻率與音量都先升後降，做出「由遠而近再遠離」的感覺。
function whoosh({ at = 0, vol = 0.3, dur = 0.24, low = 380, high = 3200,
                  q = 2.4, wet = 0.28, pan = 0 }) {
  if (!audioReady()) return;
  const ac = audioCtx;
  const t0 = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = pinkBuf;
  src.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = q;
  bp.frequency.setValueAtTime(low, t0);
  bp.frequency.exponentialRampToValueAtTime(high, t0 + dur * 0.55);
  bp.frequency.exponentialRampToValueAtTime(low * 0.7, t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const out = voice(wet, pan);
  src.connect(bp); bp.connect(g); g.connect(out);
  src.start(t0); src.stop(t0 + dur + 0.05);
  releaseVoice(out, t0 + dur + 0.1);
}

// ── 碎片散落 ─────────────────────────────────────────────────────
function debris({ at = 0, count = 10, spread = 0.5, vol = 0.12, freq = [900, 4200], wet = 0.4 }) {
  for (let i = 0; i < count; i += 1) {
    modal({
      at: at + Math.random() * spread,
      vol: vol * (0.4 + Math.random() * 0.6),
      freq: freq[0] + Math.random() * (freq[1] - freq[0]),
      set: "trinket",
      decay: 0.06 + Math.random() * 0.09,
      excite: 0.002,
      wet,
      pan: (Math.random() * 2 - 1) * 0.7
    });
  }
}

function makeImpulse(seconds, decay) {
  const len = Math.floor(audioCtx.sampleRate * seconds);
  const buf = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buf.getChannelData(ch);
    // 真實空間的殘響尾巴會越來越暗（空氣與牆面吸收高頻）。
    // 初版用等能量的白噪音，量測出來尾音的頻譜重心反而比起音還高，
    // 聽起來就是一層假假的嘶聲。這裡用逐漸變重的單極低通把尾巴壓暗。
    let lp = 0;
    for (let i = 0; i < len; i += 1) {
      const t = i / len;
      const white = Math.random() * 2 - 1;
      const coeff = 0.85 * Math.pow(1 - t, 1.6) + 0.03;   // 1 → 0.03，越後面越暗
      lp += coeff * (white - lp);
      const gate = t < 0.012 ? t / 0.012 : 1;             // pre-delay
      data[i] = lp * Math.pow(1 - t, decay) * gate * 2.4;
    }
  }
  return buf;
}

function audioReady() {
  return !audioMuted && !audioBroken && initAudio() && noiseBuf && brownBuf && liveVoices < MAX_VOICES;
}

// 每個聲音一條 voice：dry 直送 master，wet 送殘響
function voice(wet = 0.18, pan = 0) {
  const ac = audioCtx;
  const out = ac.createGain();
  out.gain.value = 1;

  let node = out;
  if (ac.createStereoPanner && pan !== 0) {
    const panner = ac.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(panner);
    node = panner;
  }
  node.connect(masterGain);
  if (wet > 0) {
    const send = ac.createGain();
    send.gain.value = wet;
    node.connect(send);
    send.connect(reverbBus);
  }

  liveVoices += 1;
  return out;
}

function releaseVoice(node, at) {
  const ac = audioCtx;
  const timer = ac.createConstantSource ? ac.createConstantSource() : null;
  const done = () => {
    liveVoices = Math.max(0, liveVoices - 1);
    try { node.disconnect(); } catch (_) {}
  };
  if (timer) {
    timer.connect(ac.createGain());
    timer.start(at);
    timer.stop(at + 0.001);
    timer.onended = done;
  } else {
    setTimeout(done, Math.max(0, (at - ac.currentTime) * 1000) + 60);
  }
}

// 打擊包絡：極快起音 + 指數衰減
function hitEnv(param, t0, peak, decay, attack = 0.002) {
  param.setValueAtTime(0.0001, t0);
  param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  param.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

// 有起音時間的包絡（用於蓄力、護體那種漸強）
function swellEnv(param, t0, peak, attack, hold, release) {
  param.setValueAtTime(0.0001, t0);
  param.linearRampToValueAtTime(peak, t0 + attack);
  param.setValueAtTime(peak, t0 + attack + hold);
  param.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
}

// ── 基本發聲單元 ────────────────────────────────────────────────

// 帶濾波的噪音：衝擊、破空、布料、石屑都靠它
function noise({ at = 0, dur = 0.12, vol = 0.3, type = "bandpass", freq = 1200,
                 freqEnd = null, q = 1.2, wet = 0.18, pan = 0, attack = 0.002 }) {
  if (!audioReady()) return;
  const ac = audioCtx;
  const t0 = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur);
  filter.Q.value = q;
  const g = ac.createGain();
  hitEnv(g.gain, t0, vol, dur, attack);
  const out = voice(wet, pan);
  src.connect(filter); filter.connect(g); g.connect(out);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
  releaseVoice(out, t0 + dur + 0.1);
}

// 帶滑音的振盪器：體感低頻、破空呼嘯、蓄力上升
function tone({ at = 0, dur = 0.18, vol = 0.25, type = "sine", freq = 220,
                freqEnd = null, wet = 0.18, pan = 0, attack = 0.003, swell = null }) {
  if (!audioReady()) return;
  const ac = audioCtx;
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
  const g = ac.createGain();
  if (swell) swellEnv(g.gain, t0, vol, swell.attack, swell.hold, swell.release);
  else hitEnv(g.gain, t0, vol, dur, attack);
  const out = voice(wet, pan);
  osc.connect(g); g.connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.1);
  releaseVoice(out, t0 + dur + 0.15);
}

// FM：金屬鳴響。劍刃相擊、鏢身振動、鐘聲都用這個
function metal({ at = 0, dur = 0.3, vol = 0.2, freq = 640, ratio = 2.71,
                 index = 900, wet = 0.3, pan = 0, decay = null }) {
  if (!audioReady()) return;
  const ac = audioCtx;
  const t0 = ac.currentTime + at;
  const carrier = ac.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = freq;
  const mod = ac.createOscillator();
  mod.type = "sine";
  mod.frequency.value = freq * ratio;
  const modGain = ac.createGain();
  // 調變量自己也要衰減，否則尾音會一直很刺
  hitEnv(modGain.gain, t0, index, decay || dur * 0.5, 0.001);
  const g = ac.createGain();
  hitEnv(g.gain, t0, vol, dur, 0.001);
  const out = voice(wet, pan);
  mod.connect(modGain); modGain.connect(carrier.frequency);
  carrier.connect(g); g.connect(out);
  mod.start(t0); carrier.start(t0);
  mod.stop(t0 + dur + 0.1); carrier.stop(t0 + dur + 0.1);
  releaseVoice(out, t0 + dur + 0.15);
}

const rand = (a, b) => a + Math.random() * (b - a);
// 同一個音重複播放時給一點音高偏移，不然連發會像機關槍卡帶
const vary = (f, cents = 70) => f * Math.pow(2, rand(-cents, cents) / 1200);

// ── 招式音效 ────────────────────────────────────────────────────
// 設計原則：照實體事件的結構去疊，而不是「挑一個好聽的波形」。
//   撞擊 = 瞬態(1-3ms 寬頻喀) → 衝擊體(頻譜快速下塌) → 共振尾(模態衰減)
//   爆炸 = 爆裂 → 下掃氣爆 → 次低頻衝擊 → 碎片 → 長尾轟鳴
//   破空 = 帶通頻率與音量同時先升後降
const SFX = {
  // ══ 唐門：細、尖、金屬、快 ══

  dartThrow() {
    whoosh({ dur: 0.09, vol: 0.34, low: 1800, high: 6500, q: 3.4, wet: 0.12 });
    crack({ at: 0.02, vol: 0.3, dur: 0.0015, freq: 7000 });
    modal({ at: 0.02, vol: 0.12, freq: vary(3400), set: "trinket", decay: 0.09, excite: 0.004, wet: 0.2 });
  },

  nailThrow() {
    whoosh({ dur: 0.12, vol: 0.24, low: 900, high: 4200, q: 2.6, wet: 0.16 });
    crack({ at: 0.015, vol: 0.26, dur: 0.002, freq: 5000 });
    // 鋼釘出膛：實心金屬的共振尾
    modal({ at: 0.015, vol: 0.1, freq: vary(1150), set: "trinket", decay: 0.26, wet: 0.34 });
    body({ at: 0.015, dur: 0.05, vol: 0.16, from: 3400, to: 700, color: "pink" });
  },

  // 機匣連發：每一發都是完整的「喀＋金屬尾」，不是單純的滴答
  machineBox() {
    crack({ vol: 0.34, dur: 0.003, freq: 2600 });         // 機簧扣動
    modal({ vol: 0.1, freq: 780, set: "trinket", decay: 0.08, wet: 0.2 });
    for (let i = 0; i < 11; i += 1) {
      const at = 0.03 + i * 0.021 + rand(0, 0.005);
      const pan = rand(-0.45, 0.45);
      crack({ at, vol: 0.3, dur: 0.0016, freq: rand(4500, 7500), pan });
      modal({ at, vol: 0.09, freq: rand(2600, 4200), set: "trinket",
              decay: 0.05 + Math.random() * 0.04, excite: 0.002, wet: 0.16, pan });
    }
    body({ at: 0.25, dur: 0.12, vol: 0.26, from: 900, to: 200, color: "brown", drive: 1.6 });
  },

  silkArmor() {
    body({ dur: 0.4, vol: 0.14, from: 500, to: 2400, q: 0.7, color: "pink", wet: 0.34 });
    modal({ at: 0.05, vol: 0.13, freq: 1560, set: "gong", q: 8, qStep: 4, decay: 0.7, excite: 0.016, wet: 0.55 });
    tone({ dur: 0.55, vol: 0.1, type: "sine", freq: 392,
           swell: { attack: 0.16, hold: 0.1, release: 0.3 } });
  },

  needleRain() {
    body({ dur: 0.6, vol: 0.22, from: 6000, to: 2600, q: 0.6, color: "white", wet: 0.3 });
    thump({ at: 0.5, vol: 0.24, from: 150, to: 48, dur: 0.26, drive: 2.4 });
    for (let i = 0; i < 18; i += 1) {
      const t = i / 18;
      const at = t * 0.6 + rand(0, 0.02);
      const pan = rand(-0.6, 0.6);
      crack({ at, vol: 0.24 + Math.sin(t * Math.PI) * 0.24, dur: 0.0014, freq: rand(5000, 9000), pan });
      if (i % 2 === 0) {
        modal({ at, vol: 0.07, freq: rand(3800, 6000), set: "trinket", decay: 0.04, excite: 0.0015, wet: 0.2, pan });
      }
    }
  },

  // ══ 劍客：鋼鐵 ══

  // 揮劍：破空為主，尾巴帶一點刀身自鳴
  swordSwing() {
    whoosh({ dur: 0.2, vol: 0.34, low: 500, high: 4600, q: 1.8, wet: 0.24 });
    modal({ at: 0.09, vol: 0.07, freq: vary(880), set: "blade", decay: 0.3, excite: 0.006, wet: 0.42, bright: 0.9 });
  },

  // 刀刃咬進去：這是整套音效裡最需要像「真的金屬」的一個
  swordImpact() {
    crack({ vol: 0.5, dur: 0.0022, freq: 5200 });                       // 接觸瞬間
    body({ dur: 0.07, vol: 0.34, from: 5200, to: 400, q: 1.4, color: "pink", drive: 1.8 });
    modal({ vol: 0.17, freq: vary(1180, 120), set: "blade", decay: 0.55, excite: 0.0035, wet: 0.46 });
    modal({ at: 0.002, vol: 0.07, freq: vary(2380, 150), set: "trinket", decay: 0.28, wet: 0.5 });
    thump({ vol: 0.26, from: 170, to: 60, dur: 0.13, drive: 2.6 });     // 重量
  },

  swordBeam() {
    whoosh({ dur: 0.42, vol: 0.32, low: 400, high: 5400, q: 1.4, wet: 0.36 });
    modal({ at: 0.05, vol: 0.11, freq: 740, set: "blade", decay: 0.75, excite: 0.01, wet: 0.5 });
    body({ at: 0.05, dur: 0.3, vol: 0.18, from: 4200, to: 600, color: "pink", wet: 0.4 });
    thump({ at: 0.06, vol: 0.22, from: 150, to: 52, dur: 0.28, drive: 2.2 });
  },

  crossCut() {
    SFX.swordSwing();
    whoosh({ at: 0.085, dur: 0.2, vol: 0.34, low: 700, high: 5200, q: 1.6, wet: 0.26, pan: 0.22 });
    crack({ at: 0.095, vol: 0.4, dur: 0.002, freq: 4800, pan: 0.2 });
    modal({ at: 0.095, vol: 0.14, freq: vary(700, 120), set: "blade", decay: 0.5, wet: 0.46, pan: 0.15 });
    thump({ at: 0.095, vol: 0.3, from: 160, to: 50, dur: 0.2, drive: 2.6 });
  },

  thrust() {
    whoosh({ dur: 0.13, vol: 0.26, low: 2600, high: 800, q: 4.2, wet: 0.16 });
    crack({ at: 0.1, vol: 0.42, dur: 0.0018, freq: 6000 });
    modal({ at: 0.1, vol: 0.1, freq: vary(1680), set: "trinket", decay: 0.22, wet: 0.4 });
    thump({ at: 0.1, vol: 0.2, from: 190, to: 70, dur: 0.11, drive: 2.2 });
  },

  counterStance() {
    modal({ vol: 0.16, freq: 523, set: "gong", q: 8, qStep: 4, decay: 0.85, excite: 0.016, wet: 0.55 });
    modal({ at: 0.12, vol: 0.14, freq: 784, set: "gong", q: 8, qStep: 4, decay: 0.95, excite: 0.016, wet: 0.6 });
    body({ dur: 0.28, vol: 0.09, from: 1600, to: 500, color: "pink", wet: 0.3 });
  },

  // 格開後回斬：全場最清亮的一聲鋼鐵
  counterHit() {
    crack({ vol: 0.55, dur: 0.0025, freq: 6000 });
    body({ dur: 0.08, vol: 0.34, from: 6000, to: 500, q: 1.6, color: "pink", drive: 2.2 });
    modal({ vol: 0.18, freq: 1046, set: "blade", decay: 0.95, excite: 0.004, wet: 0.6 });
    modal({ at: 0.003, vol: 0.08, freq: 2093, set: "trinket", decay: 0.28, wet: 0.5 });
    thump({ vol: 0.3, from: 200, to: 62, dur: 0.2, drive: 2.8 });
  },

  // ══ 拳師：肉身撞擊 ══
  // 真實拳頭 = 悶重的次低頻 + 皮肉的中頻拍擊 + 一點高頻脆響，
  // 而且低頻要飽和，乾淨的正弦聽起來就是合成器。
  // 順移突進：擦地起步 + 破空 + 落地
  boxerDash() {
    body({ dur: 0.07, vol: 0.26, from: 2600, to: 500, q: 1.2, color: "brown", drive: 1.6 });
    whoosh({ at: 0.01, dur: 0.16, vol: 0.3, low: 300, high: 2200, q: 1.6, wet: 0.3 });
    thump({ at: 0.11, vol: 0.24, from: 130, to: 46, dur: 0.14, drive: 2.6 });
    crack({ at: 0.11, vol: 0.14, dur: 0.0018, freq: 3000 });
  },

  punch(power = 1) {
    crack({ vol: 0.16 * power, dur: 0.0016, freq: 3800 });
    body({ dur: 0.075, vol: 0.34 * power, from: 1500, to: 190, q: 1.2, color: "brown", drive: 2.0 });
    thump({ vol: 0.46 * power, from: vary(128, 130), to: 40, dur: 0.19, drive: 3.0 });
    // 第二次微小撞擊：真實的打擊不是單一事件
    body({ at: 0.012, dur: 0.04, vol: 0.12 * power, from: 700, to: 240, color: "brown" });
  },

  palmPush() {
    // 「推」不是「打」：沒有脆響，低頻長、空氣位移重
    body({ dur: 0.36, vol: 0.26, from: 1100, to: 130, q: 0.8, color: "brown", drive: 1.6, wet: 0.3 });
    thump({ vol: 0.46, from: 112, to: 30, dur: 0.42, drive: 3.2, wet: 0.24 });
    whoosh({ at: 0.01, dur: 0.26, vol: 0.16, low: 260, high: 900, q: 1.2, wet: 0.3 });
  },

  dragonPull() {
    // 反向：頻率往上吸
    whoosh({ dur: 0.3, vol: 0.22, low: 200, high: 1400, q: 2.0, wet: 0.34 });
    tone({ dur: 0.3, vol: 0.16, type: "sawtooth", freq: 110, freqEnd: 430, wet: 0.3, attack: 0.06 });
    crack({ at: 0.28, vol: 0.24, dur: 0.002, freq: 3000 });
    thump({ at: 0.28, vol: 0.36, from: 150, to: 44, dur: 0.2, drive: 2.8 });
  },

  meridianLock() {
    crack({ vol: 0.42, dur: 0.0018, freq: 5600 });            // 關節脆響
    body({ dur: 0.05, vol: 0.28, from: 3600, to: 500, q: 2.2, color: "pink", drive: 2.0 });
    thump({ vol: 0.38, from: 140, to: 42, dur: 0.26, drive: 3.0 });
    modal({ at: 0.004, vol: 0.12, freq: 1240, set: "trinket", decay: 0.16, wet: 0.34 });
  },

  channelStart() {
    body({ dur: 0.3, vol: 0.16, from: 240, to: 900, q: 1.0, color: "brown", wet: 0.34 });
    tone({ dur: 0.3, vol: 0.18, type: "sawtooth", freq: 82, freqEnd: 175, wet: 0.3, attack: 0.1 });
  },

  channelTick() {
    body({ dur: 0.05, vol: 0.2, from: 1300, to: 220, q: 1.2, color: "brown", drive: 1.8,
           pan: rand(-0.35, 0.35) });
    thump({ vol: 0.26, from: vary(155, 200), to: 52, dur: 0.09, drive: 2.8 });
  },

  channelFinish() {
    crack({ vol: 0.6, dur: 0.0025, freq: 3600 });
    body({ dur: 0.14, vol: 0.56, from: 3400, to: 150, q: 1.1, color: "brown", drive: 2.4 });
    thump({ vol: 0.66, from: 140, to: 22, dur: 0.68, drive: 3.4, wet: 0.26 });
    body({ at: 0.03, dur: 0.5, vol: 0.16, from: 420, to: 60, q: 0.5, color: "brown", wet: 0.5 });
    modal({ at: 0.006, vol: 0.14, freq: 300, set: "gong", q: 8, qStep: 4, decay: 0.5, wet: 0.5 });
  },

  // ══ 爆炸 ══
  // 真實爆炸的結構：爆裂 → 下掃氣爆 → 次低頻衝擊 → 碎片 → 長尾轟鳴
  dragonCharge() {
    tone({ dur: 1.9, vol: 0.2, type: "sawtooth", freq: 44, freqEnd: 150, wet: 0.4,
           swell: { attack: 1.5, hold: 0.15, release: 0.25 } });
    body({ dur: 1.9, vol: 0.16, from: 160, to: 1500, q: 0.8, color: "brown", wet: 0.45 });
    for (let i = 0; i < 5; i += 1) {
      modal({ at: 0.3 + i * 0.34, vol: 0.07 + i * 0.016, freq: 260 + i * 90,
              set: "gong", q: 8, qStep: 4, decay: 0.4, excite: 0.008, wet: 0.6 });
    }
  },

  dragonBurst() {
    crack({ vol: 0.6, dur: 0.003, freq: 3000 });                                  // 爆裂
    body({ dur: 0.42, vol: 0.44, from: 7000, to: 90, q: 0.7, color: "white", drive: 2.2, wet: 0.4 });
    thump({ vol: 0.7, from: 105, to: 22, dur: 0.85, drive: 3.6, wet: 0.4 });      // 次低頻
    body({ at: 0.04, dur: 1.3, vol: 0.24, from: 700, to: 70, q: 0.5, color: "brown", wet: 0.6 });
    debris({ at: 0.07, count: 9, spread: 0.45, vol: 0.1, freq: [700, 3600] });    // 碎石
    modal({ at: 0.01, vol: 0.14, freq: 120, set: "gong", q: 8, qStep: 4, decay: 1.2, excite: 0.012, wet: 0.65 });
  },

  // ══ 通用命中 ══

  hitLight() {
    crack({ vol: 0.2, dur: 0.0014, freq: 4800 });
    body({ dur: 0.05, vol: 0.24, from: 2600, to: 400, q: 1.3, color: "pink" });
    thump({ vol: 0.2, from: vary(190, 150), to: 76, dur: 0.09, drive: 2.2 });
  },

  hitHeavy() {
    crack({ vol: 0.34, dur: 0.002, freq: 4200 });
    body({ dur: 0.1, vol: 0.34, from: 3400, to: 240, q: 1.2, color: "brown", drive: 2.0 });
    thump({ vol: 0.42, from: vary(140, 130), to: 44, dur: 0.26, drive: 3.0 });
  },

  critAccent() {
    modal({ vol: 0.1, freq: 1760, set: "blade", decay: 0.5, excite: 0.003, wet: 0.5 });
    crack({ vol: 0.22, dur: 0.0015, freq: 7000 });
  },

  launcher() {
    crack({ vol: 0.4, dur: 0.0024, freq: 4000 });
    body({ dur: 0.14, vol: 0.36, from: 3600, to: 200, q: 1.0, color: "brown", drive: 2.4 });
    thump({ vol: 0.56, from: 165, to: 34, dur: 0.4, drive: 3.2, wet: 0.24 });
    whoosh({ at: 0.05, dur: 0.4, vol: 0.2, low: 400, high: 2600, q: 1.6, wet: 0.4 });
    modal({ at: 0.004, vol: 0.08, freq: 1320, set: "blade", decay: 0.6, wet: 0.55 });
  },

  // ══ 魔道 ══

  enemyShot() {
    whoosh({ dur: 0.13, vol: 0.3, low: 1400, high: 400, q: 2.8, wet: 0.22, pan: 0.28 });
    body({ dur: 0.09, vol: 0.24, from: 1200, to: 220, q: 1.4, color: "brown", pan: 0.28 });
    thump({ vol: 0.2, from: 190, to: 80, dur: 0.12, drive: 2.2, pan: 0.28 });
  },

  enemyTelegraph() {
    tone({ dur: 0.14, vol: 0.2, type: "triangle", freq: 320, freqEnd: 200, wet: 0.26, pan: 0.32 });
    crack({ vol: 0.08, dur: 0.0015, freq: 2600, pan: 0.32 });
  },

  teleport() {
    tone({ dur: 0.32, vol: 0.2, type: "sawtooth", freq: 900, freqEnd: 80, wet: 0.5 });
    body({ dur: 0.3, vol: 0.2, from: 5000, to: 200, q: 3.0, color: "white", wet: 0.5 });
  },

  enemyCleave() {
    whoosh({ dur: 0.18, vol: 0.3, low: 380, high: 2400, q: 1.6, wet: 0.3 });
    crack({ at: 0.11, vol: 0.42, dur: 0.0025, freq: 3600 });
    body({ at: 0.11, dur: 0.13, vol: 0.36, from: 3200, to: 150, q: 1.0, color: "brown", drive: 2.4 });
    thump({ at: 0.11, vol: 0.5, from: 120, to: 28, dur: 0.42, drive: 3.4, wet: 0.3 });
    modal({ at: 0.113, vol: 0.16, freq: 420, set: "gong", q: 8, qStep: 4, decay: 0.5, wet: 0.5 });
  },

  fieldOmen() {
    thump({ vol: 0.3, from: 62, to: 40, dur: 0.8, drive: 2.6, wet: 0.5 });
    modal({ at: 0.02, vol: 0.12, freq: 190, set: "gong", q: 8, qStep: 4, decay: 0.9, excite: 0.012, wet: 0.65 });
  },

  // 罡氣落地：土石被炸開的悶響，不是電子音
  tileBurst() {
    crack({ vol: 0.16, dur: 0.0018, freq: 2600, pan: rand(-0.4, 0.4) });
    body({ dur: 0.16, vol: 0.28, from: 1800, to: 90, q: 0.8, color: "brown", drive: 1.8,
           pan: rand(-0.4, 0.4) });
    thump({ vol: 0.32, from: vary(96, 160), to: 26, dur: 0.34, drive: 3.0 });
    body({ at: 0.02, dur: 0.3, vol: 0.12, from: 380, to: 70, q: 0.5, color: "brown", wet: 0.45 });
    debris({ at: 0.03, count: 3, spread: 0.14, vol: 0.05, freq: [1200, 3000], wet: 0.35 });
  },

  dartVolley() {
    body({ dur: 0.3, vol: 0.2, from: 3000, to: 5600, q: 0.9, color: "white", wet: 0.26 });
    for (let i = 0; i < 8; i += 1) {
      crack({ at: rand(0, 0.2), vol: 0.09, dur: 0.0012, freq: rand(4200, 7500), pan: rand(-0.6, 0.6) });
    }
  },

  counterBurst() {
    crack({ vol: 0.34, dur: 0.0022, freq: 4400 });
    body({ dur: 0.2, vol: 0.3, from: 3000, to: 160, q: 1.1, color: "brown", drive: 2.2 });
    thump({ vol: 0.44, from: 155, to: 34, dur: 0.44, drive: 3.2, wet: 0.34 });
    modal({ at: 0.004, vol: 0.16, freq: 620, set: "gong", q: 8, qStep: 4, decay: 0.55, wet: 0.55 });
  },

  // ══ 玩家受擊與介面 ══

  playerHurt() {
    body({ dur: 0.12, vol: 0.3, from: 1400, to: 160, q: 1.0, color: "brown", drive: 2.2 });
    thump({ vol: 0.46, from: 122, to: 34, dur: 0.3, drive: 3.2 });
    tone({ at: 0.02, dur: 0.2, vol: 0.1, type: "sawtooth", freq: 180, freqEnd: 110 });
  },

  shieldBlock() {
    crack({ vol: 0.3, dur: 0.002, freq: 5600 });
    modal({ vol: 0.12, freq: 980, set: "gong", q: 8, qStep: 4, decay: 0.5, excite: 0.004, wet: 0.5 });
    body({ dur: 0.06, vol: 0.2, from: 4000, to: 800, q: 1.6, color: "pink" });
  },

  drawCard() {
    body({ dur: 0.17, vol: 0.24, from: 1400, to: 4800, q: 0.7, color: "pink", wet: 0.2 });
    modal({ at: 0.05, vol: 0.12, freq: 1980, set: "gong", q: 8, qStep: 4, decay: 0.45, excite: 0.012, wet: 0.45 });
  },

  aimOn() {
    crack({ vol: 0.2, dur: 0.0014, freq: 5000 });
    modal({ vol: 0.13, freq: 1560, set: "trinket", decay: 0.16, excite: 0.005, wet: 0.3 });
  },

  aimOff() {
    tone({ dur: 0.09, vol: 0.1, type: "triangle", freq: 520, freqEnd: 300, wet: 0.2 });
  },

  pause() {
    crack({ vol: 0.14, dur: 0.0016, freq: 2200 });
    modal({ vol: 0.11, freq: 880, set: "trinket", decay: 0.13, excite: 0.005, wet: 0.28 });
  },

  victory() {
    [523, 587, 698, 784, 1047].forEach((f, i) => {
      modal({ at: i * 0.115, vol: 0.17, freq: f, set: "gong", q: 8, qStep: 4, decay: 0.9, excite: 0.016, wet: 0.6 });
      crack({ at: i * 0.115, vol: 0.14, dur: 0.0014, freq: 5000 });
    });
    modal({ at: 0.46, vol: 0.16, freq: 131, set: "gong", q: 8, qStep: 4, decay: 1.6, excite: 0.03, wet: 0.65 });
  },

  defeat() {
    [392, 349, 294, 233].forEach((f, i) => {
      modal({ at: i * 0.17, vol: 0.16, freq: f, set: "gong", q: 8, qStep: 4, decay: 0.85, excite: 0.018, wet: 0.6 });
    });
    // 收尾的低沉大鑼
    modal({ at: 0.6, vol: 0.42, freq: 62, set: "gong", q: 8, qStep: 4, decay: 2.0, excite: 0.04, wet: 0.7 });
    body({ at: 0.6, dur: 1.5, vol: 0.14, from: 800, to: 80, q: 0.5, color: "brown", wet: 0.6 });
  }
};

// ═══════════════════════════════════════════════════════════════════
// Generated Foley bank; the original synthesizer is only an offline/load-failure fallback.
const soundBank = window.CombatAudio && window.COMBAT_SOUND_MANIFEST
  ? window.CombatAudio.create({ manifest: window.COMBAT_SOUND_MANIFEST }) : null;
SFX.dartImpact = () => SFX.hitLight();
SFX.punchSwing = () => SFX.boxerDash();
SFX.breathing = () => SFX.drawCard();
SFX.waveSweep = () => SFX.enemyShot();

function installSampleOverrides() {
  for (const name of Object.keys(SFX)) {
    const synth = SFX[name];
    SFX[name] = function (...args) {
      if (audioMuted || audioBroken) return;
      if (soundBank?.play(name, name === "punch" ? args[0] ?? 1 : 1)) return;
      return synth.apply(this, args);
    };
  }
}

async function loadSamples() {
  if (!soundBank || !initAudio()) return;
  await soundBank.load(audioCtx, masterGain);
}

function toggleMute() {
  audioMuted = !audioMuted;
  if (audioMuted) soundBank?.stopAll();
  if (audioCtx && masterGain) {
    masterGain.gain.setTargetAtTime(audioMuted ? 0 : MASTER_VOL, audioCtx.currentTime, 0.02);
  }
  try { localStorage.setItem("pulsedeck.muted", audioMuted ? "1" : "0"); } catch (_) {}
  syncMuteButton();
  if (!audioMuted) SFX.aimOn();
}

function loadMutePref() {
  try { audioMuted = localStorage.getItem("pulsedeck.muted") === "1"; } catch (_) {}
}

const classes = {
  tangmen: {
    name: "唐門",
    color: "#4fb8a0",
    maxHp: TANGMEN_MAX_HP,
    message: "唐門：袖箭命中才會累積氣條，滿氣抽一張暗器卡",
    deck: [
      {
        id: "bone-nail",
        name: "透骨釘",
        tag: "直線",
        tone: "damage",
        description: "沿同一列打出破甲鋼釘，命中造成 32 傷害。",
        sfx: () => SFX.nailThrow(),
        // 直線彈道：整列都可能命中（彈體只在同一列的高度飛行）
        target: () => ({ mode: "lane", cells: laneCells(state.player.row, true) }),
        cast(game) {
          const origin = cellCenter("player", game.player.col, game.player.row);
          addProjectile({
            x: origin.x + 34,
            y: origin.y - 16,
            vx: 640,
            vy: 0,
            radius: 10,
            shape: "nail",
            color: "#cfe6dd",
            trail: "#7fe3cf",
            damage: 32,
            hitKind: "skill",
            owner: "player"
          });
        }
      },
      {
        id: "thousand-machine",
        name: "千機匣",
        tag: "近距",
        tone: "control",
        description: "袖中機匣近距爆射，攻擊敵方前兩格造成 44 傷害並短暫定身。",
        sfx: () => SFX.machineBox(),
        target: () => ({
          mode: "area",
          cells: rectCells("enemy", [0, 1], [state.player.row - 1, state.player.row, state.player.row + 1])
        }),
        cast(game) {
          const rows = [game.player.row - 1, game.player.row, game.player.row + 1];
          addDartSpray(rows, 0, 2, "#7fe3cf");
          const enemyCell = enemyVisualCell();
          if (enemyCell.side === "enemy" && rows.includes(enemyCell.row) && enemyCell.col <= 1) {
            applyEnemyDamage(44, { kind: "skill" });
            game.enemy.stun = 0.38;
            game.message = "千機匣命中：敵人被釘住";
          }
        }
      },
      {
        id: "silk-armor",
        name: "金絲軟甲",
        tag: "防禦",
        tone: "utility",
        description: "披上金絲軟甲獲得 28 護盾，護盾會先抵擋敵方攻擊。",
        sfx: () => SFX.silkArmor(),
        instant: true,
        target: () => ({ mode: "self", cells: [{ side: "player", col: state.player.col, row: state.player.row }] }),
        cast(game) {
          game.player.shield = Math.min(60, game.player.shield + 28);
          const pos = cellCenter("player", game.player.col, game.player.row);
          addBurst(pos.x, pos.y - 22, "#d8a12f", 0.35);
          game.message = "金絲軟甲：護體已成";
        }
      },
      {
        id: "pear-blossom",
        name: "暴雨梨花針",
        tag: "範圍",
        tone: "damage",
        description: "鎖定敵人所在格，梨花針暴雨落下造成 56 傷害。",
        sfx: () => SFX.needleRain(),
        // 鎖定敵人當下的格子（敵人跑掉就躲過，所以預覽跟著敵人走）
        target: () => ({ mode: "mark", cells: [{ side: "enemy", col: state.enemy.col, row: state.enemy.row }] }),
        cast(game) {
          game.effects.push({
            kind: "needleRain",
            side: "enemy",
            col: game.enemy.col,
            row: game.enemy.row,
            color: "#cfe6dd",
            time: 0.72,
            duration: 0.72,
            onFinish() {
              const pos = cellCenter(this.side, this.col, this.row);
              if (game.enemy.col === this.col && game.enemy.row === this.row) {
                applyEnemyDamage(56, { kind: "skill", big: true });
              }
              addBurst(pos.x, pos.y - 22, "#cfe6dd", 0.3);
              for (let i = 0; i < 14; i += 1) {
                addBurst(
                  pos.x + (Math.random() * 2 - 1) * 40,
                  pos.y - 10 + (Math.random() * 2 - 1) * 22,
                  "#7fe3cf",
                  0.16 + Math.random() * 0.12
                );
              }
            }
          });
          game.message = "暴雨梨花針：針雨鎖定，敵人離開該格即可躲過";
        }
      }
    ],
    basicAttack(game) {
      SFX.dartThrow();
      const origin = cellCenter("player", game.player.col, game.player.row);
      addProjectile({
        x: origin.x + 32,
        y: origin.y - 18,
        vx: 760,
        vy: 0,
        radius: 7,
        shape: "dart",
        color: "#e2ded0",
        trail: "#d8a12f",
        damage: 12,
        hitKind: "basic",
        owner: "player",
        chargeOnHit: 24
      });
    }
  },
  swordsman: {
    name: "劍客",
    color: "#d8a12f",
    maxHp: SWORDSMAN_MAX_HP,
    message: "劍客：普攻固定斬前方第四格，浮空後接特定攻擊可加倍擊飛",
    deck: [
      {
        id: "sword-qi",
        name: "流光劍氣",
        tag: "直線",
        tone: "airborne",
        description: "瞬間掃過整列的劍氣，造成 24 傷害並使敵人浮空 1 秒。浮空後接特定攻擊可加倍擊飛。",
        sfx: () => SFX.swordBeam(),
        target: () => ({ mode: "lane", cells: laneCells(state.player.row, false) }),
        cast(game) {
          const row = game.player.row;
          const enemyCell = enemyVisualCell();
          game.effects.push({
            kind: "swordWave",
            row,
            color: "#f0d692",
            time: 0.18,
            duration: 0.18
          });
          if (enemyCell.row === row) {
            applyEnemyDamage(24, { kind: "skill" });
            game.enemy.airborne = 1;
            game.enemy.stun = Math.max(game.enemy.stun, 0.35);
            const pos = enemyVisualPosition();
            addBurst(pos.x, pos.y - 22, "#f0d692", 0.22);
            game.message = "流光劍氣命中：敵人浮空，浮空後接特定攻擊可加倍擊飛（斷雲橫砍）";
          } else {
            game.message = "流光劍氣掃空：劍氣會瞬間通過整列";
          }
        }
      },
      {
        id: "cross-cut",
        name: "斷雲橫砍",
        tag: "豎三格",
        tone: "damage",
        description: "以目前準心為中心砍擊豎三格，浮空中命中會傷害加倍並擊飛。",
        sfx: () => SFX.crossCut(),
        target: () => {
          const aim = combatAimCell();
          return { mode: "hit", cells: rectCells(aim.side, [aim.col], [aim.row - 1, aim.row, aim.row + 1]) };
        },
        cast(game) {
          const aim = combatAimCell();
          const rows = [aim.row - 1, aim.row, aim.row + 1];
          addSlashEffect(rows, aim.col, 1, "#d8a12f", aim.side);
          if (rows.some((row) => enemyOnCell({ side: aim.side, col: aim.col, row }))) {
            hitEnemyWithSkill(30, { combo: true, color: "#d8a12f" });
          }
        }
      },
      {
        id: "thrust",
        name: "追風突刺",
        tag: "穿刺",
        tone: "control",
        description: "突刺準心格與其左側一格，造成 28 傷害並定身 4 秒。",
        sfx: () => SFX.thrust(),
        target: () => {
          const aim = combatAimCell();
          return { mode: "hit", cells: rectCells(aim.side, [aim.col - 1, aim.col], [aim.row]) };
        },
        cast(game) {
          const aim = combatAimCell();
          const hitCols = [aim.col - 1, aim.col];
          addSlashEffect([aim.row], Math.max(0, aim.col - 1), Math.min(2, aim.col + 1), "#e9dcc0", aim.side);
          if (hitCols.some((col) => enemyOnCell({ side: aim.side, col, row: aim.row }))) {
            hitEnemyWithSkill(28, { color: "#e9dcc0" });
            game.enemy.root = 4;
            game.message = "追風突刺命中：敵人定身 4 秒";
          }
        }
      },
      {
        id: "moon-arc",
        name: "月弧返斬",
        tag: "反擊",
        description: "進入 1.2 秒防守架勢；期間受擊會抵銷傷害並反斬敵人。",
        sfx: () => SFX.counterStance(),
        instant: true,
        target: () => ({ mode: "self", cells: [{ side: "player", col: state.player.col, row: state.player.row }] }),
        cast(game) {
          game.player.counter = 1.2;
          const pos = cellCenter("player", game.player.col, game.player.row);
          addBurst(pos.x, pos.y - 20, "#8e4b6d", 0.34);
          game.message = "月弧返斬：進入防守反擊架勢";
        }
      }
    ],
    // 普攻改成飛出去的劍氣，但一次只能有一道在場上：
    // 前一道要命中或飛出畫面，才能再揮下一劍。
    basicAttack(game) {
      if (swordQiInFlight()) {
        game.message = "劍氣未消：等前一道命中或離場才能再揮";
        return;
      }
      SFX.swordSwing();
      const origin = cellCenter("player", game.player.col, game.player.row);
      addProjectile({
        x: origin.x + 30,
        y: origin.y - 20,
        vx: 700,
        vy: 0,
        radius: 16,
        shape: "swordQi",
        color: "#fff6d8",
        trail: "#d8a12f",
        damage: 14,
        hitKind: "basic",
        owner: "player",
        swordBasic: true,
        chargeOnHit: 42
      });
      game.message = "劍客揮出劍氣：同一列擊中才會集氣";
    }
  },
  boxer: {
    name: "拳師",
    color: "#e07b3a",
    maxHp: BOXER_MAX_HP,
    message: "拳師：同列普攻鎖定敵人左側出拳，收招返回；命中集氣 90",
    deck: [
      {
        id: "driving-palm",
        name: "震山推掌",
        tag: "推",
        tone: "control",
        description: "以準心為中心攻擊 2x3 區域，造成 18 傷害、緩速並把敵人往後推 1 格。",
        sfx: () => SFX.palmPush(),
        target: () => areaToCells(boxerControlArea(combatAimCell())),
        cast(game) {
          const aim = combatAimCell();
          const area = boxerControlArea(aim);
          addAreaEffect(area, "#e8a05a");
          if (enemyInsideArea(area)) {
            hitEnemyWithSkill(18, { color: "#e8a05a" });
            game.enemy.slow = Math.max(game.enemy.slow, 2.4);
            shiftEnemy(1);
            game.message = "震山推掌命中：敵人被推開";
          }
        }
      },
      {
        id: "dragon-pull",
        name: "擒龍勁",
        tag: "拉",
        tone: "control",
        description: "以準心為中心攻擊 2x3 區域，造成 14 傷害、緩速並把敵人拉近 1 格。",
        sfx: () => SFX.dragonPull(),
        target: () => areaToCells(boxerControlArea(combatAimCell())),
        cast(game) {
          const aim = combatAimCell();
          const area = boxerControlArea(aim);
          addAreaEffect(area, "#4fb8a0");
          if (enemyInsideArea(area)) {
            hitEnemyWithSkill(14, { color: "#4fb8a0" });
            game.enemy.slow = Math.max(game.enemy.slow, 2.4);
            shiftEnemy(-1);
            game.message = "擒龍勁命中：敵人被拉近";
          }
        }
      },
      {
        id: "meridian-lock",
        name: "鎖脈震擊",
        tag: "定身",
        tone: "control",
        description: "攻擊準心格與左側一格，造成 20 傷害並定身 4 秒。",
        sfx: () => SFX.meridianLock(),
        target: () => {
          const aim = combatAimCell();
          return { mode: "hit", cells: rectCells(aim.side, [aim.col - 1, aim.col], [aim.row]) };
        },
        cast(game) {
          const aim = combatAimCell();
          const startCol = Math.max(0, aim.col - 1);
          addSlashEffect([aim.row], startCol, aim.col - startCol + 1, "#d8a12f", aim.side);
          if ([aim.col - 1, aim.col].some((col) => enemyOnCell({ side: aim.side, col, row: aim.row }))) {
            hitEnemyWithSkill(20, { color: "#d8a12f" });
            game.enemy.root = 4;
            game.message = "鎖脈震擊命中：敵人定身 4 秒";
          }
        }
      },
      {
        id: "hundred-fist",
        name: "百裂崩拳",
        tag: "爆發",
        tone: "damage",
        description: "只打準心格；引導 1.6 秒期間無法移動，持續命中，最後一擊造成大傷害。",
        sfx: () => SFX.channelStart(),
        target: () => {
          const aim = combatAimCell();
          return { mode: "hit", cells: [aim] };
        },
        cast(game) {
          const aim = combatAimCell();
          game.effects.push({
            kind: "boxerChannel",
            side: aim.side,
            col: aim.col,
            row: aim.row,
            color: "#e07b3a",
            tickTimer: 0.05,
            finisherDone: false,
            time: 1.6,
            duration: 1.6
          });
          game.message = "百裂崩拳：引導 1.6 秒無法移動，敵人留在準心內才會吃滿傷害";
        }
      },
      {
        id: "breathing",
        name: "運氣調息",
        tag: "抽牌",
        tone: "draw",
        description: "直接抽兩張新卡，補充拳路。",
        sfx: () => SFX.breathing(),
        instant: true,
        target: () => ({ mode: "none", cells: [] }),
        cast(game) {
          drawCard();
          drawCard();
          game.message = "運氣調息：抽兩張新卡";
        }
      },
      {
        id: "dragon-regret",
        name: "亢龍有悔",
        tag: "大招",
        tone: "damage",
        description: "引導 2 秒後，以準心欄位為中心打出十字範圍重擊。",
        sfx: () => SFX.dragonCharge(),
        target: () => {
          const aim = combatAimCell();
          return { mode: "hit", cells: crossCells(aim.side, aim.col, aim.row) };
        },
        cast(game) {
          const aim = combatAimCell();
          game.effects.push({
            kind: "dragonRegret",
            side: aim.side,
            col: aim.col,
            row: aim.row,
            color: "#c8452f",
            time: 2,
            duration: 2,
            onFinish() {
              SFX.dragonBurst();
              const cells = crossCells(this.side, this.col, this.row);
              addCrossBurst(cells, this.color);
              if (enemyInsideCells(cells)) {
                hitEnemyWithSkill(92, { color: this.color, forceCrit: true, big: true, silent: true });
              }
            }
          });
          game.message = "亢龍有悔：開始引導 2 秒";
        }
      }
    ],
    basicAttack(game) {
      const aim = boxerBasicTarget();
      const origin = { side: "player", col: game.player.col, row: game.player.row };
      const landing = offsetCell(aim, -1);
      game.player.boxerStrike = { origin, landing, aim, elapsed: 0, resolved: false };
      addDashTrail(origin, landing);
      SFX.boxerDash();
      game.effects.push({
        kind: "target",
        ...aim,
        color: "#e07b3a",
        time: BOXER_STRIKE_DURATION,
        duration: BOXER_STRIKE_DURATION
      });
      game.message = "崩山突：瞬移出拳";
      renderHand();
    }
  }
};

state = createInitialState();

function createInitialState() {
  const profession = classes[selectedClass];
  return {
    phase: "playing",
    message: profession.message,
    player: {
      hp: profession.maxHp,
      shield: 0,
      col: 1,
      row: 2,
      moveCooldown: 0,
      attackCooldown: 0,
      invuln: 0,
      counter: 0,
      charge: 0,
      aiming: null,
      boxerStrike: null,
      hand: Array(HAND_SIZE).fill(null)
    },
    enemy: {
      hp: ENEMY_MAX_HP,
      col: 2,
      row: 1,
      moveTimer: 0.9,
      attackTimer: 0.9,
      specialCooldown: 4.2,
      special: null,
      fieldCooldown: 3.2,
      field: null,
      fieldTurn: Math.floor(Math.random() * FIELD_ATTACKS.length),
      counterCharge: 0,
      counterCooldown: 0,
      teleportStrikeCooldown: 5.4 + Math.random() * 2.2,
      teleportStrike: null,
      stun: 0,
      airborne: 0,
      slow: 0,
      root: 0,
      visualKnockback: null
    },
    projectiles: [],
    effects: []
  };
}

function cellCenter(side, col, row) {
  const points = cellPolygon(side, col, row);
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
}

function cellPolygon(side, col, row, inset = 0) {
  const globalCol = side === "player" ? col : COLS_PER_SIDE + col;
  const points = [
    boardPoint(globalCol, row),
    boardPoint(globalCol + 1, row),
    boardPoint(globalCol + 1, row + 1),
    boardPoint(globalCol, row + 1)
  ];
  return inset > 0 ? insetPolygon(points, inset) : points;
}

function drawPolygon(points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

function lerpPoint(a, b, amount) {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount
  };
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function boardPoint(col, row) {
  const rowT = row / ROWS;
  const colT = col / (COLS_PER_SIDE * 2);
  const left = lerpPoint(BOARD_TOP_LEFT, BOARD_BOTTOM_LEFT, rowT);
  const right = lerpPoint(BOARD_TOP_RIGHT, BOARD_BOTTOM_RIGHT, rowT);
  return lerpPoint(left, right, colT);
}

function insetPolygon(points, amount) {
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
  const factor = Math.max(0.72, 1 - amount / 100);
  return points.map((point) => ({
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor
  }));
}

function forwardCellFromPlayer(col, row, distance) {
  const globalCol = col + distance;
  if (globalCol < COLS_PER_SIDE) {
    return { side: "player", col: globalCol, row };
  }
  return {
    side: "enemy",
    col: clamp(globalCol - COLS_PER_SIDE, 0, COLS_PER_SIDE - 1),
    row
  };
}

function playerMaxHp() {
  return classes[selectedClass].maxHp;
}

function combatAimCell() {
  if (state.player.boxerStrike) return state.player.boxerStrike.aim;
  return forwardCellFromPlayer(state.player.col, state.player.row, 4);
}

function offsetCell(cell, dc, dr = 0) {
  const col = (cell.side === "enemy" ? COLS_PER_SIDE : 0) + cell.col + dc;
  const row = cell.row + dr;
  if (col < 0 || col >= COLS_PER_SIDE * 2 || row < 0 || row >= ROWS) return null;
  return col < COLS_PER_SIDE ? { side: "player", col, row }
    : { side: "enemy", col: col - COLS_PER_SIDE, row };
}

// 原格保留給返回與移動；繪圖、受擊與敵人瞄準共用瞬移中的實際位置。
function playerCombatCell() {
  return state.player.boxerStrike?.landing
    || { side: "player", col: state.player.col, row: state.player.row };
}

function playerCombatPosition() {
  const cell = playerCombatCell();
  return cellCenter(cell.side, cell.col, cell.row);
}

function playerOnCell(cell) {
  const player = playerCombatCell();
  return cell.side === player.side && cell.col === player.col && cell.row === player.row;
}

function boxerBasicTarget() {
  const enemy = enemyVisualCell();
  if (enemy.row === state.player.row && offsetCell(enemy, -1)) return { ...enemy };
  return { ...combatAimCell() };
}

function enemyOnCell(cell) {
  const enemyCell = enemyVisualCell();
  return cell.side === enemyCell.side && cell.col === enemyCell.col && cell.row === enemyCell.row;
}

function enemyVisualCell() {
  const strike = state.enemy.teleportStrike;
  if (strike) return strike.landing;
  return { side: "enemy", col: state.enemy.col, row: state.enemy.row };
}

function enemyVisualPosition() {
  const cell = enemyVisualCell();
  return cellCenter(cell.side, cell.col, cell.row);
}

function shiftEnemy(amount) {
  state.enemy.col = clamp(state.enemy.col + amount, 0, COLS_PER_SIDE - 1);
}

function boxerControlArea(aim) {
  return {
    side: aim.side,
    cols: [Math.max(0, aim.col - 1), aim.col],
    rows: [aim.row - 1, aim.row, aim.row + 1].filter((row) => row >= 0 && row < ROWS)
  };
}

function enemyInsideArea(area) {
  const enemyCell = enemyVisualCell();
  return area.side === enemyCell.side && area.cols.includes(enemyCell.col) && area.rows.includes(enemyCell.row);
}

function addAreaEffect(area, color) {
  state.effects.push({
    kind: "area",
    area,
    color,
    time: 0.26,
    duration: 0.26
  });
}

function crossCells(side, col, row) {
  const cells = [{ side, col, row }];
  for (let nextCol = 0; nextCol < COLS_PER_SIDE; nextCol += 1) {
    if (nextCol !== col) cells.push({ side, col: nextCol, row });
  }
  for (let nextRow = 0; nextRow < ROWS; nextRow += 1) {
    if (nextRow !== row) cells.push({ side, col, row: nextRow });
  }
  return cells;
}

function enemyInsideCells(cells) {
  return cells.some((cell) => enemyOnCell(cell));
}

// ── 準心範圍用的格子產生器 ───────────────────────────────────────
// 卡牌的 target() 一律用這幾個 helper 組出來，能沿用 cast 裡同一個
// combatAimCell()／boxerControlArea() 的就直接沿用，預覽才不會跟實際命中不一致。
function rectCells(side, cols, rows) {
  const cells = [];
  for (const col of cols) {
    if (col < 0 || col >= COLS_PER_SIDE) continue;
    for (const row of rows) {
      if (row < 0 || row >= ROWS) continue;
      cells.push({ side, col, row });
    }
  }
  return cells;
}

// 整列彈道。includePlayerSide 用於玩家自己這側也會飛過的直線攻擊。
function laneCells(row, includePlayerSide) {
  const cells = [];
  if (includePlayerSide) {
    for (let col = state.player.col + 1; col < COLS_PER_SIDE; col += 1) {
      cells.push({ side: "player", col, row });
    }
  }
  for (let col = 0; col < COLS_PER_SIDE; col += 1) {
    cells.push({ side: "enemy", col, row });
  }
  return cells.filter((cell) => cell.row >= 0 && cell.row < ROWS);
}

function areaToCells(area) {
  return { mode: "area", cells: rectCells(area.side, area.cols, area.rows) };
}

function addCrossBurst(cells, color) {
  for (const cell of cells) {
    const pos = cellCenter(cell.side, cell.col, cell.row);
    addBurst(pos.x, pos.y - 18, color, 0.26);
  }
}

function addProjectile(projectile) {
  state.projectiles.push(projectile);
}

function addBurst(x, y, color, duration = 0.2) {
  state.effects.push({ kind: "burst", x, y, color, time: duration, duration });
}

function addSwordHitEffect() {
  const pos = enemyVisualPosition();
  state.effects.push({
    kind: "swordHit",
    x: pos.x,
    y: pos.y - 24,
    color: "#f0d692",
    time: 0.24,
    duration: 0.24
  });
}

function addPunchHitEffect() {
  const pos = enemyVisualPosition();
  state.effects.push({
    kind: "punchHit",
    x: pos.x,
    y: pos.y - 24,
    color: "#e8a05a",
    time: 0.22,
    duration: 0.22
  });
}

function addSlashEffect(rows, col, width, color, side = "enemy") {
  state.effects.push({
    kind: "slash",
    rows,
    col,
    width,
    side,
    color,
    seed: Math.floor(Math.random() * 99991),
    time: 0.34,
    duration: 0.34
  });
}

// 唐門近距爆射：一大片飛出去的暗器
function addDartSpray(rows, col, width, color, side = "enemy") {
  state.effects.push({
    kind: "dartSpray",
    rows: rows.filter((row) => row >= 0 && row < ROWS),
    col,
    width,
    side,
    color,
    seed: Math.floor(Math.random() * 99991),
    time: 0.32,
    duration: 0.32
  });
}

function addPlayerTileTelegraph(col, row, delay, damage, color = "#c8452f", side = "player") {
  state.effects.push({
    kind: "tileTelegraph",
    side,
    col,
    row,
    color,
    time: delay,
    duration: delay,
    onFinish() {
      SFX.tileBurst();
      const pos = cellCenter(side, col, row);
      addBurst(pos.x, pos.y - 10, color, 0.24);
      if (playerOnCell({ side, col, row })) {
        damagePlayer(damage);
      }
    }
  });
}

function addColumnTelegraph(side, col, rows, delay, damage = 0) {
  state.effects.push({
    kind: "columnTelegraph",
    side,
    col,
    rows,
    color: "#d8623f",
    time: delay,
    duration: delay,
    onFinish() {
      for (const row of rows) {
        const pos = cellCenter(side, col, row);
        addBurst(pos.x, pos.y - 10, "#d8623f", 0.18);
      }
      if (rows.some((row) => playerOnCell({ side, col, row }))) {
        damagePlayer(damage);
      }
    }
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function firstEmptyHandSlot() {
  return state.player.hand.findIndex((card) => card === null);
}

function drawCard() {
  const slot = firstEmptyHandSlot();
  if (slot === -1) {
    state.message = "手牌已滿，先使用技能空出欄位";
    return false;
  }
  const deck = classes[selectedClass].deck;
  const weights = deck.map((card) => {
    const copies = state.player.hand.filter((held) => held && held.id === card.id).length;
    return copies >= 2 ? 0.35 : 1;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = Math.random() * totalWeight;
  let card = deck[deck.length - 1];
  for (let i = 0; i < deck.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) {
      card = deck[i];
      break;
    }
  }
  state.player.hand[slot] = card;
  state.message = `抽到 ${card.name}，放入第 ${slot + 1} 格`;
  SFX.drawCard();
  renderHand();
  return true;
}

function gainCharge(amount) {
  state.player.charge = Math.min(100, state.player.charge + amount);
  while (state.player.charge >= 100 && firstEmptyHandSlot() !== -1) {
    state.player.charge -= 100;
    drawCard();
  }
}

function redeemStoredCharge() {
  if (state.player.charge < 100 || firstEmptyHandSlot() === -1) return;
  state.player.charge -= 100;
  drawCard();
}

function hitEnemyWithSkill(baseDamage, options = {}) {
  const combo = options.combo && state.enemy.airborne > 0;
  if (state.phase === "playing" && !options.silent) {
    if (combo) SFX.launcher();
    else if (options.sfx) options.sfx();
    else if (selectedClass === "swordsman") SFX.swordImpact();
    else if (selectedClass === "tangmen") SFX.dartImpact();
    else if (selectedClass === "boxer") SFX.punch(options.big ? 1.2 : 1);
    else if (options.kind === "basic") SFX.hitLight();
    else SFX.hitHeavy();
  }
  const resolved = applyEnemyDamage(combo ? baseDamage * 2 : baseDamage, {
    kind: options.kind || "skill",
    big: options.big || combo,
    forceCrit: options.forceCrit
  });
  if (options.charge) gainCharge(options.charge);

  const pos = enemyVisualPosition();
  addBurst(pos.x, pos.y - 20, options.color || "#d8a12f", combo ? 0.34 : 0.2);

  if (combo) {
    const fromCol = state.enemy.col;
    const row = state.enemy.row;
    state.enemy.airborne = 0;
    state.enemy.col = COLS_PER_SIDE - 1;
    state.enemy.slow = 2.8;
    state.enemy.stun = Math.max(state.enemy.stun, 0.45);
    state.enemy.visualKnockback = {
      fromCol,
      toCol: COLS_PER_SIDE - 1,
      row,
      time: 0.34,
      duration: 0.34
    };
    state.effects.push({
      kind: "knockback",
      fromCol,
      toCol: COLS_PER_SIDE - 1,
      row,
      color: options.color || "#d8a12f",
      time: 0.34,
      duration: 0.34
    });
    state.message = `擊飛聯招！傷害 ${resolved.damage}，敵人被推到最後排並緩速`;
  }
}

function finishBoxerStrike() {
  const strike = state.player.boxerStrike;
  if (!strike) return;
  state.player.col = strike.origin.col;
  state.player.row = strike.origin.row;
  state.player.boxerStrike = null;
  addDashTrail(strike.landing, strike.origin);
  renderHand();
}

function updateBoxerStrike(dt) {
  const strike = state.player.boxerStrike;
  if (!strike || paused) return;
  if (state.phase !== "playing" || state.player.hp <= 0) {
    finishBoxerStrike();
    return;
  }
  strike.elapsed += dt;
  if (!strike.resolved && strike.elapsed >= BOXER_STRIKE_IMPACT) {
    strike.resolved = true;
    if (enemyOnCell(strike.aim)) {
      hitEnemyWithSkill(BOXER_BASIC_DAMAGE, {
        charge: BOXER_BASIC_CHARGE, color: "#e07b3a", kind: "basic", sfx: () => SFX.punch(1.15)
      });
      addPunchHitEffect();
      if (state.phase === "playing") state.message = "崩山突：命中";
    } else {
      SFX.punchSwing();
      state.message = "崩山突：落空";
    }
  }
  if (strike.elapsed >= BOXER_STRIKE_DURATION) finishBoxerStrike();
}

function addDashTrail(from, to) {
  if (from.side === to.side && from.col === to.col && from.row === to.row) return;
  state.effects.push({
    kind: "dashTrail",
    from: { ...from },
    to: { ...to },
    color: "#e07b3a",
    time: 0.3,
    duration: 0.3
  });
}

// 場上還有沒有玩家的劍氣普攻
function swordQiInFlight() {
  return state.projectiles.some((p) => p.owner === "player" && p.swordBasic && !p.dead);
}

function playerBasicAttack() {
  if (paused || state.phase !== "playing" || state.player.attackCooldown > 0 || state.player.boxerStrike) return;
  if (selectedClass === "boxer" && playerIsChanneling()) return;
  // 劍客的節奏由「一次只能一道劍氣」控制，冷卻只用來擋按鍵連點
  if (selectedClass === "swordsman" && swordQiInFlight()) return;
  if (selectedClass === "swordsman") state.player.attackCooldown = 0.16;
  else if (selectedClass === "boxer") state.player.attackCooldown = BOXER_ATTACK_CD;
  else state.player.attackCooldown = 0.34;
  if (selectedClass === "boxer") state.player.artAction = null;
  CharacterArt.play(state.player, "attack", selectedClass === "boxer" ? BOXER_STRIKE_DURATION : 0.32);
  classes[selectedClass].basicAttack(state);
}

// ── 兩段式施放 ───────────────────────────────────────────────────
// 第一下進入瞄準（卡牌發光、棋盤畫出可命中格），第二下才真的放出去。
// 瞄準期間可以自由移動，準心會跟著更新 —— 這才是「比較好瞄準」的關鍵。
function aimedCard() {
  if (state.player.aiming === null) return null;
  return state.player.hand[state.player.aiming] || null;
}

// 目前瞄準的範圍，附帶「現在放會不會命中」
function currentAimPreview() {
  const card = aimedCard();
  if (!card || !card.target) return null;
  const preview = card.target(state);
  return {
    card,
    mode: preview.mode,
    cells: preview.cells,
    willHit: preview.cells.some((cell) => enemyOnCell(cell))
  };
}

function cancelAiming(reason) {
  if (state.player.aiming === null) return;
  state.player.aiming = null;
  SFX.aimOff();
  if (reason) state.message = reason;
  renderHand();
}

function resolveCard(index) {
  const card = state.player.hand[index];
  if (!card) return;
  state.player.hand[index] = null;
  state.player.aiming = null;
  state.message = `施放 ${card.name}`;
  if (card.sfx) card.sfx();
  if (card.id === "dragon-regret") CharacterArt.play(state.player, "charge", 2.54, 2);
  else if (["moon-arc", "silk-armor", "breathing"].includes(card.id)) CharacterArt.play(state.player, "guard", 0.5);
  else CharacterArt.play(state.player, "cast", 0.54);
  card.cast(state);
  redeemStoredCharge();
  renderHand();
}

function castCard(index) {
  if (paused || state.phase !== "playing" || state.player.boxerStrike) return;
  const card = state.player.hand[index];
  if (!card) return;

  // 沒有瞄準對象的卡（護盾、架勢、抽牌）不需要兩段，按一下就放
  if (card.instant || !card.target) {
    resolveCard(index);
    return;
  }

  if (state.player.aiming === index) {
    resolveCard(index);
    return;
  }

  // 換選另一張：直接切過去，不用先取消
  state.player.aiming = index;
  SFX.aimOn();
  state.message = `${card.name}：瞄準中，再按一次施放（Q 取消）`;
  renderHand();
}

function rollDamage(baseDamage, { forceCrit = false } = {}) {
  const variance = 1 + (Math.random() * 2 - 1) * DAMAGE_VARIANCE;
  const crit = forceCrit || Math.random() < CRIT_CHANCE;
  const damage = Math.max(1, Math.round(baseDamage * variance * (crit ? 2 : 1)));
  return { damage, crit };
}

function applyEnemyDamage(baseDamage, { kind = "skill", forceCrit = false, big = false } = {}) {
  const { damage, crit } = rollDamage(baseDamage, { forceCrit });
  if (crit && state.phase === "playing") SFX.critAccent();
  state.enemy.hp = Math.max(0, state.enemy.hp - damage);
  state.enemy.artHurt = 0.24;
  const pos = enemyVisualPosition();
  addDamageNumber(pos.x, pos.y - 72, damage, { kind, big: big || crit });
  if (state.enemy.hp <= 0 && state.phase === "playing") {
    soundBank?.stopAll();
    state.phase = "win";
    state.player.aiming = null;
    state.message = "勝利：模板完成，可以開始加關卡與卡池";
    SFX.victory();
    syncPauseButton();
    renderHand();
  }
  return { damage, crit };
}

function addDamageNumber(x, y, damage, { kind = "skill", big = false } = {}) {
  // 同時存在的傷害數字往上錯開，避免重疊糊成一團
  const live = state.effects.filter((effect) => effect.kind === "damageNumber").length;
  state.effects.push({
    kind: "damageNumber",
    x,
    y,
    big,
    text: String(damage),
    color: big ? INK.cinnabarLit : kind === "basic" ? INK.paper : INK.goldLit,
    size: big ? 42 : kind === "basic" ? 25 : 31,
    stroke: big ? "#4a0f0a" : kind === "basic" ? "#191f24" : "#4a3208",
    drift: (Math.random() * 2 - 1) * 26,
    tilt: (Math.random() * 2 - 1) * (big ? 0.1 : 0.05),
    stack: Math.min(live, 5) * 17,
    time: big ? 0.92 : 0.74,
    duration: big ? 0.92 : 0.74
  });
}

function damagePlayer(amount) {
  if (state.player.invuln > 0 || state.phase !== "playing") return;
  if (state.player.counter > 0) {
    state.player.counter = 0;
    CharacterArt.play(state.player, "slash", 0.4);
    const pos = playerCombatPosition();
    addBurst(pos.x, pos.y - 20, "#8e4b6d", 0.3);
    SFX.counterHit();
    hitEnemyWithSkill(46, { color: "#8e4b6d" });
    state.message = "月弧返斬成功：抵銷傷害並反擊";
    return;
  }
  const blocked = Math.min(state.player.shield, amount);
  if (blocked >= amount) SFX.shieldBlock();
  else SFX.playerHurt();
  state.player.shield -= blocked;
  state.player.hp = Math.max(0, state.player.hp - (amount - blocked));
  if (amount > blocked) state.player.artHurt = 0.24;
  else CharacterArt.play(state.player, "guard", 0.3);
  state.player.invuln = 0.38;
  if (state.player.hp <= 0) {
    state.phase = "lose";
    state.player.aiming = null;
    state.message = "戰敗：按重新開始再試一次";
    soundBank?.stopAll();
    SFX.defeat();
    syncPauseButton();
    renderHand();
  }
}

// 引導中的百裂崩拳會把拳師釘在原地 —— 高傷害的代價是這 1.6 秒不能閃。
// 直接從 effects 推導，不另外存一個計時器，兩邊不會有機會走不同步。
function playerIsChanneling() {
  return state.effects.some((effect) => effect.kind === "boxerChannel" && effect.time > 0);
}

function movePlayer(dx, dy) {
  if (paused || state.phase !== "playing" || state.player.moveCooldown > 0 || state.player.boxerStrike) return;
  if (playerIsChanneling()) {
    state.message = "百裂崩拳引導中：雙腳生根，無法移動";
    return;
  }
  const nextCol = clamp(state.player.col + dx, 0, COLS_PER_SIDE - 1);
  const nextRow = clamp(state.player.row + dy, 0, ROWS - 1);
  if (nextCol === state.player.col && nextRow === state.player.row) return;
  state.player.col = nextCol;
  state.player.row = nextRow;
  state.player.moveCooldown = 0.13;
  CharacterArt.play(state.player, "move", 0.13);
}

function detectMobileInput() {
  return mobileInputQuery.matches || navigator.maxTouchPoints > 0 || window.innerWidth <= 900;
}

function syncInputMode() {
  mobileInputEnabled = detectMobileInput();
  document.body.classList.toggle("mobile-input", mobileInputEnabled);
}

function handleBoardPointerDown(event) {
  if (!mobileInputEnabled || event.pointerType === "mouse" || paused) return;
  touchStart = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY
  };
  canvas.setPointerCapture(event.pointerId);
}

function handleBoardPointerUp(event) {
  if (!touchStart || touchStart.id !== event.pointerId) return;

  const dx = event.clientX - touchStart.x;
  const dy = event.clientY - touchStart.y;
  const distance = Math.hypot(dx, dy);
  const swipeThreshold = 40;

  if (distance < swipeThreshold) {
    playerBasicAttack();
  } else if (Math.abs(dx) > Math.abs(dy)) {
    movePlayer(dx > 0 ? 1 : -1, 0);
  } else {
    movePlayer(0, dy > 0 ? 1 : -1);
  }

  touchStart = null;
}

function cancelBoardPointer(event) {
  if (touchStart && touchStart.id === event.pointerId) {
    touchStart = null;
  }
}

function updateInput() {
  if (paused) return;
  if (keys.has("arrowleft") || keys.has("a")) movePlayer(-1, 0);
  if (keys.has("arrowright") || keys.has("d")) movePlayer(1, 0);
  if (keys.has("arrowup") || keys.has("w")) movePlayer(0, -1);
  if (keys.has("arrowdown") || keys.has("s")) movePlayer(0, 1);
}

function enemyHasInterruptingControl(enemy) {
  return enemy.stun > 0 || enemy.airborne > 0 || Boolean(enemy.visualKnockback);
}

function interruptTeleportStrike(enemy) {
  const strike = enemy.teleportStrike;
  if (!strike || strike.phase !== "warning") return;
  strike.phase = "interrupted";
  strike.time = 0;
  enemy.artAction = null;

  const pos = cellCenter(strike.landing.side, strike.landing.col, strike.landing.row);
  addBurst(pos.x, pos.y - 28, "#7fe3cf", 0.38);
  state.effects.push({
    kind: "interruptMark",
    x: pos.x + 58,
    y: pos.y - 58,
    color: "#7fe3cf",
    time: 0.72,
    duration: 0.72
  });
  state.message = "瞬身斬被中斷！敵人會在控制狀態結束後返回原位";
}

function updateEnemy(dt) {
  const enemy = state.enemy;
  if (state.phase !== "playing") return;
  enemy.stun = Math.max(0, enemy.stun - dt);
  enemy.airborne = Math.max(0, enemy.airborne - dt);
  enemy.slow = Math.max(0, enemy.slow - dt);
  enemy.root = Math.max(0, enemy.root - dt);
  if (enemy.visualKnockback) {
    enemy.visualKnockback.time -= dt;
    if (enemy.visualKnockback.time <= 0) {
      enemy.visualKnockback = null;
    }
  }

  if (
    enemy.teleportStrike
    && enemy.teleportStrike.phase === "warning"
    && enemyHasInterruptingControl(enemy)
  ) {
    interruptTeleportStrike(enemy);
  }

  const speed = enemy.slow > 0 ? 0.42 : 1;

  // ── 軌道一：場地攻擊 ────────────────────────────────────────────
  // 已經釋放出去的罡氣不受控制影響，會繼續走完；只有「起手」需要敵人能行動。
  // 這條軌道刻意不會 return，敵人在場地攻擊期間照樣移動、照樣出招、照樣普攻。
  if (enemy.field) {
    updateFieldAttack(enemy, dt);
  } else {
    enemy.fieldCooldown = Math.max(0, enemy.fieldCooldown - dt * speed);
    if (enemy.fieldCooldown <= 0 && enemy.stun <= 0 && enemy.airborne <= 0) {
      startFieldAttack();
    }
  }

  // ── 反擊軌道：貼在準心上不動就會被反震 ──────────────────────
  updateCounterBurst(enemy, dt);

  // ── 軌道二：招式（瞬身斬 / 橫江斷浪 / 漫天花雨）────────────────
  if (enemy.teleportStrike) {
    updateTeleportStrike(enemy, dt);
  } else {
    enemy.teleportStrikeCooldown = Math.max(0, enemy.teleportStrikeCooldown - dt * speed);
    if (enemy.teleportStrikeCooldown <= 0 && enemy.stun <= 0 && enemy.airborne <= 0) {
      startTeleportStrike();
    }
  }

  if (enemy.stun > 0 || enemy.airborne > 0) return;

  enemy.specialCooldown = Math.max(0, enemy.specialCooldown - dt * speed);

  if (enemy.special) {
    updateEnemySpecial(enemy, dt * speed);
  } else if (enemy.specialCooldown <= 0) {
    startEnemySpecial();
  }

  if (enemy.teleportStrike || enemy.special) return;

  enemy.moveTimer -= dt * speed;
  enemy.attackTimer -= dt * speed;

  if (enemy.moveTimer <= 0 && enemy.root <= 0) {
    const choices = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
      [0, 0]
    ];
    const [dx, dy] = choices[Math.floor(Math.random() * choices.length)];
    enemy.col = clamp(enemy.col + dx, 0, COLS_PER_SIDE - 1);
    enemy.row = clamp(enemy.row + dy, 0, ROWS - 1);
    enemy.moveTimer = 0.62 + Math.random() * 0.45;
  }

  if (enemy.attackTimer <= 0) {
    addEnemyLaneShot(enemy.row);
    enemy.attackTimer = 0.78 + Math.random() * 0.42;
  }
}

// 普攻改為「先亮車道 0.22 秒，再射出」。射速加快後如果不給讀招窗口就變成純運氣。
function addEnemyLaneShot(row) {
  SFX.enemyTelegraph();
  CharacterArt.play(state.enemy, "charge", ENEMY_SHOT_WARNING + 0.3, ENEMY_SHOT_WARNING);
  state.effects.push({
    kind: "laneWarn",
    row,
    color: "#d8452f",
    time: ENEMY_SHOT_WARNING,
    duration: ENEMY_SHOT_WARNING,
    onFinish() {
      SFX.enemyShot();
      const origin = cellCenter("enemy", COLS_PER_SIDE - 1, row);
      addProjectile({
        x: origin.x + 30,
        y: origin.y - 18,
        vx: -470,
        vy: 0,
        radius: 10,
        color: "#e8543c",
        damage: ENEMY_SHOT_DAMAGE,
        owner: "enemy"
      });
    }
  });
}

function startTeleportStrike() {
  const enemy = state.enemy;
  const player = playerCombatCell();
  const landing = offsetCell(player, 1);
  if (!landing) return;
  const targetRows = [player.row - 1, player.row, player.row + 1]
    .filter((row) => row >= 0 && row < ROWS);

  enemy.teleportStrike = {
    phase: "warning",
    time: 1,
    duration: 1,
    origin: { side: "enemy", col: enemy.col, row: enemy.row },
    landing,
    targetCells: targetRows.map((row) => ({ side: player.side, col: player.col, row }))
  };

  const originPos = cellCenter("enemy", enemy.col, enemy.row);
  const landingPos = cellCenter(landing.side, landing.col, landing.row);
  state.effects.push({
    kind: "teleportRift",
    x: originPos.x,
    y: originPos.y - 28,
    color: "#c8452f",
    time: 0.34,
    duration: 0.34
  });
  state.effects.push({
    kind: "teleportRift",
    x: landingPos.x,
    y: landingPos.y - 28,
    color: "#d8a12f",
    time: 0.42,
    duration: 0.42
  });
  SFX.teleport();
  state.message = "招式・瞬身斬：硃紅豎三格 1 秒後落刀，立刻移出警示區";
}

function updateTeleportStrike(enemy, dt) {
  const strike = enemy.teleportStrike;
  if (!strike) return;

  if (strike.phase === "interrupted") {
    if (enemyHasInterruptingControl(enemy)) return;
    strike.phase = "return";
    strike.time = 0.28;
    strike.duration = 0.28;
    state.message = "控制結束：敵人正在傳送回出招前的位置";
    return;
  }

  strike.time -= dt;
  if (strike.time > 0) return;

  if (strike.phase === "warning") {
    SFX.enemyCleave();
    CharacterArt.play(enemy, "slash", 0.34);
    state.effects.push({
      kind: "meleeCleave",
      cells: strike.targetCells.map((cell) => ({ ...cell })),
      color: "#c8452f",
      time: 0.34,
      duration: 0.34
    });
    for (const cell of strike.targetCells) {
      const pos = cellCenter(cell.side, cell.col, cell.row);
      addBurst(pos.x, pos.y - 12, "#c8452f", 0.28);
    }
    const hit = strike.targetCells.some(playerOnCell);
    if (hit) damagePlayer(TELEPORT_DAMAGE);
    if (state.phase === "playing") {
      state.message = hit
        ? "瞬身斬命中！敵人即將返回原位"
        : "閃避成功！敵人的瞬身斬落空";
    }
    strike.phase = "return";
    strike.time = 0.28;
    strike.duration = 0.28;
    return;
  }

  const landingPos = cellCenter(strike.landing.side, strike.landing.col, strike.landing.row);
  const originPos = cellCenter(strike.origin.side, strike.origin.col, strike.origin.row);
  state.effects.push({
    kind: "teleportRift",
    x: landingPos.x,
    y: landingPos.y - 28,
    color: "#c8452f",
    time: 0.3,
    duration: 0.3
  });
  state.effects.push({
    kind: "teleportRift",
    x: originPos.x,
    y: originPos.y - 28,
    color: "#d8a12f",
    time: 0.36,
    duration: 0.36
  });
  enemy.col = strike.origin.col;
  enemy.row = strike.origin.row;
  enemy.teleportStrike = null;
  enemy.teleportStrikeCooldown = 7 + Math.random() * 4;
}

// ═══════════════════════════════════════════════════════════════════
// 軌道一：場地攻擊。兩式交互施放，玩家腳下永遠有東西在燒。
// ═══════════════════════════════════════════════════════════════════

// 周天罡氣：外圈 12 格順走一圈，再收進內圈 4 格。全 16 格覆蓋，沒有安全點。
const HEAVENLY_CIRCUIT_PATH = [
  [0, 0], [1, 0], [2, 0], [3, 0],
  [3, 1], [3, 2], [3, 3],
  [2, 3], [1, 3], [0, 3],
  [0, 2], [0, 1],
  [1, 1], [2, 1], [2, 2], [1, 2]
];

// 梅花樁陣：棋盤格黑白交錯三波，逼玩家在兩種奇偶格之間定時跳位。
const PLUM_WAVES = [
  { parity: 0, warning: 0.70 },
  { parity: 1, warning: 0.60 },
  { parity: 0, warning: 0.50 }
];

function parityCells(parity) {
  const cells = [];
  for (let col = 0; col < COLS_PER_SIDE; col += 1) {
    for (let row = 0; row < ROWS; row += 1) {
      if ((col + row) % 2 === parity) cells.push([col, row]);
    }
  }
  return cells;
}

// 反身崩罡的觸發條件是「站在敵人正對面的格子」，與職業無關。
// 一開始寫成「脈衝使只要同列就算貼位」，結果同列是它唯一的輸出窗口，
// 等於每次想輸出都被反震（模擬 90 秒陣亡 6 次），所以改成純位置判定：
// 近戰必須貼正對格才能打，自然會吃到；脈衝使遠距輸出則多半不會觸發。
function playerIsCamping() {
  const aim = combatAimCell();
  const cell = enemyVisualCell();
  return aim.side === cell.side && aim.col === cell.col && aim.row === cell.row;
}

function updateCounterBurst(enemy, dt) {
  enemy.counterCooldown = Math.max(0, enemy.counterCooldown - dt);
  if (enemy.stun > 0 || enemy.airborne > 0 || enemy.counterCooldown > 0) {
    enemy.counterCharge = Math.max(0, enemy.counterCharge - dt);
    return;
  }

  if (playerIsCamping()) {
    enemy.counterCharge += dt;
  } else {
    enemy.counterCharge = Math.max(0, enemy.counterCharge - dt * 1.6);
  }

  if (enemy.counterCharge < COUNTER_CHARGE_TIME) return;

  enemy.counterCharge = 0;
  enemy.counterCooldown = COUNTER_COOLDOWN + COUNTER_WARNING;

  // 以玩家當下位置為中心的十字，逼玩家離開輸出位
  const player = playerCombatCell();
  const cells = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]
    .map(([dc, dr]) => offsetCell(player, dc, dr)).filter(Boolean);

  for (const cell of cells) {
    addPlayerTileTelegraph(cell.col, cell.row, COUNTER_WARNING, COUNTER_DAMAGE, "#8e4b6d", cell.side);
  }
  SFX.counterBurst();
  const pos = enemyVisualPosition();
  addBurst(pos.x, pos.y - 30, "#8e4b6d", 0.34);
  state.message = "反身崩罡：貼位太久被反震，十字範圍即將炸開";
}

function startFieldAttack() {
  CharacterArt.play(state.enemy, "cast", 0.54);
  const enemy = state.enemy;
  const type = FIELD_ATTACKS[enemy.fieldTurn % FIELD_ATTACKS.length];
  enemy.fieldTurn += 1;

  if (type === "heavenlyCircuit") {
    enemy.field = { type, timer: 0.34, step: 0 };
    state.message = "場地攻擊・周天罡氣：罡氣繞場一周後收向中央，別停在原地";
  } else {
    enemy.field = { type, timer: 0.30, step: 0 };
    state.message = "場地攻擊・梅花樁陣：黑白格交錯落罡，站在沒亮的那一種格子";
  }

  SFX.fieldOmen();
  state.effects.push({
    kind: "fieldOmen",
    color: type === "heavenlyCircuit" ? "#d8a12f" : "#c8452f",
    time: 0.85,
    duration: 0.85
  });
}

function finishFieldAttack() {
  state.enemy.field = null;
  state.enemy.fieldCooldown = 6.5 + Math.random() * 2.5;
}

function updateFieldAttack(enemy, dt) {
  const field = enemy.field;
  field.timer -= dt;
  if (field.timer > 0) return;

  if (field.type === "heavenlyCircuit") {
    const [col, row] = HEAVENLY_CIRCUIT_PATH[field.step];
    addPlayerTileTelegraph(col, row, 0.40, FIELD_TILE_DAMAGE, "#d8a12f");
    field.step += 1;
    field.timer = 0.24;
    if (field.step >= HEAVENLY_CIRCUIT_PATH.length) finishFieldAttack();
    return;
  }

  if (field.type === "plumPiles") {
    const wave = PLUM_WAVES[field.step];
    for (const [col, row] of parityCells(wave.parity)) {
      addPlayerTileTelegraph(col, row, wave.warning, PLUM_TILE_DAMAGE, "#c8452f");
    }
    field.step += 1;
    field.timer = wave.warning + 0.30;
    if (field.step >= PLUM_WAVES.length) finishFieldAttack();
  }
}

// ═══════════════════════════════════════════════════════════════════
// 軌道二：招式。與場地攻擊同時進行，玩家要一邊讀腳下一邊讀招。
// ═══════════════════════════════════════════════════════════════════

function startEnemySpecial() {
  CharacterArt.play(state.enemy, "cast", 0.54);
  const enemy = state.enemy;
  const type = ENEMY_SPECIALS[Math.floor(Math.random() * ENEMY_SPECIALS.length)];

  if (type === "waveSweep") {
    const centerRow = clamp(enemy.row, 1, ROWS - 2);
    const path = [];
    for (let col = enemy.col; col >= 0; col -= 1) path.push({ side: "enemy", col });
    for (let col = COLS_PER_SIDE - 1; col >= 0; col -= 1) path.push({ side: "player", col });
    enemy.special = {
      type,
      timer: 0.40,
      step: 0,
      path,
      rows: [centerRow - 1, centerRow, centerRow + 1]
    };
    state.message = "招式・橫江斷浪：三列刀浪由右掃來，往上下閃";
    return;
  }

  // 漫天花雨：每一輪封鎖三列、只留一列生路，連放三輪。
  enemy.special = { type, timer: 0.34, step: 0, volleys: 3 };
  state.message = "招式・漫天花雨：暗器封三列，找出唯一沒亮的那一列";
}

function finishEnemySpecial() {
  state.enemy.special = null;
  state.enemy.specialCooldown = 5.5 + Math.random() * 2;
}

function updateEnemySpecial(enemy, dt) {
  enemy.special.timer -= dt;
  if (enemy.special.timer > 0) return;

  if (enemy.special.type === "waveSweep") {
    SFX.waveSweep();
    const target = enemy.special.path[enemy.special.step];
    addColumnTelegraph(
      target.side,
      target.col,
      enemy.special.rows,
      0.32,
      WAVE_DAMAGE
    );
    enemy.special.step += 1;
    enemy.special.timer = 0.32;
    if (enemy.special.step >= enemy.special.path.length) finishEnemySpecial();
    return;
  }

  if (enemy.special.type === "dartVolley") {
    const safeRow = Math.floor(Math.random() * ROWS);
    for (let row = 0; row < ROWS; row += 1) {
      if (row === safeRow) continue;
      addEnemyDartLane(row);
    }
    enemy.special.step += 1;
    enemy.special.timer = 0.62;
    if (enemy.special.step >= enemy.special.volleys) finishEnemySpecial();
  }
}

function addEnemyDartLane(row) {
  SFX.dartVolley();
  state.effects.push({
    kind: "dartLane",
    row,
    color: "#e8c26a",
    time: 0.30,
    duration: 0.30,
    onFinish() {
      const origin = cellCenter("enemy", COLS_PER_SIDE - 1, row);
      for (let i = 0; i < 2; i += 1) {
        addProjectile({
          x: origin.x + 34 + i * 30,
          y: origin.y - 18 - (i % 2 ? 5 : -5),
          vx: -640,
          vy: 0,
          radius: 6,
          color: "#f0d692",
          damage: DART_DAMAGE,
          owner: "enemy"
        });
      }
    }
  });
}

function updateProjectiles(dt) {
  for (const projectile of state.projectiles) {
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;

    if (projectile.owner === "player") {
      const enemyCenter = enemyVisualPosition();
      if (Math.hypot(projectile.x - enemyCenter.x, projectile.y - (enemyCenter.y - 18)) < 35) {
        projectile.dead = true;
        if (projectile.shape === "swordQi") SFX.swordImpact();
        else SFX.dartImpact();
        applyEnemyDamage(projectile.damage, { kind: projectile.hitKind || "basic" });
        if (projectile.chargeOnHit) gainCharge(projectile.chargeOnHit);
        if (projectile.onHit) projectile.onHit();
        if (projectile.shape === "swordQi") addSwordHitEffect();
        else addBurst(enemyCenter.x, enemyCenter.y - 20, projectile.trail || projectile.color, 0.18);
      }
    } else {
      const playerCenter = playerCombatPosition();
      if (Math.hypot(projectile.x - playerCenter.x, projectile.y - (playerCenter.y - 18)) < 35) {
        projectile.dead = true;
        damagePlayer(projectile.damage);
        addBurst(playerCenter.x, playerCenter.y - 20, projectile.color, 0.18);
      }
    }

    // 用邏輯寬度判定出界（canvas.width 現在是裝置像素，會是它的 2 倍以上）
    if (projectile.x < -50 || projectile.x > LOGIC_W + 50) {
      projectile.dead = true;
    }
  }
  state.projectiles = state.projectiles.filter((projectile) => !projectile.dead);
}

function updateEffects(dt) {
  for (const effect of state.effects) {
    effect.time -= dt;
    if (effect.kind === "boxerChannel") {
      effect.tickTimer -= dt;
      while (effect.tickTimer <= 0 && effect.time > 0) {
        effect.tickTimer += 0.2;
        SFX.channelTick();
        if (enemyOnCell(effect)) {
          hitEnemyWithSkill(14, { color: effect.color, silent: true });
        }
      }
      if (!effect.finisherDone && effect.time <= 0.2) {
        effect.finisherDone = true;
        SFX.channelFinish();
        if (enemyOnCell(effect)) {
          hitEnemyWithSkill(48, { color: "#f0d692", big: true, silent: true });
          state.message = "百裂崩拳收尾重擊命中";
        }
      }
    }
    if (effect.time <= 0 && effect.onFinish) {
      effect.onFinish();
      effect.onFinish = null;
    }
  }
  state.effects = state.effects.filter((effect) => effect.time > 0);
}

function update(dt) {
  CharacterArt.update(state.player, dt);
  CharacterArt.update(state.enemy, dt);
  updateInput();
  state.player.moveCooldown = Math.max(0, state.player.moveCooldown - dt);
  state.player.attackCooldown = Math.max(0, state.player.attackCooldown - dt);
  state.player.invuln = Math.max(0, state.player.invuln - dt);
  state.player.counter = Math.max(0, state.player.counter - dt);
  updateEnemy(dt);
  updateProjectiles(dt);
  updateEffects(dt);
  updateBoxerStrike(dt);
  updatePetals(dt);
  syncHud();
}

// ═══════════════════════════════════════════════════════════════════
// 高解析度：畫布 backing store 依 devicePixelRatio 放大，但所有既有
// 座標常數（BOARD_TOP_LEFT 等）繼續用 1152x648 的邏輯座標，不用改。
// ═══════════════════════════════════════════════════════════════════
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = rect.width || LOGIC_W;
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const scale = (cssWidth / LOGIC_W) * dpr;
  const nextW = Math.max(1, Math.round(LOGIC_W * scale));
  const nextH = Math.max(1, Math.round(LOGIC_H * scale));
  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW;
    canvas.height = nextH;
    bgCache = null;
    gridCache = null;
  }
  ctx.setTransform(canvas.width / LOGIC_W, 0, 0, canvas.height / LOGIC_H, 0, 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}

function makeLayer(renderFn) {
  const scale = canvas.width / LOGIC_W;
  const layer = document.createElement("canvas");
  layer.width = Math.max(1, Math.round(LOGIC_W * scale));
  layer.height = Math.max(1, Math.round(LOGIC_H * scale));
  const lctx = layer.getContext("2d");
  lctx.setTransform(scale, 0, 0, scale, 0, 0);
  lctx.lineJoin = "round";
  lctx.lineCap = "round";
  renderFn(lctx);
  return layer;
}

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function polyOn(c, points) {
  c.beginPath();
  c.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) c.lineTo(points[i].x, points[i].y);
  c.closePath();
}

// 水墨遠山：用 seed 隨機走出不規則稜線，再用垂直漸層做出「墨色由濃到淡」的暈染。
function drawInkRidge(c, baseY, height, topColor, bottomColor, seed, softness) {
  const rand = seededRandom(seed);
  const points = [];
  const step = 34;
  let peak = height * 0.5;
  for (let x = -step; x <= LOGIC_W + step; x += step) {
    peak += (rand() - 0.5) * height * 0.42;
    peak = clamp(peak, height * 0.18, height);
    points.push({ x, y: baseY - peak });
  }

  const grad = c.createLinearGradient(0, baseY - height, 0, baseY);
  grad.addColorStop(0, topColor);
  grad.addColorStop(1, bottomColor);

  c.save();
  c.beginPath();
  c.moveTo(-step, baseY);
  for (let i = 0; i < points.length - 1; i += 1) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    c.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
  }
  c.lineTo(LOGIC_W + step, baseY);
  c.closePath();
  c.fillStyle = grad;
  c.fill();

  // 稜線上緣淡淡的留白，模擬宣紙上的水痕
  c.globalAlpha = softness;
  c.strokeStyle = INK.mist;
  c.lineWidth = 1.6;
  c.stroke();
  c.restore();
}

function drawBamboo(c, x, baseY, topY, width, alpha, seed) {
  const rand = seededRandom(seed);
  c.save();
  c.globalAlpha = alpha;
  c.strokeStyle = INK.ink;
  c.lineWidth = width;
  const bend = (rand() - 0.5) * 26;
  c.beginPath();
  c.moveTo(x, baseY);
  c.quadraticCurveTo(x + bend, (baseY + topY) / 2, x + bend * 1.7, topY);
  c.stroke();

  // 竹節
  c.lineWidth = width * 1.5;
  for (let t = 0.12; t < 1; t += 0.17) {
    const nx = x + bend * t * 1.4;
    const ny = baseY + (topY - baseY) * t;
    c.beginPath();
    c.moveTo(nx - width, ny);
    c.lineTo(nx + width, ny);
    c.stroke();
  }

  // 竹葉
  c.lineWidth = 1.4;
  for (let i = 0; i < 7; i += 1) {
    const t = 0.3 + rand() * 0.65;
    const nx = x + bend * t * 1.4;
    const ny = baseY + (topY - baseY) * t;
    const dir = rand() > 0.5 ? 1 : -1;
    const len = 20 + rand() * 26;
    c.beginPath();
    c.moveTo(nx, ny);
    c.quadraticCurveTo(nx + dir * len * 0.6, ny - len * 0.5, nx + dir * len, ny - len * 0.16);
    c.quadraticCurveTo(nx + dir * len * 0.55, ny - len * 0.12, nx, ny);
    c.fillStyle = "#2c3a34";
    c.fill();
  }
  c.restore();
}

function drawPagoda(c, x, baseY, scale, alpha) {
  c.save();
  c.globalAlpha = alpha;
  c.translate(x, baseY);
  c.scale(scale, scale);
  c.fillStyle = INK.ink;
  for (let tier = 0; tier < 3; tier += 1) {
    const y = -tier * 30;
    const halfWidth = 46 - tier * 9;
    // 飛簷
    c.beginPath();
    c.moveTo(-halfWidth - 12, y);
    c.quadraticCurveTo(-halfWidth * 0.5, y - 13, 0, y - 15);
    c.quadraticCurveTo(halfWidth * 0.5, y - 13, halfWidth + 12, y);
    c.quadraticCurveTo(halfWidth * 0.6, y - 4, 0, y - 4);
    c.quadraticCurveTo(-halfWidth * 0.6, y - 4, -halfWidth - 12, y);
    c.closePath();
    c.fill();
    // 樓身
    c.fillRect(-halfWidth * 0.62, y - 30, halfWidth * 1.24, 26);
  }
  c.fillRect(-2.5, -118, 5, 24);
  c.restore();
}

// 雲紋：武俠美術裡最好用的裝飾語彙，用在石台裙邊。
// 卷雲紋：一條主浪帶兩個內捲的雲頭，左右對稱。
// （初版用兩個 arc 疊起來，在小尺寸下會讀成英文字母 "cc"，改成單一連續筆畫。）
function drawCloudScroll(c, x, y, size, alpha, color) {
  const s = size / 26;
  c.save();
  c.globalAlpha = alpha;
  c.strokeStyle = color;
  c.lineWidth = 1.7 * s;
  c.lineCap = "round";
  for (const dir of [-1, 1]) {
    c.beginPath();
    // 主浪：由中央往外拉平
    c.moveTo(x, y + 3 * s);
    c.quadraticCurveTo(x + dir * 13 * s, y + 5 * s, x + dir * 20 * s, y - 1 * s);
    // 雲頭內捲
    c.quadraticCurveTo(x + dir * 25 * s, y - 6 * s, x + dir * 19 * s, y - 8 * s);
    c.quadraticCurveTo(x + dir * 14 * s, y - 9 * s, x + dir * 15 * s, y - 4 * s);
    c.stroke();
  }
  // 中央小雲頭
  c.lineWidth = 1.3 * s;
  c.beginPath();
  c.arc(x, y - 3 * s, 3.2 * s, Math.PI * 0.15, Math.PI * 1.7);
  c.stroke();
  c.restore();
}

function drawTaiji(c, x, y, radius, alpha) {
  c.save();
  c.globalAlpha = alpha;
  c.translate(x, y);
  c.fillStyle = INK.ink;
  c.beginPath();
  c.arc(0, 0, radius, -Math.PI / 2, Math.PI / 2);
  c.arc(0, radius / 2, radius / 2, Math.PI / 2, -Math.PI / 2, true);
  c.arc(0, -radius / 2, radius / 2, Math.PI / 2, -Math.PI / 2);
  c.closePath();
  c.fill();
  c.fillStyle = INK.paper;
  c.beginPath();
  c.arc(0, -radius / 2, radius * 0.17, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = INK.ink;
  c.beginPath();
  c.arc(0, radius / 2, radius * 0.17, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = INK.ink;
  c.lineWidth = radius * 0.06;
  c.beginPath();
  c.arc(0, 0, radius, 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

// 靜態場景一次畫進離屏畫布，每幀只做一次 drawImage。
// 動態的落花與流霧另外疊在上面。
function paintScene(c) {
  // ── 天色：黃昏宣紙 ──
  const sky = c.createLinearGradient(0, 0, 0, LOGIC_H);
  sky.addColorStop(0, "#1d2630");
  sky.addColorStop(0.22, "#4a4a4a");
  sky.addColorStop(0.34, "#9b8f77");
  sky.addColorStop(0.46, "#cbb994");
  sky.addColorStop(0.58, "#7d7460");
  sky.addColorStop(1, "#141a1f");
  c.fillStyle = sky;
  c.fillRect(0, 0, LOGIC_W, LOGIC_H);

  // ── 明月與月暈 ──
  const moonX = 902;
  const moonY = 104;
  const halo = c.createRadialGradient(moonX, moonY, 10, moonX, moonY, 150);
  halo.addColorStop(0, "rgba(240, 230, 200, 0.42)");
  halo.addColorStop(0.45, "rgba(232, 220, 190, 0.13)");
  halo.addColorStop(1, "rgba(232, 220, 190, 0)");
  c.fillStyle = halo;
  c.fillRect(moonX - 160, moonY - 160, 320, 320);
  c.fillStyle = "#efe6cd";
  c.beginPath();
  c.arc(moonX, moonY, 46, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "rgba(200, 188, 158, 0.5)";
  c.beginPath();
  c.arc(moonX - 14, moonY - 10, 9, 0, Math.PI * 2);
  c.arc(moonX + 13, moonY + 12, 6, 0, Math.PI * 2);
  c.arc(moonX + 4, moonY - 22, 4.5, 0, Math.PI * 2);
  c.fill();

  // ── 三重遠山：由淡到濃 ──
  drawInkRidge(c, 200, 148, "rgba(106, 118, 120, 0.62)", "rgba(146, 154, 148, 0.24)", 7, 0.38);
  drawInkRidge(c, 210, 118, "rgba(44, 58, 63, 0.86)", "rgba(76, 88, 86, 0.44)", 21, 0.28);

  // 遠處樓閣剪影
  drawPagoda(c, 168, 202, 0.78, 0.5);
  drawPagoda(c, 1006, 200, 0.6, 0.4);

  drawInkRidge(c, 216, 86, "rgba(16, 21, 26, 0.97)", "rgba(28, 35, 40, 0.8)", 43, 0.2);

  // ── 薄霧橫帶 ──
  for (const band of [[150, 22, 0.16], [176, 16, 0.2], [198, 12, 0.24]]) {
    const mist = c.createLinearGradient(0, band[0], 0, band[0] + band[1]);
    mist.addColorStop(0, `rgba(233, 220, 192, 0)`);
    mist.addColorStop(0.5, `rgba(233, 220, 192, ${band[2]})`);
    mist.addColorStop(1, `rgba(233, 220, 192, 0)`);
    c.fillStyle = mist;
    c.fillRect(0, band[0], LOGIC_W, band[1]);
  }

  // ── 兩側竹林 ──
  drawBamboo(c, 34, 520, 96, 7, 0.82, 11);
  drawBamboo(c, 68, 528, 150, 5, 0.62, 29);
  drawBamboo(c, 12, 540, 190, 4, 0.42, 53);
  drawBamboo(c, 1120, 520, 96, 7, 0.82, 71);
  drawBamboo(c, 1086, 528, 152, 5, 0.6, 97);
  drawBamboo(c, 1142, 540, 190, 4, 0.42, 113);

  // ── 石台（演武場）──
  const daisOuter = [
    { x: 60, y: 182 },
    { x: 1092, y: 182 },
    { x: 1112, y: 502 },
    { x: 40, y: 502 }
  ];
  const stone = c.createLinearGradient(0, 182, 0, 502);
  stone.addColorStop(0, "#3d4249");
  stone.addColorStop(0.4, "#2b3036");
  stone.addColorStop(1, "#1a1e23");
  c.fillStyle = stone;
  polyOn(c, daisOuter);
  c.fill();

  // 石台外緣雙描邊：深墨 + 米白細線
  c.strokeStyle = "#0d1116";
  c.lineWidth = 5;
  polyOn(c, daisOuter);
  c.stroke();
  c.strokeStyle = "rgba(233, 220, 192, 0.26)";
  c.lineWidth = 1.4;
  polyOn(c, daisOuter);
  c.stroke();

  // 石板拼縫（隨機裂紋，seed 固定所以每次一樣）
  const rand = seededRandom(9001);
  c.strokeStyle = "rgba(233, 220, 192, 0.06)";
  c.lineWidth = 1;
  for (let i = 0; i < 26; i += 1) {
    const x = 60 + rand() * 1030;
    const y = 182 + rand() * 320;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (rand() - 0.5) * 70, y + (rand() - 0.5) * 30);
    c.stroke();
  }

  // ── 上下裙邊：金線 + 雲紋 ──
  for (const edge of [{ y: 192, dir: 1 }, { y: 486, dir: -1 }]) {
    c.strokeStyle = "rgba(216, 161, 47, 0.55)";
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(88, edge.y);
    c.lineTo(1064, edge.y);
    c.stroke();
    c.strokeStyle = "rgba(233, 220, 192, 0.18)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(88, edge.y + edge.dir * 5);
    c.lineTo(1064, edge.y + edge.dir * 5);
    c.stroke();
  }
  for (let x = 122; x < 1060; x += 104) {
    drawCloudScroll(c, x, 495, 24, 0.34, INK.gold);
  }

  // ── 中線太極 ──
  c.strokeStyle = "rgba(216, 161, 47, 0.3)";
  c.lineWidth = 2;
  c.setLineDash([9, 7]);
  c.beginPath();
  c.moveTo(576, 196);
  c.lineTo(576, 482);
  c.stroke();
  c.setLineDash([]);
  drawTaiji(c, 576, 166, 16, 0.55);

  // ── 前景地面 ──
  const floor = c.createLinearGradient(0, 502, 0, LOGIC_H);
  floor.addColorStop(0, "#20252b");
  floor.addColorStop(1, "#0b0e12");
  c.fillStyle = floor;
  c.fillRect(0, 502, LOGIC_W, LOGIC_H - 502);
  c.strokeStyle = "rgba(233, 220, 192, 0.07)";
  c.lineWidth = 1;
  for (let x = 40; x < LOGIC_W; x += 118) {
    c.beginPath();
    c.moveTo(576 + (x - 576) * 0.62, 502);
    c.lineTo(x, LOGIC_H);
    c.stroke();
  }
  for (const y of [528, 566, 612]) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(LOGIC_W, y);
    c.stroke();
  }

  // ── 兩側石燈籠 ──
  for (const lamp of [{ x: 86, y: 556 }, { x: 1066, y: 556 }]) {
    const glow = c.createRadialGradient(lamp.x, lamp.y - 14, 4, lamp.x, lamp.y - 14, 78);
    glow.addColorStop(0, "rgba(240, 190, 96, 0.34)");
    glow.addColorStop(1, "rgba(240, 190, 96, 0)");
    c.fillStyle = glow;
    c.fillRect(lamp.x - 80, lamp.y - 92, 160, 160);
    c.fillStyle = "#14181d";
    c.fillRect(lamp.x - 7, lamp.y + 4, 14, 42);
    c.fillRect(lamp.x - 19, lamp.y - 30, 38, 34);
    c.fillStyle = "rgba(240, 196, 108, 0.86)";
    c.fillRect(lamp.x - 12, lamp.y - 24, 24, 22);
    c.fillStyle = "#14181d";
    c.beginPath();
    c.moveTo(lamp.x - 28, lamp.y - 30);
    c.quadraticCurveTo(lamp.x, lamp.y - 48, lamp.x + 28, lamp.y - 30);
    c.quadraticCurveTo(lamp.x, lamp.y - 36, lamp.x - 28, lamp.y - 30);
    c.closePath();
    c.fill();
  }

  // ── 底部落款橫幅 ──
  c.fillStyle = "rgba(12, 15, 19, 0.78)";
  c.fillRect(0, 600, LOGIC_W, 48);
  c.strokeStyle = "rgba(216, 161, 47, 0.34)";
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, 600.5);
  c.lineTo(LOGIC_W, 600.5);
  c.stroke();

  c.fillStyle = "rgba(233, 220, 192, 0.5)";
  c.font = FONT.brush(19);
  c.textAlign = "left";
  c.fillText("演武場・第肆重", 56, 631);
  c.textAlign = "right";
  c.fillText("正邪對決", LOGIC_W - 56, 631);
  c.textAlign = "left";

  // 硃砂印章
  c.save();
  c.translate(LOGIC_W - 40, 624);
  c.rotate(-0.05);
  c.fillStyle = "rgba(200, 69, 47, 0.82)";
  c.fillRect(-11, -11, 22, 22);
  c.fillStyle = "rgba(233, 220, 192, 0.9)";
  c.font = FONT.title(12);
  c.textAlign = "center";
  c.fillText("脈", 0, 4);
  c.restore();
  c.textAlign = "left";

  // ── 四角暗角，把視線壓向棋盤 ──
  const vignette = c.createRadialGradient(LOGIC_W / 2, 330, 250, LOGIC_W / 2, 330, 760);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.62)");
  c.fillStyle = vignette;
  c.fillRect(0, 0, LOGIC_W, LOGIC_H);
}

function initPetals() {
  petals = Array.from({ length: 26 }, () => ({
    x: Math.random() * LOGIC_W,
    y: Math.random() * LOGIC_H,
    vx: -14 - Math.random() * 22,
    vy: 12 + Math.random() * 20,
    size: 3 + Math.random() * 4,
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 2.4,
    alpha: 0.18 + Math.random() * 0.34,
    warm: Math.random() > 0.45
  }));
}

function updatePetals(dt) {
  for (const petal of petals) {
    petal.x += petal.vx * dt;
    petal.y += petal.vy * dt;
    petal.rot += petal.vrot * dt;
    petal.x += Math.sin(petal.y / 46) * 12 * dt;
    if (petal.y > LOGIC_H + 12 || petal.x < -16) {
      petal.x = Math.random() * LOGIC_W + 60;
      petal.y = -14;
    }
  }
}

function drawPetals() {
  for (const petal of petals) {
    ctx.save();
    ctx.translate(petal.x, petal.y);
    ctx.rotate(petal.rot);
    ctx.globalAlpha = petal.alpha;
    ctx.fillStyle = petal.warm ? "#e8c9b6" : INK.paperDim;
    ctx.beginPath();
    ctx.ellipse(0, 0, petal.size, petal.size * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawBackground() {
  if (!bgCache) bgCache = makeLayer(paintScene);
  ctx.drawImage(bgCache, 0, 0, LOGIC_W, LOGIC_H);

  // 流霧：兩層反向緩慢橫移
  const t = performance.now() / 1000;
  ctx.save();
  for (const layer of [{ y: 236, h: 46, speed: 9, alpha: 0.05 }, { y: 430, h: 58, speed: -6, alpha: 0.045 }]) {
    const offset = ((t * layer.speed) % (LOGIC_W * 2)) - LOGIC_W * 0.5;
    const mist = ctx.createLinearGradient(offset, 0, offset + LOGIC_W * 0.7, 0);
    mist.addColorStop(0, "rgba(233, 220, 192, 0)");
    mist.addColorStop(0.5, `rgba(233, 220, 192, ${layer.alpha})`);
    mist.addColorStop(1, "rgba(233, 220, 192, 0)");
    ctx.fillStyle = mist;
    ctx.fillRect(0, layer.y, LOGIC_W, layer.h);
  }
  ctx.restore();

  drawPetals();
}

// 棋盤 = 石板演武場。玉青陣（我方）／硃紅陣（魔道），石面雕紋一次快取。
function paintBoard(c) {
  const rand = seededRandom(4242);

  for (const side of ["player", "enemy"]) {
    const ally = side === "player";
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS_PER_SIDE; col += 1) {
        const poly = cellPolygon(side, col, row, 2);
        const top = boardPoint(0, row).y;
        const bottom = boardPoint(0, row + 1).y;
        const alternate = (col + row) % 2 === 0;

        // 石面：兩種明度交錯，像真的石板拼花
        const grad = c.createLinearGradient(0, top, 0, bottom);
        // 石頭是灰的。陣營色只在上緣透一點，不能讓整格發光。
        if (ally) {
          grad.addColorStop(0, alternate ? "rgba(58, 66, 66, 0.97)" : "rgba(48, 55, 56, 0.97)");
          grad.addColorStop(0.55, alternate ? "rgba(41, 49, 50, 0.97)" : "rgba(35, 42, 43, 0.97)");
          grad.addColorStop(1, "rgba(24, 29, 31, 0.98)");
        } else {
          grad.addColorStop(0, alternate ? "rgba(70, 60, 58, 0.97)" : "rgba(59, 50, 49, 0.97)");
          grad.addColorStop(0.55, alternate ? "rgba(50, 42, 42, 0.97)" : "rgba(43, 36, 36, 0.97)");
          grad.addColorStop(1, "rgba(27, 22, 23, 0.98)");
        }
        c.fillStyle = grad;
        polyOn(c, poly);
        c.fill();

        // 石面斑駁
        c.save();
        polyOn(c, poly);
        c.clip();
        c.fillStyle = "rgba(233, 220, 192, 0.05)";
        for (let i = 0; i < 5; i += 1) {
          const px = poly[0].x + rand() * (poly[1].x - poly[0].x);
          const py = poly[0].y + rand() * (poly[3].y - poly[0].y);
          c.beginPath();
          c.ellipse(px, py, 3 + rand() * 9, 1.5 + rand() * 3, rand() * 3, 0, Math.PI * 2);
          c.fill();
        }
        c.restore();

        // 雕刻內縮線
        c.strokeStyle = ally ? "rgba(79, 184, 160, 0.09)" : "rgba(232, 84, 60, 0.09)";
        c.lineWidth = 1;
        polyOn(c, cellPolygon(side, col, row, 9));
        c.stroke();
      }
    }

    // 格線：先深墨壓底，再上一層陣營色
    const startCol = ally ? 0 : COLS_PER_SIDE;
    const endCol = startCol + COLS_PER_SIDE;
    for (const pass of [
      { color: "rgba(8, 11, 14, 0.9)", width: 4 },
      { color: ally ? "rgba(79, 184, 160, 0.26)" : "rgba(200, 69, 47, 0.26)", width: 1.4 }
    ]) {
      c.strokeStyle = pass.color;
      c.lineWidth = pass.width;
      for (let row = 0; row <= ROWS; row += 1) {
        const a = boardPoint(startCol, row);
        const b = boardPoint(endCol, row);
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
      for (let col = startCol; col <= endCol; col += 1) {
        const a = boardPoint(col, 0);
        const b = boardPoint(col, ROWS);
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
    }

    // 陣營外框 + 四角卡榫
    const outline = [
      boardPoint(startCol, 0),
      boardPoint(endCol, 0),
      boardPoint(endCol, ROWS),
      boardPoint(startCol, ROWS)
    ];
    c.strokeStyle = ally ? "rgba(79, 184, 160, 0.52)" : "rgba(200, 69, 47, 0.52)";
    c.lineWidth = 2.2;
    polyOn(c, outline);
    c.stroke();
    c.strokeStyle = "rgba(216, 161, 47, 0.5)";
    c.lineWidth = 3.4;
    for (const corner of outline) {
      c.beginPath();
      c.moveTo(corner.x - 9, corner.y);
      c.lineTo(corner.x + 9, corner.y);
      c.stroke();
    }
  }
}

function drawGrid(side) {
  // 兩側石板一起快取，只在第一次（或尺寸變動）繪製
  if (side === "player") {
    if (!gridCache) gridCache = makeLayer(paintBoard);
    ctx.drawImage(gridCache, 0, 0, LOGIC_W, LOGIC_H);

    // 玩家所在格：呼吸中的罡氣光環
    const player = playerCombatCell();
    const accent = classes[selectedClass].color;
    const breath = 0.5 + Math.sin(performance.now() / 340) * 0.16;
    ctx.save();
    ctx.fillStyle = `${accent}22`;
    drawPolygon(cellPolygon(player.side, player.col, player.row, 5));
    ctx.fill();
    ctx.globalAlpha = breath;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.6;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 12;
    drawPolygon(cellPolygon(player.side, player.col, player.row, 7));
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    // 四角準星
    const poly = cellPolygon(player.side, player.col, player.row, 7);
    ctx.strokeStyle = INK.gold;
    ctx.lineWidth = 2;
    for (const point of poly) {
      ctx.beginPath();
      ctx.moveTo(point.x - 7, point.y);
      ctx.lineTo(point.x + 7, point.y);
      ctx.stroke();
    }
    ctx.restore();

    // 引導定身：腳下生根的視覺，讓「動不了」是看得見的而不是手感壞掉
    if (playerIsChanneling()) {
      const cell = cellCenter("player", state.player.col, state.player.row);
      const pulse = 0.55 + Math.sin(performance.now() / 90) * 0.22;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = INK.cinnabarLit;
      ctx.lineWidth = 3.4;
      drawPolygon(cellPolygon("player", state.player.col, state.player.row, 4));
      ctx.stroke();
      // 四邊往外的鎖定爪
      ctx.lineWidth = 2.6;
      for (const point of cellPolygon("player", state.player.col, state.player.row, 2)) {
        const dx = point.x - cell.x;
        const dy = point.y - cell.y;
        const len = Math.hypot(dx, dy) || 1;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x + (dx / len) * 11, point.y + (dy / len) * 11);
        ctx.stroke();
      }
      // 「定」字
      ctx.globalAlpha = Math.min(1, pulse + 0.25);
      ctx.font = FONT.brush(26);
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(20, 10, 8, 0.85)";
      ctx.strokeText("定", cell.x, cell.y + 16);
      ctx.fillStyle = INK.goldLit;
      ctx.fillText("定", cell.x, cell.y + 16);
      ctx.restore();
    }
  }
}

// 瞄準中的技能範圍：把「這一下會打到哪幾格」直接畫在棋盤上。
// 命中時整組轉金色並在敵人頭上標「中」，落空則維持冷色，讓玩家自己判斷要不要走位。
function drawSkillPreview() {
  const preview = currentAimPreview();
  if (!preview || state.phase !== "playing" || paused) return;

  const pulse = 0.5 + Math.sin(performance.now() / 130) * 0.28;
  const hit = preview.willHit;
  const base = hit ? INK.goldLit : "#8fd8e8";
  const fill = hit ? "rgba(240, 214, 146, " : "rgba(143, 216, 232, ";

  ctx.save();
  for (const cell of preview.cells) {
    // 底色
    ctx.fillStyle = `${fill}${(hit ? 0.2 : 0.13) + pulse * 0.12})`;
    drawPolygon(cellPolygon(cell.side, cell.col, cell.row, 4));
    ctx.fill();

    // 外框
    ctx.globalAlpha = 0.5 + pulse * 0.4;
    ctx.strokeStyle = base;
    ctx.lineWidth = hit ? 2.6 : 1.8;
    drawPolygon(cellPolygon(cell.side, cell.col, cell.row, 6));
    ctx.stroke();

    // 四角括號，讓它讀起來像準心而不是單純染色
    const poly = cellPolygon(cell.side, cell.col, cell.row, 5);
    const center = cellCenter(cell.side, cell.col, cell.row);
    ctx.lineWidth = 2.4;
    ctx.globalAlpha = 0.75 + pulse * 0.25;
    for (const point of poly) {
      const dx = center.x - point.x;
      const dy = center.y - point.y;
      const len = Math.hypot(dx, dy) || 1;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + (dx / len) * 13, point.y + (dy / len) * 13);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 命中提示
  if (hit) {
    const pos = enemyVisualPosition();
    ctx.globalAlpha = 0.8 + pulse * 0.2;
    ctx.font = FONT.brush(30);
    ctx.textAlign = "center";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(24, 14, 6, 0.9)";
    ctx.strokeText("中", pos.x, pos.y - 116);
    ctx.fillStyle = INK.goldLit;
    ctx.fillText("中", pos.x, pos.y - 116);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// 準心／彈道指引。近戰畫準心格，唐門畫整列導引線（原本完全沒有提示）。
function drawAimReticle() {
  if (state.phase !== "playing") return;

  if (selectedClass === "tangmen") {
    const row = state.player.row;
    const origin = cellCenter("player", state.player.col, row);
    const end = midpoint(
      boardPoint(COLS_PER_SIDE * 2, row),
      boardPoint(COLS_PER_SIDE * 2, row + 1)
    );
    ctx.save();
    ctx.globalAlpha = 0.2 + Math.sin(performance.now() / 300) * 0.06;
    ctx.strokeStyle = classes.tangmen.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.moveTo(origin.x + 24, origin.y - 18);
    ctx.lineTo(end.x, end.y - 18);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const target = combatAimCell();
  const breath = 0.52 + Math.sin(performance.now() / 260) * 0.14;
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = INK.paper;
  drawPolygon(cellPolygon(target.side, target.col, target.row, 6));
  ctx.fill();
  ctx.globalAlpha = breath;
  ctx.strokeStyle = selectedClass === "boxer" ? INK.goldLit : INK.paper;
  ctx.lineWidth = 2.4;
  ctx.setLineDash([9, 8]);
  drawPolygon(cellPolygon(target.side, target.col, target.row, 6));
  ctx.stroke();
  ctx.setLineDash([]);
  // 四角框住準心
  const poly = cellPolygon(target.side, target.col, target.row, 4);
  ctx.lineWidth = 2.6;
  ctx.globalAlpha = Math.min(1, breath + 0.3);
  for (const point of poly) {
    ctx.beginPath();
    ctx.moveTo(point.x - 8, point.y);
    ctx.lineTo(point.x + 8, point.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTeleportStrikeWarning() {
  const strike = state.enemy.teleportStrike;
  if (!strike || strike.phase !== "warning") return;

  const pulse = 0.2 + (Math.sin(performance.now() / 52) + 1) * 0.08;
  ctx.save();
  ctx.shadowColor = INK.cinnabar;
  ctx.shadowBlur = 12;
  for (const cell of strike.targetCells) {
    ctx.fillStyle = `rgba(200, 69, 47, ${pulse})`;
    drawPolygon(cellPolygon(cell.side, cell.col, cell.row, 3));
    ctx.fill();
    ctx.strokeStyle = INK.cinnabarLit;
    ctx.lineWidth = 3;
    drawPolygon(cellPolygon(cell.side, cell.col, cell.row, 7));
    ctx.stroke();
    ctx.strokeStyle = "rgba(233, 220, 192, 0.5)";
    ctx.lineWidth = 1.2;
    drawPolygon(cellPolygon(cell.side, cell.col, cell.row, 13));
    ctx.stroke();
    // 落刀格中央的符文，和場地攻擊使用同一套語彙
    const mid = cellCenter(cell.side, cell.col, cell.row);
    drawRuneGlyph(mid.x, mid.y - 6, 24, INK.paper, 0.3 + pulse);
  }
  ctx.shadowBlur = 0;

  const landing = cellCenter(strike.landing.side, strike.landing.col, strike.landing.row);
  const labelY = Math.max(128, landing.y - 112);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(14, 8, 9, 0.92)";
  ctx.fillRect(landing.x - 60, labelY - 22, 120, 30);
  ctx.strokeStyle = INK.gold;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(landing.x - 60, labelY - 22, 120, 30);
  ctx.fillStyle = INK.paper;
  ctx.font = FONT.strong(16);
  ctx.textAlign = "center";
  ctx.fillText(`瞬身斬 ${Math.max(0, strike.time).toFixed(1)}"`, landing.x, labelY - 1);
  ctx.textAlign = "left";
  ctx.restore();
}

function drawHpBar(x, y, width, hp, maxHp, shield = 0) {
  const pct = clamp(hp / maxHp, 0, 1);
  ctx.fillStyle = "rgba(10, 13, 16, 0.9)";
  ctx.fillRect(x - width / 2 - 2, y - 2, width + 4, 11);
  ctx.fillStyle = pct > 0.35 ? INK.jade : INK.cinnabarLit;
  ctx.fillRect(x - width / 2, y, width * pct, 7);
  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  ctx.fillRect(x - width / 2, y, width * pct, 2);
  if (shield > 0) {
    ctx.fillStyle = INK.goldLit;
    ctx.fillRect(x - width / 2, y - 7, width * clamp(shield / 60, 0, 1), 5);
  }
  ctx.strokeStyle = "rgba(233, 220, 192, 0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x - width / 2, y, width, 7);
}

// ═══════════════════════════════════════════════════════════════════
// 角色：武俠造型。座標約定 —— 原點在腳下，地面 y≈+20，頭頂 y≈-86。
// ═══════════════════════════════════════════════════════════════════

// 飄帶：用正弦波做出隨風擺動的長帶，武俠角色的靈魂配件。
function drawRibbon(x, y, length, width, color, phase, dir = -1) {
  const now = performance.now() / 260 + phase;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 1; i <= 8; i += 1) {
    const t = i / 8;
    const px = x + dir * length * t;
    const py = y + Math.sin(now + t * 3.1) * 9 * t + t * t * 12;
    ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

// 交領：中式衣襟的 V 字疊襟
function drawCollar(topY, halfWidth, depth, light, dark) {
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.moveTo(-halfWidth, topY);
  ctx.lineTo(0, topY + depth);
  ctx.lineTo(halfWidth, topY);
  ctx.lineTo(halfWidth * 0.6, topY - 4);
  ctx.lineTo(0, topY + depth - 7);
  ctx.lineTo(-halfWidth * 0.6, topY - 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function drawHeadBase(cy, radius, skin, shade) {
  // 略窄的鵝蛋臉，比正圓更像人
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(0, cy, radius * 0.74, radius * 0.98, 0, 0, Math.PI * 2);
  ctx.fill();
  // 側面陰影
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.ellipse(radius * 0.3, cy + 1, radius * 0.42, radius * 0.88, 0, 0, Math.PI * 2);
  ctx.fill();
  // 下顎收窄
  ctx.beginPath();
  ctx.ellipse(0, cy + radius * 0.82, radius * 0.5, radius * 0.3, 0, 0, Math.PI);
  ctx.fill();
}

// 斜挑的眼與淡淡的嘴，武俠角色的神態靠這兩筆
function drawFace(cy, spread, ink) {
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  ctx.moveTo(-spread - 2.2, cy + 0.8);
  ctx.lineTo(-spread + 1.4, cy - 0.6);
  ctx.moveTo(spread - 1.4, cy - 0.6);
  ctx.lineTo(spread + 2.2, cy + 0.8);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(-1.6, cy + 6.5);
  ctx.lineTo(1.6, cy + 6.5);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ── 脈衝使：內家氣功道人 ───────────────────────────────────────────
function drawTangmenCharacter() {
  const sway = Math.sin(performance.now() / 420) * 2.4;

  // 身後飄帶：從肩後拉出，才不會看起來像飄在空中的麵條
  drawRibbon(-14, -52, 26, 5, "rgba(216, 161, 47, 0.72)", 0);

  // 腿與布鞋
  ctx.strokeStyle = "#101b1e";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(-7, -6);
  ctx.lineTo(-11, 17);
  ctx.moveTo(8, -6);
  ctx.lineTo(13, 17);
  ctx.stroke();
  ctx.strokeStyle = "#3d4b4a";
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(-11, 18);
  ctx.lineTo(-21, 19);
  ctx.moveTo(13, 18);
  ctx.lineTo(23, 19);
  ctx.stroke();

  // 道袍（下襬外擴）
  const robe = ctx.createLinearGradient(-24, -62, 22, 12);
  robe.addColorStop(0, "#20474e");
  robe.addColorStop(0.5, "#2f7a72");
  robe.addColorStop(1, "#12292d");
  ctx.fillStyle = robe;
  ctx.beginPath();
  ctx.moveTo(-15, -60);
  ctx.quadraticCurveTo(-19, -34, -22 + sway, 7);
  ctx.quadraticCurveTo(-7, 11, 0, 10);
  ctx.quadraticCurveTo(9, 11, 21 + sway, 6);
  ctx.quadraticCurveTo(18, -34, 14, -60);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#7fe3cf";
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // 寬袖
  ctx.fillStyle = "#215058";
  ctx.beginPath();
  ctx.moveTo(-16, -54);
  ctx.quadraticCurveTo(-36, -42, -32 + sway * 1.4, -18);
  ctx.quadraticCurveTo(-22, -22, -15, -34);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(15, -54);
  ctx.quadraticCurveTo(35, -42, 31 + sway * 1.4, -18);
  ctx.quadraticCurveTo(21, -22, 14, -34);
  ctx.closePath();
  ctx.fill();

  drawCollar(-58, 12, 15, "#e9dcc0", "#8a7f66");

  // 腰帶
  ctx.fillStyle = "#c8452f";
  ctx.fillRect(-17, -26, 33, 6);
  ctx.fillStyle = "#d8a12f";
  ctx.fillRect(-17, -22, 33, 2);

  // 頭與髮髻
  drawHeadBase(-70, 11, "#e6c8a4", "rgba(120, 84, 58, 0.32)");
  ctx.fillStyle = "#15191c";
  ctx.beginPath();
  ctx.ellipse(0, -78, 11, 7, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -86, 5.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#d8a12f";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-7, -87);
  ctx.lineTo(8, -84);
  ctx.stroke();
  // 兩側髮鬢
  ctx.fillStyle = "#15191c";
  ctx.beginPath();
  ctx.moveTo(-8.5, -76);
  ctx.quadraticCurveTo(-10.5, -66, -7.5, -62);
  ctx.quadraticCurveTo(-7, -70, -5.5, -75);
  ctx.closePath();
  ctx.moveTo(8.5, -76);
  ctx.quadraticCurveTo(10.5, -66, 7.5, -62);
  ctx.quadraticCurveTo(7, -70, 5.5, -75);
  ctx.closePath();
  ctx.fill();
  drawFace(-70, 4, "#1b2226");

  // 指間待發的暗器：三枚細鏢夾在右手，一枚在左手轉著
  ctx.save();
  ctx.strokeStyle = "#dfe8e0";
  ctx.lineWidth = 1.8;
  ctx.shadowColor = "#7fe3cf";
  ctx.shadowBlur = 6;
  for (let i = 0; i < 3; i += 1) {
    const fan = -0.42 + i * 0.34;
    const bx = 25;
    const by = -33 + i * 1.5;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.cos(fan) * 13, by + Math.sin(fan) * 13);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  // 左手旋轉的一枚
  const spin = performance.now() / 220;
  ctx.translate(-25, -34);
  ctx.rotate(spin);
  ctx.fillStyle = "#e6ece4";
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(0, -2.6);
  ctx.lineTo(-7, 0);
  ctx.lineTo(0, 2.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── 劍客：江湖行者 ─────────────────────────────────────────────────
function drawSwordsmanCharacter() {
  const sway = Math.sin(performance.now() / 380) * 2.6;

  // 披風
  ctx.fillStyle = "#3a2a22";
  ctx.beginPath();
  ctx.moveTo(-12, -58);
  ctx.quadraticCurveTo(-34, -30, -30 + sway * 1.6, 10);
  ctx.quadraticCurveTo(-14, 4, -8, -18);
  ctx.closePath();
  ctx.fill();

  drawRibbon(-8, -75, 28, 3.2, "rgba(200, 69, 47, 0.85)", 0.6);
  drawRibbon(-8, -73, 21, 2.2, "rgba(233, 220, 192, 0.4)", 2.1);

  // 腿與長靴
  ctx.strokeStyle = "#241b16";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(-8, -6);
  ctx.lineTo(-13, 17);
  ctx.moveTo(8, -6);
  ctx.lineTo(14, 17);
  ctx.stroke();
  ctx.strokeStyle = "#4c3a2c";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-13, 18);
  ctx.lineTo(-23, 19);
  ctx.moveTo(14, 18);
  ctx.lineTo(24, 19);
  ctx.stroke();

  // 袍身
  const robe = ctx.createLinearGradient(-22, -60, 20, 10);
  robe.addColorStop(0, "#e2d5b2");
  robe.addColorStop(0.55, "#b8a781");
  robe.addColorStop(1, "#6d6047");
  ctx.fillStyle = robe;
  ctx.beginPath();
  ctx.moveTo(-15, -60);
  ctx.quadraticCurveTo(-21, -32, -22 + sway, 8);
  ctx.quadraticCurveTo(-6, 12, 0, 10);
  ctx.quadraticCurveTo(8, 12, 22 + sway, 7);
  ctx.quadraticCurveTo(19, -32, 14, -60);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#d8a12f";
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // 下襬開衩
  ctx.strokeStyle = "rgba(90, 78, 56, 0.7)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(1 + sway * 0.4, 10);
  ctx.stroke();

  drawCollar(-58, 12, 15, "#f2ead4", "#9a8e6f");

  // 腰帶與玉扣
  ctx.fillStyle = "#8e4b6d";
  ctx.fillRect(-16, -27, 31, 7);
  ctx.fillStyle = "#4fb8a0";
  ctx.beginPath();
  ctx.arc(0, -23.5, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // 頭、髮、束帶
  drawHeadBase(-70, 11, "#e8cba6", "rgba(120, 84, 58, 0.3)");
  ctx.fillStyle = "#16181b";
  ctx.beginPath();
  ctx.ellipse(0, -77, 11.5, 8, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-11, -74);
  ctx.quadraticCurveTo(-16, -58, -9, -50);
  ctx.quadraticCurveTo(-9, -64, -6, -72);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#c8452f";
  ctx.fillRect(-11.5, -77, 23, 3.6);
  drawFace(-70, 4, "#1b2226");

  // 長劍：斜握於右側
  ctx.save();
  ctx.translate(30, -14);
  ctx.rotate(-0.30 + sway * 0.012);
  // 劍鋒
  const blade = ctx.createLinearGradient(0, -46, 0, 6);
  blade.addColorStop(0, "#ffffff");
  blade.addColorStop(0.4, "#e2ddcb");
  blade.addColorStop(1, "#9aa09a");
  ctx.fillStyle = blade;
  ctx.beginPath();
  ctx.moveTo(0, -52);
  ctx.lineTo(3.2, -44);
  ctx.lineTo(3.2, 0);
  ctx.lineTo(-3.2, 0);
  ctx.lineTo(-3.2, -44);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, -49);
  ctx.lineTo(0, -2);
  ctx.stroke();
  // 護手與柄
  ctx.fillStyle = "#d8a12f";
  ctx.fillRect(-7, 0, 14, 4);
  ctx.fillStyle = "#5b2f22";
  ctx.fillRect(-2.6, 4, 5.2, 15);
  ctx.fillStyle = "#d8a12f";
  ctx.beginPath();
  ctx.arc(0, 20, 3, 0, Math.PI * 2);
  ctx.fill();
  // 劍穗
  drawRibbon(0, 21, 9, 2.4, "rgba(200, 69, 47, 0.85)", 1.1, 1);
  ctx.restore();
}

// ── 拳師：外家硬功 ─────────────────────────────────────────────────
function drawBoxerCharacter() {
  const sway = Math.sin(performance.now() / 330) * 2;

  drawRibbon(-14, -26, 26, 5, "rgba(200, 69, 47, 0.82)", 0.3);

  // 紮實的下盤（馬步）
  ctx.strokeStyle = "#20262b";
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(-9, -8);
  ctx.lineTo(-17, 16);
  ctx.moveTo(9, -8);
  ctx.lineTo(18, 16);
  ctx.stroke();
  // 綁腿
  ctx.strokeStyle = "#e0d3b4";
  ctx.lineWidth = 3;
  for (const leg of [[-13, 3, -15, 7], [13, 3, 16, 7]]) {
    ctx.beginPath();
    ctx.moveTo(leg[0], leg[1]);
    ctx.lineTo(leg[2], leg[3]);
    ctx.stroke();
  }
  ctx.strokeStyle = "#4a3a2a";
  ctx.lineWidth = 5.5;
  ctx.beginPath();
  ctx.moveTo(-17, 18);
  ctx.lineTo(-28, 19);
  ctx.moveTo(18, 18);
  ctx.lineTo(29, 19);
  ctx.stroke();

  // 軀幹（赤膊）
  const torso = ctx.createLinearGradient(-18, -58, 16, -22);
  torso.addColorStop(0, "#d8a271");
  torso.addColorStop(0.6, "#b47b4c");
  torso.addColorStop(1, "#7d5232");
  ctx.fillStyle = torso;
  ctx.beginPath();
  ctx.moveTo(-18, -57);
  ctx.quadraticCurveTo(-20, -46, -13, -24);
  ctx.quadraticCurveTo(0, -21, 13, -24);
  ctx.quadraticCurveTo(20, -46, 18, -57);
  ctx.quadraticCurveTo(0, -61, -18, -57);
  ctx.closePath();
  ctx.fill();
  // 胸膛：兩塊胸肌 + 短腹線（不要畫成十字）
  ctx.strokeStyle = "rgba(88, 50, 26, 0.45)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-11, -46);
  ctx.quadraticCurveTo(-5, -41, 0, -43);
  ctx.moveTo(11, -46);
  ctx.quadraticCurveTo(5, -41, 0, -43);
  ctx.stroke();
  ctx.lineWidth = 1.1;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(0, -38);
  ctx.lineTo(0, -27);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 敞開的短褂
  ctx.fillStyle = "#7a3a22";
  ctx.beginPath();
  ctx.moveTo(-17, -57);
  ctx.quadraticCurveTo(-27, -38, -22 + sway, -18);
  ctx.lineTo(-12, -20);
  ctx.quadraticCurveTo(-15, -40, -13, -56);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(17, -57);
  ctx.quadraticCurveTo(27, -38, 22 + sway, -18);
  ctx.lineTo(12, -20);
  ctx.quadraticCurveTo(15, -40, 13, -56);
  ctx.closePath();
  ctx.fill();

  // 腰帶 + 垂結
  ctx.fillStyle = "#c8452f";
  ctx.fillRect(-19, -24, 38, 8);
  ctx.fillStyle = "#a03424";
  ctx.beginPath();
  ctx.moveTo(-4, -16);
  ctx.lineTo(4, -16);
  ctx.lineTo(2 + sway * 0.5, 2);
  ctx.lineTo(-2 + sway * 0.5, 2);
  ctx.closePath();
  ctx.fill();

  // 抱拳架式：手臂 + 護腕
  ctx.strokeStyle = "#c08a5c";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(-15, -52);
  ctx.quadraticCurveTo(-27, -44, -21, -33);
  ctx.moveTo(15, -52);
  ctx.quadraticCurveTo(28, -46, 24, -34);
  ctx.stroke();
  ctx.strokeStyle = "#e0d3b4";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(-23, -37);
  ctx.lineTo(-20, -30);
  ctx.moveTo(25, -38);
  ctx.lineTo(23, -31);
  ctx.stroke();
  // 拳頭
  ctx.fillStyle = "#d29a68";
  ctx.beginPath();
  ctx.arc(-20, -27, 6.4, 0, Math.PI * 2);
  ctx.arc(24, -28, 6.8, 0, Math.PI * 2);
  ctx.fill();

  // 頭
  drawHeadBase(-68, 11.5, "#dfa877", "rgba(105, 62, 34, 0.34)");
  ctx.fillStyle = "#191b1d";
  ctx.beginPath();
  ctx.ellipse(0, -75, 11.5, 7, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // 額巾
  ctx.fillStyle = "#c8452f";
  ctx.fillRect(-12, -74, 24, 4);
  drawRibbon(-11, -72, 22, 2.4, "rgba(200, 69, 47, 0.8)", 1.7);
  drawFace(-67, 4.2, "#1b2226");
  // 怒眉
  ctx.strokeStyle = "#191b1d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-8, -71.5);
  ctx.lineTo(-2.5, -68.5);
  ctx.moveTo(8, -71.5);
  ctx.lineTo(2.5, -68.5);
  ctx.stroke();
}

// ── 敵人：魔道宗師 ─────────────────────────────────────────────────
function drawEnemyCharacter() {
  const float = Math.sin(performance.now() / 520) * 3;
  const wisp = performance.now() / 300;

  // 腳下不落地的血色罡氣
  ctx.save();
  ctx.globalAlpha = 0.3;
  const aura = ctx.createRadialGradient(0, 6, 4, 0, 6, 46);
  aura.addColorStop(0, "rgba(200, 69, 47, 0.66)");
  aura.addColorStop(1, "rgba(200, 69, 47, 0)");
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.ellipse(0, 8, 44, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 飄散的魔氣
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = "#c8452f";
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i += 1) {
    const phase = wisp + i * 2.1;
    ctx.beginPath();
    ctx.moveTo(-30 + i * 26, 10);
    ctx.quadraticCurveTo(
      -30 + i * 26 + Math.sin(phase) * 12,
      -12,
      -30 + i * 26 + Math.cos(phase) * 8,
      -34
    );
    ctx.stroke();
  }
  ctx.restore();

  ctx.translate(0, float);

  // 破爛長袍：下襬不規則，像懸在半空
  const robe = ctx.createLinearGradient(-30, -78, 26, 16);
  robe.addColorStop(0, "#241a22");
  robe.addColorStop(0.45, "#3a1f28");
  robe.addColorStop(1, "#0e0a0d");
  ctx.fillStyle = robe;
  ctx.beginPath();
  ctx.moveTo(-20, -70);
  ctx.quadraticCurveTo(-34, -34, -30, 4);
  ctx.lineTo(-22, -4);
  ctx.lineTo(-16, 12);
  ctx.lineTo(-8, -2);
  ctx.lineTo(-1, 16);
  ctx.lineTo(7, -2);
  ctx.lineTo(15, 11);
  ctx.lineTo(21, -5);
  ctx.lineTo(29, 3);
  ctx.quadraticCurveTo(33, -34, 19, -70);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(142, 75, 109, 0.72)";
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // 內襯血光
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#7d1f1c";
  ctx.beginPath();
  ctx.moveTo(-7, -62);
  ctx.quadraticCurveTo(0, -58, 7, -62);
  ctx.quadraticCurveTo(5, -36, 3, -16);
  ctx.quadraticCurveTo(0, -12, -3, -16);
  ctx.quadraticCurveTo(-5, -36, -7, -62);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 寬袖
  ctx.fillStyle = "#2b1a22";
  ctx.beginPath();
  ctx.moveTo(-20, -66);
  ctx.quadraticCurveTo(-46, -48, -40, -18);
  ctx.quadraticCurveTo(-27, -26, -18, -42);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(19, -66);
  ctx.quadraticCurveTo(45, -48, 39, -18);
  ctx.quadraticCurveTo(26, -26, 17, -42);
  ctx.closePath();
  ctx.fill();

  // 枯手與利爪：彎曲的指節，不要畫成箭頭
  for (const side of [-1, 1]) {
    const hx = side * 34;
    ctx.fillStyle = "#b8ad99";
    ctx.beginPath();
    ctx.ellipse(hx, -20, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c9bfae";
    ctx.lineWidth = 1.9;
    for (let f = 0; f < 3; f += 1) {
      const drop = -17 + f * 3.4;
      ctx.beginPath();
      ctx.moveTo(hx + side * 2, drop);
      ctx.quadraticCurveTo(hx + side * 9, drop + 1.5, hx + side * 8, drop + 6.5);
      ctx.stroke();
    }
  }

  // 腰間束帶
  ctx.fillStyle = "#8e4b6d";
  ctx.fillRect(-19, -34, 38, 6);
  ctx.fillStyle = "#c8452f";
  ctx.beginPath();
  ctx.arc(0, -31, 4, 0, Math.PI * 2);
  ctx.fill();

  // 陰影中的臉
  ctx.fillStyle = "#0b0709";
  ctx.beginPath();
  ctx.ellipse(0, -80, 11, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  // 兩點血眸
  ctx.save();
  ctx.shadowColor = "#ff6b4a";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#ff6b4a";
  ctx.beginPath();
  ctx.ellipse(-4.4, -82, 2.6, 1.7, -0.2, 0, Math.PI * 2);
  ctx.ellipse(4.4, -82, 2.6, 1.7, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 斗笠
  ctx.fillStyle = "#3b2f22";
  ctx.beginPath();
  ctx.moveTo(-40, -84);
  ctx.quadraticCurveTo(-20, -108, 0, -110);
  ctx.quadraticCurveTo(20, -108, 40, -84);
  ctx.quadraticCurveTo(20, -92, 0, -92);
  ctx.quadraticCurveTo(-20, -92, -40, -84);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#6d5a3c";
  ctx.lineWidth = 1.3;
  ctx.stroke();
  // 斗笠編紋
  ctx.strokeStyle = "rgba(233, 220, 192, 0.16)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo(-40 + i * 7, -85 - i * 1.5);
    ctx.quadraticCurveTo(0, -96 - i * 3.2, 40 - i * 7, -85 - i * 1.5);
    ctx.stroke();
  }
  ctx.fillStyle = "#c8452f";
  ctx.beginPath();
  ctx.arc(0, -110, 3.4, 0, Math.PI * 2);
  ctx.fill();

  // 斗笠垂紗
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = "#151013";
  ctx.beginPath();
  ctx.moveTo(-34, -85);
  ctx.lineTo(34, -85);
  ctx.lineTo(28, -64 + Math.sin(wisp) * 2);
  ctx.lineTo(-28, -64 - Math.sin(wisp) * 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawUnit(unit, side, color) {
  let pos = side === "player" ? playerCombatPosition() : cellCenter(side, unit.col, unit.row);
  if (side === "enemy" && state.enemy.teleportStrike) {
    const landing = state.enemy.teleportStrike.landing;
    pos = cellCenter(landing.side, landing.col, landing.row);
    if (state.enemy.teleportStrike.phase === "interrupted" && state.enemy.visualKnockback) {
      const knock = state.enemy.visualKnockback;
      const recoil = Math.sin((1 - knock.time / knock.duration) * Math.PI);
      pos = { x: pos.x + recoil * 34, y: pos.y - recoil * 18 };
    }
  } else if (side === "enemy" && state.enemy.visualKnockback) {
    const knock = state.enemy.visualKnockback;
    const progress = 1 - knock.time / knock.duration;
    const from = cellCenter("enemy", knock.fromCol, knock.row);
    const to = cellCenter("enemy", knock.toCol, knock.row);
    const ease = 1 - Math.pow(1 - progress, 3);
    pos = {
      x: from.x + (to.x - from.x) * ease,
      y: from.y + (to.y - from.y) * ease
    };
  }
  // 浮空改成拋物線，不再是瞬間位移 24px
  const airRatio = side === "enemy" ? clamp(state.enemy.airborne, 0, 1) : 0;
  const lift = airRatio > 0 ? 30 * Math.sin(Math.PI * airRatio) : 0;
  const depth = clamp((pos.y - BOARD_TOP_LEFT.y) / (BOARD_BOTTOM_LEFT.y - BOARD_TOP_LEFT.y), 0, 1);
  const scale = 1.0 + depth * 0.16;

  // 影子畫在地面，不隨浮空與出手位移
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.scale(scale, scale);
  const shadowShrink = 1 - airRatio * 0.34;
  ctx.fillStyle = `rgba(0, 0, 0, ${0.44 - airRatio * 0.16})`;
  ctx.beginPath();
  ctx.ellipse(0, 20, 40 * shadowShrink, 11 * shadowShrink, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(pos.x, pos.y - lift);
  ctx.scale(scale, scale);
  const artClock = unit.artClock || 0;
  const blink = side === "player" && unit.invuln > 0 && Math.floor(artClock / 0.07) % 2 === 0;
  ctx.globalAlpha = blink ? 0.6 : 1;

  if (classicCharacterArt) {
    if (side === "enemy") drawEnemyCharacter();
    else if (selectedClass === "swordsman") drawSwordsmanCharacter();
    else if (selectedClass === "boxer") drawBoxerCharacter();
    else drawTangmenCharacter();
  } else {
    const channel = side === "player" && selectedClass === "boxer"
      ? state.effects.find((effect) => effect.kind === "boxerChannel" && effect.time > 0) : null;
    CharacterArt.draw(ctx, side === "enemy" ? "enemy" : selectedClass, unit, {
      aiming: side === "player" && state.player.aiming !== null,
      defending: side === "player" && state.player.counter > 0,
      channelRemaining: channel ? channel.time : 0,
      teleportWarning: side === "enemy" && unit.teleportStrike?.phase === "warning",
      reducedMotion: reducedCharacterMotion.matches
    });
  }

  // 護盾：玉青罡氣圈 + 八卦刻線
  if (side === "player" && state.player.shield > 0) {
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = INK.jade;
    ctx.lineWidth = 2.4;
    ctx.shadowColor = INK.jade;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(0, -35, 49, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.4;
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI * 2 * i) / 8 + artClock / 2.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 43, -35 + Math.sin(angle) * 43);
      ctx.lineTo(Math.cos(angle) * 50, -35 + Math.sin(angle) * 50);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 反擊架勢：紫檀色半弧
  if (side === "player" && state.player.counter > 0) {
    ctx.save();
    ctx.strokeStyle = INK.plum;
    ctx.lineWidth = 4;
    ctx.shadowColor = INK.plum;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, -35, 54, -Math.PI * 0.85, Math.PI * 0.35);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  if (side === "player") {
    drawHpBar(pos.x, pos.y + 27, 78, state.player.hp, playerMaxHp(), state.player.shield);
  }

  if (side === "enemy") {
    const labels = [];
    if (state.enemy.stun > 0) labels.push("暈");
    if (state.enemy.airborne > 0) labels.push("浮空");
    if (state.enemy.slow > 0) labels.push("緩");
    if (state.enemy.root > 0) labels.push("定身");
    if (labels.length) {
      const text = labels.join("・");
      ctx.save();
      ctx.font = FONT.strong(15);
      ctx.textAlign = "center";
      const width = ctx.measureText(text).width + 18;
      const y = pos.y - (classicCharacterArt ? 104 : 120 * scale) - lift;
      ctx.fillStyle = "rgba(12, 15, 19, 0.84)";
      ctx.fillRect(pos.x - width / 2, y - 15, width, 21);
      ctx.strokeStyle = INK.gold;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(pos.x - width / 2, y - 15, width, 21);
      ctx.fillStyle = INK.goldLit;
      ctx.fillText(text, pos.x, y);
      ctx.restore();
    }
  }
}

// 頂部魔道血條：分段刻度 + 延遲白條，讓大傷害看得見。
let bossHpLag = ENEMY_MAX_HP;

function drawBossBar() {
  const hp = state.enemy.hp;
  bossHpLag += (hp - bossHpLag) * 0.055;
  if (bossHpLag < hp) bossHpLag = hp;

  const width = 620;
  const x = (LOGIC_W - width) / 2;
  const y = 28;
  const height = 15;
  const pct = clamp(hp / ENEMY_MAX_HP, 0, 1);
  const lagPct = clamp(bossHpLag / ENEMY_MAX_HP, 0, 1);
  const low = pct < 0.35;

  ctx.save();
  // 卷軸底
  ctx.fillStyle = "rgba(12, 15, 19, 0.86)";
  ctx.fillRect(x - 5, y - 5, width + 10, height + 10);
  ctx.strokeStyle = low ? INK.cinnabar : "rgba(216, 161, 47, 0.6)";
  ctx.lineWidth = low ? 2 : 1.3;
  ctx.strokeRect(x - 5.5, y - 5.5, width + 11, height + 11);

  // 延遲白條
  ctx.fillStyle = "rgba(233, 220, 192, 0.5)";
  ctx.fillRect(x, y, width * lagPct, height);

  // 血
  const blood = ctx.createLinearGradient(x, y, x, y + height);
  blood.addColorStop(0, low ? "#e8543c" : "#c8452f");
  blood.addColorStop(1, low ? "#8e2a1e" : "#7d1f1c");
  ctx.fillStyle = blood;
  ctx.fillRect(x, y, width * pct, height);
  ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
  ctx.fillRect(x, y, width * pct, 3);

  // 分成 10 格刻度（不管總血量多少都好數）
  ctx.strokeStyle = "rgba(12, 15, 19, 0.7)";
  ctx.lineWidth = 1;
  const tick = ENEMY_MAX_HP / 10;
  for (let v = tick; v < ENEMY_MAX_HP; v += tick) {
    const tx = x + (width * v) / ENEMY_MAX_HP;
    ctx.beginPath();
    ctx.moveTo(tx, y);
    ctx.lineTo(tx, y + height);
    ctx.stroke();
  }

  // 名號與數值
  ctx.font = FONT.brush(22);
  ctx.fillStyle = INK.paper;
  ctx.textAlign = "left";
  ctx.fillText("魔道宗師", x - 2, y - 12);
  ctx.font = FONT.strong(13);
  ctx.fillStyle = low ? INK.cinnabarLit : "rgba(233, 220, 192, 0.72)";
  ctx.textAlign = "right";
  ctx.fillText(`${hp} / ${ENEMY_MAX_HP}`, x + width + 2, y - 12);
  ctx.textAlign = "left";
  ctx.restore();
}

// 月牙刀光：填色的新月形，中間厚兩端尖。斬擊特效的核心零件。
function fillCrescent(cx, cy, radius, bow, spread, rotation, color, alpha, glow = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, radius, -spread, spread);
  ctx.quadraticCurveTo(radius - bow, 0, Math.cos(-spread) * radius, Math.sin(-spread) * radius);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 前緣外凸的月牙（凸面朝行進方向）。飛行中的劍氣要用這個，
// 用 fillCrescent 會變成凹面朝前，看起來像一輪彎月而不是一道刀鋒。
function fillForwardCrescent(cx, cy, reach, height, thickness, color, alpha, glow = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = alpha;
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  // 外緣：從上角尖往前凸出到下角尖
  ctx.moveTo(-reach * 0.34, -height);
  ctx.quadraticCurveTo(reach * 1.5, -height * 0.34, reach, 0);
  ctx.quadraticCurveTo(reach * 1.5, height * 0.34, -reach * 0.34, height);
  // 內緣：往回收，形成月牙厚度
  ctx.quadraticCurveTo(reach * 0.9 - thickness, height * 0.22, reach - thickness, 0);
  ctx.quadraticCurveTo(reach * 0.9 - thickness, -height * 0.22, -reach * 0.34, -height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 一整套「帥氣斬擊」：外光暈 → 主月牙 → 亮芯 → 殘影 → 速度線 → 火花
function drawSlashBurst(cx, cy, radius, rotation, color, progress, scale = 1) {
  const fade = 1 - progress;
  const grow = 0.72 + progress * 0.42;
  const r = radius * grow * scale;

  // 外層光暈
  fillCrescent(cx, cy, r * 1.16, r * 0.72, 0.92, rotation, color, fade * 0.22, 26);
  // 三道殘影，越後面越淡越偏
  for (let ghost = 3; ghost >= 1; ghost -= 1) {
    fillCrescent(
      cx - Math.cos(rotation) * ghost * 7, cy - Math.sin(rotation) * ghost * 7,
      r * (1 - ghost * 0.07), r * 0.6, 0.86 - ghost * 0.05,
      rotation + ghost * 0.05, color, fade * (0.2 / ghost), 0
    );
  }
  // 主月牙
  fillCrescent(cx, cy, r, r * 0.58, 0.88, rotation, color, fade * 0.9, 18);
  // 亮芯：白熱的刀鋒
  fillCrescent(cx, cy, r * 0.93, r * 0.3, 0.7, rotation, "#fffdf2", fade * 0.85, 14);

  // 速度線
  ctx.save();
  ctx.globalAlpha = fade * 0.5;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  for (let i = 0; i < 5; i += 1) {
    const a = rotation - 0.6 + i * 0.3;
    const inner = r * (0.5 + (i % 2) * 0.16);
    const outer = r * (1.3 + progress * 0.5 + (i % 3) * 0.12);
    ctx.lineWidth = 2.4 - i * 0.3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    ctx.stroke();
  }
  ctx.restore();

  // 火花
  ctx.save();
  ctx.globalAlpha = fade * 0.9;
  ctx.fillStyle = "#fff6d8";
  for (let i = 0; i < 7; i += 1) {
    const a = rotation - 0.85 + i * 0.28;
    const d = r * (0.9 + progress * 0.85);
    const s = (1.8 - progress * 1.1) * (i % 2 ? 1 : 1.7);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, Math.max(0.4, s), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawProjectiles() {
  for (const projectile of state.projectiles) {
    const dir = Math.sign(projectile.vx) || 1;
    const r = projectile.radius;
    const trailColor = projectile.trail || projectile.color;
    ctx.save();
    ctx.translate(projectile.x, projectile.y);
    ctx.scale(dir, 1);

    // 拖尾
    const tailLen = projectile.shape === "swordQi" ? 96 : 52;
    const tail = ctx.createLinearGradient(0, 0, -tailLen, 0);
    tail.addColorStop(0, trailColor);
    tail.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = tail;
    ctx.lineWidth = r * (projectile.shape === "swordQi" ? 1.1 : 1.3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-tailLen, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (projectile.shape === "swordQi") {
      // 劍氣：凸面朝前的一道刀鋒，外光暈 + 主體 + 白熱亮芯
      const wob = Math.sin(performance.now() / 70) * 0.6;
      // 背後的柔光，不用月牙形（月牙疊月牙會在邊緣留下一圈像線框的輪廓）
      const halo = ctx.createRadialGradient(r * 0.6, 0, 2, r * 0.6, 0, r * 2.4);
      halo.addColorStop(0, projectile.trail);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.ellipse(r * 0.6, 0, r * 2.4, r * 1.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      fillForwardCrescent(0, 0, r * 1.35, r * 1.72 + wob, r * 0.95, projectile.trail, 0.9, 20);
      fillForwardCrescent(0, 0, r * 1.2, r * 1.4 + wob, r * 0.62, projectile.color, 0.95, 14);
      fillForwardCrescent(0, 0, r * 1.05, r * 0.95, r * 0.3, "#ffffff", 0.95, 10);
      // 上下拖出的短氣絲（不要拉太長，會把形狀收成閉合的葉片）
      ctx.globalAlpha = 0.34;
      ctx.strokeStyle = projectile.trail;
      ctx.lineWidth = 1.8;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, s * r * 1.5);
        ctx.quadraticCurveTo(-r * 1.6, s * r * 1.1, -r * 2.4, s * r * 0.9);
        ctx.stroke();
      }
    } else if (projectile.shape === "nail") {
      // 透骨釘：細長鋼釘，前端尖、後端收，中段一圈銅箍
      ctx.shadowColor = trailColor;
      ctx.shadowBlur = 12;
      ctx.fillStyle = projectile.color;
      ctx.beginPath();
      ctx.moveTo(r * 2.6, 0);
      ctx.quadraticCurveTo(r * 0.4, -r * 0.42, -r * 2.0, -r * 0.2);
      ctx.lineTo(-r * 2.0, r * 0.2);
      ctx.quadraticCurveTo(r * 0.4, r * 0.42, r * 2.6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      // 銅箍
      ctx.fillStyle = trailColor;
      ctx.fillRect(-r * 0.5, -r * 0.44, r * 0.5, r * 0.88);
      // 尖端反光
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(r * 2.6, 0);
      ctx.lineTo(r * 1.0, -r * 0.2);
      ctx.lineTo(r * 1.0, r * 0.2);
      ctx.closePath();
      ctx.fill();
    } else if (projectile.shape === "dart") {
      // 袖箭：菱形鏢身 + 十字尾
      ctx.rotate(Math.sin(performance.now() / 90) * 0.12);
      ctx.shadowColor = trailColor;
      ctx.shadowBlur = 10;
      ctx.fillStyle = projectile.color;
      ctx.beginPath();
      ctx.moveTo(r * 2.2, 0);
      ctx.lineTo(0, -r * 0.9);
      ctx.lineTo(-r * 1.2, 0);
      ctx.lineTo(0, r * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = trailColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 1.2, 0);
      ctx.lineTo(-r * 2.1, -r * 0.7);
      ctx.moveTo(-r * 1.2, 0);
      ctx.lineTo(-r * 2.1, r * 0.7);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(r * 2.2, 0);
      ctx.lineTo(r * 0.5, -r * 0.22);
      ctx.lineTo(r * 0.5, r * 0.22);
      ctx.closePath();
      ctx.fill();
    } else {
      // 預設圓形彈體（敵方彈幕）
      ctx.fillStyle = projectile.color;
      ctx.shadowColor = projectile.color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.35, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = INK.paper;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(r * 0.3, 0, r * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

const FOREGROUND_EFFECT_KINDS = new Set([
  "burst",
  "teleportRift",
  "meleeCleave",
  "interruptMark",
  "swordHit",
  "punchHit",
  "swordWave",
  "damageNumber",
  "knockback",
  "fieldOmen",
  "dashTrail",
  "slash",
  "dartSpray",
  "needleRain"
]);

// 毛筆弧線：頭寬尾細的一筆帶過，武俠刀光的基本語彙。
function drawBrushArc(x1, y1, cx, cy, x2, y2, width, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  const steps = 7;
  for (let i = 0; i < steps; i += 1) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const taper = Math.sin(Math.PI * (0.18 + t0 * 0.82));
    ctx.lineWidth = Math.max(0.6, width * taper);
    const p0 = quadPoint(x1, y1, cx, cy, x2, y2, t0);
    const p1 = quadPoint(x1, y1, cx, cy, x2, y2, t1);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  ctx.restore();
}

function quadPoint(x1, y1, cx, cy, x2, y2, t) {
  const inv = 1 - t;
  return {
    x: inv * inv * x1 + 2 * inv * t * cx + t * t * x2,
    y: inv * inv * y1 + 2 * inv * t * cy + t * t * y2
  };
}

// 潑墨：命中瞬間濺出的不規則墨點
function drawInkSplat(x, y, radius, color, alpha, seed) {
  const rand = seededRandom(seed);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let i = 0; i < 9; i += 1) {
    const angle = rand() * Math.PI * 2;
    const dist = radius * (0.35 + rand() * 0.75);
    const size = radius * (0.07 + rand() * 0.17);
    ctx.beginPath();
    ctx.ellipse(
      x + Math.cos(angle) * dist,
      y + Math.sin(angle) * dist,
      size,
      size * (0.5 + rand() * 0.7),
      angle,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

// 硃砂符文：預警格上的道家符號，比純紅方塊好認得多
function drawRuneGlyph(cx, cy, size, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, size * 0.09);
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.5, cy - size * 0.52);
  ctx.lineTo(cx + size * 0.5, cy - size * 0.52);
  ctx.moveTo(cx, cy - size * 0.52);
  ctx.lineTo(cx, cy + size * 0.5);
  ctx.moveTo(cx - size * 0.36, cy - size * 0.1);
  ctx.lineTo(cx + size * 0.36, cy - size * 0.1);
  ctx.moveTo(cx - size * 0.44, cy + size * 0.3);
  ctx.lineTo(cx + size * 0.44, cy + size * 0.3);
  ctx.stroke();
  ctx.restore();
}

// 整列車道警示（普攻／暗器共用）
function drawLaneBand(row, color, alpha, dashed) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (const side of ["player", "enemy"]) {
    for (let col = 0; col < COLS_PER_SIDE; col += 1) {
      drawPolygon(cellPolygon(side, col, row, 4));
      ctx.fill();
    }
  }
  const left = midpoint(boardPoint(0, row), boardPoint(0, row + 1));
  const right = midpoint(boardPoint(COLS_PER_SIDE * 2, row), boardPoint(COLS_PER_SIDE * 2, row + 1));
  ctx.globalAlpha = Math.min(1, alpha * 2.6);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  if (dashed) ctx.setLineDash([12, 8]);
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawEffects(layer = "under") {
  for (const effect of state.effects) {
    const isForeground = FOREGROUND_EFFECT_KINDS.has(effect.kind);
    if ((layer === "over") !== isForeground) continue;
    const progress = 1 - effect.time / effect.duration;
    if (effect.kind === "burst") {
      if (effect.seed === undefined) effect.seed = Math.floor(Math.random() * 99991);
      const fade = 1 - progress;
      // 罡氣環：擴散同時變細
      ctx.save();
      ctx.globalAlpha = fade * 0.9;
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 5 * fade + 0.6;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, 14 + progress * 46, 0, Math.PI * 2);
      ctx.stroke();
      // 內圈亮環
      ctx.globalAlpha = fade * 0.55;
      ctx.strokeStyle = INK.paper;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, 9 + progress * 28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      // 潑墨
      drawInkSplat(effect.x, effect.y, 20 + progress * 34, effect.color, fade * 0.75, effect.seed);
    }
    if (effect.kind === "teleportRift") {
      ctx.save();
      ctx.translate(effect.x, effect.y);
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = effect.color;
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = 18;
      ctx.lineWidth = 5 - progress * 2;
      ctx.beginPath();
      ctx.moveTo(-12 + progress * 8, -52);
      ctx.quadraticCurveTo(18, -8, -8 - progress * 6, 46);
      ctx.stroke();
      ctx.strokeStyle = "#fff3d1";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(8, -42);
      ctx.quadraticCurveTo(-10, 0, 11, 38);
      ctx.stroke();
      ctx.restore();
    }
    if (effect.kind === "meleeCleave") {
      ctx.save();
      ctx.globalAlpha = 1 - progress;
      ctx.lineCap = "round";
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = 18;
      for (const cell of effect.cells) {
        const pos = cellCenter(cell.side, cell.col, cell.row);
        const reach = 38 + progress * 24;
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 10 - progress * 5;
        ctx.beginPath();
        ctx.moveTo(pos.x - reach, pos.y - 35);
        ctx.quadraticCurveTo(pos.x + 5, pos.y - 4, pos.x + reach, pos.y + 22);
        ctx.stroke();
        ctx.strokeStyle = "#fff4df";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(pos.x - reach * 0.82, pos.y - 32);
        ctx.quadraticCurveTo(pos.x, pos.y - 6, pos.x + reach * 0.82, pos.y + 18);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (effect.kind === "interruptMark") {
      ctx.save();
      ctx.translate(effect.x, effect.y - progress * 18);
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = effect.color;
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-20, -18);
      ctx.lineTo(20, 18);
      ctx.moveTo(20, -18);
      ctx.lineTo(-20, 18);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = INK.paper;
      ctx.strokeStyle = "#2a1410";
      ctx.lineWidth = 5;
      ctx.font = FONT.brush(30);
      ctx.textAlign = "center";
      ctx.strokeText("破", 0, -28);
      ctx.fillText("破", 0, -28);
      ctx.restore();
    }
    // 劍氣命中：交叉雙月牙
    if (effect.kind === "swordHit") {
      drawSlashBurst(effect.x, effect.y, 52, -0.7, effect.color, progress);
      drawSlashBurst(effect.x, effect.y, 44, 0.72, effect.color, Math.min(1, progress * 1.3), 0.85);
    }
    if (effect.kind === "punchHit") {
      const spikes = 8;
      const inner = 10 + progress * 6;
      const outer = 26 + progress * 18;
      ctx.save();
      ctx.translate(effect.x, effect.y);
      ctx.globalAlpha = 1 - progress;
      ctx.fillStyle = effect.color;
      ctx.strokeStyle = "#fff1d6";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i += 1) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = (Math.PI * i) / spikes + 0.4;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (effect.kind === "slash") {
      const fade = 1 - progress;
      const validRows = effect.rows.filter((row) => row >= 0 && row < ROWS);

      // 底層：受擊格染色
      ctx.save();
      ctx.globalAlpha = fade * 0.3;
      ctx.fillStyle = effect.color;
      for (const row of validRows) {
        for (let offset = 0; offset < effect.width; offset += 1) {
          drawPolygon(cellPolygon(effect.side, effect.col + offset, row, 4));
          ctx.fill();
        }
      }
      ctx.restore();

      if (!validRows.length) continue;

      const topRow = Math.min(...validRows);
      const bottomRow = Math.max(...validRows);
      const startCol = clamp(effect.col, 0, COLS_PER_SIDE - 1);
      const endCol = clamp(effect.col + effect.width - 1, 0, COLS_PER_SIDE - 1);
      const a = cellCenter(effect.side, startCol, topRow);
      const b = cellCenter(effect.side, endCol, bottomRow);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2 - 18;
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      const radius = Math.max(46, span * 0.62 + 34);
      // 斬擊角度：跨多列時斜劈，單列時橫掃
      const rotation = validRows.length > 1 ? -0.62 : -0.1;

      drawSlashBurst(cx, cy, radius, rotation, effect.color, progress);

      // 交叉的第二刀，讓多格斬看起來是「一套」而不是一下
      if (validRows.length > 1) {
        drawSlashBurst(cx, cy, radius * 0.82, rotation + 1.15, effect.color, Math.min(1, progress * 1.35), 0.9);
      }
    }
    // 拳師順移：起點塵土、路徑速度線、三道殘影
    if (effect.kind === "dashTrail") {
      const from = cellCenter(effect.from.side, effect.from.col, effect.from.row);
      const to = cellCenter(effect.to.side, effect.to.col, effect.to.row);
      const fade = 1 - progress;

      ctx.save();
      // 路徑速度線
      ctx.globalAlpha = fade * 0.7;
      ctx.strokeStyle = effect.color;
      ctx.lineCap = "round";
      for (let i = 0; i < 5; i += 1) {
        const off = (i - 2) * 9;
        ctx.lineWidth = 3.4 - Math.abs(i - 2) * 0.7;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y - 30 + off);
        ctx.lineTo(to.x - Math.sign(to.x - from.x) * 18, to.y - 30 + off * 0.6);
        ctx.stroke();
      }
      // 殘影：沿路徑三個位置的剪影
      for (let i = 1; i <= 3; i += 1) {
        const t = i / 4;
        const gx = from.x + (to.x - from.x) * t;
        const gy = from.y + (to.y - from.y) * t;
        ctx.globalAlpha = fade * (0.3 - i * 0.06);
        ctx.fillStyle = effect.color;
        ctx.beginPath();
        ctx.ellipse(gx, gy - 34, 15, 34, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // 起點揚起的塵土
      ctx.globalAlpha = fade * 0.44;
      ctx.fillStyle = "rgba(190, 176, 148, 0.8)";
      const rand2 = seededRandom(effect.from.col * 131 + effect.from.row * 17 + 7);
      for (let i = 0; i < 7; i += 1) {
        const a = rand2() * Math.PI * 2;
        const d = 8 + progress * (18 + rand2() * 20);
        ctx.beginPath();
        ctx.arc(from.x + Math.cos(a) * d, from.y + 12 + Math.sin(a) * d * 0.4,
                2.6 * fade + 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      // 落點衝擊圈
      ctx.globalAlpha = fade * 0.6;
      ctx.strokeStyle = INK.goldLit;
      ctx.lineWidth = 3 * fade + 0.6;
      ctx.beginPath();
      ctx.ellipse(to.x, to.y + 10, 20 + progress * 34, 8 + progress * 13, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // 唐門千機匣：一片暗器噴射
    if (effect.kind === "dartSpray") {
      const fade = 1 - progress;
      const rand = seededRandom(effect.seed);
      ctx.save();
      ctx.globalAlpha = fade * 0.26;
      ctx.fillStyle = effect.color;
      for (const row of effect.rows) {
        for (let offset = 0; offset < effect.width; offset += 1) {
          drawPolygon(cellPolygon(effect.side, effect.col + offset, row, 4));
          ctx.fill();
        }
      }
      ctx.restore();

      if (!effect.rows.length) continue;
      const from = cellCenter("player", state.player.col, state.player.row);
      ctx.save();
      ctx.globalAlpha = fade;
      for (let i = 0; i < 22; i += 1) {
        const row = effect.rows[Math.floor(rand() * effect.rows.length)];
        const col = clamp(effect.col + Math.floor(rand() * effect.width), 0, COLS_PER_SIDE - 1);
        const to = cellCenter(effect.side, col, row);
        const t = clamp(progress * (0.7 + rand() * 0.75), 0, 1);
        const px = from.x + (to.x - from.x) * t;
        const py = from.y - 20 + (to.y - 20 - (from.y - 20)) * t + (rand() - 0.5) * 12;
        // 針身
        ctx.strokeStyle = i % 3 === 0 ? "#ffffff" : effect.color;
        ctx.lineWidth = 1.9;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - 13, py - (rand() - 0.5) * 5);
        ctx.stroke();
      }
      ctx.restore();
    }
    // 暴雨梨花針：針雨從天而降
    if (effect.kind === "needleRain") {
      const center = cellCenter(effect.side, effect.col, effect.row);
      const rand = seededRandom(4711);
      ctx.save();
      // 鎖定框
      ctx.globalAlpha = 0.3 + progress * 0.5;
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 2;
      drawPolygon(cellPolygon(effect.side, effect.col, effect.row, 7));
      ctx.stroke();
      // 下墜的針
      for (let i = 0; i < 20; i += 1) {
        const ox = (rand() - 0.5) * 78;
        const delay = rand() * 0.55;
        const t = (progress - delay) / (1 - delay);
        if (t <= 0) continue;
        const y = center.y - 150 + (140 + rand() * 20) * Math.min(1, t);
        ctx.globalAlpha = Math.min(1, t * 2) * 0.9;
        ctx.strokeStyle = i % 4 === 0 ? "#ffffff" : effect.color;
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(center.x + ox, y);
        ctx.lineTo(center.x + ox + 3, y - 15);
        ctx.stroke();
      }
      ctx.restore();
    }
    // 流光劍氣：橫貫整列的一道劍芒
    if (effect.kind === "swordWave") {
      const fade = 1 - progress;
      const left = midpoint(boardPoint(0, effect.row), boardPoint(0, effect.row + 1));
      const right = midpoint(boardPoint(COLS_PER_SIDE * 2, effect.row), boardPoint(COLS_PER_SIDE * 2, effect.row + 1));
      const y = left.y - 20;
      const head = left.x + (right.x - left.x) * Math.min(1, progress * 1.5);
      const thickness = 26 * fade + 5;

      ctx.save();
      // 整列染色
      ctx.globalAlpha = fade * 0.24;
      ctx.fillStyle = effect.color;
      for (const side of ["player", "enemy"]) {
        for (let col = 0; col < COLS_PER_SIDE; col += 1) {
          drawPolygon(cellPolygon(side, col, effect.row, 5));
          ctx.fill();
        }
      }

      // 主劍芒：中間厚、兩端尖的長條
      const beam = ctx.createLinearGradient(left.x, 0, head, 0);
      beam.addColorStop(0, "rgba(0,0,0,0)");
      beam.addColorStop(0.25, effect.color);
      beam.addColorStop(0.85, "#fffdf2");
      beam.addColorStop(1, "#ffffff");
      ctx.globalAlpha = fade;
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = 24;
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(left.x, y);
      ctx.quadraticCurveTo((left.x + head) / 2, y - thickness, head, y - thickness * 0.28);
      ctx.lineTo(head, y + thickness * 0.28);
      ctx.quadraticCurveTo((left.x + head) / 2, y + thickness, left.x, y);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      // 亮芯
      ctx.globalAlpha = fade * 0.95;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1, 4 * fade);
      ctx.beginPath();
      ctx.moveTo(left.x + 20, y);
      ctx.lineTo(head, y);
      ctx.stroke();

      // 前鋒的月牙刀頭
      drawSlashBurst(head, y, 40, -0.05, effect.color, progress, 0.9);

      // 上下擴散的氣浪
      ctx.globalAlpha = fade * 0.34;
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 2;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(left.x + 30, y + s * (thickness * 0.6));
        ctx.quadraticCurveTo(
          (left.x + head) / 2, y + s * (thickness * 1.5 + progress * 26),
          head - 10, y + s * (thickness * 0.5)
        );
        ctx.stroke();
      }
      ctx.restore();
    }
    if (effect.kind === "area") {
      ctx.save();
      ctx.fillStyle = `${effect.color}44`;
      for (const row of effect.area.rows) {
        for (const col of effect.area.cols) {
          drawPolygon(cellPolygon(effect.area.side, col, row, 4));
          ctx.fill();
        }
      }
      ctx.restore();
    }
    if (effect.kind === "boxerChannel") {
      const progressPulse = 0.34 + Math.sin(performance.now() / 42) * 0.18;
      ctx.save();
      ctx.fillStyle = `rgba(255, 159, 67, ${progressPulse})`;
      drawPolygon(cellPolygon(effect.side, effect.col, effect.row, 4));
      ctx.fill();
      ctx.strokeStyle = "#f0d692";
      ctx.lineWidth = 4;
      drawPolygon(cellPolygon(effect.side, effect.col, effect.row, 8));
      ctx.stroke();
      ctx.restore();
    }
    if (effect.kind === "dragonRegret") {
      const cells = crossCells(effect.side, effect.col, effect.row);
      const alpha = 0.16 + Math.sin(performance.now() / 60) * 0.08;
      ctx.save();
      ctx.fillStyle = `rgba(255, 107, 87, ${alpha})`;
      ctx.strokeStyle = "#c8452f";
      ctx.lineWidth = 3;
      for (const cell of cells) {
        drawPolygon(cellPolygon(cell.side, cell.col, cell.row, 5));
        ctx.fill();
        drawPolygon(cellPolygon(cell.side, cell.col, cell.row, 8));
        ctx.stroke();
      }
      ctx.restore();
    }
    if (effect.kind === "mark" || effect.kind === "target") {
      ctx.strokeStyle = effect.color || "#c8452f";
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.45 + Math.sin(performance.now() / 70) * 0.25;
      drawPolygon(cellPolygon(effect.side, effect.col, effect.row, 8));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (effect.kind === "tileTelegraph") {
      // 進度越接近爆點，符文越亮、越縮 —— 讓玩家用亮度判斷剩餘時間
      const heat = 0.16 + progress * progress * 0.46;
      const center = cellCenter(effect.side, effect.col, effect.row);
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = effect.color;
      ctx.globalAlpha = heat;
      drawPolygon(cellPolygon(effect.side, effect.col, effect.row, 4));
      ctx.fill();
      ctx.globalAlpha = 0.5 + progress * 0.5;
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 2 + progress * 2;
      drawPolygon(cellPolygon(effect.side, effect.col, effect.row, 7));
      ctx.stroke();
      ctx.restore();
      drawRuneGlyph(center.x, center.y - 6, 26 - progress * 8, INK.paper, 0.34 + progress * 0.5);
    }
    if (effect.kind === "columnTelegraph") {
      const heat = 0.14 + progress * progress * 0.4;
      for (const row of effect.rows) {
        if (row < 0 || row >= ROWS) continue;
        ctx.save();
        ctx.globalAlpha = heat;
        ctx.fillStyle = effect.color;
        drawPolygon(cellPolygon(effect.side, effect.col, row, 4));
        ctx.fill();
        ctx.globalAlpha = 0.45 + progress * 0.5;
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 2 + progress * 1.6;
        drawPolygon(cellPolygon(effect.side, effect.col, row, 7));
        ctx.stroke();
        ctx.restore();
      }
    }
    // 普攻車道：敵人committed 的射擊列，硃紅虛線
    if (effect.kind === "laneWarn") {
      drawLaneBand(effect.row, effect.color, 0.09 + progress * 0.16, true);
      const anchor = cellCenter("enemy", COLS_PER_SIDE - 1, effect.row);
      ctx.save();
      ctx.globalAlpha = 0.35 + progress * 0.6;
      ctx.fillStyle = effect.color;
      ctx.beginPath();
      ctx.arc(anchor.x + 30, anchor.y - 18, 4 + progress * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 暗器車道：金色，兩排箭簇提示
    if (effect.kind === "dartLane") {
      drawLaneBand(effect.row, effect.color, 0.08 + progress * 0.14, false);
      ctx.save();
      ctx.globalAlpha = 0.4 + progress * 0.55;
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i += 1) {
        const anchor = cellCenter("enemy", COLS_PER_SIDE - 1 - i, effect.row);
        ctx.beginPath();
        ctx.moveTo(anchor.x + 8, anchor.y - 24);
        ctx.lineTo(anchor.x - 6, anchor.y - 18);
        ctx.lineTo(anchor.x + 8, anchor.y - 12);
        ctx.stroke();
      }
      ctx.restore();
    }
    // 場地攻擊起手：中央毛筆招名 + 罡氣擴散環
    if (effect.kind === "fieldOmen") {
      const fade = progress < 0.24 ? progress / 0.24 : 1 - (progress - 0.24) / 0.76;
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade) * 0.34;
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(576, 332, 90 + progress * 460, 30 + progress * 168, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (effect.kind === "damageNumber") {
      // pop 縮放 + 拋物線 + 隨機橫向偏移，解決連擊數字疊在一起
      const pop = progress < 0.16
        ? 0.42 + (progress / 0.16) * 0.82
        : 1.24 - Math.min(1, (progress - 0.16) / 0.2) * 0.24;
      const t = progress;
      const x = effect.x + effect.drift * t;
      const y = effect.y - 52 * t + 46 * t * t - effect.stack;
      ctx.save();
      ctx.globalAlpha = progress > 0.7 ? (1 - progress) / 0.3 : 1;
      ctx.translate(x, y);
      ctx.rotate(effect.tilt);
      ctx.scale(pop, pop);
      ctx.font = FONT.num(effect.size);
      ctx.textAlign = "center";
      ctx.lineWidth = 5;
      ctx.strokeStyle = effect.stroke;
      ctx.strokeText(effect.text, 0, 0);
      ctx.fillStyle = effect.color;
      ctx.fillText(effect.text, 0, 0);
      if (effect.big) {
        ctx.globalAlpha *= 0.5;
        ctx.strokeStyle = INK.paper;
        ctx.lineWidth = 1;
        ctx.strokeText(effect.text, 0, 0);
      }
      ctx.restore();
    }
    if (effect.kind === "knockback") {
      const from = cellCenter("enemy", effect.fromCol, effect.row);
      const to = cellCenter("enemy", effect.toCol, effect.row);
      const sweepX = from.x + (to.x - from.x) * progress;
      ctx.strokeStyle = effect.color || "#d8a12f";
      ctx.globalAlpha = 1 - progress;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y - 10);
      ctx.lineTo(sweepX, from.y + (to.y - from.y) * progress - 10);
      ctx.stroke();
      ctx.fillStyle = effect.color || "#d8a12f";
      ctx.beginPath();
      const sweepY = from.y + (to.y - from.y) * progress;
      ctx.moveTo(sweepX + 28, sweepY - 10);
      ctx.lineTo(sweepX - 8, sweepY - 26);
      ctx.lineTo(sweepX - 8, sweepY + 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(to.x, to.y - 22, 26 + progress * 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

function drawWrappedText(text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const lines = [];
  let line = "";
  for (const character of text) {
    const candidate = line + character;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = character;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  lines.slice(0, maxLines).forEach((entry, index) => ctx.fillText(entry, x, y + index * lineHeight));
}

// 直書門派名：武俠美術的招牌手法
function drawVerticalLabel(text, x, y, size, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = FONT.brush(size);
  ctx.textAlign = "center";
  [...text].forEach((char, index) => {
    ctx.fillText(char, x, y + index * (size + 3));
  });
  ctx.restore();
}

function drawScrollPanel(x, y, w, h, accent) {
  ctx.save();
  const paper = ctx.createLinearGradient(x, y, x, y + h);
  paper.addColorStop(0, "rgba(20, 24, 29, 0.9)");
  paper.addColorStop(1, "rgba(12, 15, 19, 0.9)");
  ctx.fillStyle = paper;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, 4, h);
  ctx.strokeStyle = "rgba(216, 161, 47, 0.34)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  // 四角雲紋角飾
  ctx.strokeStyle = "rgba(216, 161, 47, 0.6)";
  ctx.lineWidth = 1.6;
  const c = 9;
  for (const corner of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(corner[0] + corner[2] * c, corner[1]);
    ctx.lineTo(corner[0], corner[1]);
    ctx.lineTo(corner[0], corner[1] + corner[3] * c);
    ctx.stroke();
  }
  ctx.restore();
}

function drawText() {
  const accent = classes[selectedClass].color;

  drawBossBar();

  // 左上：門派牌 + 戰況
  drawScrollPanel(28, 58, 452, 56, accent);
  ctx.fillStyle = INK.paper;
  ctx.font = FONT.brush(28);
  ctx.textAlign = "left";
  ctx.fillText(classes[selectedClass].name, 46, 84);
  ctx.font = FONT.body(14);
  ctx.fillStyle = "rgba(233, 220, 192, 0.62)";
  drawWrappedText(state.message, 46, 104, 418, 18, 1);

  // 瞄準狀態列。不能塞進 state.message —— 敵人每出一招就會把它蓋掉
  // （訊息列只有一格，這是既有的 C6 問題），所以獨立畫一條。
  const preview = currentAimPreview();
  if (preview && !paused) {
    const hit = preview.willHit;
    const barW = 452;
    const barY = 536;
    ctx.save();
    ctx.fillStyle = "rgba(12, 15, 19, 0.9)";
    ctx.fillRect(28, barY, barW, 34);
    ctx.fillStyle = hit ? INK.goldLit : "#8fd8e8";
    ctx.fillRect(28, barY, 4, 34);
    ctx.strokeStyle = hit ? INK.gold : "rgba(143, 216, 232, 0.6)";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(28.5, barY + 0.5, barW - 1, 33);

    ctx.font = FONT.brush(21);
    ctx.textAlign = "left";
    ctx.fillStyle = INK.paper;
    ctx.fillText(preview.card.name, 44, barY + 25);
    const nameW = ctx.measureText(preview.card.name).width;

    ctx.font = FONT.strong(14);
    ctx.fillStyle = hit ? INK.goldLit : "#8fd8e8";
    ctx.fillText(hit ? "可命中" : "落空", 44 + nameW + 14, barY + 23);

    ctx.font = FONT.body(13);
    ctx.fillStyle = "rgba(233, 220, 192, 0.55)";
    ctx.textAlign = "right";
    ctx.fillText("再按一次施放　Q 取消", 28 + barW - 14, barY + 23);
    ctx.textAlign = "left";
    ctx.restore();
  }

  // 兩側陣營直書落款
  drawVerticalLabel("正道", 84, 236, 20, INK.jade, 0.6);
  drawVerticalLabel("魔道", 1070, 236, 20, INK.cinnabar, 0.6);

  if (state.phase !== "playing") {
    const win = state.phase === "win";
    ctx.fillStyle = "rgba(10, 12, 14, 0.76)";
    ctx.fillRect(0, 0, LOGIC_W, LOGIC_H);
    ctx.textAlign = "center";
    ctx.font = FONT.brush(84);
    ctx.fillStyle = win ? INK.goldLit : INK.cinnabarLit;
    ctx.fillText(win ? "勝" : "敗", LOGIC_W / 2, 300);
    // 落款印章
    ctx.save();
    ctx.translate(LOGIC_W / 2 + 74, 268);
    ctx.rotate(-0.06);
    ctx.fillStyle = "rgba(200, 69, 47, 0.86)";
    ctx.fillRect(-19, -19, 38, 38);
    ctx.fillStyle = INK.paper;
    ctx.font = FONT.title(19);
    ctx.fillText(win ? "捷" : "歿", 0, 7);
    ctx.restore();
    ctx.font = FONT.body(19);
    ctx.fillStyle = "rgba(233, 220, 192, 0.8)";
    ctx.fillText(win ? "魔道伏誅・按下方重新開始" : "道消身殞・按下方重新開始", LOGIC_W / 2, 350);
    ctx.textAlign = "left";
  }
  if (paused) {
    ctx.fillStyle = "rgba(10, 12, 14, 0.8)";
    ctx.fillRect(0, 0, LOGIC_W, LOGIC_H);
    ctx.textAlign = "center";
    ctx.font = FONT.brush(72);
    ctx.fillStyle = INK.paper;
    ctx.fillText("靜", LOGIC_W / 2, 300);
    ctx.font = FONT.body(18);
    ctx.fillStyle = "rgba(233, 220, 192, 0.7)";
    ctx.fillText("按 P 或 Escape 繼續", LOGIC_W / 2, 348);
    ctx.textAlign = "left";
  }
}

function render() {
  resizeCanvas();
  ctx.clearRect(0, 0, LOGIC_W, LOGIC_H);
  drawBackground();
  drawGrid("player");
  drawAimReticle();
  drawSkillPreview();
  drawEffects("under");
  drawTeleportStrikeWarning();
  // 後排先畫，前排後畫，避免前後排角色疊錯
  const playerFirst = playerCombatCell().row <= enemyVisualCell().row;
  if (playerFirst) {
    drawUnit(state.player, "player", classes[selectedClass].color);
    drawUnit(state.enemy, "enemy", INK.cinnabar);
  } else {
    drawUnit(state.enemy, "enemy", INK.cinnabar);
    drawUnit(state.player, "player", classes[selectedClass].color);
  }
  drawProjectiles();
  drawEffects("over");
  drawText();
}

function syncHud() {
  const chargePercent = Math.round(state.player.charge);
  if (chargePercent !== lastHudCache.charge) {
    chargeFill.style.width = `${chargePercent}%`;
    chargeText.textContent = `${chargePercent}%`;
    meterBlock.classList.toggle("ready", chargePercent >= 100);
    // 氣滿而手牌已滿時，讓下一個空槽呼吸，把「氣→牌」的因果關係做出來
    document.body.classList.toggle("charge-ready", chargePercent >= 100);
    lastHudCache.charge = chargePercent;
  }
  const hp = state.player.hp;
  const shield = state.player.shield;
  if (hp !== lastHudCache.playerHp || shield !== lastHudCache.playerShield) {
    const hpLabel = `${hp}/${playerMaxHp()}`;
    playerHpText.textContent = shield > 0 ? `${hpLabel} +${shield}` : hpLabel;
    lastHudCache.playerHp = hp;
    lastHudCache.playerShield = shield;
  }
  if (state.enemy.hp !== lastHudCache.enemyHp) {
    enemyHpText.textContent = `${state.enemy.hp}/${ENEMY_MAX_HP}`;
    lastHudCache.enemyHp = state.enemy.hp;
  }
}

// 增量更新：只重建有變動的欄位。這樣抽一張牌時只有那一張播落牌動畫，
// 其他三張不會跟著閃；同時改用 textContent，不再用 innerHTML 拼字串。
function buildCard(card, index) {
  const button = document.createElement("button");
  button.className = "card";
  button.type = "button";
  button.dataset.card = card.id;
  button.dataset.tone = card.tone || "utility";
  button.setAttribute("aria-label", `第 ${index + 1} 格，${card.name}，${card.tag}。${card.description}`);

  const title = document.createElement("strong");
  title.append(document.createTextNode(`${index + 1}. ${card.name}`));
  const tag = document.createElement("small");
  tag.textContent = card.tag;
  title.append(tag);

  const desc = document.createElement("span");
  desc.textContent = card.description;

  button.append(title, desc);
  button.addEventListener("click", () => castCard(index));
  return button;
}

function renderHand() {
  const locked = paused || state.phase !== "playing" || Boolean(state.player.boxerStrike);

  state.player.hand.forEach((card, index) => {
    const current = handEl.children[index];
    const wantId = card ? card.id : null;
    const haveId = current && current.classList.contains("card") ? current.dataset.card : null;

    if (wantId === haveId && current) {
      if (card) {
        current.disabled = locked;
        // 瞄準狀態是重畫節點以外唯一會變的東西，重用節點時要一起同步
        current.classList.toggle("aiming", state.player.aiming === index);
      }
      return;
    }

    const next = card
      ? buildCard(card, index)
      : Object.assign(document.createElement("div"), {
        className: "card-slot",
        textContent: `空・${"一二三四"[index] || index + 1}`
      });
    if (card) {
      next.disabled = locked;
      next.classList.toggle("aiming", state.player.aiming === index);
    }

    if (current) handEl.replaceChild(next, current);
    else handEl.append(next);
  });

  while (handEl.children.length > state.player.hand.length) {
    handEl.lastChild.remove();
  }
}

function syncMuteButton() {
  if (!muteButton) return;
  muteButton.textContent = audioMuted ? "靜音" : "有聲";
  muteButton.classList.toggle("muted", audioMuted);
  muteButton.setAttribute("aria-pressed", String(audioMuted));
}

function syncPauseButton() {
  pauseButton.textContent = paused ? "繼續" : "暫停";
  pauseButton.classList.toggle("active", paused);
  pauseButton.setAttribute("aria-pressed", String(paused));
  pauseButton.disabled = state.phase !== "playing";
}

function syncClassButtons() {
  document.body.dataset.class = selectedClass;
  classButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.class === selectedClass);
  });
}

function togglePause() {
  if (state.phase !== "playing") return;
  if (!paused) state.player.aiming = null;
  paused = !paused;
  keys.clear();
  touchStart = null;
  soundBank?.stopAll();
  SFX.pause();
  syncPauseButton();
  renderHand();
}

function restartGame() {
  soundBank?.stopAll();
  state = createInitialState();
  paused = false;
  lastHudCache.charge = -1;
  lastHudCache.playerHp = -1;
  lastHudCache.playerShield = -1;
  lastHudCache.enemyHp = -1;
  renderHand();
  syncHud();
  syncClassButtons();
  syncPauseButton();
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  if (!paused) update(dt);
  render();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (event) => {
  initAudio();
  const key = event.key.toLowerCase();
  if (["arrowleft", "arrowright", "arrowup", "arrowdown", " ", "w", "a", "s", "d"].includes(key)) {
    event.preventDefault();
  }
  keys.add(key);
  // 瞄準中按 Escape 先收準心（比直接暫停符合直覺）
  if (key === "escape" && state.player.aiming !== null && !paused) {
    cancelAiming("取消瞄準");
    return;
  }
  if (key === "p" || key === "escape") { togglePause(); return; }
  if (paused) return;
  if (key === "q") { cancelAiming("取消瞄準"); return; }
  if (key === "j" || key === " ") playerBasicAttack();
  if (key === "1") castCard(0);
  if (key === "2") castCard(1);
  if (key === "3") castCard(2);
  if (key === "4") castCard(3);
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

window.addEventListener("blur", () => keys.clear());
window.addEventListener("resize", () => {
  syncInputMode();
  resizeCanvas();
});
if (window.ResizeObserver) new ResizeObserver(resizeCanvas).observe(canvas);
// webfont 載入完成後重畫快取，否則背景落款會停在 fallback 字體
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => { bgCache = null; });
}
document.addEventListener("visibilitychange", () => {
  keys.clear();
  if (document.hidden && state.phase === "playing" && !paused) togglePause();
});

restartButton.addEventListener("click", restartGame);
pauseButton.addEventListener("click", togglePause);
if (muteButton) muteButton.addEventListener("click", () => { initAudio(); toggleMute(); });
canvas.addEventListener("pointerdown", initAudio, { once: false });
canvas.addEventListener("pointerdown", handleBoardPointerDown);
canvas.addEventListener("pointerup", handleBoardPointerUp);
canvas.addEventListener("pointercancel", cancelBoardPointer);
if (mobileInputQuery.addEventListener) mobileInputQuery.addEventListener("change", syncInputMode);
else mobileInputQuery.addListener(syncInputMode);

classButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedClass = button.dataset.class;
    restartGame();
  });
});

loadMutePref();
syncMuteButton();
installSampleOverrides();
// 只有在 http(s) 下才去抓錄音檔；用 file:// 直接開會被 CORS 擋，沒必要噴一堆錯誤
if (location.protocol === "http:" || location.protocol === "https:") {
  soundBank?.preload();
  window.addEventListener("pointerdown", () => loadSamples(), { once: true });
  window.addEventListener("keydown", () => loadSamples(), { once: true });
}
renderHand();
syncHud();
syncClassButtons();
syncPauseButton();
syncInputMode();
initPetals();
resizeCanvas();
requestAnimationFrame(loop);
