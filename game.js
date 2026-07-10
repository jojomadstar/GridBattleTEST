const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

const chargeFill = document.querySelector("#chargeFill");
const chargeText = document.querySelector("#chargeText");
const playerHpText = document.querySelector("#playerHp");
const enemyHpText = document.querySelector("#enemyHp");
const handEl = document.querySelector("#hand");
const restartButton = document.querySelector("#restart");
const pauseButton = document.querySelector("#pause");
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
const ADEPT_MAX_HP = 100;
const SWORDSMAN_MAX_HP = 150;
const BOXER_MAX_HP = 180;
const ENEMY_MAX_HP = 640;
const CRIT_CHANCE = 0.15;
const DAMAGE_VARIANCE = 0.1;

const keys = new Set();
let selectedClass = "adept";
let lastTime = performance.now();
let state;
let touchStart = null;
let mobileInputEnabled = detectMobileInput();
let paused = false;
const lastHudCache = { charge: -1, playerHp: -1, playerShield: -1, enemyHp: -1 };
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(freq, dur, type = "square", vol = 0.12) {
  try {
    const ac = getAudioCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    osc.start();
    osc.stop(ac.currentTime + dur);
  } catch (_) {}
}

function sfxBasicHit()  { playTone(380, 0.07, "square", 0.10); }
function sfxSkillHit()  { playTone(520, 0.13, "sawtooth", 0.13); }
function sfxComboHit()  {
  playTone(200, 0.25, "sawtooth", 0.16);
  setTimeout(() => playTone(360, 0.18, "sawtooth", 0.12), 50);
}
function sfxTakeDmg()   { playTone(150, 0.17, "sawtooth", 0.15); }
function sfxDrawCard()  { playTone(900, 0.10, "sine", 0.07); }
function sfxVictory()   {
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.2, "sine", 0.12), i * 130));
}
function sfxDefeat()    {
  [330, 277, 220, 165].forEach((f, i) => setTimeout(() => playTone(f, 0.22, "sawtooth", 0.12), i * 150));
}
function sfxPause()     { playTone(440, 0.09, "sine", 0.07); }
function sfxEnemyMelee() {
  playTone(132, 0.24, "sawtooth", 0.16);
  setTimeout(() => playTone(88, 0.18, "square", 0.1), 45);
}

