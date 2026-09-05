(() => {
  "use strict";
  const action = document.querySelector("#action");
  const playing = document.querySelector("#playing");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const figures = [...document.querySelectorAll("canvas")].map((canvas) => ({
    canvas, ctx: canvas.getContext("2d"), character: canvas.dataset.character, unit: { hp: 100 }
  }));
  let elapsed = 0;
  let previous = performance.now();
  playing.checked = !motion.matches;

  function restart() {
    elapsed = playing.checked ? 0 : action.value === "charge" ? 1 : action.value === "airborne" ? 0.8 : 0.24;
    for (const figure of figures) {
      figure.unit = { hp: 100, artClock: 0 };
      const kind = action.value;
      if (["attack", "cast", "guard"].includes(kind)) CharacterArt.play(figure.unit, kind, 0.7);
      if (kind === "charge") CharacterArt.play(figure.unit, "charge", 2.54, 2);
      CharacterArt.update(figure.unit, elapsed);
      if (kind === "hurt") figure.unit.artHurt = 0.24;
    }
    render();
  }

  function render() {
    for (const { canvas, ctx, character, unit } of figures) {
      const dpr = Math.min(devicePixelRatio || 1, 2.5);
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(width * 350 / 320);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width; canvas.height = height;
      }
      ctx.setTransform(width / 320, 0, 0, height / 350, 0, 0);
      ctx.clearRect(0, 0, 320, 350);
      ctx.strokeStyle = "#354047";
      ctx.lineWidth = 1;
      const anchorX = character === "enemy" ? 192 : 128;
      ctx.beginPath(); ctx.ellipse(anchorX, 310, 58, 10, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#10161b";
      ctx.beginPath(); ctx.ellipse(anchorX, 310, 36, 6, 0, 0, Math.PI * 2); ctx.fill();
      const airborne = action.value === "airborne" ? Math.sin(elapsed * Math.PI / 1.8) ** 2 : 0;
      unit.airborne = airborne;
      ctx.save(); ctx.translate(anchorX, 290 - airborne * 32);
      CharacterArt.draw(ctx, character, unit, {
        scale: 1.3,
        reducedMotion: motion.matches,
        channelRemaining: action.value === "channel" && character === "boxer" ? 1.6 - elapsed : 0
      });
      ctx.restore();
    }
  }

  function loop(now) {
    const dt = Math.min(0.033, (now - previous) / 1000);
    previous = now;
    if (playing.checked && !document.hidden) {
      elapsed += dt;
      const cycle = action.value === "charge" ? 3.4 : action.value === "channel" ? 2.2 : 1.8;
      if (elapsed > cycle) restart();
      for (const figure of figures) CharacterArt.update(figure.unit, dt);
    }
    render();
    requestAnimationFrame(loop);
  }
  action.addEventListener("change", restart);
  new ResizeObserver(render).observe(document.querySelector(".roster"));
  restart();
  requestAnimationFrame(loop);
})();
