/* GRINDCHAIN — Phase 3 audio (GAP-29). WebAudio only, fully synthesized.
   No audio assets, no downloads, nothing leaves the device.
   Global is GameAudio (NOT Audio: window.Audio is the native constructor
   and must never be shadowed). Task-spec API maps 1:1:
   Audio.init() -> GameAudio.init(), etc. See INTEGRATION doc.

   Loudness rules: every voice gain is a fixed constant (no random loudness),
   all voices pass through one master gain + compressor. Peak is capped by
   construction: master 0.9 * bus gains below, single-voice max 0.35.

   Autoplay: nothing sounds before the first user gesture. init() creates the
   context (it starts suspended until a gesture) and installs one-shot
   pointerdown/keydown listeners that unlock it. sfx()/music() before init
   are safe no-ops that lazily call init().

   Pause: visibilitychange hidden -> auto-pause (music scheduler stops,
   context suspends); visible -> auto-resume. pauseAll()/resumeAll() are the
   manual equivalents. Wave 1 pauses the sim on hidden; this pauses audio too.

   Waveform recipes: each SFX is a short envelope script — tone() = one
   oscillator with pitch glide + exp decay; noiseBurst() = filtered white
   noise with fixed gain. Music is a lookahead step sequencer (oscillators
   only). Ducking: music bus drops to 0.05 for 1.2 s on ult SFX. */
