const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

const chargeFill = document.querySelector("#chargeFill");
const chargeText = document.querySelector("#chargeText");
const playerHpText = document.querySelector("#playerHp");
const enemyHpText = document.querySelector("#enemyHp");
const handEl = document.querySelector("#hand");
const restartButton = document.querySelector("#restart");
const classButtons = [...document.querySelectorAll(".class-button")];
const mobileInputQuery = window.matchMedia("(pointer: coarse)");

const COLS_PER_SIDE = 4;
const ROWS = 4;
const HAND_SIZE = 4;
const TILE_W = 100;
const TILE_H = 55;
const GRID_X = 128;
const GRID_Y = 206;
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
        description: "攻擊敵方前兩格，造成 44 傷害並短暫定身。",
        cast(game) {
          const rows = [game.player.row - 1, game.player.row, game.player.row + 1];
          addSlashEffect(rows, 0, 2, "#50bcff");
          if (rows.includes(game.enemy.row) && game.enemy.col <= 1) {
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
        description: "瞬間掃過整列的劍氣，造成 24 傷害並使敵人浮空 1 秒。",
        cast(game) {
          const row = game.player.row;
          game.effects.push({
            kind: "swordWave",
            row,
            color: "#f8df72",
            time: 0.18,
            duration: 0.18
          });
          if (game.enemy.row === row) {
            applyEnemyDamage(24, { kind: "skill" });
            game.enemy.airborne = 1;
            game.enemy.stun = Math.max(game.enemy.stun, 0.35);
            const pos = cellCenter("enemy", game.enemy.col, game.enemy.row);
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
        description: "以目前準心為中心砍擊豎三格，浮空中命中會傷害加倍並擊飛。",
        cast(game) {
          const aim = swordsmanAimCell();
          const rows = [aim.row - 1, aim.row, aim.row + 1];
          addSlashEffect(rows, aim.col, 1, "#f1c94c", aim.side);
          if (aim.side === "enemy" && game.enemy.col === aim.col && rows.includes(game.enemy.row)) {
            hitEnemyWithSkill(30, { combo: true, color: "#f1c94c" });
          }
        }
      },
      {
        id: "thrust",
        name: "追風突刺",
        tag: "穿刺",
        description: "突刺準心格與其左側一格，造成 28 傷害並定身 4 秒。",
        cast(game) {
          const aim = swordsmanAimCell();
          const hitCols = [aim.col - 1, aim.col];
          addSlashEffect([aim.row], Math.max(0, aim.col - 1), Math.min(2, aim.col + 1), "#dff8f2", aim.side);
          if (aim.side === "enemy" && game.enemy.row === aim.row && hitCols.includes(game.enemy.col)) {
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
      if (target.side === "enemy" && game.enemy.col === target.col && game.enemy.row === targetRow) {
        hitEnemyWithSkill(14, { charge: 42, color: "#f1c94c", kind: "basic" });
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
        description: "攻擊準心格與左側一格，造成 20 傷害並定身 4 秒。",
        cast(game) {
          const aim = combatAimCell();
          const startCol = Math.max(0, aim.col - 1);
          addSlashEffect([aim.row], startCol, aim.col - startCol + 1, "#f6d365", aim.side);
          if (aim.side === "enemy" && game.enemy.row === aim.row && [aim.col - 1, aim.col].includes(game.enemy.col)) {
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
  return cell.side === "enemy" && state.enemy.col === cell.col && state.enemy.row === cell.row;
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
  return area.side === "enemy" && area.cols.includes(state.enemy.col) && area.rows.includes(state.enemy.row);
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
    return;
  }
  const deck = classes[selectedClass].deck;
  const card = deck[Math.floor(Math.random() * deck.length)];
  state.player.hand[slot] = card;
  state.message = `抽到 ${card.name}，放入第 ${slot + 1} 格`;
  renderHand();
}

function gainCharge(amount) {
  state.player.charge += amount;
  while (state.player.charge >= 100) {
    state.player.charge -= 100;
    drawCard();
  }
}

function hitEnemyWithSkill(baseDamage, options = {}) {
  const combo = options.combo && state.enemy.airborne > 0;
  const resolved = applyEnemyDamage(combo ? baseDamage * 2 : baseDamage, {
    kind: options.kind || "skill",
    big: options.big || combo,
    forceCrit: options.forceCrit
  });
  if (options.charge) gainCharge(options.charge);

  const pos = cellCenter("enemy", state.enemy.col, state.enemy.row);
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
  if (state.phase !== "playing" || state.player.attackCooldown > 0) return;
  state.player.attackCooldown = selectedClass === "swordsman" ? 0.28 : 0.34;
  classes[selectedClass].basicAttack(state);
}

function castCard(index) {
  if (state.phase !== "playing") return;
  const card = state.player.hand[index];
  if (!card) return;
  state.player.hand[index] = null;
  card.cast(state);
  if (card.id !== "sword-qi" && !state.message.includes("擊飛聯招") && !state.message.includes("浮空")) {
    state.message = `施放 ${card.name}`;
  }
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
  const pos = cellCenter("enemy", state.enemy.col, state.enemy.row);
  addDamageNumber(pos.x, pos.y - 72, damage, { kind, big: big || crit });
  if (state.enemy.hp <= 0) {
    state.phase = "win";
    state.message = "勝利：模板完成，可以開始加關卡與卡池";
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
  const blocked = Math.min(state.player.shield, amount);
  state.player.shield -= blocked;
  state.player.hp = Math.max(0, state.player.hp - (amount - blocked));
  state.player.invuln = 0.38;
  if (state.player.hp <= 0) {
    state.phase = "lose";
    state.message = "戰敗：按重新開始再試一次";
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
  return mobileInputQuery.matches || navigator.maxTouchPoints > 0;
}

function syncInputMode() {
  mobileInputEnabled = detectMobileInput();
  document.body.classList.toggle("mobile-input", mobileInputEnabled);
}

function handleBoardPointerDown(event) {
  if (!mobileInputEnabled || event.pointerType === "mouse") return;
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
  const swipeThreshold = 28;

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
  if (keys.has("arrowleft") || keys.has("a")) movePlayer(-1, 0);
  if (keys.has("arrowright") || keys.has("d")) movePlayer(1, 0);
  if (keys.has("arrowup") || keys.has("w")) movePlayer(0, -1);
  if (keys.has("arrowdown") || keys.has("s")) movePlayer(0, 1);
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
  if (enemy.stun > 0 || enemy.airborne > 0) return;

  const speed = enemy.slow > 0 ? 0.42 : 1;
  enemy.specialCooldown = Math.max(0, enemy.specialCooldown - dt * speed);

  if (enemy.special) {
    updateEnemySpecial(enemy, dt * speed);
    return;
  }

  if (enemy.specialCooldown <= 0) {
    startEnemySpecial();
    return;
  }

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
      const enemyCenter = cellCenter("enemy", state.enemy.col, state.enemy.row);
      if (Math.hypot(projectile.x - enemyCenter.x, projectile.y - (enemyCenter.y - 18)) < 35) {
        projectile.dead = true;
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

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#3f78a9");
  sky.addColorStop(0.32, "#9cd4e9");
  sky.addColorStop(0.33, "#284354");
  sky.addColorStop(1, "#131b23");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(238, 252, 255, 0.86)";
  for (let i = 0; i < 9; i += 1) {
    const x = i * 142 - 40;
    ctx.beginPath();
    ctx.moveTo(x, 156);
    ctx.lineTo(x + 82, 44 + (i % 3) * 14);
    ctx.lineTo(x + 166, 156);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = "#1d2a33";
  ctx.fillRect(0, 180, canvas.width, 288);
  ctx.fillStyle = "#dff8f2";
  ctx.fillRect(112, 188, 928, 12);
  ctx.fillStyle = "#4fe8c8";
  ctx.fillRect(108, 204, 936, 12);
  ctx.fillStyle = "#dff8f2";
  ctx.fillRect(116, 470, 928, 12);
  ctx.fillStyle = "#4fe8c8";
  ctx.fillRect(112, 452, 936, 12);
}

function drawGrid(side) {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS_PER_SIDE; col += 1) {
      ctx.fillStyle = side === "player" ? "rgba(24, 55, 66, 0.76)" : "rgba(62, 34, 39, 0.76)";
      drawPolygon(cellPolygon(side, col, row));
      ctx.fill();
    }
  }

  const startCol = side === "player" ? 0 : COLS_PER_SIDE;
  const endCol = startCol + COLS_PER_SIDE;
  ctx.strokeStyle = side === "player" ? "#3d7890" : "#913f4b";
  ctx.lineWidth = 2;

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

function drawHpBar(x, y, width, hp, maxHp, shield = 0) {
  const pct = clamp(hp / maxHp, 0, 1);
  ctx.fillStyle = "rgba(6, 9, 12, 0.86)";
  ctx.fillRect(x - width / 2, y, width, 7);
  ctx.fillStyle = pct > 0.35 ? "#32d58a" : "#ff6255";
  ctx.fillRect(x - width / 2, y, width * pct, 7);
  if (shield > 0) {
    ctx.fillStyle = "#50bcff";
    ctx.fillRect(x - width / 2, y - 7, width * clamp(shield / 60, 0, 1), 5);
  }
  ctx.strokeStyle = "#dff8f2";
  ctx.lineWidth = 1;
  ctx.strokeRect(x - width / 2, y, width, 7);
}

function drawUnit(unit, side, color) {
  let pos = cellCenter(side, unit.col, unit.row);
  if (side === "enemy" && state.enemy.visualKnockback) {
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
  ctx.save();
  ctx.translate(pos.x, pos.y - lift);
  const blink = side === "player" && state.player.invuln > 0 && Math.floor(performance.now() / 70) % 2 === 0;
  ctx.globalAlpha = blink ? 0.45 : 1;

  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.beginPath();
  ctx.ellipse(0, 16 + lift, 34, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.strokeStyle = "#f7fbff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(-22, -52, 44, 64, 9);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#101214";
  ctx.fillRect(side === "player" ? 7 : -16, -34, 9, 9);
  if (side === "player" && state.player.shield > 0) {
    ctx.strokeStyle = "#32d58a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, -22, 39, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (side === "player" && state.player.counter > 0) {
    ctx.strokeStyle = "#c79cff";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, -22, 44, -Math.PI * 0.85, Math.PI * 0.35);
    ctx.stroke();
  }
  ctx.restore();

  const hp = side === "player" ? state.player.hp : state.enemy.hp;
  const maxHp = side === "player" ? playerMaxHp() : ENEMY_MAX_HP;
  const shield = side === "player" ? state.player.shield : 0;
  drawHpBar(pos.x, pos.y + 24, 64, hp, maxHp, shield);

  if (side === "enemy") {
    const labels = [];
    if (state.enemy.airborne > 0) labels.push("浮空");
    if (state.enemy.slow > 0) labels.push("緩速");
    if (state.enemy.root > 0) labels.push("定身");
    if (labels.length) {
      ctx.fillStyle = "#f1c94c";
      ctx.font = "700 14px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(labels.join(" / "), pos.x, pos.y - 68 - lift);
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

function drawEffects() {
  for (const effect of state.effects) {
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

function drawText() {
  ctx.fillStyle = "#eef5f7";
  ctx.font = "700 27px Segoe UI, sans-serif";
  ctx.fillText(`${classes[selectedClass].name} Prototype`, 42, 58);
  ctx.font = "16px Segoe UI, sans-serif";
  ctx.fillStyle = "#c6d3da";
  ctx.fillText(state.message, 42, 86);

  ctx.fillStyle = "rgba(238, 245, 247, 0.72)";
  ctx.font = "13px Segoe UI, sans-serif";
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
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawGrid("player");
  drawGrid("enemy");
  drawSwordsmanAim();
  drawEffects();
  drawUnit(state.player, "player", classes[selectedClass].color);
  drawUnit(state.enemy, "enemy", "#ff6255");
  drawProjectiles();
  drawText();
}

function syncHud() {
  const chargePercent = Math.round(state.player.charge);
  chargeFill.style.width = `${chargePercent}%`;
  chargeText.textContent = `${chargePercent}%`;
  playerHpText.textContent = state.player.shield > 0
    ? `${state.player.hp} +${state.player.shield}`
    : String(state.player.hp);
  enemyHpText.textContent = String(state.enemy.hp);
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
    button.innerHTML = `<strong>${index + 1}. ${card.name}<small>${card.tag}</small></strong><span>${card.description}</span>`;
    button.addEventListener("click", () => castCard(index));
    handEl.append(button);
  });
}

function syncClassButtons() {
  classButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.class === selectedClass);
  });
}

function restartGame() {
  state = createInitialState();
  renderHand();
  syncHud();
  syncClassButtons();
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (["arrowleft", "arrowright", "arrowup", "arrowdown", " ", "w", "a", "s", "d"].includes(key)) {
    event.preventDefault();
  }
  keys.add(key);
  if (key === "j" || key === " ") playerBasicAttack();
  if (key === "1") castCard(0);
  if (key === "2") castCard(1);
  if (key === "3") castCard(2);
  if (key === "4") castCard(3);
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

restartButton.addEventListener("click", restartGame);
canvas.addEventListener("pointerdown", handleBoardPointerDown);
canvas.addEventListener("pointerup", handleBoardPointerUp);
canvas.addEventListener("pointercancel", cancelBoardPointer);
mobileInputQuery.addEventListener("change", syncInputMode);

classButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedClass = button.dataset.class;
    restartGame();
  });
});

renderHand();
syncHud();
syncClassButtons();
syncInputMode();
requestAnimationFrame(loop);
