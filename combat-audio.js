(function (root) {
  'use strict';
  function create({ manifest, base = 'sounds/', fetcher = root.fetch?.bind(root), random = Math.random, maxVoices = 20 }) {
    const buffers = new Map(), active = new Set(), lastPlay = new Map(), lastVariant = new Map();
    let downloads, loading, context, output, generation = 0;
    const entries = Object.entries(manifest.sounds);
    function preload() {
      if (downloads) return downloads;
      const files = entries.flatMap(([, spec]) => spec.files);
      const results = new Map();
      let cursor = 0;
      downloads = Promise.all(Array.from({ length: 4 }, async () => {
        while (cursor < files.length) {
          const file = files[cursor++];
          try {
            const response = await fetcher(`${base}${file}?v=${manifest.version}`);
            if (response.ok) results.set(file, await response.arrayBuffer());
          } catch (_) { /* A failed file keeps its event on the synthesis fallback. */ }
        }
      })).then(() => results);
      return downloads;
    }
    async function load(ac, destination) {
      context = ac; output = destination;
      if (loading) return loading;
      loading = (async () => {
        const files = await preload();
        for (const [name, spec] of entries) {
          const decoded = [];
          for (const file of spec.files) {
            const bytes = files.get(file);
            if (!bytes) continue;
            try { decoded.push(await ac.decodeAudioData(bytes.slice(0))); } catch (_) {}
          }
          if (decoded.length) buffers.set(name, decoded);
        }
        // Release compressed/PCM downloads after decode; only AudioBuffers remain resident.
        files.clear();
        return buffers.size;
      })();
      return loading;
    }
    function release(item) {
      if (!active.delete(item)) return;
      item.source.disconnect(); item.gain.disconnect();
    }
    function stop(name) {
      for (const item of [...active]) {
        if (name && item.name !== name) continue;
        try { item.source.stop(); } catch (_) {}
        release(item);
      }
    }
    function stopAll() { stop(); lastPlay.clear(); generation++; }
    function play(name, power = 1) {
      const spec = manifest.sounds[name], variants = buffers.get(name);
      if (!spec || !variants || !context || context.state !== 'running') return false;
      const now = context.currentTime;
      if (now - (lastPlay.get(name) ?? -Infinity) < spec.cooldown) return true;
      const same = [...active].filter(item => item.name === name);
      if (same.length >= spec.limit) { same[0].source.stop(); release(same[0]); }
      if (active.size >= maxVoices) {
        const expendable = [...active].find(item => item.priority <= spec.priority);
        if (!expendable) return true;
        expendable.source.stop(); release(expendable);
      }
      let index = Math.floor(random() * variants.length);
      if (variants.length > 1 && index === lastVariant.get(name)) index = (index + 1) % variants.length;
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = variants[index];
      source.playbackRate.value = 1 + (random() * 2 - 1) * spec.vary;
      gain.gain.value = spec.gain * Math.min(1.25, Math.max(0, Number.isFinite(power) ? power : 1));
      source.connect(gain); gain.connect(output);
      const item = { source, gain, name, priority: spec.priority };
      source.onended = () => release(item);
      active.add(item); lastPlay.set(name, now); lastVariant.set(name, index);
      source.start(now);
      return true;
    }
    function status() { return { loaded: buffers.size, total: entries.length, active: active.size, generation }; }
    return { preload, load, play, stop, stopAll, status };
  }
  const api = { create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CombatAudio = api;
})(globalThis);
