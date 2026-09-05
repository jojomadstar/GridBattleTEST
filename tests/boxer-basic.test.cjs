const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Run the real game logic with only browser UI/audio entry points stubbed out.
class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.style = {}; this.className = "";
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        if (enabled ?? !names.has(name)) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
      }
    };
  }
  append(...children) { this.children.push(...children); children.forEach((child) => { child.parent = this; }); }
  replaceChild(next, current) { this.children[this.children.indexOf(current)] = next; next.parent = this; }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  get lastChild() { return this.children.at(-1); }
  getContext() { return { setTransform() {} }; }
  getBoundingClientRect() { return { width: 1152, height: 648 }; }
  addEventListener() {}
  setAttribute() {}
}
const elements = new Map();
const scope = {
  console, URLSearchParams, performance: { now: () => 0 },
  location: { search: "", protocol: "file:" }, navigator: { maxTouchPoints: 0 },
  localStorage: { getItem: () => "1", setItem() {} }, requestAnimationFrame() {},
  document: {
    body: new Element(), addEventListener() {},
    createElement: () => new Element(), createTextNode: () => new Element(),
    querySelector: (selector) => {
      if (!elements.has(selector)) elements.set(selector, new Element());
      return elements.get(selector);
    },
    querySelectorAll: () => []
  },
  matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {},
  innerWidth: 1152, devicePixelRatio: 1
};
scope.window = scope;
vm.createContext(scope);
for (const file of ["character-art.js", "game.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), scope, { filename: file });
}
const run = (code) => vm.runInContext(code, scope);
const value = (code) => JSON.parse(JSON.stringify(run(code)));
const reset = () => run("selectedClass = 'boxer'; restartGame(); Math.random = () => 0.5;");
let tests = 0;
function test(name, fn) { reset(); fn(); tests += 1; console.log(`PASS ${name}`); }

test("All same-row positions lock the enemy and return to the exact original cell", () => {
  for (let row = 0; row < 4; row += 1) for (let home = 0; home < 4; home += 1) for (let enemy = 0; enemy < 4; enemy += 1) {
    reset();
    run(`state.player.row=${row}; state.player.col=${home}; state.enemy.row=${row}; state.enemy.col=${enemy}; playerBasicAttack();`);
    assert.deepEqual(value("combatAimCell()"), { side: "enemy", col: enemy, row });
    assert.deepEqual(value("playerCombatCell()"), { side: enemy ? "enemy" : "player", col: enemy ? enemy - 1 : 3, row });
    assert.equal(run("state.enemy.hp"), 600, "No damage before the punch lands");
    run("updateBoxerStrike(BOXER_STRIKE_IMPACT);");
    assert.equal(run("state.enemy.hp"), 582);
    assert.equal(run("state.player.charge"), 90);
    run("updateBoxerStrike(BOXER_STRIKE_DURATION);");
    assert.equal(run("state.enemy.hp"), 582, "One hit per attack");
    assert.deepEqual(value("playerCombatCell()"), { side: "player", col: home, row });
    assert.equal(run("state.player.boxerStrike"), null);
  }
});

test("Different rows do not track and a miss grants no damage or charge", () => {
  run("state.player.col=2; state.player.row=3; state.enemy.row=0; state.enemy.col=0; playerBasicAttack();");
  assert.deepEqual(value("combatAimCell()"), { side: "enemy", col: 2, row: 3 });
  run("updateBoxerStrike(0.5);");
  assert.equal(run("state.enemy.hp"), 600);
  assert.equal(run("state.player.charge"), 0);
  assert.deepEqual(value("playerCombatCell()"), { side: "player", col: 2, row: 3 });
});

test("A target that leaves the locked cell before impact can dodge", () => {
  run("state.enemy.row=state.player.row; playerBasicAttack(); state.enemy.col=3; updateBoxerStrike(0.2);");
  assert.equal(run("state.enemy.hp"), 600);
  assert.equal(run("state.player.charge"), 0);
  assert.equal(run("combatAimCell().col"), 2);
});

test("An enemy entering the selected cell is checked at impact time", () => {
  run("playerBasicAttack(); state.enemy.col=1; state.enemy.row=2; updateBoxerStrike(0.2);");
  assert.equal(run("state.enemy.hp"), 582);
  assert.equal(run("state.player.charge"), 90);
});

test("A teleporting enemy is targeted at its visible cell, not its saved origin", () => {
  run("state.enemy.teleportStrike={landing:{side:'player',col:2,row:2}}; playerBasicAttack(); updateBoxerStrike(0.2);");
  assert.deepEqual(value("playerCombatCell()"), { side: "player", col: 1, row: 2 });
  assert.equal(run("state.enemy.hp"), 582);
});

test("Two hits draw a card using the existing 100-energy meter cap", () => {
  run("state.enemy.row=state.player.row; playerBasicAttack(); updateBoxerStrike(0.5); state.player.attackCooldown=0; playerBasicAttack(); updateBoxerStrike(0.5);");
  assert.equal(run("state.player.charge"), 0);
  assert.equal(run("state.player.hand.filter(Boolean).length"), 1);
});

test("No overlapping attacks, movement, or card consumption during the round trip", () => {
  run("state.player.hand[0]=classes.boxer.deck[4]; playerBasicAttack(); movePlayer(1,0); castCard(0); state.player.attackCooldown=0; playerBasicAttack();");
  assert.equal(run("state.player.col"), 1);
  assert.equal(run("state.player.hand[0].id"), "breathing");
  assert.equal(run("state.player.boxerStrike.elapsed"), 0);
  assert.equal(run("state.effects.filter(e=>e.kind==='target').length"), 1);
  assert.equal(elements.get("#hand").children[0].disabled, true);
  run("updateBoxerStrike(0.5);");
  assert.equal(elements.get("#hand").children[0].disabled, false);
  run("movePlayer(1,0);");
  assert.equal(run("state.player.col"), 2);
});

test("Pause freezes the attack and resume completes the return", () => {
  run("playerBasicAttack(); updateBoxerStrike(0.05); togglePause(); updateBoxerStrike(1);");
  assert.equal(run("state.player.boxerStrike.elapsed"), 0.05);
  run("togglePause(); updateBoxerStrike(0.5);");
  assert.equal(run("state.player.boxerStrike"), null);
});

test("Channeling cannot trigger a teleport or consume the basic cooldown", () => {
  run("state.effects.push({kind:'boxerChannel',time:1}); playerBasicAttack();");
  assert.equal(run("state.player.boxerStrike"), null);
  assert.equal(run("state.player.attackCooldown"), 0);
});

test("Lethal incoming damage cancels a pending hit and returns home", () => {
  run("state.enemy.row=state.player.row; playerBasicAttack(); damagePlayer(999); updateBoxerStrike(0.5);");
  assert.equal(run("state.phase"), "lose");
  assert.equal(run("state.enemy.hp"), 600);
  assert.equal(run("state.player.boxerStrike"), null);
  assert.equal(run("playerCombatCell().side"), "player");
});

test("Victory and restart leave no delayed attack behind", () => {
  run("state.enemy.row=state.player.row; state.enemy.hp=1; playerBasicAttack(); updateBoxerStrike(0.2); updateBoxerStrike(0.01);");
  assert.equal(run("state.phase"), "win");
  assert.equal(run("state.player.boxerStrike"), null);
  run("restartGame(); playerBasicAttack(); restartGame(); updateBoxerStrike(1);");
  assert.equal(run("state.enemy.hp"), 600);
  assert.equal(run("state.player.boxerStrike"), null);
});

test("Incoming projectiles hit the visible landing cell, not the vacant home cell", () => {
  run("state.enemy.row=2; state.enemy.col=3; playerBasicAttack(); const home=cellCenter('player',1,2); const away=playerCombatPosition(); addProjectile({owner:'enemy',x:home.x,y:home.y-18,vx:0,vy:0,damage:15}); updateProjectiles(0);");
  assert.equal(run("state.player.hp"), 180);
  run("addProjectile({owner:'enemy',x:away.x,y:away.y-18,vx:0,vy:0,damage:15}); updateProjectiles(0);");
  assert.equal(run("state.player.hp"), 165);
});

test("Tile and column hazards respect the landing side and position", () => {
  run("state.enemy.row=2; state.enemy.col=3; playerBasicAttack(); addPlayerTileTelegraph(1,2,0.01,15); updateEffects(0.02);");
  assert.equal(run("state.player.hp"), 180);
  run("addColumnTelegraph('enemy',2,[1,2,3],0.01,22); updateEffects(0.02);");
  assert.equal(run("state.player.hp"), 158);
  run("state.player.invuln=0; addPlayerTileTelegraph(2,2,0.01,13,'#f00','enemy'); updateEffects(0.02);");
  assert.equal(run("state.player.hp"), 145);
});

test("Enemy teleport warnings target the player's current temporary cell", () => {
  run("state.enemy.row=2; state.enemy.col=3; playerBasicAttack(); startTeleportStrike();");
  assert.deepEqual(value("state.enemy.teleportStrike.targetCells[1]"), { side: "enemy", col: 2, row: 2 });
  run("updateBoxerStrike(0.5); updateTeleportStrike(state.enemy,1.1);");
  assert.equal(run("state.player.hp"), 180);
});

test("Other classes retain their projectile basic attacks", () => {
  for (const role of ["tangmen", "swordsman"]) {
    run(`selectedClass='${role}'; restartGame(); playerBasicAttack();`);
    assert.equal(run("state.player.boxerStrike"), null);
    assert.equal(run("state.projectiles.length"), 1);
  }
});
console.log(`${tests} boxer regression tests passed, including 64 same-row position combinations.`);