'use strict';
const GameAudio = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null;
  let noiseBuf = null, started = false, unlocked = false;
  let manualPaused = false, autoPaused = false;
  let curMusic = null, schedTimer = null, step = 0, nextNoteTime = 0;
  let duckUntil = 0;
  const VERSION = 'phase3-audio-1.0.0';

  // --- fixed SFX voice gains (constants; never random) ---
  const V = { tiny: 0.10, soft: 0.16, mid: 0.22, loud: 0.30, max: 0.35 };

  function settings() {
    try {
      if (typeof Settings !== 'undefined') return Settings.get();
      if (typeof Save !== 'undefined' && Save.data && Save.data.settings) {
        const s = Save.data.settings;
        return { volume: typeof s.volume === 'number' ? s.volume : 0.7,
          muted: !!s.muted };
      }
    } catch (e) {}
    return { volume: 0.7, muted: false };
  }
  function applyVolume() {
    if (!ctx || !master) return;
    const s = settings();
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(s.muted ? 0 : s.volume, t, 0.02);
  }
  function tone(o) {
    // o: {type, freq, freqEnd, dur, gain, delay, attack}
    if (!ctx || manualPaused || autoPaused) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, o.freq), t0);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + o.dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.gain, t0 + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g); g.connect(sfxBus);
    osc.start(t0); osc.stop(t0 + o.dur + 0.05);
  }
  function noiseBurst(o) {
    // o: {dur, gain, delay, filterFreq, filterType, q}
    if (!ctx || manualPaused || autoPaused) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filterType || 'bandpass';
    f.frequency.value = o.filterFreq || 1200;
    f.Q.value = o.q || 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t0); src.stop(t0 + o.dur + 0.05);
  }

  // --- SFX recipe table: name -> function. Every name is safe to call
  // at any time (no-ops when audio is unavailable / muted / paused). ---
  const SFX = {
    attack()  { tone({ type: 'square', freq: 220, freqEnd: 90, dur: 0.08, gain: V.soft }); },
    hit()     { tone({ type: 'triangle', freq: 180, freqEnd: 60, dur: 0.10, gain: V.mid });
                noiseBurst({ dur: 0.05, gain: 0.08, filterFreq: 2000 }); },
    kill()    { tone({ type: 'sawtooth', freq: 300, freqEnd: 40, dur: 0.25, gain: V.loud });
                noiseBurst({ dur: 0.15, gain: 0.10, filterFreq: 900 }); },
    // Faction skills: S1 quick zap, S2 heavier, ult long + ducks music.
    // RED = saw (tech buzz), BLUE = sine (magic shimmer), PURPLE = triangle (hybrid).
    skill_s1_red()    { tone({ type: 'sawtooth', freq: 440, freqEnd: 880, dur: 0.15, gain: V.mid }); },
    skill_s1_blue()   { tone({ type: 'sine', freq: 520, freqEnd: 1040, dur: 0.20, gain: V.soft });
                        tone({ type: 'sine', freq: 1560, freqEnd: 2080, dur: 0.15, gain: 0.06, delay: 0.05 }); },
    skill_s1_purple() { tone({ type: 'triangle', freq: 330, freqEnd: 660, dur: 0.18, gain: V.mid });
                        tone({ type: 'triangle', freq: 340, freqEnd: 680, dur: 0.18, gain: V.soft, delay: 0.02 }); },
    skill_s2_red()    { tone({ type: 'square', freq: 180, freqEnd: 60, dur: 0.30, gain: V.loud });
                        noiseBurst({ dur: 0.20, gain: 0.10, filterFreq: 500 }); },
    skill_s2_blue()   { noiseBurst({ dur: 0.35, gain: V.mid, filterFreq: 3000, filterType: 'highpass' });
                        tone({ type: 'sine', freq: 800, freqEnd: 200, dur: 0.35, gain: V.mid }); },
    skill_s2_purple() { tone({ type: 'sine', freq: 600, freqEnd: 120, dur: 0.30, gain: V.mid });
                        tone({ type: 'sine', freq: 1200, freqEnd: 1800, dur: 0.08, gain: V.soft }); },
    skill_ult_red()   { duck(); tone({ type: 'sawtooth', freq: 110, freqEnd: 880, dur: 0.70, gain: V.max });
                        noiseBurst({ dur: 0.50, gain: 0.14, filterFreq: 700 }); },
    skill_ult_blue()  { duck(); tone({ type: 'sine', freq: 200, freqEnd: 1600, dur: 0.80, gain: V.loud });
                        noiseBurst({ dur: 0.40, gain: 0.12, filterFreq: 1500 }); },
    skill_ult_purple(){ duck(); tone({ type: 'triangle', freq: 90, freqEnd: 900, dur: 0.45, gain: V.loud });
                        tone({ type: 'triangle', freq: 900, freqEnd: 90, dur: 0.45, gain: V.loud, delay: 0.45 }); },
    // Generic aliases (faction-agnostic callers): map to RED recipes.
    skill_s1()  { SFX.skill_s1_red(); },
    skill_s2()  { SFX.skill_s2_red(); },
    skill_ult() { SFX.skill_ult_red(); },
    potion()    { tone({ type: 'sine', freq: 500, freqEnd: 900, dur: 0.10, gain: V.soft });
                  tone({ type: 'sine', freq: 700, freqEnd: 1100, dur: 0.10, gain: V.soft, delay: 0.09 }); },
    heal()      { tone({ type: 'sine', freq: 400, freqEnd: 800, dur: 0.30, gain: V.soft });
                  tone({ type: 'sine', freq: 600, freqEnd: 1200, dur: 0.30, gain: 0.08, delay: 0.06 }); },
    revive()    { tone({ type: 'sine', freq: 262, dur: 0.15, gain: V.soft });
                  tone({ type: 'sine', freq: 392, dur: 0.15, gain: V.soft, delay: 0.14 });
                  tone({ type: 'sine', freq: 523, dur: 0.25, gain: V.soft, delay: 0.28 }); },
    pickup()    { tone({ type: 'sine', freq: 700, freqEnd: 1200, dur: 0.10, gain: V.soft }); },
    chest()     { tone({ type: 'triangle', freq: 300, dur: 0.10, gain: V.mid });
                  tone({ type: 'triangle', freq: 450, dur: 0.10, gain: V.mid, delay: 0.10 });
                  tone({ type: 'triangle', freq: 675, dur: 0.16, gain: V.mid, delay: 0.20 }); },
    draft_pick(){ tone({ type: 'sine', freq: 440, dur: 0.10, gain: V.soft });
                  tone({ type: 'sine', freq: 660, dur: 0.10, gain: V.soft, delay: 0.09 });
                  tone({ type: 'sine', freq: 880, dur: 0.16, gain: V.soft, delay: 0.18 }); },
    shop_buy()  { tone({ type: 'square', freq: 880, freqEnd: 1320, dur: 0.15, gain: V.soft });
                  tone({ type: 'sine', freq: 1760, dur: 0.12, gain: 0.08, delay: 0.05 }); },
    boss_phase(){ tone({ type: 'sawtooth', freq: 80, freqEnd: 40, dur: 0.60, gain: V.max });
                  tone({ type: 'square', freq: 55, freqEnd: 35, dur: 0.60, gain: V.mid, delay: 0.05 }); },
    boss_spawn(){ tone({ type: 'sawtooth', freq: 60, freqEnd: 120, dur: 0.80, gain: V.loud });
                  noiseBurst({ dur: 0.60, gain: 0.10, filterFreq: 300 }); },
    shield_break(){ noiseBurst({ dur: 0.25, gain: V.loud, filterFreq: 3500, filterType: 'highpass' });
                    tone({ type: 'square', freq: 1200, freqEnd: 200, dur: 0.20, gain: V.mid }); },
    player_hurt(){ tone({ type: 'sawtooth', freq: 200, freqEnd: 80, dur: 0.15, gain: V.loud }); },
    death()     { tone({ type: 'sawtooth', freq: 300, freqEnd: 30, dur: 1.00, gain: V.max });
                  noiseBurst({ dur: 0.60, gain: 0.12, filterFreq: 400 }); },
    victory()   { [523, 659, 784, 1046].forEach((f, i) =>
                    tone({ type: 'triangle', freq: f, dur: 0.22, gain: V.mid, delay: i * 0.13 })); },
    ui_click()  { tone({ type: 'square', freq: 1000, dur: 0.03, gain: V.tiny }); },
    error()     { tone({ type: 'square', freq: 160, dur: 0.15, gain: V.soft });
                  tone({ type: 'square', freq: 140, dur: 0.18, gain: V.soft, delay: 0.14 }); },
    // --- CC telegraph cues (MAPS section 6: every CC telegraph gets an
    // audio cue — ground marker + glowing eyes + THIS sound). Distinct
    // per family so the player can dodge by ear. ---
    telegraph()        { tone({ type: 'sine', freq: 1200, freqEnd: 900, dur: 0.15, gain: V.mid }); },
    telegraph_stun()   { tone({ type: 'square', freq: 900, dur: 0.10, gain: V.mid });
                         tone({ type: 'square', freq: 900, dur: 0.10, gain: V.mid, delay: 0.14 }); },
    telegraph_root()   { tone({ type: 'sine', freq: 300, freqEnd: 150, dur: 0.30, gain: V.mid }); },
    telegraph_slow()   { tone({ type: 'sine', freq: 600, freqEnd: 300, dur: 0.30, gain: V.soft }); },
    telegraph_fear()   { tone({ type: 'sawtooth', freq: 400, freqEnd: 100, dur: 0.40, gain: V.mid }); },
    telegraph_silence(){ tone({ type: 'triangle', freq: 1500, freqEnd: 500, dur: 0.25, gain: V.soft }); },
    telegraph_aoe()    { noiseBurst({ dur: 0.40, gain: V.mid, filterFreq: 800 });
                         tone({ type: 'sine', freq: 300, freqEnd: 700, dur: 0.35, gain: V.soft }); },
    telegraph_charge() { tone({ type: 'sawtooth', freq: 100, freqEnd: 400, dur: 0.40, gain: V.mid }); },
    telegraph_boss()   { tone({ type: 'sawtooth', freq: 70, freqEnd: 50, dur: 0.80, gain: V.max });
                         tone({ type: 'square', freq: 1100, dur: 0.10, gain: V.mid, delay: 0.10 });
                         tone({ type: 'square', freq: 1100, dur: 0.10, gain: V.mid, delay: 0.30 }); },
  };

  function duck() { if (ctx) duckUntil = ctx.currentTime + 1.2; }

  // --- music: lookahead step sequencer, oscillators only ---
  // Combat: A-minor pulse (bass eighth-notes + sparse pad), hub: slow
  // C-major pad arpeggio. Both sit low in the mix (musicBus 0.35x master).
  const MUSIC = {
    combat: { stepDur: 0.22,
      bass: [55.00, 0, 55.00, 0, 65.41, 0, 49.00, 0, 55.00, 0, 55.00, 0, 73.42, 0, 82.41, 0],
      pad: [110.00, 164.81, 220.00], padEvery: 8 },
    hub: { stepDur: 0.50,
      bass: [130.81, 0, 98.00, 0, 87.31, 0, 98.00, 0],
      pad: [261.63, 329.63, 392.00], padEvery: 4 },
  };
  function musicNote(o) {
    if (!ctx || manualPaused || autoPaused) return;
    const t0 = o.at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'triangle';
    osc.frequency.value = o.freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.gain, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g); g.connect(musicBus);
    osc.start(t0); osc.stop(t0 + o.dur + 0.05);
  }
  function scheduleMusic() {
    if (!ctx || !curMusic) return;
    const pat = MUSIC[curMusic];
    if (!pat) return;
    // Schedule 0.4 s ahead; ducked level while an ult burst is sounding.
    while (nextNoteTime < ctx.currentTime + 0.4) {
      const i = step % pat.bass.length;
      const bass = pat.bass[i];
      const ducked = ctx.currentTime < duckUntil;
      const lvl = ducked ? 0.35 : 1;
      if (bass) musicNote({ freq: bass, dur: pat.stepDur * 0.9, gain: 0.16 * lvl, at: nextNoteTime, type: 'triangle' });
      if (step % pat.padEvery === 0) {
        pat.pad.forEach((f) => musicNote({ freq: f, dur: pat.stepDur * pat.padEvery * 0.9, gain: 0.035 * lvl, at: nextNoteTime, type: 'sine' }));
      }
      if (curMusic === 'combat' && step % 4 === 2) {
        musicNote({ freq: 880 + (step % 8) * 55, dur: 0.08, gain: 0.02 * lvl, at: nextNoteTime, type: 'sine' });
      }
      nextNoteTime += pat.stepDur;
      step += 1;
    }
  }
  function startScheduler() {
    if (schedTimer !== null || !ctx) return;
    step = 0; nextNoteTime = ctx.currentTime + 0.05;
    schedTimer = setInterval(scheduleMusic, 200);
    if (schedTimer && typeof schedTimer.unref === 'function') { try { schedTimer.unref(); } catch (e) {} }
  }
  function stopScheduler() {
    if (schedTimer !== null) { clearInterval(schedTimer); schedTimer = null; }
  }

  function unlock() {
    if (!ctx || unlocked) return;
    try {
      const p = ctx.resume && ctx.resume();
      if (p && typeof p.then === 'function') p.then(() => { unlocked = true; }).catch(() => {});
      else unlocked = true;
    } catch (e) {}
  }
  function onVisibility() {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      if (!manualPaused && !autoPaused) { autoPaused = true; stopScheduler(); suspendCtx(); }
    } else if (autoPaused) {
      autoPaused = false; resumeCtx(); if (curMusic) startScheduler();
    }
  }
  function suspendCtx() { try { if (ctx && ctx.suspend) ctx.suspend(); } catch (e) {} }
  function resumeCtx() { try { if (ctx && ctx.resume) ctx.resume(); } catch (e) {} }

  function init() {
    if (started) { unlock(); return true; }
    try {
      const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
      if (!AC) return false;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 8;
      comp.attack.value = 0.003; comp.release.value = 0.25;
      master = ctx.createGain();
      master.gain.value = settings().muted ? 0 : settings().volume;
      sfxBus = ctx.createGain(); sfxBus.gain.value = 1.0;
      musicBus = ctx.createGain(); musicBus.gain.value = 0.35;
      sfxBus.connect(master); musicBus.connect(master);
      master.connect(comp); comp.connect(ctx.destination);
      const len = ctx.sampleRate || 44100;
      noiseBuf = ctx.createBuffer(1, len, len);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; // white noise; gain stays fixed
      started = true;
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', onVisibility);
        // One-shot gesture unlock (autoplay policy): first real interaction
        // resumes the context; listeners remove themselves afterwards.
        const gesture = () => { unlock(); };
        ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => {
          document.addEventListener(ev, gesture, { once: true, passive: true });
        });
      }
      unlock();
      return true;
    } catch (e) { return false; }
  }

  function sfx(name) {
    try {
      if (!started) init();
      if (!started || !ctx) return false;
      if (settings().muted) return false;
      unlock();
      const fn = SFX[name];
      if (!fn) return false;
      fn();
      return true;
    } catch (e) { return false; }
  }
  // Convenience: skill('s1'|'s2'|'ult', 'red'|'blue'|'purple')
  function skill(tier, faction) {
    const t = (tier === 's2' || tier === 'ult') ? tier : 's1';
    const f = (faction === 'blue' || faction === 'purple') ? faction : 'red';
    return sfx('skill_' + t + '_' + f);
  }
  // Convenience: telegraph('stun'|'root'|'slow'|'fear'|'silence'|'aoe'|'charge'|'boss')
  function telegraph(kind) {
    const map = { stun: 'telegraph_stun', root: 'telegraph_root', slow: 'telegraph_slow',
      fear: 'telegraph_fear', silence: 'telegraph_silence', aoe: 'telegraph_aoe',
      charge: 'telegraph_charge', boss: 'telegraph_boss' };
    return sfx(map[kind] || 'telegraph');
  }
  function music(mode) {
    try {
      if (mode !== 'combat' && mode !== 'hub' && mode !== null) return false;
      if (mode !== null) {
        if (!started) init();
        if (!started || !ctx) return false;
        if (settings().muted) { curMusic = mode; return true; } // remember; sounds on unmute
      }
      curMusic = mode;
      stopScheduler();
      if (mode && !manualPaused && !autoPaused) startScheduler();
      return true;
    } catch (e) { return false; }
  }
  function setVolume(v) {
    const val = Math.min(1, Math.max(0, Number(v)));
    if (!isFinite(val)) return false;
    try {
      if (typeof Settings !== 'undefined') Settings.set({ volume: val });
      else if (typeof Save !== 'undefined') { Save.data.settings.volume = val; Save.save(); }
    } catch (e) {}
    applyVolume();
    return true;
  }
  function setMuted(m) {
    try {
      if (typeof Settings !== 'undefined') Settings.set({ muted: !!m });
      else if (typeof Save !== 'undefined') { Save.data.settings.muted = !!m; Save.save(); }
    } catch (e) {}
    applyVolume();
    return true;
  }
  function pauseAll() {
    manualPaused = true; autoPaused = false;
    stopScheduler(); suspendCtx();
  }
  function resumeAll() {
    manualPaused = false; autoPaused = false;
    resumeCtx(); applyVolume(); if (curMusic) startScheduler();
  }

  return { init, sfx, skill, telegraph, music, setVolume, setMuted,
    pauseAll, resumeAll, VERSION,
    get isReady() { return started && !!ctx; },
    get currentMusic() { return curMusic; },
    get sfxNames() { return Object.keys(SFX); },
    // Test hooks (not part of the game API): drive visibility + inspect state.
    _test: { onVisibility, get paused() { return manualPaused || autoPaused; },
      get autoPaused() { return autoPaused; }, get duckUntil() { return duckUntil; } },
  };
})();
if (typeof window !== 'undefined') window.GameAudio = GameAudio;
