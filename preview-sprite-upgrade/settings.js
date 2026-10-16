/* GRINDCHAIN — Phase 3 settings (GAP-33 wiring).
   Persistence lives ONLY in Save (grindchain.save.v1, see save-schema.md).
   This module adds no second store: it reads/writes Save.data.settings
   and persists via Save.save(). It never touches save.js internals.
   Load order: save.js -> settings.js -> audio.js -> analytics.js -> app.js.

   Keys (all under Save.data.settings; legacy keys preserved untouched):
     volume     0..1, default 0.7            (master volume)
     muted      bool, default false          (mirrored to sound/music)
     quality    'low'|'med'|'high'           (legacy 'auto' reads as 'med')
     colorblind 'none'|'protan'|'deutan'|'tritan'
     textSize   'small'|'medium'|'large'
     sound/music/vibration — legacy Wave 1 booleans, kept in sync with muted.
   UI agent: read Settings.get(), render controls, call Settings.set().
   Settings.apply() tags <html> with data-colorblind / data-text-size so the
   UI stylesheet can apply filters + scale (no CSS lives in this file). */
'use strict';
const Settings = (() => {
  const DEFAULTS = Object.freeze({
    volume: 0.7, muted: false, quality: 'med',
    colorblind: 'none', textSize: 'medium',
  });
  const QUALITIES = ['low', 'med', 'high'];
  const COLORBLIND = ['none', 'protan', 'deutan', 'tritan'];
  const TEXT_SIZES = ['small', 'medium', 'large'];
  // Engine-facing budgets per quality. Engine reads these once at init
  // (particle cap + DPR cap + FX cap); changing quality mid-run applies
  // on the next run start. Values stay inside Wave 1 perf budgets.
  const CAPS = Object.freeze({
    low:  { particleCap: 80,  dprCap: 1,   fxCap: 8 },
    med:  { particleCap: 160, dprCap: 1.5, fxCap: 16 },
    high: { particleCap: 220, dprCap: 2,   fxCap: 24 },
  });
  const TEXT_SCALE = Object.freeze({ small: 0.875, medium: 1, large: 1.125 });
  const listeners = new Set();

  function store() {
    // Save is the Wave 1 module; fall back to an in-memory object if it is
    // somehow absent (tests) so Settings never throws.
    if (typeof Save !== 'undefined' && Save.data) {
      if (!Save.data.settings || typeof Save.data.settings !== 'object') Save.data.settings = {};
      return Save.data.settings;
    }
    if (!Settings._mem) Settings._mem = {};
    return Settings._mem;
  }
  function normalizeQuality(q) {
    if (q === 'auto') return 'med'; // Wave 1 default 'auto' == medium budget
    return QUALITIES.includes(q) ? q : 'med';
  }
  function clamp01(v) {
    v = Number(v);
    return (isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULTS.volume);
  }
  function get() {
    const s = store();
    return {
      volume: (typeof s.volume === 'number' && isFinite(s.volume))
        ? clamp01(s.volume) : DEFAULTS.volume,
      muted: (typeof s.muted === 'boolean') ? s.muted : !!(s.sound === false),
      quality: normalizeQuality(s.quality),
      colorblind: COLORBLIND.includes(s.colorblind) ? s.colorblind : DEFAULTS.colorblind,
      textSize: TEXT_SIZES.includes(s.textSize) ? s.textSize : DEFAULTS.textSize,
      // Legacy keys, exposed read-only for any Wave 1 reader.
      sound: (typeof s.sound === 'boolean') ? s.sound : true,
      music: (typeof s.music === 'boolean') ? s.music : true,
      vibration: (typeof s.vibration === 'boolean') ? s.vibration : true,
    };
  }
  function apply() {
    const cur = get();
    try {
      const el = document.documentElement;
      if (el) {
        el.dataset.colorblind = cur.colorblind;
        el.dataset.textSize = cur.textSize;
        el.dataset.quality = cur.quality;
      }
    } catch (e) { /* headless / no DOM: settings still persist */ }
    return cur;
  }
  function set(patch) {
    if (!patch || typeof patch !== 'object') return get();
    const s = store();
    let changed = false;
    if (patch.volume !== undefined) {
      const v = clamp01(patch.volume);
      if (s.volume !== v) { s.volume = v; changed = true; }
    }
    if (patch.muted !== undefined) {
      const m = !!patch.muted;
      if (s.muted !== m) { s.muted = m; changed = true; }
      // Keep legacy booleans consistent with muted so Wave 1 readers agree.
      if (s.sound !== !m) { s.sound = !m; changed = true; }
      if (s.music !== !m) { s.music = !m; changed = true; }
    }
    if (patch.quality !== undefined) {
      const q = normalizeQuality(patch.quality);
      if (s.quality !== q) { s.quality = q; changed = true; }
    }
    if (patch.colorblind !== undefined && COLORBLIND.includes(patch.colorblind)) {
      if (s.colorblind !== patch.colorblind) { s.colorblind = patch.colorblind; changed = true; }
    }
    if (patch.textSize !== undefined && TEXT_SIZES.includes(patch.textSize)) {
      if (s.textSize !== patch.textSize) { s.textSize = patch.textSize; changed = true; }
    }
    if (!changed) return get();
    const cur = apply();
    try { if (typeof Save !== 'undefined') Save.save(); } catch (e) {}
    try {
      if (typeof Analytics !== 'undefined' && Analytics.event) {
        Analytics.event('settings_change', {
          quality: cur.quality, colorblind: cur.colorblind,
          textSize: cur.textSize, muted: cur.muted,
          // Volume bucketed, never the exact float, to keep the log coarse.
          volumeBucket: cur.volume === 0 ? 'off' : cur.volume < 0.34 ? 'low'
            : cur.volume < 0.67 ? 'mid' : 'high',
        });
      }
    } catch (e) { /* analytics must never break settings */ }
    listeners.forEach((cb) => { try { cb(cur); } catch (e) {} });
    return cur;
  }
  function reset() {
    const s = store();
    s.volume = DEFAULTS.volume; s.muted = DEFAULTS.muted;
    s.quality = DEFAULTS.quality; s.colorblind = DEFAULTS.colorblind;
    s.textSize = DEFAULTS.textSize; s.sound = true; s.music = true;
    const cur = apply();
    try { if (typeof Save !== 'undefined') Save.save(); } catch (e) {}
    listeners.forEach((cb) => { try { cb(cur); } catch (e) {} });
    return cur;
  }
  function subscribe(cb) { if (typeof cb === 'function') listeners.add(cb); return () => listeners.delete(cb); }
  function qualityCaps(quality) { return CAPS[normalizeQuality(quality)] || CAPS.med; }
  function textScale(size) { return TEXT_SCALE[TEXT_SIZES.includes(size) ? size : 'medium']; }

  return { get, set, reset, apply, subscribe, qualityCaps, textScale, DEFAULTS };
})();
if (typeof window !== 'undefined') window.Settings = Settings;
