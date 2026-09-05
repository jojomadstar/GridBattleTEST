const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const scope = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../character-art.js"), "utf8"), scope);
const art = scope.window.CharacterArt;

for (const character of Object.keys(art.palettes)) {
  for (const kind of ["attack", "slash", "cast", "charge", "guard", "move"]) {
    const unit = { hp: 100, col: 2, row: 1 };
    art.play(unit, kind, 0.54, 0.2);
    for (let frame = 0; frame < 60; frame += 1) {
      art.update(unit, 1 / 60);
      const pose = art.sample(character, unit);
      for (const value of Object.values(pose)) {
        if (typeof value === "number") assert.ok(Number.isFinite(value));
        if (Array.isArray(value)) value.forEach((n) => assert.ok(Number.isFinite(n)));
      }
    }
    assert.equal(unit.artAction, null);
    assert.equal(unit.hp, 100);
    assert.equal(unit.col, 2);
    assert.equal(unit.row, 1);
  }
}

const unit = { hp: 100 };
art.play(unit, "attack");
art.play(unit, "move");
assert.equal(unit.artAction.kind, "attack", "Movement must not cancel the attack pose");
art.play(unit, "charge", 2.54, 2);
art.play(unit, "attack");
assert.equal(unit.artAction.kind, "charge");
assert.equal(art.sample("boxer", unit).name, "charge");
art.update(unit, 2.1);
assert.equal(art.sample("boxer", unit).name, "cast");
unit.stun = 1;
assert.equal(art.sample("enemy", unit, { teleportWarning: true }).name, "hurt");
unit.stun = 0;
unit.artHurt = 0.24;
assert.equal(art.sample("tangmen", unit).name, "hurt");
unit.hp = 0;
art.update(unit, 0.4);
assert.equal(art.sample("enemy", unit).name, "down");
assert.equal(art.sample("enemy", unit).still, true);
assert.equal(art.sample("boxer", { hp: 100 }, { channelRemaining: 1 }).name, "channel");
assert.equal(art.sample("swordsman", { hp: 100 }, { reducedMotion: true }).still, true);
console.log("Character art: 24 animation paths, combat-state priority and hitbox invariants passed.");
