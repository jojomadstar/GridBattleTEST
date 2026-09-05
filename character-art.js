(() => {
  "use strict";

  const paths = new Map();
  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const palettes = {
    tangmen: { cloth: "#246e6b", light: "#71b9ab", shade: "#102e36", trim: "#b8d3cd", accent: "#55d5b3", hair: "#17232e", hairLight: "#476075", skin: "#edc2a7", skinShade: "#a86655" },
    swordsman: { cloth: "#e1e9df", light: "#fffbed", shade: "#8dabb0", trim: "#c5ae73", accent: "#43ad9d", hair: "#192330", hairLight: "#4f657b", skin: "#efd0b4", skinShade: "#b77f67" },
    boxer: { cloth: "#9b3040", light: "#e77362", shade: "#481d30", trim: "#d8b273", accent: "#f3bd78", hair: "#242432", hairLight: "#5e5362", skin: "#dda17c", skinShade: "#915444" },
    enemy: { cloth: "#7d263e", light: "#c24a58", shade: "#271c32", trim: "#9eb8ca", accent: "#ec6a74", hair: "#d1e0e5", hairLight: "#f5f5ea", skin: "#d2c5c0", skinShade: "#8c7889" }
  };

  function shape(c, data, fill, stroke = "#101925", width = 1.1) {
    let path = paths.get(data);
    if (!path) { path = new Path2D(data); paths.set(data, path); }
    if (fill) { c.fillStyle = fill; c.fill(path); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(path); }
  }

  function gradient(c, x, y, x2, y2, colors) {
    const g = c.createLinearGradient(x, y, x2, y2);
    colors.forEach((color, i) => g.addColorStop(i / (colors.length - 1), color));
    return g;
  }

  function line(c, points, color, width = 1) {
    c.beginPath();
    c.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) c.lineTo(points[i][0], points[i][1]);
    c.strokeStyle = color; c.lineWidth = width; c.stroke();
  }

  function ellipse(c, x, y, rx, ry, fill, rotation = 0) {
    c.beginPath(); c.ellipse(x, y, rx, ry, rotation, 0, TAU);
    c.fillStyle = fill; c.fill();
  }

  const neutral = {
    tangmen: { front: [30, -77], rear: [-24, -76], blade: -0.7 },
    swordsman: { front: [29, -77], rear: [-22, -72], blade: -0.83 },
    boxer: { front: [35, -106], rear: [0, -113], blade: 0 },
    enemy: { front: [31, -77], rear: [-22, -94], blade: -0.78 }
  };

  function target(character, name) {
    const base = { ...neutral[character], lean: 0, crouch: 0, spread: 0, head: 0,
      palm: 0, weaponBack: 0, energy: 0, stride: 0 };
    const sword = character === "swordsman" || character === "enemy";
    if (name === "guard") return { ...base, front: sword ? [29, -99] : [27, -108],
      rear: [-9, -101], blade: -1.04, crouch: 3, spread: 2 };
    if (name === "windup") return { ...base, front: sword ? [-22, -114] : [4, -108],
      rear: [14, -97], blade: -2.82, lean: -0.11, crouch: 5, spread: 4, head: 0.04 };
    if (name === "strike") return { ...base, front: [65, -109], rear: [-32, -103],
      blade: -0.12, lean: 0.14, crouch: 7, spread: 11, head: -0.08 };
    if (name === "charge") return { ...base, front: [21, -91], rear: [-5, -90],
      blade: 1.08, weaponBack: 1, crouch: 7, spread: 4, palm: 1, energy: 1, head: 0.08 };
    if (name === "cast") return { ...base, front: [61, -105],
      rear: character === "boxer" ? [43, -91] : [-25, -76], blade: 1.02,
      weaponBack: 1, lean: 0.1, crouch: 5, spread: 7, palm: 1, energy: 0.7, head: -0.05 };
    if (name === "hurt") return { ...base, front: [12, -91], rear: [-26, -78],
      blade: 0.97, lean: -0.19, crouch: 10, head: -0.12, spread: 3 };
    if (name === "down") return { ...base, front: [31, -48], rear: [-8, -56],
      blade: 0.22, lean: 0.32, crouch: 33, head: 0.33, spread: -4 };
    return base;
  }

  function blend(a, b, t) {
    t = clamp(t, 0, 1);
    const out = {};
    for (const key of Object.keys(a)) out[key] = Array.isArray(a[key])
      ? a[key].map((n, i) => mix(n, b[key][i], t)) : mix(a[key], b[key], t);
    return out;
  }

  function sample(character, unit = {}, options = {}) {
    const clock = unit.artClock || 0;
    const idle = target(character, options.aiming || options.defending ? "guard" : "idle");
    let pose = idle;
    let name = "idle";
    const action = unit.artAction;
    if (action) {
      const t = clamp(action.elapsed / action.duration, 0, 1);
      if (action.kind === "attack" || action.kind === "slash") {
        name = "attack";
        if (action.kind === "slash") {
          pose = blend(target(character, "strike"), idle, smooth((t - 0.22) / 0.78));
        } else if (t < 0.18) {
          pose = blend(idle, target(character, "windup"), smooth(t / 0.18));
        } else if (t < 0.4) {
          pose = blend(target(character, "windup"), target(character, "strike"), smooth((t - 0.18) / 0.22));
        } else pose = blend(target(character, "strike"), idle, smooth((t - 0.48) / 0.52));
      } else if (action.kind === "cast") {
        name = "cast";
        pose = blend(target(character, "cast"), idle, smooth((t - 0.32) / 0.68));
      } else if (action.kind === "charge") {
        name = action.elapsed < action.chargeTime ? "charge" : "cast";
        pose = action.elapsed < action.chargeTime
          ? blend(idle, target(character, "charge"), smooth(action.elapsed / 0.16))
          : blend(target(character, "cast"), idle, smooth((action.elapsed - action.chargeTime - 0.14) / 0.4));
      } else if (action.kind === "guard") {
        name = "guard"; pose = target(character, "guard");
      } else if (action.kind === "move") {
        name = "move"; pose = { ...idle, crouch: Math.sin(t * Math.PI) * 3, stride: Math.sin(t * Math.PI) * 6 };
      }
    }
    if (options.channelRemaining > 0) {
      name = "channel";
      pose = blend(target(character, "windup"), target(character, "strike"),
        (Math.sin(clock * 40) + 1) / 2);
      if (options.channelRemaining < 0.2) pose = target(character, "cast");
    }
    if (options.teleportWarning) {
      name = "windup"; pose = target(character, "windup");
    }
    if (unit.stun > 0 || unit.airborne > 0 || unit.visualKnockback) {
      name = "hurt"; pose = target(character, "hurt");
    } else if (unit.artHurt > 0) {
      name = "hurt";
      pose = blend(pose, target(character, "hurt"), Math.sin(clamp(unit.artHurt / 0.24, 0, 1) * Math.PI / 2));
    }
    if (unit.hp <= 0) {
      name = "down";
      pose = blend(target(character, "hurt"), target(character, "down"), smooth((unit.artDead || 0) / 0.4));
    }
    return { ...pose, name, clock, still: Boolean(options.reducedMotion || unit.hp <= 0) };
  }

  function play(unit, kind, duration = 0.4, chargeTime = 0) {
    if (unit.hp <= 0) return;
    if (unit.artAction && (kind === "move" || kind === "attack"
      && ["charge", "cast"].includes(unit.artAction.kind))) return;
    unit.artAction = { kind, duration, elapsed: 0, chargeTime };
  }

  function update(unit, dt) {
    unit.artClock = (unit.artClock || 0) + dt;
    unit.artHurt = Math.max(0, (unit.artHurt || 0) - dt);
    if (unit.hp <= 0) unit.artDead = (unit.artDead || 0) + dt;
    if (unit.artAction) {
      unit.artAction.elapsed += dt;
      if (unit.artAction.elapsed >= unit.artAction.duration) unit.artAction = null;
    }
  }

  function hairBack(c, p, pose, character) {
    if (character === "boxer") {
      shape(c, "M-10 -141 L-29 -127 L-20 -130 L-30 -113 L-17 -121 L-13 -113 L-7 -130 Z", p.hair, "#111a25", 0.9);
      return;
    }
    if (character === "tangmen") {
      shape(c, "M-8 -145 Q-30 -145 -28 -124 L-34 -112 L-24 -117 L-24 -105 L-12 -118 L-6 -130 Z",
        gradient(c, -28, -132, -5, -120, [p.hairLight, p.hair]), "#111a25", 0.9);
      line(c, [[-13, -141], [-22, -133], [-26, -117]], p.hairLight, 0.8);
      return;
    }
    const wind = pose.still ? 0 : Math.sin(pose.clock * 2.8) * 3;
    c.save(); c.translate(-5, -142);
    c.beginPath(); c.moveTo(4, 0);
    c.bezierCurveTo(-18, -15, -42, 10, -33 + wind, 30);
    c.bezierCurveTo(-28, 47, -43 + wind, 68, -55, 78);
    c.bezierCurveTo(-21, 64, -13, 46, -18, 30);
    c.bezierCurveTo(-20, 15, 0, 13, 4, 0);
    c.fillStyle = gradient(c, -45, 20, 2, 25, [p.hair, p.hairLight, p.hair]);
    c.fill(); c.strokeStyle = "#111a25"; c.lineWidth = 1; c.stroke();
    c.strokeStyle = p.hairLight; c.lineWidth = 0.75;
    for (let i = 0; i < 3; i += 1) {
      c.beginPath(); c.moveTo(-3 - i * 3, 2);
      c.bezierCurveTo(-32 - i * 2, 12, -20 + wind - i * 3, 45, -43 + i * 4, 66);
      c.stroke();
    }
    c.restore();
  }

  function coatTails(c, p, pose, character) {
    const wave = pose.still ? 0 : Math.sin(pose.clock * 3 + 0.7) * 3;
    c.save(); c.translate(0, pose.crouch * 0.65);
    const extent = character === "boxer" ? 0.48 : 1;
    c.translate(-4, -59); c.scale(1, extent);
    c.beginPath(); c.moveTo(-10, -7); c.lineTo(16, -4);
    c.bezierCurveTo(12, 20, 28 + wave, 32, 31 + wave, 55);
    c.lineTo(7, 43); c.lineTo(-2, 62);
    c.bezierCurveTo(-11, 45, -31 - wave, 55, -42 - wave, 60);
    c.bezierCurveTo(-31, 28, -21, 4, -10, -7);
    c.closePath();
    c.fillStyle = gradient(c, -24, 4, 18, 48, [p.shade, p.cloth, p.shade]);
    c.fill(); c.strokeStyle = "#101925"; c.lineWidth = 1.3; c.stroke();
    c.beginPath(); c.moveTo(-8, 0); c.bezierCurveTo(-10, 23, -23, 43, -36 - wave, 54);
    c.moveTo(13, 2); c.bezierCurveTo(12, 25, 22, 37, 26 + wave, 47);
    c.strokeStyle = p.trim; c.lineWidth = 1.2; c.stroke();
    c.restore();
  }

  function segment(c, from, to, r1, r2, light, dark, trim) {
    c.save(); c.translate(from[0], from[1]);
    c.rotate(Math.atan2(to[1] - from[1], to[0] - from[0]));
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    c.beginPath(); c.moveTo(-1, -r1);
    c.quadraticCurveTo(length * 0.52, -r1 * 1.08, length, -r2);
    c.lineTo(length + 1, r2);
    c.quadraticCurveTo(length * 0.55, r1 * 0.82, -1, r1);
    c.closePath(); c.fillStyle = gradient(c, 0, -r1, 0, r1, [light, dark]);
    c.fill(); c.strokeStyle = "#111925"; c.lineWidth = 1.25; c.stroke();
    if (trim) line(c, [[2, -r1 + 1], [length - 2, -r2 + 1]], trim, 0.8);
    c.restore();
  }

  function legs(c, p, pose, character) {
    const strong = character === "boxer";
    for (const side of [-1, 1]) {
      const hip = [side * 8 + pose.lean * 10, -59 + pose.crouch];
      const foot = [side * (23 + pose.spread) + pose.stride * side, -5];
      const knee = [side * (16 + pose.spread * 0.8) + pose.lean * 10, -30 + pose.crouch * 0.6];
      segment(c, hip, knee, strong ? 11 : 8.4, strong ? 9 : 6.7, "#3b4857", "#121d2b", "#6c7c86");
      segment(c, knee, foot, strong ? 8.3 : 6.6, 5.2, "#283746", "#0e1723", null);
      c.save(); c.translate(foot[0], foot[1]);
      shape(c, "M-5 -18 L6 -17 L5 -3 Q9 0 15 1 L16 5 Q4 7 -7 4 L-6 -3 Z",
        gradient(c, -5, -10, 10, 2, ["#364653", "#121a27"]), "#101720", 1.2);
      line(c, [[-5, -13], [4, -14], [3, -5]], p.trim, 1.2);
      line(c, [[-5, 3], [7, 4], [14, 3]], "#83939a", 0.8);
      if (strong) {
        for (let j = 0; j < 3; j += 1) line(c, [[-5, -17 + j * 3], [5, -19 + j * 3]], "#bdbfb1", 1.6);
      }
      c.restore();
    }
  }

  function sash(c, p, pose, character) {
    const wave = pose.still ? 0 : Math.sin(pose.clock * 3.3) * 2;
    c.save(); c.translate(-8, -60);
    c.beginPath(); c.moveTo(4, 0); c.lineTo(-3, 5);
    c.bezierCurveTo(-17, 10, -24, 21 + wave, -45, 18 + wave);
    c.lineTo(-40, 26 + wave);
    c.bezierCurveTo(-20, 32 + wave, -8, 12, 5, 7); c.closePath();
    c.fillStyle = character === "swordsman" ? "#388d86" : p.light;
    c.fill(); c.strokeStyle = p.shade; c.lineWidth = 1; c.stroke();
    c.restore();
  }

  function torso(c, p, character) {
    const strong = character === "boxer";
    if (strong) {
      shape(c, "M-18 -112 Q-6 -119 6 -116 L22 -107 Q19 -93 14 -80 L11 -61 Q0 -56 -13 -62 L-17 -83 Q-24 -100 -18 -112 Z",
        gradient(c, -18, -105, 20, -77, [p.skinShade, p.skin, "#edba94", p.skinShade]));
      shape(c, "M-13 -105 Q-5 -113 3 -106 L2 -93 Q-7 -89 -14 -95 Z", "#e5ad86", null);
      shape(c, "M4 -106 Q13 -110 18 -102 L14 -91 Q9 -90 3 -94 Z", "#f1bf94", null);
      line(c, [[-13, -94], [-5, -92], [1, -94], [3, -104]], "#9a6251", 1);
      line(c, [[4, -94], [12, -92], [16, -95]], "#9a6251", 1);
      line(c, [[2, -89], [1, -77], [0, -66]], "#a46951", 0.8);
      for (let y = -86; y < -65; y += 8) {
        line(c, [[-8, y], [-3, y + 2]], "#ad755b", 0.8);
        line(c, [[4, y + 2], [9, y]], "#ad755b", 0.8);
      }
      shape(c, "M-17 -113 L-9 -112 Q-15 -94 -12 -75 L-15 -53 L-24 -58 Q-23 -89 -25 -105 Z",
        gradient(c, -25, -108, -10, -70, [p.light, p.cloth, p.shade]));
      shape(c, "M11 -114 L22 -109 L25 -101 L17 -88 L15 -62 L10 -60 L9 -79 L15 -100 Z", p.cloth);
      line(c, [[-11, -111], [-17, -91], [-16, -64]], p.trim, 1.2);
      line(c, [[11, -111], [18, -102], [13, -86]], p.trim, 1.2);
    } else {
      shape(c, "M-16 -110 L-5 -118 L6 -116 L20 -108 L18 -91 L11 -60 Q1 -56 -13 -61 L-19 -87 Z",
        gradient(c, -21, -96, 20, -81, [p.shade, p.cloth, p.light, p.cloth]));
      shape(c, "M-3 -116 L8 -112 L8 -96 L-7 -72 L-13 -76 Z", "#202d39", null);
      shape(c, "M-6 -115 L-11 -111 L2 -91 L7 -99 Z", "#f0ebd8", null);
      shape(c, "M9 -113 L14 -108 L-10 -76 L-14 -80 Z", p.light, p.shade, 0.7);
      line(c, [[11, -109], [2, -94], [-10, -78]], p.trim, 1.1);
      line(c, [[-13, -95], [-10, -87]], p.light, 0.8);
      line(c, [[12, -86], [7, -66]], p.shade, 1.2);
      if (character === "enemy") {
        shape(c, "M-14 -108 L-3 -113 L12 -107 L17 -91 L6 -75 L-8 -79 L-17 -94 Z",
          gradient(c, -16, -98, 12, -82, ["#1c2637", "#4d586c", "#20263b"]));
        shape(c, "M-10 -101 L1 -107 L12 -98 L6 -85 L-4 -81 L-11 -90 Z", "#343b50", p.trim, 0.85);
        line(c, [[-9, -97], [1, -91], [11, -97]], p.trim, 1);
        shape(c, "M1 -98 L5 -92 L1 -86 L-3 -92 Z", p.accent, null);
      }
      // Front split panels show the legs instead of forming a single bell-shaped robe.
      shape(c, "M-13 -62 L-2 -58 Q-6 -40 -17 -13 L-29 -5 Q-24 -35 -13 -62 Z",
        gradient(c, -27, -34, 0, -33, [p.shade, p.cloth, p.light]));
      shape(c, "M2 -59 L12 -62 Q13 -34 23 -15 L10 -20 L1 -35 Z", p.cloth);
      line(c, [[-10, -56], [-17, -24], [-25, -9]], p.trim, 1.2);
      line(c, [[10, -56], [10, -35], [19, -19]], p.trim, 1);
      line(c, [[-15, -38], [-17, -25]], p.light, 1);
    }
    shape(c, "M-15 -64 Q-2 -61 13 -65 L14 -56 Q0 -51 -16 -57 Z", "#1a2837", p.trim, 0.9);
    shape(c, "M-3 -63 L5 -63 L8 -58 L4 -53 L-4 -54 L-6 -59 Z", p.trim, "#344551", 0.8);
    shape(c, "M-1 -61 L3 -61 L5 -58 L2 -55 L-2 -57 Z", p.accent, null);
    line(c, [[7, -54], [11, -41], [9, -32]], p.trim, 0.8);
    shape(c, "M9 -37 L13 -32 L10 -24 L7 -31 Z", p.accent, "#153540", 0.7);
  }

  function shoulder(c, p, x, y, enemy) {
    c.save(); c.translate(x, y);
    shape(c, enemy ? "M-12 4 L-15 -5 L-6 -14 L8 -7 L15 6 L4 13 Z"
      : "M-11 3 L-8 -7 L0 -10 L10 -5 L13 7 L5 12 Z",
    gradient(c, -10, -8, 11, 9, ["#687c8c", "#c3d4d7", "#34495b"]), "#152635", 1.1);
    shape(c, "M-6 -3 L1 -6 L8 1 L5 7 L-2 5 Z", p.shade, p.trim, 0.8);
    line(c, [[-10, 3], [-2, 9], [8, 6]], "#e0e4d7", 0.8);
    c.restore();
  }

  // Two-bone arm joints retain limb lengths as the hand follows an animated target.
  function armJoints(shoulderPoint, handTarget, bend, length1 = 25, length2 = 25) {
    const dx = handTarget[0] - shoulderPoint[0], dy = handTarget[1] - shoulderPoint[1];
    const distance = clamp(Math.hypot(dx, dy), 5, length1 + length2 - 0.01);
    const angle = Math.atan2(dy, dx);
    const offset = Math.acos(clamp((length1 * length1 + distance * distance - length2 * length2)
      / (2 * length1 * distance), -1, 1));
    const elbow = [shoulderPoint[0] + Math.cos(angle + offset * bend) * length1,
      shoulderPoint[1] + Math.sin(angle + offset * bend) * length1];
    const hand = [shoulderPoint[0] + Math.cos(angle) * distance,
      shoulderPoint[1] + Math.sin(angle) * distance];
    return { elbow, hand };
  }

  function hand(c, p, x, y, angle, palm, boxer) {
    c.save(); c.translate(x, y); c.rotate(angle);
    if (palm) {
      shape(c, "M-3 -4 Q0 -6 3 -3 L8 -8 Q10 -9 10 -7 L6 -2 L11 -3 Q13 -2 11 0 L6 2 L10 3 Q11 5 8 5 L2 6 L-4 3 Z", p.skin, p.skinShade, 0.8);
      line(c, [[0, -1], [3, 1], [1, 3]], p.skinShade, 0.7);
    } else {
      shape(c, boxer ? "M-4 -6 L4 -7 L9 -3 L9 4 L4 7 L-4 5 L-6 0 Z"
        : "M-4 -4 L3 -5 L6 -1 L5 4 L0 5 L-4 2 Z", p.skin, "#674b46", 0.85);
      line(c, [[0, -3], [3, -2], [4, 0]], "#f4d2ac", 1);
      if (boxer) {
        shape(c, "M-4 -6 L2 -6 L5 5 L-3 5 Z", "#e3dfc9", "#949b94", 0.7);
        line(c, [[-3, -2], [2, -3]], "#899693", 0.7);
        line(c, [[-2, 2], [3, 1]], "#899693", 0.7);
      }
    }
    c.restore();
  }

  function arm(c, p, character, shoulderPoint, destination, bend, pose, front) {
    const strong = character === "boxer";
    const joints = armJoints(shoulderPoint, destination, bend, strong ? 26 : 24, 26);
    segment(c, shoulderPoint, joints.elbow, strong ? 8.2 : 7, strong ? 6.3 : 6.8,
      strong ? p.skin : p.light, strong ? p.skinShade : p.shade, strong ? null : p.trim);
    if (!strong && character === "swordsman") {
      c.save(); c.translate(joints.elbow[0], joints.elbow[1]);
      shape(c, "M-6 -3 L6 1 Q8 13 1 22 L-9 14 Z", p.cloth, p.shade, 0.9);
      line(c, [[-6, 2], [-3, 15], [2, 18]], p.light, 1); c.restore();
    }
    segment(c, joints.elbow, joints.hand, strong ? 6.5 : 5.3, strong ? 5.4 : 4,
      strong ? p.skin : p.cloth, strong ? p.skinShade : p.shade, null);
    const angle = Math.atan2(joints.hand[1] - joints.elbow[1], joints.hand[0] - joints.elbow[0]);
    c.save(); c.translate(joints.hand[0], joints.hand[1]); c.rotate(angle);
    shape(c, "M-18 -6 L-3 -5 L-3 5 L-18 7 L-21 0 Z",
      gradient(c, -10, -6, -10, 7, [strong ? "#eee0bd" : p.trim, "#4b5b69", "#243644"]), "#182633", 0.9);
    for (let i = 0; i < 3; i += 1) line(c, [[-16 + i * 4, -4], [-14 + i * 4, 4]], strong ? "#d9bc86" : "#93afb7", 0.8);
    if (character === "tangmen") {
      shape(c, "M-19 -5 L-1 -6 L8 -2 L-18 -1 Z", "#c0d6d5", "#32515a", 0.8);
      shape(c, "M-16 -8 L-2 -8 L1 -6 L-18 -5 Z", "#416b71", p.trim, 0.7);
      line(c, [[-9, -8], [1, -13], [5, -6]], p.trim, 1);
    }
    c.restore();
    hand(c, p, joints.hand[0], joints.hand[1], angle, pose.palm > 0.5 && front, strong);
    if (character === "tangmen" && front && pose.palm < 0.5) {
      c.save(); c.translate(joints.hand[0], joints.hand[1]); c.rotate(angle - 0.25);
      for (let i = 0; i < 3; i += 1) {
        c.rotate(0.18);
        shape(c, "M2 -1 L14 -1 L21 0 L14 1 L2 1 Z", "#d3ebe4", "#35585f", 0.45);
      }
      c.restore();
    }
    return joints.hand;
  }

  function blade(c, p, at, angle, enemy, clock) {
    c.save(); c.translate(at[0], at[1]); c.rotate(angle);
    if (enemy) {
      shape(c, "M4 -2 Q28 -9 61 -14 Q53 0 33 4 L4 4 Z",
        gradient(c, 20, -12, 20, 6, ["#f1f5eb", "#a3bed0", "#4d647c"]), "#314b62", 0.85);
      shape(c, "M8 -1 Q35 -4 56 -11 Q35 2 8 2 Z", "#dce9e8", null);
    } else {
      shape(c, "M5 -3 L56 -3 L67 0 L56 3 L5 3 Z",
        gradient(c, 20, -3, 20, 3, ["#f8ffef", "#c8e3e5", "#6b919f"]), "#466674", 0.75);
      line(c, [[8, 0], [63, 0]], "#fafff4", 0.8);
    }
    shape(c, "M2 -8 L5 -6 L6 6 L2 9 L-1 7 L0 -6 Z", p.trim, "#48545a", 0.8);
    shape(c, "M-12 -2 L1 -2 L1 2 L-12 2 L-15 0 Z", "#26404d", p.trim, 0.8);
    for (let i = -10; i < 0; i += 3) line(c, [[i, -2], [i + 1, 2]], p.trim, 0.7);
    c.beginPath(); c.moveTo(-14, 1); c.quadraticCurveTo(-22, 12, -31, 9 + Math.sin(clock * 4) * 3);
    c.strokeStyle = p.accent; c.lineWidth = 1.8; c.stroke(); c.restore();
  }

  function head(c, p, pose, character) {
    c.save(); c.translate(3, -128); c.rotate(pose.head);
    shape(c, "M-6 9 L6 8 L8 19 L-7 22 Z", p.skinShade, "#1b2530", 0.8);
    shape(c, "M-8 -11 Q-4 -20 6 -14 L11 -7 L10 -1 L12 3 L10 5 L9 12 L2 16 L-5 11 L-9 3 Z",
      gradient(c, -8, 0, 11, -2, [p.skinShade, p.skin, "#f5dbc2"]), "#4c4148", 0.85);
    shape(c, "M-8 -3 Q-14 -5 -11 4 L-7 7 Z", p.skin, p.skinShade, 0.75);
    line(c, [[-10, 0], [-9, 3]], p.skinShade, 0.75);
    shape(c, "M9 5 L7 9 L2 11 L4 14 L9 11 Z", p.skinShade, null);
    if (character === "enemy") {
      shape(c, "M-6 -9 L3 -13 L11 -8 L10 -1 L6 4 L-1 2 L-7 -3 Z",
        gradient(c, -6, -8, 10, 2, ["#71849a", "#f5eddf", "#bed1d8"]), "#6c7f91", 0.85);
      shape(c, "M0 -4 L9 -5 L7 -1 L2 0 Z", "#382b42", null);
      line(c, [[3, -3], [7, -3]], "#e98993", 1.2);
      line(c, [[-3, -7], [0, -2], [-1, 1]], "#8a9bac", 0.7);
    } else {
      shape(c, "M1 -3 L8 -4 L6 -1 L2 -1 Z", "#ffefdf", null);
      line(c, [[0, -4], [4, -5], [9, -5]], "#242a35", 1.1);
      ellipse(c, 6, -2.8, 1.15, 1.05, "#223440");
      line(c, [[0, -8], [7, -9]], p.hair, 1.25);
      line(c, [[-5, -5], [-2, -5.5]], "#35404a", 0.8);
      line(c, [[9, -1], [8, 3], [10, 4]], p.skinShade, 0.65);
    }
    line(c, [[3, 8.5], [7, 8]], "#8a5354", 0.85);
    line(c, [[4, 10], [6, 10]], "#f4d2b8", 0.6);
    // Swept, overlapping hair masses frame a three-quarter face rather than a round head.
    shape(c, character === "boxer"
      ? "M-10 5 L-16 -4 L-12 -9 L-17 -16 L-8 -15 L-9 -23 L0 -19 L5 -24 L7 -20 L15 -16 L11 -7 L8 -11 L3 -6 L4 -12 L-4 -6 L-6 3 Z"
      : "M-10 5 Q-16 -1 -13 -14 Q-7 -24 5 -20 L13 -13 L11 -7 L8 -12 Q6 -6 -1 0 L1 -10 Q-5 -2 -9 9 Z",
      gradient(c, -13, -15, 9, 0, [p.hairLight, p.hair, p.hair]), "#101a26", 0.9);
    if (character !== "boxer") {
      shape(c, "M-12 -12 Q-20 -16 -16 -24 Q-11 -29 -7 -22 L-5 -17 Z", p.hair, "#111b27", 0.8);
      line(c, [[-15, -20], [-8, -23], [-6, -20]], p.trim, 1.3);
      shape(c, "M-9 -27 L-5 -25 L-8 -19 L-11 -21 Z", p.accent, "#2a4657", 0.6);
    }
    shape(c, character === "boxer" || character === "tangmen"
      ? "M-10 -5 Q-14 3 -9 12 L-7 14 L-7 3 L-4 0 Z"
      : "M-10 -5 Q-15 6 -11 21 L-6 30 Q-8 13 -4 0 Z", p.hair, null);
    c.beginPath(); c.moveTo(-11, -12); c.quadraticCurveTo(-3, -22, 7, -15);
    c.moveTo(-9, -5); c.quadraticCurveTo(-4, -9, -2, -14);
    c.strokeStyle = p.hairLight; c.lineWidth = 0.8; c.stroke();
    if (character === "boxer") {
      shape(c, "M-11 -10 L7 -15 L10 -11 L-10 -6 Z", p.cloth, null);
      line(c, [[-10, -9], [7, -13]], p.trim, 0.8);
    }
    c.restore();
  }

  function scarf(c, p, character, pose) {
    if (character === "boxer") return;
    if (character === "tangmen") {
      shape(c, "M-8 -115 Q1 -108 10 -114 L14 -107 L7 -98 L-12 -101 L-18 -110 Z",
        gradient(c, -14, -114, 12, -100, [p.light, p.cloth, p.shade]), "#163c44", 0.9);
      line(c, [[-11, -109], [0, -105], [10, -109]], "#a5d2bb", 1);
    }
    const wave = pose.still ? 0 : Math.sin(pose.clock * 2.4 + 1) * 4;
    c.beginPath(); c.moveTo(-13, -111); c.lineTo(-8, -106);
    c.bezierCurveTo(-21, -92, -40, -94 + wave, -59, -84 + wave);
    c.lineTo(-50, -98 + wave);
    c.bezierCurveTo(-39, -101 + wave, -28, -101, -13, -111);
    c.closePath(); c.fillStyle = character === "enemy" ? p.cloth : p.accent;
    c.fill(); c.strokeStyle = p.shade; c.lineWidth = 0.8; c.stroke();
    if (character === "swordsman") {
      line(c, [[-15, -109], [-28, -101], [-45, -97 + wave]], p.trim, 0.6);
    }
  }

  function skillMarks(c, p, pose, frontHand, character) {
    if (pose.energy < 0.15) return;
    c.save(); c.translate(frontHand[0], frontHand[1]);
    c.rotate(pose.clock * 0.5); c.globalAlpha *= 0.55 * pose.energy;
    c.strokeStyle = p.accent; c.lineWidth = 1;
    const radius = character === "boxer" ? 15 : 12;
    // Small angular hand seals stay local to the casting hand, clear of floor warnings.
    for (let i = 0; i < 4; i += 1) {
      c.rotate(Math.PI / 2);
      line(c, [[radius - 3, -5], [radius + 2, 0], [radius - 3, 5]], p.accent, 1);
    }
    c.restore();
  }

  function draw(c, character, unit, options = {}) {
    const p = palettes[character] || palettes.tangmen;
    const pose = sample(character, unit, options);
    const facing = character === "enemy" ? -1 : 1;
    const scale = options.scale || (character === "enemy" ? 0.82 : 0.78);
    c.save(); c.translate(0, 18); c.scale(facing * scale, scale);
    c.lineCap = "round"; c.lineJoin = "round";
    coatTails(c, p, pose, character);
    legs(c, p, pose, character);
    c.save(); c.translate(pose.lean * 12, -59 + pose.crouch); c.rotate(pose.lean); c.translate(0, 59);
    const breath = pose.still ? 0 : Math.sin(pose.clock * 3.2) * 0.5;
    c.translate(0, breath);
    hairBack(c, p, pose, character);
    const rearHand = arm(c, p, character, [-15, -107], pose.rear, 1, pose, false);
    if (pose.weaponBack > 0.5 && ["swordsman", "enemy"].includes(character)) {
      blade(c, p, rearHand, pose.blade, character === "enemy", pose.clock);
    }
    torso(c, p, character);
    sash(c, p, pose, character);
    if (character === "enemy") shoulder(c, p, -16, -108, true);
    head(c, p, pose, character);
    scarf(c, p, character, pose);
    const frontHand = arm(c, p, character, [15, -107], pose.front, 1, pose, true);
    if (character === "enemy" || character === "tangmen") shoulder(c, p, 15, -108, character === "enemy");
    if (pose.weaponBack <= 0.5 && ["swordsman", "enemy"].includes(character)) {
      blade(c, p, frontHand, pose.blade, character === "enemy", pose.clock);
      hand(c, p, frontHand[0], frontHand[1], 0, false, false);
    }
    skillMarks(c, p, pose, frontHand, character);
    c.restore(); c.restore();
    return pose;
  }

  window.CharacterArt = { draw, play, update, sample, palettes };
})();