const classes = {
  adept: {
    name: "脈衝使",
    color: "#50bcff",
    maxHp: ADEPT_MAX_HP,
    message: "脈衝使：普攻命中才會累積氣條，滿氣抽一張技能卡",
    deck: [
      {
        id: "bolt",
        name: "脈衝彈",
        tag: "直線",
        tone: "damage",
        description: "沿同一列射出高速能量，命中造成 32 傷害。",
        cast(game) {
          const origin = cellCenter("player", game.player.col, game.player.row);
          addProjectile({
            x: origin.x + 34,
            y: origin.y - 16,
            vx: 620,
            vy: 0,
            radius: 12,
            color: "#50bcff",
            damage: 32,
            hitKind: "skill",
            owner: "player"
          });
        }
      },
      {
        id: "slash",
        name: "裂隙斬",
        tag: "近距",
        tone: "control",
        description: "攻擊敵方前兩格，造成 44 傷害並短暫定身。",
        cast(game) {
          const rows = [game.player.row - 1, game.player.row, game.player.row + 1];
          addSlashEffect(rows, 0, 2, "#50bcff");
          const enemyCell = enemyVisualCell();
          if (enemyCell.side === "enemy" && rows.includes(enemyCell.row) && enemyCell.col <= 1) {
            applyEnemyDamage(44, { kind: "skill" });
            game.enemy.stun = 0.38;
          }
        }
      },
      {
        id: "shield",
        name: "護盾矩陣",
        tag: "防禦",
        description: "獲得 28 護盾，護盾會先抵擋敵方攻擊。",
        cast(game) {
          game.player.shield = Math.min(60, game.player.shield + 28);
          const pos = cellCenter("player", game.player.col, game.player.row);
          addBurst(pos.x, pos.y - 22, "#32d58a", 0.35);
        }
      },
      {
        id: "flare",
        name: "熱核落點",
        tag: "範圍",
        tone: "damage",
        description: "鎖定敵人所在格，短暫延遲後爆炸造成 56 傷害。",
        cast(game) {
          game.effects.push({
            kind: "mark",
            col: game.enemy.col,
            row: game.enemy.row,
            time: 0.72,
            duration: 0.72,
            onFinish() {
              if (game.enemy.col === this.col && game.enemy.row === this.row) {
                applyEnemyDamage(56, { kind: "skill" });
              }
              const pos = cellCenter("enemy", this.col, this.row);
              addBurst(pos.x, pos.y - 22, "#ff6255", 0.28);
            }
          });
        }
      }
    ],
    basicAttack(game) {
      const origin = cellCenter("player", game.player.col, game.player.row);
      addProjectile({
        x: origin.x + 32,
        y: origin.y - 18,
        vx: 720,
        vy: 0,
        radius: 8,
        color: "#f1c94c",
        damage: 12,
        hitKind: "basic",
        owner: "player",
        chargeOnHit: 24
      });
    }
  },
  swordsman: {
    name: "劍客",
    color: "#f1c94c",
    maxHp: SWORDSMAN_MAX_HP,
    message: "劍客：普攻固定斬前方第四格，劍氣可浮空後接擊飛聯招",
    deck: [
      {
        id: "sword-qi",
        name: "流光劍氣",
        tag: "直線",
        tone: "airborne",
        description: "瞬間掃過整列的劍氣，造成 24 傷害並使敵人浮空 1 秒。",
        cast(game) {
          const row = game.player.row;
          const enemyCell = enemyVisualCell();
          game.effects.push({
            kind: "swordWave",
            row,
            color: "#f8df72",
            time: 0.18,
            duration: 0.18
          });
          if (enemyCell.row === row) {
            applyEnemyDamage(24, { kind: "skill" });
            game.enemy.airborne = 1;
            game.enemy.stun = Math.max(game.enemy.stun, 0.35);
            const pos = enemyVisualPosition();
            addBurst(pos.x, pos.y - 22, "#f8df72", 0.22);
            game.message = "流光劍氣瞬間命中：敵人浮空，立刻接攻擊可觸發擊飛聯招";
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
        cast(game) {
          const aim = swordsmanAimCell();
          const rows = [aim.row - 1, aim.row, aim.row + 1];
          addSlashEffect(rows, aim.col, 1, "#f1c94c", aim.side);
          if (rows.some((row) => enemyOnCell({ side: aim.side, col: aim.col, row }))) {
            hitEnemyWithSkill(30, { combo: true, color: "#f1c94c" });
          }
        }
      },
      {
        id: "thrust",
        name: "追風突刺",
        tag: "穿刺",
        tone: "control",
        description: "突刺準心格與其左側一格，造成 28 傷害並定身 4 秒。",
        cast(game) {
          const aim = swordsmanAimCell();
          const hitCols = [aim.col - 1, aim.col];
          addSlashEffect([aim.row], Math.max(0, aim.col - 1), Math.min(2, aim.col + 1), "#dff8f2", aim.side);
          if (hitCols.some((col) => enemyOnCell({ side: aim.side, col, row: aim.row }))) {
            hitEnemyWithSkill(28, { color: "#dff8f2" });
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
        cast(game) {
          game.player.counter = 1.2;
          const pos = cellCenter("player", game.player.col, game.player.row);
          addBurst(pos.x, pos.y - 20, "#c79cff", 0.34);
          game.message = "月弧返斬：進入防守反擊架勢";
        }
      }
    ],
    basicAttack(game) {
      const target = swordsmanAimCell();
      const targetRow = game.player.row;
      game.effects.push({
        kind: "target",
        side: target.side,
        col: target.col,
        row: targetRow,
        color: "#f1c94c",
        time: 0.26,
        duration: 0.26
      });
      if (enemyOnCell({ side: target.side, col: target.col, row: targetRow })) {
        hitEnemyWithSkill(14, { charge: 42, color: "#f1c94c", kind: "basic" });
        addSwordHitEffect();
        game.message = "劍客普攻命中第四格，氣條大幅上升";
      } else {
        game.message = "劍客普攻揮空：只有命中才會集氣";
      }
    }
  },
  boxer: {
    name: "拳師",
    color: "#ff9f43",
    maxHp: BOXER_MAX_HP,
    message: "拳師：推拉敵人進準心，定身後用爆發技能打滿傷害",
    deck: [
      {
        id: "driving-palm",
        name: "震山推掌",
        tag: "推",
        tone: "control",
        description: "以準心為中心攻擊 2x3 區域，造成 18 傷害、緩速並把敵人往後推 1 格。",
        cast(game) {
          const aim = combatAimCell();
          const area = boxerControlArea(aim);
          addAreaEffect(area, "#ffb35c");
          if (enemyInsideArea(area)) {
            hitEnemyWithSkill(18, { color: "#ffb35c" });
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
        cast(game) {
          const aim = combatAimCell();
          const area = boxerControlArea(aim);
          addAreaEffect(area, "#7ee7d5");
          if (enemyInsideArea(area)) {
            hitEnemyWithSkill(14, { color: "#7ee7d5" });
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
        cast(game) {
          const aim = combatAimCell();
          const startCol = Math.max(0, aim.col - 1);
          addSlashEffect([aim.row], startCol, aim.col - startCol + 1, "#f6d365", aim.side);
          if ([aim.col - 1, aim.col].some((col) => enemyOnCell({ side: aim.side, col, row: aim.row }))) {
            hitEnemyWithSkill(20, { color: "#f6d365" });
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
        description: "只打準心格；引導 1.6 秒，持續命中，最後一擊造成大傷害。",
        cast(game) {
          const aim = combatAimCell();
          game.effects.push({
            kind: "boxerChannel",
            side: aim.side,
            col: aim.col,
            row: aim.row,
            color: "#ff9f43",
            tickTimer: 0.05,
            finisherDone: false,
            time: 1.6,
            duration: 1.6
          });
          game.message = "百裂崩拳：開始引導，敵人留在準心內才會吃滿傷害";
        }
      },
      {
        id: "breathing",
        name: "運氣調息",
        tag: "抽牌",
        tone: "draw",
        description: "直接抽兩張新卡，補充拳路。",
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
        cast(game) {
          const aim = combatAimCell();
          game.effects.push({
            kind: "dragonRegret",
            side: aim.side,
            col: aim.col,
            row: aim.row,
            color: "#ff6b57",
            time: 2,
            duration: 2,
            onFinish() {
              const cells = crossCells(this.side, this.col, this.row);
              addCrossBurst(cells, this.color);
              if (enemyInsideCells(cells)) {
                hitEnemyWithSkill(92, { color: this.color, forceCrit: true, big: true });
              }
            }
          });
          game.message = "亢龍有悔：開始引導 2 秒";
        }
      }
    ],
    basicAttack(game) {
      const aim = combatAimCell();
      game.effects.push({
        kind: "target",
        side: aim.side,
        col: aim.col,
        row: aim.row,
        color: "#ff9f43",
        time: 0.22,
        duration: 0.22
      });
      if (enemyOnCell(aim)) {
        hitEnemyWithSkill(16, { charge: 34, color: "#ff9f43", kind: "basic" });
        addPunchHitEffect();
        game.message = "拳師普攻命中準心";
      } else {
        game.message = "拳師普攻揮空：先把敵人控進準心";
      }
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
      hand: Array(HAND_SIZE).fill(null)
    },
    enemy: {
      hp: ENEMY_MAX_HP,
      col: 2,
      row: 1,
      moveTimer: 0.9,
      attackTimer: 1.2,
      specialCooldown: 4.2,
      special: null,
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
  return forwardCellFromPlayer(state.player.col, state.player.row, 4);
}

function swordsmanAimCell() {
  return combatAimCell();
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

function addRowPulse(row, color) {
  state.effects.push({
    kind: "rowPulse",
    row,
    color,
    time: 0.22,
    duration: 0.22
  });
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
    color: "#fdf3b0",
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
    color: "#ffb35c",
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
    time: 0.22,
    duration: 0.22
  });
}

function addPlayerTileTelegraph(col, row, delay, damage, color = "#ff6255") {
  state.effects.push({
    kind: "tileTelegraph",
    side: "player",
    col,
    row,
    color,
    time: delay,
    duration: delay,
    onFinish() {
      const pos = cellCenter("player", col, row);
      addBurst(pos.x, pos.y - 10, color, 0.24);
      if (state.player.col === col && state.player.row === row) {
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
    color: "#ff8d63",
    time: delay,
    duration: delay,
    onFinish() {
      for (const row of rows) {
        const pos = cellCenter(side, col, row);
        addBurst(pos.x, pos.y - 10, "#ff8d63", 0.18);
      }
      if (side === "player" && state.player.col === col && rows.includes(state.player.row)) {
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
  sfxDrawCard();
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
  if (state.phase === "playing") {
    if (combo) sfxComboHit();
    else if (options.kind === "basic") sfxBasicHit();
    else sfxSkillHit();
  }
  const resolved = applyEnemyDamage(combo ? baseDamage * 2 : baseDamage, {
    kind: options.kind || "skill",
    big: options.big || combo,
    forceCrit: options.forceCrit
  });
  if (options.charge) gainCharge(options.charge);

  const pos = enemyVisualPosition();
  addBurst(pos.x, pos.y - 20, options.color || "#f1c94c", combo ? 0.34 : 0.2);

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
      color: options.color || "#f1c94c",
      time: 0.34,
      duration: 0.34
    });
    state.message = `擊飛聯招！傷害 ${resolved.damage}，敵人被推到最後排並緩速`;
  }
}

function playerBasicAttack() {
  if (paused || state.phase !== "playing" || state.player.attackCooldown > 0) return;
  state.player.attackCooldown = selectedClass === "swordsman" ? 0.28 : 0.34;
  classes[selectedClass].basicAttack(state);
}

function castCard(index) {
  if (paused || state.phase !== "playing") return;
  const card = state.player.hand[index];
  if (!card) return;
  state.player.hand[index] = null;
  state.message = `施放 ${card.name}`;
  card.cast(state);
  redeemStoredCharge();
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
  state.enemy.hp = Math.max(0, state.enemy.hp - damage);
  const pos = enemyVisualPosition();
  addDamageNumber(pos.x, pos.y - 72, damage, { kind, big: big || crit });
  if (state.enemy.hp <= 0 && state.phase === "playing") {
    state.phase = "win";
    state.message = "勝利：模板完成，可以開始加關卡與卡池";
    sfxVictory();
    syncPauseButton();
    renderHand();
  }
  return { damage, crit };
}

function addDamageNumber(x, y, damage, { kind = "skill", big = false } = {}) {
  state.effects.push({
    kind: "damageNumber",
    x,
    y,
    text: String(damage),
    color: big ? "#ff4f4f" : kind === "basic" ? "#ffffff" : "#ffd166",
    size: big ? 40 : kind === "basic" ? 24 : 30,
    stroke: big ? "#6b1010" : kind === "basic" ? "#30343b" : "#6b4b00",
    time: big ? 0.9 : 0.72,
    duration: big ? 0.9 : 0.72
  });
}

function damagePlayer(amount) {
  if (state.player.invuln > 0 || state.phase !== "playing") return;
  if (state.player.counter > 0) {
    state.player.counter = 0;
    const pos = cellCenter("player", state.player.col, state.player.row);
    addBurst(pos.x, pos.y - 20, "#c79cff", 0.3);
    hitEnemyWithSkill(46, { color: "#c79cff" });
    state.message = "月弧返斬成功：抵銷傷害並反擊";
    return;
  }
  sfxTakeDmg();
  const blocked = Math.min(state.player.shield, amount);
  state.player.shield -= blocked;
  state.player.hp = Math.max(0, state.player.hp - (amount - blocked));
  state.player.invuln = 0.38;
  if (state.player.hp <= 0) {
    state.phase = "lose";
    state.message = "戰敗：按重新開始再試一次";
    sfxDefeat();
    syncPauseButton();
    renderHand();
  }
}

function movePlayer(dx, dy) {
  if (state.phase !== "playing" || state.player.moveCooldown > 0) return;
  const nextCol = clamp(state.player.col + dx, 0, COLS_PER_SIDE - 1);
  const nextRow = clamp(state.player.row + dy, 0, ROWS - 1);
  if (nextCol === state.player.col && nextRow === state.player.row) return;
  state.player.col = nextCol;
  state.player.row = nextRow;
  state.player.moveCooldown = 0.13;
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

  const pos = cellCenter(strike.landing.side, strike.landing.col, strike.landing.row);
  addBurst(pos.x, pos.y - 28, "#7ff4ff", 0.38);
  state.effects.push({
    kind: "interruptMark",
    x: pos.x + 58,
    y: pos.y - 58,
    color: "#7ff4ff",
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
    const origin = cellCenter("enemy", enemy.col, enemy.row);
    addProjectile({
      x: origin.x - 34,
      y: origin.y - 18,
      vx: -430,
      vy: 0,
      radius: 10,
      color: "#ff6255",
      damage: 16,
      owner: "enemy"
    });
    enemy.attackTimer = 1.05 + Math.random() * 0.55;
  }
}

function startTeleportStrike() {
  const enemy = state.enemy;
  const frontGlobalCol = state.player.col + 1;
  const landing = frontGlobalCol < COLS_PER_SIDE
    ? { side: "player", col: frontGlobalCol, row: state.player.row }
    : { side: "enemy", col: 0, row: state.player.row };
  const targetRows = [state.player.row - 1, state.player.row, state.player.row + 1]
    .filter((row) => row >= 0 && row < ROWS);

  enemy.teleportStrike = {
    phase: "warning",
    time: 1,
    duration: 1,
    origin: { side: "enemy", col: enemy.col, row: enemy.row },
    landing,
    targetCells: targetRows.map((row) => ({ side: "player", col: state.player.col, row }))
  };

  const originPos = cellCenter("enemy", enemy.col, enemy.row);
  const landingPos = cellCenter(landing.side, landing.col, landing.row);
  state.effects.push({
    kind: "teleportRift",
    x: originPos.x,
    y: originPos.y - 28,
    color: "#ff5f59",
    time: 0.34,
    duration: 0.34
  });
  state.effects.push({
    kind: "teleportRift",
    x: landingPos.x,
    y: landingPos.y - 28,
    color: "#ffcc62",
    time: 0.42,
    duration: 0.42
  });
  state.message = "敵人瞬身近戰：紅色豎三格將在 1 秒後斬擊，立刻移出警示區";
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
    sfxEnemyMelee();
    state.effects.push({
      kind: "meleeCleave",
      cells: strike.targetCells.map((cell) => ({ ...cell })),
      color: "#ff5f59",
      time: 0.34,
      duration: 0.34
    });
    for (const cell of strike.targetCells) {
      const pos = cellCenter(cell.side, cell.col, cell.row);
      addBurst(pos.x, pos.y - 12, "#ff5f59", 0.28);
    }
    const hit = strike.targetCells.some((cell) => (
      state.player.col === cell.col && state.player.row === cell.row
    ));
    if (hit) damagePlayer(30);
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
    color: "#ff5f59",
    time: 0.3,
    duration: 0.3
  });
  state.effects.push({
    kind: "teleportRift",
    x: originPos.x,
    y: originPos.y - 28,
    color: "#ffcc62",
    time: 0.36,
    duration: 0.36
  });
  enemy.col = strike.origin.col;
  enemy.row = strike.origin.row;
  enemy.teleportStrike = null;
  enemy.teleportStrikeCooldown = 7 + Math.random() * 4;
}

function startEnemySpecial() {
  const enemy = state.enemy;
  const specials = ["orbitBombard", "waveSweep"];
  const type = specials[Math.floor(Math.random() * specials.length)];

  if (type === "orbitBombard") {
    enemy.special = {
      type,
      timer: 0.35,
      step: 0,
      path: [
        [0, 0], [1, 0], [2, 0], [3, 0],
        [3, 1], [3, 2], [3, 3],
        [2, 3], [1, 3], [0, 3],
        [0, 2], [0, 1]
      ]
    };
    state.message = "敵人特殊攻擊：環狀轟炸，沿著外圈移動躲避";
    return;
  }

  const centerRow = clamp(enemy.row, 1, ROWS - 2);
  const path = [];
  for (let col = enemy.col; col >= 0; col -= 1) {
    path.push({ side: "enemy", col });
  }
  for (let col = COLS_PER_SIDE - 1; col >= 0; col -= 1) {
    path.push({ side: "player", col });
  }
  enemy.special = {
    type,
    timer: 0.42,
    step: 0,
    path,
    rows: [centerRow - 1, centerRow, centerRow + 1]
  };
  state.message = "敵人特殊攻擊：三格波浪，準備左右閃避";
}

function finishEnemySpecial() {
  state.enemy.special = null;
  state.enemy.specialCooldown = 5 + Math.random() * 2;
}

function updateEnemySpecial(enemy, dt) {
  enemy.special.timer -= dt;
  if (enemy.special.timer > 0) return;

  if (enemy.special.type === "orbitBombard") {
    const [col, row] = enemy.special.path[enemy.special.step];
    addPlayerTileTelegraph(col, row, 0.42, 18, "#ff6255");
    enemy.special.step += 1;
    enemy.special.timer = 0.28;
    if (enemy.special.step >= enemy.special.path.length) {
      finishEnemySpecial();
    }
    return;
  }

  if (enemy.special.type === "waveSweep") {
    const target = enemy.special.path[enemy.special.step];
    addColumnTelegraph(target.side, target.col, enemy.special.rows, 0.34, target.side === "player" ? 22 : 0);
    enemy.special.step += 1;
    enemy.special.timer = 0.34;
    if (enemy.special.step >= enemy.special.path.length) {
      finishEnemySpecial();
    }
  }
}

function updateProjectiles(dt) {
  for (const projectile of state.projectiles) {
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;

    if (projectile.owner === "player") {
      const enemyCenter = enemyVisualPosition();
      if (Math.hypot(projectile.x - enemyCenter.x, projectile.y - (enemyCenter.y - 18)) < 35) {
        projectile.dead = true;
        if (projectile.hitKind === "skill") sfxSkillHit(); else sfxBasicHit();
        applyEnemyDamage(projectile.damage, { kind: projectile.hitKind || "basic" });
        if (projectile.chargeOnHit) gainCharge(projectile.chargeOnHit);
        if (projectile.onHit) projectile.onHit();
        addBurst(enemyCenter.x, enemyCenter.y - 20, projectile.color, 0.18);
      }
    } else {
      const playerCenter = cellCenter("player", state.player.col, state.player.row);
      if (Math.hypot(projectile.x - playerCenter.x, projectile.y - (playerCenter.y - 18)) < 35) {
        projectile.dead = true;
        damagePlayer(projectile.damage);
        addBurst(playerCenter.x, playerCenter.y - 20, projectile.color, 0.18);
      }
    }

    if (projectile.x < -50 || projectile.x > canvas.width + 50) {
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
        if (enemyOnCell(effect)) {
          hitEnemyWithSkill(14, { color: effect.color });
        }
      }
      if (!effect.finisherDone && effect.time <= 0.2) {
        effect.finisherDone = true;
        if (enemyOnCell(effect)) {
          hitEnemyWithSkill(48, { color: "#ffd166", big: true });
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
  updateInput();
  state.player.moveCooldown = Math.max(0, state.player.moveCooldown - dt);
  state.player.attackCooldown = Math.max(0, state.player.attackCooldown - dt);
  state.player.invuln = Math.max(0, state.player.invuln - dt);
  state.player.counter = Math.max(0, state.player.counter - dt);
  updateEnemy(dt);
  updateProjectiles(dt);
  updateEffects(dt);
  syncHud();
}

function drawMountainLayer(baseY, color, peakHeight, step, offset = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  for (let x = -step + offset, i = 0; x < canvas.width + step; x += step, i += 1) {
    const height = peakHeight * (0.72 + (i % 3) * 0.14);
    ctx.lineTo(x, baseY);
    ctx.lineTo(x + step * 0.52, baseY - height);
    ctx.lineTo(x + step, baseY);
  }
  ctx.lineTo(canvas.width, baseY);
  ctx.closePath();
  ctx.fill();
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#13283b");
  sky.addColorStop(0.28, "#5f91a2");
  sky.addColorStop(0.5, "#243d49");
  sky.addColorStop(1, "#0d141a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(224, 239, 239, 0.5)";
  for (let i = 0; i < 34; i += 1) {
    const x = (i * 197) % canvas.width;
    const y = 24 + ((i * 53) % 102);
    ctx.fillRect(x, y, i % 4 === 0 ? 2 : 1, 1);
  }

  drawMountainLayer(178, "#d8e5e5", 112, 158, -50);
  drawMountainLayer(190, "#7fa4aa", 82, 132, 22);
  drawMountainLayer(202, "#36545e", 56, 116, -30);

  const horizon = ctx.createLinearGradient(0, 166, 0, 226);
  horizon.addColorStop(0, "rgba(18, 35, 43, 0.25)");
  horizon.addColorStop(1, "#101b22");
  ctx.fillStyle = horizon;
  ctx.fillRect(0, 166, canvas.width, 82);

  ctx.fillStyle = "#17242c";
  for (let x = 0; x < canvas.width; x += 72) {
    const height = 18 + ((x / 72) % 4) * 6;
    ctx.fillRect(x, 190 - height, 48, height);
    ctx.fillStyle = "rgba(242, 196, 94, 0.55)";
    ctx.fillRect(x + 8, 180 - height, 4, 4);
    ctx.fillStyle = "#17242c";
  }

  ctx.fillStyle = "rgba(5, 10, 14, 0.72)";
  drawPolygon([
    { x: 72, y: 185 },
    { x: 1080, y: 185 },
    { x: 1092, y: 496 },
    { x: 58, y: 496 }
  ]);
  ctx.fill();

  ctx.strokeStyle = "#d4e6df";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(102, 192);
  ctx.lineTo(1050, 192);
  ctx.moveTo(94, 478);
  ctx.lineTo(1058, 478);
  ctx.stroke();

  ctx.strokeStyle = "#42cdb2";
  ctx.lineWidth = 7;
  ctx.shadowColor = "#42cdb2";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(96, 204);
  ctx.lineTo(1056, 204);
  ctx.moveTo(88, 466);
  ctx.lineTo(1064, 466);
  ctx.stroke();
  ctx.shadowBlur = 0;

  const foreground = ctx.createLinearGradient(0, 496, 0, canvas.height);
  foreground.addColorStop(0, "#17232a");
  foreground.addColorStop(1, "#080c10");
  ctx.fillStyle = foreground;
  ctx.fillRect(0, 496, canvas.width, canvas.height - 496);

  ctx.strokeStyle = "rgba(98, 126, 137, 0.26)";
  ctx.lineWidth = 1;
  for (let x = 64; x < canvas.width; x += 128) {
    ctx.beginPath();
    ctx.moveTo(576 + (x - 576) * 0.68, 496);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (const y of [526, 570, 620]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(5, 9, 12, 0.72)";
  ctx.fillRect(0, 596, canvas.width, 52);
  ctx.fillStyle = "rgba(85, 214, 228, 0.62)";
  ctx.fillRect(58, 610, 116, 3);
  ctx.fillStyle = "rgba(239, 95, 89, 0.62)";
  ctx.fillRect(canvas.width - 174, 610, 116, 3);
  ctx.fillStyle = "rgba(214, 229, 229, 0.46)";
  ctx.font = "700 11px Segoe UI, sans-serif";
  ctx.fillText("SECTOR 04 / ARENA ONLINE", 58, 632);
  ctx.textAlign = "right";
  ctx.fillText("THREAT RESPONSE GRID", canvas.width - 58, 632);
  ctx.textAlign = "left";
}

function drawGrid(side) {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS_PER_SIDE; col += 1) {
      const tileGradient = ctx.createLinearGradient(0, boardPoint(0, row).y, 0, boardPoint(0, row + 1).y);
      const alternate = (col + row) % 2 === 0;
      if (side === "player") {
        tileGradient.addColorStop(0, alternate ? "rgba(22, 65, 75, 0.92)" : "rgba(18, 53, 65, 0.92)");
        tileGradient.addColorStop(1, "rgba(10, 28, 35, 0.96)");
      } else {
        tileGradient.addColorStop(0, alternate ? "rgba(78, 38, 44, 0.92)" : "rgba(62, 29, 37, 0.92)");
        tileGradient.addColorStop(1, "rgba(35, 17, 25, 0.96)");
      }
      ctx.fillStyle = tileGradient;
      drawPolygon(cellPolygon(side, col, row, 2));
      ctx.fill();

      ctx.strokeStyle = side === "player" ? "rgba(104, 204, 215, 0.12)" : "rgba(255, 129, 125, 0.12)";
      ctx.lineWidth = 1;
      drawPolygon(cellPolygon(side, col, row, 8));
      ctx.stroke();
    }
  }

  if (side === "player") {
    ctx.fillStyle = `${classes[selectedClass].color}24`;
    drawPolygon(cellPolygon("player", state.player.col, state.player.row, 5));
    ctx.fill();
    ctx.strokeStyle = `${classes[selectedClass].color}b8`;
    ctx.lineWidth = 3;
    drawPolygon(cellPolygon("player", state.player.col, state.player.row, 8));
    ctx.stroke();
  }

  const startCol = side === "player" ? 0 : COLS_PER_SIDE;
  const endCol = startCol + COLS_PER_SIDE;
  ctx.strokeStyle = side === "player" ? "#438a9a" : "#a24c57";
  ctx.lineWidth = 2.2;

  for (let row = 0; row <= ROWS; row += 1) {
    const start = boardPoint(startCol, row);
    const end = boardPoint(endCol, row);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  for (let col = startCol; col <= endCol; col += 1) {
    const start = boardPoint(col, 0);
    const end = boardPoint(col, ROWS);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }


  const sideOutline = [
    boardPoint(startCol, 0),
    boardPoint(endCol, 0),
    boardPoint(endCol, ROWS),
    boardPoint(startCol, ROWS)
  ];
  ctx.strokeStyle = side === "player" ? "#69c8d0" : "#e06468";
  ctx.lineWidth = 3;
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 7;
  drawPolygon(sideOutline);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawSwordsmanAim() {
  if (!["swordsman", "boxer"].includes(selectedClass) || state.phase !== "playing") return;
  const target = combatAimCell();

  ctx.save();
  ctx.fillStyle = "rgba(245, 248, 250, 0.16)";
  ctx.strokeStyle = selectedClass === "boxer"
    ? "rgba(255, 224, 170, 0.82)"
    : "rgba(245, 248, 250, 0.74)";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 7]);
  drawPolygon(cellPolygon(target.side, target.col, target.row, 6));
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTeleportStrikeWarning() {
  const strike = state.enemy.teleportStrike;
  if (!strike || strike.phase !== "warning") return;

  const pulse = 0.24 + (Math.sin(performance.now() / 52) + 1) * 0.09;
  ctx.save();
  ctx.shadowColor = "#ff3f3f";
  ctx.shadowBlur = 14;
  for (const cell of strike.targetCells) {
    ctx.fillStyle = `rgba(255, 44, 52, ${pulse})`;
    drawPolygon(cellPolygon(cell.side, cell.col, cell.row, 3));
    ctx.fill();
    ctx.strokeStyle = "#ff4f55";
    ctx.lineWidth = 4;
    drawPolygon(cellPolygon(cell.side, cell.col, cell.row, 7));
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 230, 190, 0.9)";
    ctx.lineWidth = 1.5;
    drawPolygon(cellPolygon(cell.side, cell.col, cell.row, 13));
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  const landing = cellCenter(strike.landing.side, strike.landing.col, strike.landing.row);
  const labelY = Math.max(118, landing.y - 108);
  ctx.fillStyle = "rgba(15, 6, 8, 0.9)";
  ctx.fillRect(landing.x - 57, labelY - 20, 114, 27);
  ctx.strokeStyle = "#ffcc62";
  ctx.lineWidth = 2;
  ctx.strokeRect(landing.x - 57, labelY - 20, 114, 27);
  ctx.fillStyle = "#fff4df";
  ctx.font = "800 13px Segoe UI, Microsoft JhengHei, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`瞬身斬 ${Math.max(0, strike.time).toFixed(1)}s`, landing.x, labelY - 2);
  ctx.textAlign = "left";
  ctx.restore();
}

function drawHpBar(x, y, width, hp, maxHp, shield = 0) {
  const pct = clamp(hp / maxHp, 0, 1);
  ctx.fillStyle = "rgba(3, 7, 10, 0.92)";
  ctx.fillRect(x - width / 2 - 2, y - 2, width + 4, 11);
  ctx.fillStyle = pct > 0.35 ? "#32d58a" : "#ff6255";
  ctx.fillRect(x - width / 2, y, width * pct, 7);
  ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
  ctx.fillRect(x - width / 2, y, width * pct, 2);
  if (shield > 0) {
    ctx.fillStyle = "#50bcff";
    ctx.fillRect(x - width / 2, y - 7, width * clamp(shield / 60, 0, 1), 5);
  }
  ctx.strokeStyle = "rgba(223, 248, 242, 0.7)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x - width / 2, y, width, 7);
}

function drawAdeptCharacter() {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.fillStyle = "#e5505f";
  ctx.beginPath();
  ctx.moveTo(-12, -58);
  ctx.lineTo(-42, -49);
  ctx.lineTo(-22, -38);
  ctx.lineTo(-5, -48);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#071117";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-9, -4);
  ctx.lineTo(-13, 20);
  ctx.moveTo(9, -4);
  ctx.lineTo(15, 20);
  ctx.stroke();
  ctx.strokeStyle = "#55d6e4";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-13, 18);
  ctx.lineTo(-24, 20);
  ctx.moveTo(15, 18);
  ctx.lineTo(26, 20);
  ctx.stroke();

  const coat = ctx.createLinearGradient(-20, -60, 20, 5);
  coat.addColorStop(0, "#17374a");
  coat.addColorStop(0.52, "#286c7c");
  coat.addColorStop(1, "#102530");
  ctx.fillStyle = coat;
  ctx.strokeStyle = "#9cebf0";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-17, -57);
  ctx.lineTo(14, -57);
  ctx.lineTo(23, -14);
  ctx.lineTo(4, 7);
  ctx.lineTo(-23, -10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#0b151d";
  ctx.fillRect(-5, -56, 8, 57);
  ctx.fillStyle = "#ffd166";
  ctx.beginPath();
  ctx.arc(0, -36, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff2a7";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = "#153747";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(13, -47);
  ctx.lineTo(30, -33);
  ctx.stroke();
  ctx.fillStyle = "#10232d";
  ctx.strokeStyle = "#62dae6";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(25, -41, 27, 18, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffd166";
  ctx.fillRect(47, -36, 9, 7);

  ctx.fillStyle = "#d9a37d";
  ctx.strokeStyle = "#071117";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(-1, -72, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#111c25";
  ctx.beginPath();
  ctx.arc(-3, -77, 14, Math.PI, Math.PI * 2);
  ctx.lineTo(10, -70);
  ctx.lineTo(-15, -70);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#7ff4ff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-11, -71);
  ctx.lineTo(10, -71);
  ctx.stroke();
}

function drawSwordsmanCharacter() {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.strokeStyle = "#eef4f4";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-27, 19);
  ctx.lineTo(31, -68);
  ctx.stroke();
  ctx.strokeStyle = "#c64545";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(-31, 20);
  ctx.lineTo(-22, 7);
  ctx.stroke();

  ctx.strokeStyle = "#10151b";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(-10, -3);
  ctx.lineTo(-18, 21);
  ctx.moveTo(8, -3);
  ctx.lineTo(18, 21);
  ctx.stroke();

  const robe = ctx.createLinearGradient(-22, -58, 22, 6);
  robe.addColorStop(0, "#171d25");
  robe.addColorStop(0.5, "#35404b");
  robe.addColorStop(1, "#11161d");
  ctx.fillStyle = robe;
  ctx.strokeStyle = "#f2d16b";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-19, -56);
  ctx.lineTo(16, -56);
  ctx.lineTo(24, -9);
  ctx.lineTo(1, 8);
  ctx.lineTo(-24, -8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#d24f4f";
  ctx.beginPath();
  ctx.moveTo(-19, -29);
  ctx.lineTo(19, -34);
  ctx.lineTo(20, -24);
  ctx.lineTo(-18, -19);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f2d16b";
  ctx.beginPath();
  ctx.moveTo(-16, -54);
  ctx.lineTo(4, -30);
  ctx.lineTo(14, -55);
  ctx.lineTo(4, -58);
  ctx.lineTo(-3, -41);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#d9a37d";
  ctx.strokeStyle = "#0d1117";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(-1, -72, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#15191f";
  ctx.beginPath();
  ctx.arc(-2, -78, 15, Math.PI, Math.PI * 2);
  ctx.lineTo(10, -69);
  ctx.lineTo(-16, -70);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(11, -87, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f2d16b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-10, -71);
  ctx.lineTo(7, -71);
  ctx.stroke();
}

function drawBoxerCharacter() {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.strokeStyle = "#171515";
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(-11, -2);
  ctx.lineTo(-24, 20);
  ctx.moveTo(11, -2);
  ctx.lineTo(27, 20);
  ctx.stroke();

  const vest = ctx.createLinearGradient(-25, -60, 25, 4);
  vest.addColorStop(0, "#432923");
  vest.addColorStop(0.52, "#a94c2d");
  vest.addColorStop(1, "#3a2522");
  ctx.fillStyle = vest;
  ctx.strokeStyle = "#ffc36a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-23, -54);
  ctx.quadraticCurveTo(0, -65, 23, -54);
  ctx.lineTo(27, -11);
  ctx.lineTo(12, 5);
  ctx.lineTo(-15, 4);
  ctx.lineTo(-28, -12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#6c3525";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(-20, -47);
  ctx.lineTo(-37, -30);
  ctx.moveTo(20, -47);
  ctx.lineTo(38, -30);
  ctx.stroke();
  ctx.fillStyle = "#e77937";
  ctx.strokeStyle = "#ffd38a";
  ctx.lineWidth = 3;
  for (const x of [-41, 41]) {
    ctx.beginPath();
    ctx.roundRect(x - 12, -40, 24, 25, 7);
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = "#ba7653";
  ctx.strokeStyle = "#171515";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, -72, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#272020";
  ctx.beginPath();
  ctx.arc(-2, -78, 14, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-9, -66, 18, 4);
  ctx.fillStyle = "#ffd166";
  ctx.fillRect(-5, -37, 10, 18);
}

function drawEnemyCharacter() {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.strokeStyle = "#160c10";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(-10, -4);
  ctx.lineTo(-18, 20);
  ctx.moveTo(10, -4);
  ctx.lineTo(19, 20);
  ctx.stroke();

  ctx.strokeStyle = "#ec7d77";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-24, -48);
  ctx.lineTo(-43, -18);
  ctx.moveTo(24, -48);
  ctx.lineTo(46, -20);
  ctx.stroke();

  const armor = ctx.createLinearGradient(-24, -62, 25, 4);
  armor.addColorStop(0, "#3a1821");
  armor.addColorStop(0.5, "#9e3442");
  armor.addColorStop(1, "#2a141b");
  ctx.fillStyle = armor;
  ctx.strokeStyle = "#ff817a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-24, -58);
  ctx.lineTo(-34, -47);
  ctx.lineTo(-22, -9);
  ctx.lineTo(0, 7);
  ctx.lineTo(23, -9);
  ctx.lineTo(34, -47);
  ctx.lineTo(23, -58);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#14141b";
  ctx.beginPath();
  ctx.moveTo(-13, -56);
  ctx.lineTo(13, -56);
  ctx.lineTo(8, -11);
  ctx.lineTo(-7, -11);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffcc62";
  ctx.shadowColor = "#ff5c57";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(0, -35, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#21151b";
  ctx.strokeStyle = "#ff817a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-17, -73);
  ctx.lineTo(-10, -87);
  ctx.lineTo(-2, -82);
  ctx.lineTo(9, -90);
  ctx.lineTo(17, -72);
  ctx.lineTo(10, -58);
  ctx.lineTo(-11, -58);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#ffcc62";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-9, -70);
  ctx.lineTo(9, -70);
  ctx.stroke();

  ctx.strokeStyle = "#cfd8d8";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(35, -33);
  ctx.lineTo(55, 13);
  ctx.stroke();
  ctx.strokeStyle = "#ff817a";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(31, -39);
  ctx.lineTo(39, -28);
  ctx.stroke();
}

function drawUnit(unit, side, color) {
  let pos = cellCenter(side, unit.col, unit.row);
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
  const lift = side === "enemy" && state.enemy.airborne > 0 ? 24 : 0;
  const depth = clamp((pos.y - BOARD_TOP_LEFT.y) / (BOARD_BOTTOM_LEFT.y - BOARD_TOP_LEFT.y), 0, 1);
  const scale = 0.88 + depth * 0.14;
  const idle = paused ? 0 : Math.sin(performance.now() / 230 + (side === "enemy" ? 1.4 : 0)) * 1.5;
  ctx.save();
  ctx.translate(pos.x, pos.y - lift + idle);
  ctx.scale(scale, scale);
  const blink = side === "player" && state.player.invuln > 0 && Math.floor(performance.now() / 70) % 2 === 0;
  ctx.globalAlpha = blink ? 0.45 : 1;

  ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
  ctx.beginPath();
  ctx.ellipse(0, 20 + lift / scale - idle, 40, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  if (side === "enemy") drawEnemyCharacter();
  else if (selectedClass === "swordsman") drawSwordsmanCharacter();
  else if (selectedClass === "boxer") drawBoxerCharacter();
  else drawAdeptCharacter();

  if (side === "player" && state.player.shield > 0) {
    ctx.strokeStyle = "#32d58a";
    ctx.lineWidth = 4;
    ctx.shadowColor = "#32d58a";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, -35, 49, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  if (side === "player" && state.player.counter > 0) {
    ctx.strokeStyle = "#c79cff";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, -35, 54, -Math.PI * 0.85, Math.PI * 0.35);
    ctx.stroke();
  }
  ctx.restore();

  const hp = side === "player" ? state.player.hp : state.enemy.hp;
  const maxHp = side === "player" ? playerMaxHp() : ENEMY_MAX_HP;
  const shield = side === "player" ? state.player.shield : 0;
  drawHpBar(pos.x, pos.y + 27, 78, hp, maxHp, shield);

  if (side === "enemy") {
    const labels = [];
    if (state.enemy.stun > 0) labels.push("暈眩");
    if (state.enemy.airborne > 0) labels.push("浮空");
    if (state.enemy.slow > 0) labels.push("緩速");
    if (state.enemy.root > 0) labels.push("定身");
    if (labels.length) {
      ctx.fillStyle = "#f1c94c";
      ctx.font = "700 14px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(labels.join(" / "), pos.x, pos.y - 94 - lift);
      ctx.textAlign = "left";
    }
  }
}

function drawProjectiles() {
  for (const projectile of state.projectiles) {
    ctx.fillStyle = projectile.color;
    ctx.shadowColor = projectile.color;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
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
  "knockback"
]);

function drawEffects(layer = "under") {
  for (const effect of state.effects) {
    const isForeground = FOREGROUND_EFFECT_KINDS.has(effect.kind);
    if ((layer === "over") !== isForeground) continue;
    const progress = 1 - effect.time / effect.duration;
    if (effect.kind === "burst") {
      ctx.strokeStyle = effect.color;
      ctx.globalAlpha = 1 - progress;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, 18 + progress * 42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
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
      ctx.fillStyle = "#eefeff";
      ctx.strokeStyle = "#173742";
      ctx.lineWidth = 4;
      ctx.font = "900 18px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.strokeText("BREAK", 0, -29);
      ctx.fillText("BREAK", 0, -29);
      ctx.restore();
    }
    if (effect.kind === "swordHit") {
      const reach = 30 + progress * 26;
      ctx.save();
      ctx.translate(effect.x, effect.y);
      ctx.globalAlpha = 1 - progress;
      ctx.lineCap = "round";
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 6 - progress * 3;
      ctx.beginPath();
      ctx.moveTo(-reach, -reach * 0.7);
      ctx.lineTo(reach, reach * 0.7);
      ctx.moveTo(-reach, reach * 0.7);
      ctx.lineTo(reach, -reach * 0.7);
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-reach * 0.7, -reach * 0.5);
      ctx.lineTo(reach * 0.7, reach * 0.5);
      ctx.stroke();
      ctx.restore();
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
      ctx.fillStyle = `${effect.color}55`;
      for (const row of effect.rows) {
        if (row < 0 || row >= ROWS) continue;
        for (let offset = 0; offset < effect.width; offset += 1) {
          drawPolygon(cellPolygon(effect.side, effect.col + offset, row));
          ctx.fill();
        }
      }
    }
    if (effect.kind === "swordWave") {
      const start = midpoint(boardPoint(COLS_PER_SIDE, effect.row), boardPoint(COLS_PER_SIDE, effect.row + 1));
      const end = midpoint(boardPoint(COLS_PER_SIDE * 2, effect.row), boardPoint(COLS_PER_SIDE * 2, effect.row + 1));
      const sweep = lerpPoint(start, end, progress);
      ctx.save();
      ctx.globalAlpha = 1 - progress * 0.55;
      ctx.fillStyle = "rgba(248, 223, 114, 0.28)";
      for (let col = 0; col < COLS_PER_SIDE; col += 1) {
        drawPolygon(cellPolygon("enemy", col, effect.row, 6));
        ctx.fill();
      }
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y + 14);
      ctx.lineTo(sweep.x, sweep.y - 14);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(start.x + (sweep.x - start.x) * 0.65, start.y + 10);
      ctx.lineTo(sweep.x + 40, sweep.y - 18);
      ctx.stroke();
      ctx.restore();
    }
    if (effect.kind === "rowPulse") {
      ctx.save();
      ctx.fillStyle = `${effect.color}33`;
      for (let col = 0; col < COLS_PER_SIDE; col += 1) {
        drawPolygon(cellPolygon("enemy", col, effect.row, 5));
        ctx.fill();
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
      ctx.strokeStyle = "#ffd166";
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
      ctx.strokeStyle = "#ff6b57";
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
      ctx.strokeStyle = effect.color || "#ff6255";
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.45 + Math.sin(performance.now() / 70) * 0.25;
      drawPolygon(cellPolygon(effect.side, effect.col, effect.row, 8));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (effect.kind === "tileTelegraph") {
      const pulse = 0.28 + Math.sin(performance.now() / 55) * 0.12;
      ctx.fillStyle = `rgba(255, 98, 85, ${pulse})`;
      drawPolygon(cellPolygon(effect.side, effect.col, effect.row, 4));
      ctx.fill();
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 3;
      drawPolygon(cellPolygon(effect.side, effect.col, effect.row, 8));
      ctx.stroke();
    }
    if (effect.kind === "columnTelegraph") {
      const pulse = 0.24 + Math.sin(performance.now() / 55) * 0.1;
      for (const row of effect.rows) {
        if (row < 0 || row >= ROWS) continue;
        ctx.fillStyle = `rgba(255, 141, 99, ${pulse})`;
        drawPolygon(cellPolygon(effect.side, effect.col, row, 4));
        ctx.fill();
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 3;
        drawPolygon(cellPolygon(effect.side, effect.col, row, 8));
        ctx.stroke();
      }
    }
    if (effect.kind === "damageNumber") {
      ctx.save();
      ctx.globalAlpha = 1 - progress;
      ctx.fillStyle = effect.color;
      ctx.strokeStyle = effect.stroke;
      ctx.lineWidth = 4;
      ctx.font = `800 ${effect.size}px Segoe UI, sans-serif`;
      ctx.textAlign = "center";
      const y = effect.y - progress * 34;
      ctx.strokeText(effect.text, effect.x, y);
      ctx.fillText(effect.text, effect.x, y);
      ctx.restore();
    }
    if (effect.kind === "knockback") {
      const from = cellCenter("enemy", effect.fromCol, effect.row);
      const to = cellCenter("enemy", effect.toCol, effect.row);
      const sweepX = from.x + (to.x - from.x) * progress;
      ctx.strokeStyle = effect.color || "#f1c94c";
      ctx.globalAlpha = 1 - progress;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y - 10);
      ctx.lineTo(sweepX, from.y + (to.y - from.y) * progress - 10);
      ctx.stroke();
      ctx.fillStyle = effect.color || "#f1c94c";
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

function drawText() {
  ctx.fillStyle = "rgba(7, 13, 17, 0.78)";
  ctx.fillRect(28, 24, 694, 78);
  ctx.fillStyle = classes[selectedClass].color;
  ctx.fillRect(28, 24, 6, 78);
  ctx.strokeStyle = "rgba(220, 238, 238, 0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(28.5, 24.5, 693, 77);

  ctx.fillStyle = "#eef5f7";
  ctx.font = "700 25px Segoe UI, Microsoft JhengHei, sans-serif";
  ctx.fillText(classes[selectedClass].name, 46, 56);
  ctx.font = "700 11px Segoe UI, sans-serif";
  ctx.fillStyle = classes[selectedClass].color;
  ctx.fillText("GRID COMBAT / LIVE", 46, 76);
  ctx.font = "14px Segoe UI, Microsoft JhengHei, sans-serif";
  ctx.fillStyle = "#c6d3da";
  drawWrappedText(state.message, 190, 54, 510, 21, 2);

  ctx.fillStyle = "rgba(238, 245, 247, 0.72)";
  ctx.font = "700 12px Segoe UI, sans-serif";
  ctx.fillText("PLAYER FIELD", boardPoint(0, 0).x, BOARD_TOP_LEFT.y - 16);
  ctx.fillText("ENEMY FIELD", boardPoint(COLS_PER_SIDE, 0).x, BOARD_TOP_LEFT.y - 16);

  if (state.phase !== "playing") {
    ctx.fillStyle = "rgba(10, 12, 14, 0.72)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = state.phase === "win" ? "#32d58a" : "#ff6255";
    ctx.font = "800 56px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(state.phase === "win" ? "VICTORY" : "DEFEAT", canvas.width / 2, 292);
    ctx.font = "20px Segoe UI, sans-serif";
    ctx.fillStyle = "#eef5f7";
    ctx.fillText("按下方重新開始", canvas.width / 2, 334);
    ctx.textAlign = "left";
  }
  if (paused) {
    ctx.fillStyle = "rgba(10, 12, 14, 0.78)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#eef5f7";
    ctx.font = "800 52px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", canvas.width / 2, 292);
    ctx.font = "18px Segoe UI, sans-serif";
    ctx.fillStyle = "#c6d3da";
    ctx.fillText("按 P 或 Escape 繼續", canvas.width / 2, 334);
    ctx.textAlign = "left";
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawGrid("player");
  drawGrid("enemy");
  drawSwordsmanAim();
  drawEffects("under");
  drawTeleportStrikeWarning();
  drawUnit(state.player, "player", classes[selectedClass].color);
  drawUnit(state.enemy, "enemy", "#ff6255");
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

function renderHand() {
  handEl.innerHTML = "";
  state.player.hand.forEach((card, index) => {
    if (!card) {
      const slot = document.createElement("div");
      slot.className = "card-slot";
      slot.textContent = `空槽 ${index + 1}`;
      handEl.append(slot);
      return;
    }
    const button = document.createElement("button");
    button.className = "card";
    button.type = "button";
    button.disabled = paused || state.phase !== "playing";
    button.dataset.class = selectedClass;
    button.dataset.card = card.id;
    button.dataset.tone = card.tone || "utility";
    button.setAttribute("aria-label", `第 ${index + 1} 格，${card.name}，${card.tag}`);
    button.innerHTML = `<strong>${index + 1}. ${card.name}<small>${card.tag}</small></strong><span>${card.description}</span>`;
    button.addEventListener("click", () => castCard(index));
    handEl.append(button);
  });
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
  paused = !paused;
  keys.clear();
  touchStart = null;
  sfxPause();
  syncPauseButton();
  renderHand();
}

function restartGame() {
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
  const key = event.key.toLowerCase();
  if (["arrowleft", "arrowright", "arrowup", "arrowdown", " ", "w", "a", "s", "d"].includes(key)) {
    event.preventDefault();
  }
  keys.add(key);
  if (key === "p" || key === "escape") { togglePause(); return; }
  if (paused) return;
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
window.addEventListener("resize", syncInputMode);
document.addEventListener("visibilitychange", () => {
  keys.clear();
  if (document.hidden && state.phase === "playing" && !paused) togglePause();
});

restartButton.addEventListener("click", restartGame);
pauseButton.addEventListener("click", togglePause);
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

renderHand();
syncHud();
syncClassButtons();
syncPauseButton();
syncInputMode();
requestAnimationFrame(loop);
