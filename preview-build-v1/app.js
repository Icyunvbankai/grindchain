
'use strict';
/* ============================================================
   GRINDCHAIN — mobile dungeon prototype
   Top-down arena crawler. Faction kits. Status effects. Boss.
   ============================================================ */
const cv = document.getElementById('game-canvas');
const ctx = cv.getContext('2d');
const mm = document.getElementById('minimap');
const mmc = mm.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, (typeof Settings !== 'undefined' ? Settings.qualityCaps(Settings.get().quality).dprCap : 2));
  W = window.innerWidth; H = window.innerHeight;
  cv.width = W * DPR; cv.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize); resize();
function isLandscape() { return window.innerWidth >= window.innerHeight; }
function checkOrientation() {
  const bad = !isLandscape();
  document.getElementById('rotate-overlay').style.display = bad ? 'flex' : 'none';
  return bad;
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 200));
checkOrientation();
let orientationLockFailed = false, orientationLockWarned = false;
document.addEventListener('pointerdown', function tryLock() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      Promise.resolve(screen.orientation.lock('landscape')).catch(err => {
        // BUG-07: rejection is NOT swallowed — fall back to rotate guidance.
        orientationLockFailed = true;
        if (!orientationLockWarned) {
          orientationLockWarned = true;
          console.warn('[GRINDCHAIN] screen.orientation.lock rejected; using rotate-guidance fallback.', err);
          try { toast('ROTATE TO LANDSCAPE TO PLAY'); } catch (e) {}
        }
      });
    }
  } catch (err) {
    orientationLockFailed = true;
    console.warn('[GRINDCHAIN] screen.orientation.lock threw; using rotate-guidance fallback.', err);
  }
  document.removeEventListener('pointerdown', tryLock);
});

// ---------- utils ----------
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

// ---------- arena ----------
const ARENA = { w: 1600, h: 1600 };
let walls = [], bushes = [], chests = [], props = [];

// ---------- combo counter (combo-counter-spec-2026-10-15 §2–§5) ----------
// Window + bonus tiers are named constants — never magic numbers.
// gameplay-systems.js carries its own identical tier table for addKill
// (it must stay self-contained: it loads before app.js).
const COMBO_WINDOW = 3.0;
const COMBO_BONUS_TIERS = [
  { min: 30, bonus: 5 },
  { min: 20, bonus: 3 },
  { min: 10, bonus: 2 },
  { min: 5, bonus: 1 },
  { min: 0, bonus: 0 },
];
const COMBO_MILESTONES = [5, 10, 20, 30, 50];
const COMBO_FLOATER_GOLD = '#ffd75e';
const COMBO_FLOATER_TIERS = [
  { min: 20, size: 26, color: COMBO_FLOATER_GOLD },
  { min: 10, size: 20, color: '#fff' },
  { min: 5, size: 16, color: '#fff' },
  { min: 0, size: 13, color: '#fff' },
];
function comboBonusFor(combo) {
  const c = (typeof combo === 'number' && isFinite(combo)) ? Math.max(0, Math.floor(combo)) : 0;
  for (const t of COMBO_BONUS_TIERS) if (c >= t.min) return t.bonus;
  return 0;
}
function comboFloaterStyle(combo) {
  const c = (typeof combo === 'number' && isFinite(combo)) ? Math.max(0, Math.floor(combo)) : 0;
  for (const t of COMBO_FLOATER_TIERS) if (c >= t.min) return { size: t.size, color: t.color };
  return { size: 13, color: '#fff' };
}

// ---------- game state ----------
const G = {
  running: false, time: 0, wave: 0, slain: 0, slainGoal: 20, tier: 1,
  enemies: [], projectiles: [], particles: [], pickups: [], floaters: [],
  shake: 0, boss: null, locked: null, waveState: 'idle', spawnQueue: [], spawnT: 0, fx: [],
  hitstop: 0, flash: null, ultTelegraph: null, ultSeq: 0, paused: false, pauseReason: null,
  kills: 0,
  combo: 0, comboT: 0, bestComboRun: 0,
  milestonesHit: new Set(), comboHintShown: false, runToken: 0,
};
// ---------- sprites ----------
// ---------- heroes: 12, two per class ----------
const HEROES = {
  bastion: { name:'BASTION', cls:'tank',     faction:'red'    },
  rampart: { name:'RAMPART', cls:'tank',     faction:'red'    },
  deadeye: { name:'DEADEYE', cls:'marksman', faction:'red'    },
  vigil:   { name:'VIGIL',   cls:'marksman', faction:'red'    },
  sentinel: { name:'SENTINEL', cls:'support', faction:'red'    },
  hex:     { name:'HEX',     cls:'mage',     faction:'blue'   },
  ember:   { name:'EMBER',   cls:'mage',     faction:'blue'   },
  mercy:   { name:'MERCY',   cls:'support',  faction:'blue'   },
  sage:    { name:'SAGE',    cls:'support',  faction:'blue'   },
  hymn:    { name:'HYMN',    cls:'support',  faction:'blue'   },
  rook:    { name:'ROOK',    cls:'fighter',  faction:'purple' },
  dusk:    { name:'DUSK',    cls:'fighter',  faction:'purple' },
  shade:   { name:'SHADE',   cls:'assassin', faction:'purple' },
  specter: { name:'SPECTER', cls:'assassin', faction:'purple' },
};
const heroCls = s => (HEROES[s] || {}).cls || 'mage';
const FACTION_HEROES = {
  red:    ['bastion','rampart','deadeye','vigil','sentinel'],
  blue:   ['hex','ember','mercy','sage','hymn'],
  purple: ['rook','dusk','shade','specter'],
};
const SPRITE_SRC = {
  bastion: [
"assets/sprites/bastion/frame-00.webp",
"assets/sprites/bastion/frame-01.webp",
"assets/sprites/bastion/frame-02.webp",
"assets/sprites/bastion/frame-03.webp",
"assets/sprites/bastion/frame-04.webp",
"assets/sprites/bastion/frame-05.webp",
"assets/sprites/bastion/frame-06.webp",
"assets/sprites/bastion/frame-07.webp",
"assets/sprites/bastion/frame-08.webp",
"assets/sprites/bastion/frame-09.webp",
"assets/sprites/bastion/frame-10.webp",
"assets/sprites/bastion/frame-11.webp",
"assets/sprites/bastion/frame-12.webp",
"assets/sprites/bastion/frame-13.webp",
"assets/sprites/bastion/frame-14.webp",
"assets/sprites/bastion/frame-15.webp",
"assets/sprites/bastion/frame-16.webp",
"assets/sprites/bastion/frame-17.webp",
"assets/sprites/bastion/frame-18.webp",
"assets/sprites/bastion/frame-19.webp",
"assets/sprites/bastion/frame-20.webp",
"assets/sprites/bastion/frame-21.webp",
"assets/sprites/bastion/frame-22.webp",
"assets/sprites/bastion/frame-23.webp",
"assets/sprites/bastion/frame-24.webp",
"assets/sprites/bastion/frame-25.webp",
"assets/sprites/bastion/frame-26.webp",
"assets/sprites/bastion/frame-27.webp",
"assets/sprites/bastion/frame-28.webp",
"assets/sprites/bastion/frame-29.webp",
"assets/sprites/bastion/frame-30.webp",
"assets/sprites/bastion/frame-31.webp",
"assets/sprites/bastion/frame-32.webp",
"assets/sprites/bastion/frame-33.webp",
"assets/sprites/bastion/frame-34.webp",
"assets/sprites/bastion/frame-35.webp",
"assets/sprites/bastion/frame-36.webp",
"assets/sprites/bastion/frame-37.webp",
"assets/sprites/bastion/frame-38.webp",
"assets/sprites/bastion/frame-39.webp",
"assets/sprites/bastion/frame-40.webp",
"assets/sprites/bastion/frame-41.webp",
"assets/sprites/bastion/frame-42.webp",
"assets/sprites/bastion/frame-43.webp",
"assets/sprites/bastion/frame-44.webp",
"assets/sprites/bastion/frame-45.webp",
"assets/sprites/bastion/frame-46.webp",
"assets/sprites/bastion/frame-47.webp",
"assets/sprites/bastion/frame-48.webp",
"assets/sprites/bastion/frame-49.webp",
"assets/sprites/bastion/frame-50.webp",
"assets/sprites/bastion/frame-51.webp",
"assets/sprites/bastion/frame-52.webp",
"assets/sprites/bastion/frame-53.webp"
  ],
  rampart: [
"assets/sprites/rampart/frame-00.webp",
"assets/sprites/rampart/frame-01.webp",
"assets/sprites/rampart/frame-02.webp",
"assets/sprites/rampart/frame-03.webp",
"assets/sprites/rampart/frame-04.webp",
"assets/sprites/rampart/frame-05.webp",
"assets/sprites/rampart/frame-06.webp",
"assets/sprites/rampart/frame-07.webp",
"assets/sprites/rampart/frame-08.webp",
"assets/sprites/rampart/frame-09.webp",
"assets/sprites/rampart/frame-10.webp",
"assets/sprites/rampart/frame-11.webp",
"assets/sprites/rampart/frame-12.webp",
"assets/sprites/rampart/frame-13.webp",
"assets/sprites/rampart/frame-14.webp",
"assets/sprites/rampart/frame-15.webp",
"assets/sprites/rampart/frame-16.webp",
"assets/sprites/rampart/frame-17.webp",
"assets/sprites/rampart/frame-18.webp",
"assets/sprites/rampart/frame-19.webp",
"assets/sprites/rampart/frame-20.webp",
"assets/sprites/rampart/frame-21.webp",
"assets/sprites/rampart/frame-22.webp",
"assets/sprites/rampart/frame-23.webp",
"assets/sprites/rampart/frame-24.webp",
"assets/sprites/rampart/frame-25.webp",
"assets/sprites/rampart/frame-26.webp",
"assets/sprites/rampart/frame-27.webp",
"assets/sprites/rampart/frame-28.webp",
"assets/sprites/rampart/frame-29.webp",
"assets/sprites/rampart/frame-30.webp",
"assets/sprites/rampart/frame-31.webp",
"assets/sprites/rampart/frame-32.webp",
"assets/sprites/rampart/frame-33.webp",
"assets/sprites/rampart/frame-34.webp",
"assets/sprites/rampart/frame-35.webp",
"assets/sprites/rampart/frame-36.webp",
"assets/sprites/rampart/frame-37.webp",
"assets/sprites/rampart/frame-38.webp",
"assets/sprites/rampart/frame-39.webp",
"assets/sprites/rampart/frame-40.webp",
"assets/sprites/rampart/frame-41.webp",
"assets/sprites/rampart/frame-42.webp",
"assets/sprites/rampart/frame-43.webp",
"assets/sprites/rampart/frame-44.webp",
"assets/sprites/rampart/frame-45.webp",
"assets/sprites/rampart/frame-46.webp",
"assets/sprites/rampart/frame-47.webp",
"assets/sprites/rampart/frame-48.webp",
"assets/sprites/rampart/frame-49.webp",
"assets/sprites/rampart/frame-50.webp",
"assets/sprites/rampart/frame-51.webp",
"assets/sprites/rampart/frame-52.webp",
"assets/sprites/rampart/frame-53.webp"
  ],
  deadeye: [
"assets/sprites/deadeye/frame-00.webp",
"assets/sprites/deadeye/frame-01.webp",
"assets/sprites/deadeye/frame-02.webp",
"assets/sprites/deadeye/frame-03.webp",
"assets/sprites/deadeye/frame-04.webp",
"assets/sprites/deadeye/frame-05.webp",
"assets/sprites/deadeye/frame-06.webp",
"assets/sprites/deadeye/frame-07.webp",
"assets/sprites/deadeye/frame-08.webp",
"assets/sprites/deadeye/frame-09.webp",
"assets/sprites/deadeye/frame-10.webp",
"assets/sprites/deadeye/frame-11.webp",
"assets/sprites/deadeye/frame-12.webp",
"assets/sprites/deadeye/frame-13.webp",
"assets/sprites/deadeye/frame-14.webp",
"assets/sprites/deadeye/frame-15.webp",
"assets/sprites/deadeye/frame-16.webp",
"assets/sprites/deadeye/frame-17.webp",
"assets/sprites/deadeye/frame-18.webp",
"assets/sprites/deadeye/frame-19.webp",
"assets/sprites/deadeye/frame-20.webp",
"assets/sprites/deadeye/frame-21.webp",
"assets/sprites/deadeye/frame-22.webp",
"assets/sprites/deadeye/frame-23.webp",
"assets/sprites/deadeye/frame-24.webp",
"assets/sprites/deadeye/frame-25.webp",
"assets/sprites/deadeye/frame-26.webp",
"assets/sprites/deadeye/frame-27.webp",
"assets/sprites/deadeye/frame-28.webp",
"assets/sprites/deadeye/frame-29.webp",
"assets/sprites/deadeye/frame-30.webp",
"assets/sprites/deadeye/frame-31.webp",
"assets/sprites/deadeye/frame-32.webp",
"assets/sprites/deadeye/frame-33.webp",
"assets/sprites/deadeye/frame-34.webp",
"assets/sprites/deadeye/frame-35.webp",
"assets/sprites/deadeye/frame-36.webp",
"assets/sprites/deadeye/frame-37.webp",
"assets/sprites/deadeye/frame-38.webp",
"assets/sprites/deadeye/frame-39.webp",
"assets/sprites/deadeye/frame-40.webp",
"assets/sprites/deadeye/frame-41.webp",
"assets/sprites/deadeye/frame-42.webp",
"assets/sprites/deadeye/frame-43.webp",
"assets/sprites/deadeye/frame-44.webp",
"assets/sprites/deadeye/frame-45.webp",
"assets/sprites/deadeye/frame-46.webp",
"assets/sprites/deadeye/frame-47.webp",
"assets/sprites/deadeye/frame-48.webp",
"assets/sprites/deadeye/frame-49.webp",
"assets/sprites/deadeye/frame-50.webp",
"assets/sprites/deadeye/frame-51.webp",
"assets/sprites/deadeye/frame-52.webp",
"assets/sprites/deadeye/frame-53.webp"
  ],
  vigil: [
"assets/sprites/vigil/frame-00.webp",
"assets/sprites/vigil/frame-01.webp",
"assets/sprites/vigil/frame-02.webp",
"assets/sprites/vigil/frame-03.webp",
"assets/sprites/vigil/frame-04.webp",
"assets/sprites/vigil/frame-05.webp",
"assets/sprites/vigil/frame-06.webp",
"assets/sprites/vigil/frame-07.webp",
"assets/sprites/vigil/frame-08.webp",
"assets/sprites/vigil/frame-09.webp",
"assets/sprites/vigil/frame-10.webp",
"assets/sprites/vigil/frame-11.webp",
"assets/sprites/vigil/frame-12.webp",
"assets/sprites/vigil/frame-13.webp",
"assets/sprites/vigil/frame-14.webp",
"assets/sprites/vigil/frame-15.webp",
"assets/sprites/vigil/frame-16.webp",
"assets/sprites/vigil/frame-17.webp",
"assets/sprites/vigil/frame-18.webp",
"assets/sprites/vigil/frame-19.webp",
"assets/sprites/vigil/frame-20.webp",
"assets/sprites/vigil/frame-21.webp",
"assets/sprites/vigil/frame-22.webp",
"assets/sprites/vigil/frame-23.webp",
"assets/sprites/vigil/frame-24.webp",
"assets/sprites/vigil/frame-25.webp",
"assets/sprites/vigil/frame-26.webp",
"assets/sprites/vigil/frame-27.webp",
"assets/sprites/vigil/frame-28.webp",
"assets/sprites/vigil/frame-29.webp",
"assets/sprites/vigil/frame-30.webp",
"assets/sprites/vigil/frame-31.webp",
"assets/sprites/vigil/frame-32.webp",
"assets/sprites/vigil/frame-33.webp",
"assets/sprites/vigil/frame-34.webp",
"assets/sprites/vigil/frame-35.webp",
"assets/sprites/vigil/frame-36.webp",
"assets/sprites/vigil/frame-37.webp",
"assets/sprites/vigil/frame-38.webp",
"assets/sprites/vigil/frame-39.webp",
"assets/sprites/vigil/frame-40.webp",
"assets/sprites/vigil/frame-41.webp",
"assets/sprites/vigil/frame-42.webp",
"assets/sprites/vigil/frame-43.webp",
"assets/sprites/vigil/frame-44.webp",
"assets/sprites/vigil/frame-45.webp",
"assets/sprites/vigil/frame-46.webp",
"assets/sprites/vigil/frame-47.webp",
"assets/sprites/vigil/frame-48.webp",
"assets/sprites/vigil/frame-49.webp",
"assets/sprites/vigil/frame-50.webp",
"assets/sprites/vigil/frame-51.webp",
"assets/sprites/vigil/frame-52.webp",
"assets/sprites/vigil/frame-53.webp"
  ],
  hex: [
"assets/sprites/hex/frame-00.webp",
"assets/sprites/hex/frame-01.webp",
"assets/sprites/hex/frame-02.webp",
"assets/sprites/hex/frame-03.webp",
"assets/sprites/hex/frame-04.webp",
"assets/sprites/hex/frame-05.webp",
"assets/sprites/hex/frame-06.webp",
"assets/sprites/hex/frame-07.webp",
"assets/sprites/hex/frame-08.webp",
"assets/sprites/hex/frame-09.webp",
"assets/sprites/hex/frame-10.webp",
"assets/sprites/hex/frame-11.webp",
"assets/sprites/hex/frame-12.webp",
"assets/sprites/hex/frame-13.webp",
"assets/sprites/hex/frame-14.webp",
"assets/sprites/hex/frame-15.webp",
"assets/sprites/hex/frame-16.webp",
"assets/sprites/hex/frame-17.webp",
"assets/sprites/hex/frame-18.webp",
"assets/sprites/hex/frame-19.webp",
"assets/sprites/hex/frame-20.webp",
"assets/sprites/hex/frame-21.webp",
"assets/sprites/hex/frame-22.webp",
"assets/sprites/hex/frame-23.webp",
"assets/sprites/hex/frame-24.webp",
"assets/sprites/hex/frame-25.webp",
"assets/sprites/hex/frame-26.webp",
"assets/sprites/hex/frame-27.webp",
"assets/sprites/hex/frame-28.webp",
"assets/sprites/hex/frame-29.webp",
"assets/sprites/hex/frame-30.webp",
"assets/sprites/hex/frame-31.webp",
"assets/sprites/hex/frame-32.webp",
"assets/sprites/hex/frame-33.webp",
"assets/sprites/hex/frame-34.webp",
"assets/sprites/hex/frame-35.webp",
"assets/sprites/hex/frame-36.webp",
"assets/sprites/hex/frame-37.webp",
"assets/sprites/hex/frame-38.webp",
"assets/sprites/hex/frame-39.webp",
"assets/sprites/hex/frame-40.webp",
"assets/sprites/hex/frame-41.webp",
"assets/sprites/hex/frame-42.webp",
"assets/sprites/hex/frame-43.webp",
"assets/sprites/hex/frame-44.webp",
"assets/sprites/hex/frame-45.webp",
"assets/sprites/hex/frame-46.webp",
"assets/sprites/hex/frame-47.webp",
"assets/sprites/hex/frame-48.webp",
"assets/sprites/hex/frame-49.webp",
"assets/sprites/hex/frame-50.webp",
"assets/sprites/hex/frame-51.webp",
"assets/sprites/hex/frame-52.webp",
"assets/sprites/hex/frame-53.webp"
  ],
  ember: [
"assets/sprites/ember/frame-00.webp",
"assets/sprites/ember/frame-01.webp",
"assets/sprites/ember/frame-02.webp",
"assets/sprites/ember/frame-03.webp",
"assets/sprites/ember/frame-04.webp",
"assets/sprites/ember/frame-05.webp",
"assets/sprites/ember/frame-06.webp",
"assets/sprites/ember/frame-07.webp",
"assets/sprites/ember/frame-08.webp",
"assets/sprites/ember/frame-09.webp",
"assets/sprites/ember/frame-10.webp",
"assets/sprites/ember/frame-11.webp",
"assets/sprites/ember/frame-12.webp",
"assets/sprites/ember/frame-13.webp",
"assets/sprites/ember/frame-14.webp",
"assets/sprites/ember/frame-15.webp",
"assets/sprites/ember/frame-16.webp",
"assets/sprites/ember/frame-17.webp",
"assets/sprites/ember/frame-18.webp",
"assets/sprites/ember/frame-19.webp",
"assets/sprites/ember/frame-20.webp",
"assets/sprites/ember/frame-21.webp",
"assets/sprites/ember/frame-22.webp",
"assets/sprites/ember/frame-23.webp",
"assets/sprites/ember/frame-24.webp",
"assets/sprites/ember/frame-25.webp",
"assets/sprites/ember/frame-26.webp",
"assets/sprites/ember/frame-27.webp",
"assets/sprites/ember/frame-28.webp",
"assets/sprites/ember/frame-29.webp",
"assets/sprites/ember/frame-30.webp",
"assets/sprites/ember/frame-31.webp",
"assets/sprites/ember/frame-32.webp",
"assets/sprites/ember/frame-33.webp",
"assets/sprites/ember/frame-34.webp",
"assets/sprites/ember/frame-35.webp",
"assets/sprites/ember/frame-36.webp",
"assets/sprites/ember/frame-37.webp",
"assets/sprites/ember/frame-38.webp",
"assets/sprites/ember/frame-39.webp",
"assets/sprites/ember/frame-40.webp",
"assets/sprites/ember/frame-41.webp",
"assets/sprites/ember/frame-42.webp",
"assets/sprites/ember/frame-43.webp",
"assets/sprites/ember/frame-44.webp",
"assets/sprites/ember/frame-45.webp",
"assets/sprites/ember/frame-46.webp",
"assets/sprites/ember/frame-47.webp",
"assets/sprites/ember/frame-48.webp",
"assets/sprites/ember/frame-49.webp",
"assets/sprites/ember/frame-50.webp",
"assets/sprites/ember/frame-51.webp",
"assets/sprites/ember/frame-52.webp",
"assets/sprites/ember/frame-53.webp"
  ],
  mercy: [
"assets/sprites/mercy/frame-00.webp",
"assets/sprites/mercy/frame-01.webp",
"assets/sprites/mercy/frame-02.webp",
"assets/sprites/mercy/frame-03.webp",
"assets/sprites/mercy/frame-04.webp",
"assets/sprites/mercy/frame-05.webp",
"assets/sprites/mercy/frame-06.webp",
"assets/sprites/mercy/frame-07.webp",
"assets/sprites/mercy/frame-08.webp",
"assets/sprites/mercy/frame-09.webp",
"assets/sprites/mercy/frame-10.webp",
"assets/sprites/mercy/frame-11.webp",
"assets/sprites/mercy/frame-12.webp",
"assets/sprites/mercy/frame-13.webp",
"assets/sprites/mercy/frame-14.webp",
"assets/sprites/mercy/frame-15.webp",
"assets/sprites/mercy/frame-16.webp",
"assets/sprites/mercy/frame-17.webp",
"assets/sprites/mercy/frame-18.webp",
"assets/sprites/mercy/frame-19.webp",
"assets/sprites/mercy/frame-20.webp",
"assets/sprites/mercy/frame-21.webp",
"assets/sprites/mercy/frame-22.webp",
"assets/sprites/mercy/frame-23.webp",
"assets/sprites/mercy/frame-24.webp",
"assets/sprites/mercy/frame-25.webp",
"assets/sprites/mercy/frame-26.webp",
"assets/sprites/mercy/frame-27.webp",
"assets/sprites/mercy/frame-28.webp",
"assets/sprites/mercy/frame-29.webp",
"assets/sprites/mercy/frame-30.webp",
"assets/sprites/mercy/frame-31.webp",
"assets/sprites/mercy/frame-32.webp",
"assets/sprites/mercy/frame-33.webp",
"assets/sprites/mercy/frame-34.webp",
"assets/sprites/mercy/frame-35.webp",
"assets/sprites/mercy/frame-36.webp",
"assets/sprites/mercy/frame-37.webp",
"assets/sprites/mercy/frame-38.webp",
"assets/sprites/mercy/frame-39.webp",
"assets/sprites/mercy/frame-40.webp",
"assets/sprites/mercy/frame-41.webp",
"assets/sprites/mercy/frame-42.webp",
"assets/sprites/mercy/frame-43.webp",
"assets/sprites/mercy/frame-44.webp",
"assets/sprites/mercy/frame-45.webp",
"assets/sprites/mercy/frame-46.webp",
"assets/sprites/mercy/frame-47.webp",
"assets/sprites/mercy/frame-48.webp",
"assets/sprites/mercy/frame-49.webp",
"assets/sprites/mercy/frame-50.webp",
"assets/sprites/mercy/frame-51.webp",
"assets/sprites/mercy/frame-52.webp",
"assets/sprites/mercy/frame-53.webp"
  ],
  sage: [
"assets/sprites/sage/frame-00.webp",
"assets/sprites/sage/frame-01.webp",
"assets/sprites/sage/frame-02.webp",
"assets/sprites/sage/frame-03.webp",
"assets/sprites/sage/frame-04.webp",
"assets/sprites/sage/frame-05.webp",
"assets/sprites/sage/frame-06.webp",
"assets/sprites/sage/frame-07.webp",
"assets/sprites/sage/frame-08.webp",
"assets/sprites/sage/frame-09.webp",
"assets/sprites/sage/frame-10.webp",
"assets/sprites/sage/frame-11.webp",
"assets/sprites/sage/frame-12.webp",
"assets/sprites/sage/frame-13.webp",
"assets/sprites/sage/frame-14.webp",
"assets/sprites/sage/frame-15.webp",
"assets/sprites/sage/frame-16.webp",
"assets/sprites/sage/frame-17.webp",
"assets/sprites/sage/frame-18.webp",
"assets/sprites/sage/frame-19.webp",
"assets/sprites/sage/frame-20.webp",
"assets/sprites/sage/frame-21.webp",
"assets/sprites/sage/frame-22.webp",
"assets/sprites/sage/frame-23.webp",
"assets/sprites/sage/frame-24.webp",
"assets/sprites/sage/frame-25.webp",
"assets/sprites/sage/frame-26.webp",
"assets/sprites/sage/frame-27.webp",
"assets/sprites/sage/frame-28.webp",
"assets/sprites/sage/frame-29.webp",
"assets/sprites/sage/frame-30.webp",
"assets/sprites/sage/frame-31.webp",
"assets/sprites/sage/frame-32.webp",
"assets/sprites/sage/frame-33.webp",
"assets/sprites/sage/frame-34.webp",
"assets/sprites/sage/frame-35.webp",
"assets/sprites/sage/frame-36.webp",
"assets/sprites/sage/frame-37.webp",
"assets/sprites/sage/frame-38.webp",
"assets/sprites/sage/frame-39.webp",
"assets/sprites/sage/frame-40.webp",
"assets/sprites/sage/frame-41.webp",
"assets/sprites/sage/frame-42.webp",
"assets/sprites/sage/frame-43.webp",
"assets/sprites/sage/frame-44.webp",
"assets/sprites/sage/frame-45.webp",
"assets/sprites/sage/frame-46.webp",
"assets/sprites/sage/frame-47.webp",
"assets/sprites/sage/frame-48.webp",
"assets/sprites/sage/frame-49.webp",
"assets/sprites/sage/frame-50.webp",
"assets/sprites/sage/frame-51.webp",
"assets/sprites/sage/frame-52.webp",
"assets/sprites/sage/frame-53.webp"
  ],
  rook: [
"assets/sprites/rook/frame-00.webp",
"assets/sprites/rook/frame-01.webp",
"assets/sprites/rook/frame-02.webp",
"assets/sprites/rook/frame-03.webp",
"assets/sprites/rook/frame-04.webp",
"assets/sprites/rook/frame-05.webp",
"assets/sprites/rook/frame-06.webp",
"assets/sprites/rook/frame-07.webp",
"assets/sprites/rook/frame-08.webp",
"assets/sprites/rook/frame-09.webp",
"assets/sprites/rook/frame-10.webp",
"assets/sprites/rook/frame-11.webp",
"assets/sprites/rook/frame-12.webp",
"assets/sprites/rook/frame-13.webp",
"assets/sprites/rook/frame-14.webp",
"assets/sprites/rook/frame-15.webp",
"assets/sprites/rook/frame-16.webp",
"assets/sprites/rook/frame-17.webp",
"assets/sprites/rook/frame-18.webp",
"assets/sprites/rook/frame-19.webp",
"assets/sprites/rook/frame-20.webp",
"assets/sprites/rook/frame-21.webp",
"assets/sprites/rook/frame-22.webp",
"assets/sprites/rook/frame-23.webp",
"assets/sprites/rook/frame-24.webp",
"assets/sprites/rook/frame-25.webp",
"assets/sprites/rook/frame-26.webp",
"assets/sprites/rook/frame-27.webp",
"assets/sprites/rook/frame-28.webp",
"assets/sprites/rook/frame-29.webp",
"assets/sprites/rook/frame-30.webp",
"assets/sprites/rook/frame-31.webp",
"assets/sprites/rook/frame-32.webp",
"assets/sprites/rook/frame-33.webp",
"assets/sprites/rook/frame-34.webp",
"assets/sprites/rook/frame-35.webp",
"assets/sprites/rook/frame-36.webp",
"assets/sprites/rook/frame-37.webp",
"assets/sprites/rook/frame-38.webp",
"assets/sprites/rook/frame-39.webp",
"assets/sprites/rook/frame-40.webp",
"assets/sprites/rook/frame-41.webp",
"assets/sprites/rook/frame-42.webp",
"assets/sprites/rook/frame-43.webp",
"assets/sprites/rook/frame-44.webp",
"assets/sprites/rook/frame-45.webp",
"assets/sprites/rook/frame-46.webp",
"assets/sprites/rook/frame-47.webp",
"assets/sprites/rook/frame-48.webp",
"assets/sprites/rook/frame-49.webp",
"assets/sprites/rook/frame-50.webp",
"assets/sprites/rook/frame-51.webp",
"assets/sprites/rook/frame-52.webp",
"assets/sprites/rook/frame-53.webp"
  ],
  dusk: [
"assets/sprites/dusk/frame-00.webp",
"assets/sprites/dusk/frame-01.webp",
"assets/sprites/dusk/frame-02.webp",
"assets/sprites/dusk/frame-03.webp",
"assets/sprites/dusk/frame-04.webp",
"assets/sprites/dusk/frame-05.webp",
"assets/sprites/dusk/frame-06.webp",
"assets/sprites/dusk/frame-07.webp",
"assets/sprites/dusk/frame-08.webp",
"assets/sprites/dusk/frame-09.webp",
"assets/sprites/dusk/frame-10.webp",
"assets/sprites/dusk/frame-11.webp",
"assets/sprites/dusk/frame-12.webp",
"assets/sprites/dusk/frame-13.webp",
"assets/sprites/dusk/frame-14.webp",
"assets/sprites/dusk/frame-15.webp",
"assets/sprites/dusk/frame-16.webp",
"assets/sprites/dusk/frame-17.webp",
"assets/sprites/dusk/frame-18.webp",
"assets/sprites/dusk/frame-19.webp",
"assets/sprites/dusk/frame-20.webp",
"assets/sprites/dusk/frame-21.webp",
"assets/sprites/dusk/frame-22.webp",
"assets/sprites/dusk/frame-23.webp",
"assets/sprites/dusk/frame-24.webp",
"assets/sprites/dusk/frame-25.webp",
"assets/sprites/dusk/frame-26.webp",
"assets/sprites/dusk/frame-27.webp",
"assets/sprites/dusk/frame-28.webp",
"assets/sprites/dusk/frame-29.webp",
"assets/sprites/dusk/frame-30.webp",
"assets/sprites/dusk/frame-31.webp",
"assets/sprites/dusk/frame-32.webp",
"assets/sprites/dusk/frame-33.webp",
"assets/sprites/dusk/frame-34.webp",
"assets/sprites/dusk/frame-35.webp",
"assets/sprites/dusk/frame-36.webp",
"assets/sprites/dusk/frame-37.webp",
"assets/sprites/dusk/frame-38.webp",
"assets/sprites/dusk/frame-39.webp",
"assets/sprites/dusk/frame-40.webp",
"assets/sprites/dusk/frame-41.webp",
"assets/sprites/dusk/frame-42.webp",
"assets/sprites/dusk/frame-43.webp",
"assets/sprites/dusk/frame-44.webp",
"assets/sprites/dusk/frame-45.webp",
"assets/sprites/dusk/frame-46.webp",
"assets/sprites/dusk/frame-47.webp",
"assets/sprites/dusk/frame-48.webp",
"assets/sprites/dusk/frame-49.webp",
"assets/sprites/dusk/frame-50.webp",
"assets/sprites/dusk/frame-51.webp",
"assets/sprites/dusk/frame-52.webp",
"assets/sprites/dusk/frame-53.webp"
  ],
  shade: [
"assets/sprites/shade/frame-00.webp",
"assets/sprites/shade/frame-01.webp",
"assets/sprites/shade/frame-02.webp",
"assets/sprites/shade/frame-03.webp",
"assets/sprites/shade/frame-04.webp",
"assets/sprites/shade/frame-05.webp",
"assets/sprites/shade/frame-06.webp",
"assets/sprites/shade/frame-07.webp",
"assets/sprites/shade/frame-08.webp",
"assets/sprites/shade/frame-09.webp",
"assets/sprites/shade/frame-10.webp",
"assets/sprites/shade/frame-11.webp",
"assets/sprites/shade/frame-12.webp",
"assets/sprites/shade/frame-13.webp",
"assets/sprites/shade/frame-14.webp",
"assets/sprites/shade/frame-15.webp",
"assets/sprites/shade/frame-16.webp",
"assets/sprites/shade/frame-17.webp",
"assets/sprites/shade/frame-18.webp",
"assets/sprites/shade/frame-19.webp",
"assets/sprites/shade/frame-20.webp",
"assets/sprites/shade/frame-21.webp",
"assets/sprites/shade/frame-22.webp",
"assets/sprites/shade/frame-23.webp",
"assets/sprites/shade/frame-24.webp",
"assets/sprites/shade/frame-25.webp",
"assets/sprites/shade/frame-26.webp",
"assets/sprites/shade/frame-27.webp",
"assets/sprites/shade/frame-28.webp",
"assets/sprites/shade/frame-29.webp",
"assets/sprites/shade/frame-30.webp",
"assets/sprites/shade/frame-31.webp",
"assets/sprites/shade/frame-32.webp",
"assets/sprites/shade/frame-33.webp",
"assets/sprites/shade/frame-34.webp",
"assets/sprites/shade/frame-35.webp",
"assets/sprites/shade/frame-36.webp",
"assets/sprites/shade/frame-37.webp",
"assets/sprites/shade/frame-38.webp",
"assets/sprites/shade/frame-39.webp",
"assets/sprites/shade/frame-40.webp",
"assets/sprites/shade/frame-41.webp",
"assets/sprites/shade/frame-42.webp",
"assets/sprites/shade/frame-43.webp",
"assets/sprites/shade/frame-44.webp",
"assets/sprites/shade/frame-45.webp",
"assets/sprites/shade/frame-46.webp",
"assets/sprites/shade/frame-47.webp",
"assets/sprites/shade/frame-48.webp",
"assets/sprites/shade/frame-49.webp",
"assets/sprites/shade/frame-50.webp",
"assets/sprites/shade/frame-51.webp",
"assets/sprites/shade/frame-52.webp",
"assets/sprites/shade/frame-53.webp"
  ],
  specter: [
"assets/sprites/specter/frame-00.webp",
"assets/sprites/specter/frame-01.webp",
"assets/sprites/specter/frame-02.webp",
"assets/sprites/specter/frame-03.webp",
"assets/sprites/specter/frame-04.webp",
"assets/sprites/specter/frame-05.webp",
"assets/sprites/specter/frame-06.webp",
"assets/sprites/specter/frame-07.webp",
"assets/sprites/specter/frame-08.webp",
"assets/sprites/specter/frame-09.webp",
"assets/sprites/specter/frame-10.webp",
"assets/sprites/specter/frame-11.webp",
"assets/sprites/specter/frame-12.webp",
"assets/sprites/specter/frame-13.webp",
"assets/sprites/specter/frame-14.webp",
"assets/sprites/specter/frame-15.webp",
"assets/sprites/specter/frame-16.webp",
"assets/sprites/specter/frame-17.webp",
"assets/sprites/specter/frame-18.webp",
"assets/sprites/specter/frame-19.webp",
"assets/sprites/specter/frame-20.webp",
"assets/sprites/specter/frame-21.webp",
"assets/sprites/specter/frame-22.webp",
"assets/sprites/specter/frame-23.webp",
"assets/sprites/specter/frame-24.webp",
"assets/sprites/specter/frame-25.webp",
"assets/sprites/specter/frame-26.webp",
"assets/sprites/specter/frame-27.webp",
"assets/sprites/specter/frame-28.webp",
"assets/sprites/specter/frame-29.webp",
"assets/sprites/specter/frame-30.webp",
"assets/sprites/specter/frame-31.webp",
"assets/sprites/specter/frame-32.webp",
"assets/sprites/specter/frame-33.webp",
"assets/sprites/specter/frame-34.webp",
"assets/sprites/specter/frame-35.webp",
"assets/sprites/specter/frame-36.webp",
"assets/sprites/specter/frame-37.webp",
"assets/sprites/specter/frame-38.webp",
"assets/sprites/specter/frame-39.webp",
"assets/sprites/specter/frame-40.webp",
"assets/sprites/specter/frame-41.webp",
"assets/sprites/specter/frame-42.webp",
"assets/sprites/specter/frame-43.webp",
"assets/sprites/specter/frame-44.webp",
"assets/sprites/specter/frame-45.webp",
"assets/sprites/specter/frame-46.webp",
"assets/sprites/specter/frame-47.webp",
"assets/sprites/specter/frame-48.webp",
"assets/sprites/specter/frame-49.webp",
"assets/sprites/specter/frame-50.webp",
"assets/sprites/specter/frame-51.webp",
"assets/sprites/specter/frame-52.webp",
"assets/sprites/specter/frame-53.webp"
  ],
  lava_imp: [
"assets/sprites/lava_imp/frame-00.webp",
"assets/sprites/lava_imp/frame-01.webp",
"assets/sprites/lava_imp/frame-02.webp",
"assets/sprites/lava_imp/frame-03.webp",
"assets/sprites/lava_imp/frame-04.webp",
"assets/sprites/lava_imp/frame-05.webp",
"assets/sprites/lava_imp/frame-06.webp",
"assets/sprites/lava_imp/frame-07.webp",
"assets/sprites/lava_imp/frame-08.webp",
"assets/sprites/lava_imp/frame-09.webp",
"assets/sprites/lava_imp/frame-10.webp",
"assets/sprites/lava_imp/frame-11.webp",
"assets/sprites/lava_imp/frame-12.webp",
"assets/sprites/lava_imp/frame-13.webp",
"assets/sprites/lava_imp/frame-14.webp",
"assets/sprites/lava_imp/frame-15.webp",
"assets/sprites/lava_imp/frame-16.webp",
"assets/sprites/lava_imp/frame-17.webp",
"assets/sprites/lava_imp/frame-18.webp",
"assets/sprites/lava_imp/frame-19.webp",
"assets/sprites/lava_imp/frame-20.webp",
"assets/sprites/lava_imp/frame-21.webp",
"assets/sprites/lava_imp/frame-22.webp",
"assets/sprites/lava_imp/frame-23.webp",
"assets/sprites/lava_imp/frame-24.webp",
"assets/sprites/lava_imp/frame-25.webp",
"assets/sprites/lava_imp/frame-26.webp",
"assets/sprites/lava_imp/frame-27.webp",
"assets/sprites/lava_imp/frame-28.webp",
"assets/sprites/lava_imp/frame-29.webp"
  ],
  shield_drone: [
"assets/sprites/shield_drone/frame_00.webp",
"assets/sprites/shield_drone/frame_01.webp",
"assets/sprites/shield_drone/frame_02.webp",
"assets/sprites/shield_drone/frame_03.webp",
"assets/sprites/shield_drone/frame_04.webp",
"assets/sprites/shield_drone/frame_05.webp",
"assets/sprites/shield_drone/frame_06.webp",
"assets/sprites/shield_drone/frame_07.webp",
"assets/sprites/shield_drone/frame_08.webp",
"assets/sprites/shield_drone/frame_09.webp",
"assets/sprites/shield_drone/frame_10.webp",
"assets/sprites/shield_drone/frame_11.webp",
"assets/sprites/shield_drone/frame_12.webp",
"assets/sprites/shield_drone/frame_13.webp",
"assets/sprites/shield_drone/frame_14.webp",
"assets/sprites/shield_drone/frame_15.webp",
"assets/sprites/shield_drone/frame_16.webp",
"assets/sprites/shield_drone/frame_17.webp",
"assets/sprites/shield_drone/frame_18.webp",
"assets/sprites/shield_drone/frame_19.webp",
"assets/sprites/shield_drone/frame_20.webp",
"assets/sprites/shield_drone/frame_21.webp",
"assets/sprites/shield_drone/frame_22.webp",
"assets/sprites/shield_drone/frame_23.webp",
"assets/sprites/shield_drone/frame_24.webp",
"assets/sprites/shield_drone/frame_25.webp",
"assets/sprites/shield_drone/frame_26.webp",
"assets/sprites/shield_drone/frame_27.webp",
"assets/sprites/shield_drone/frame_28.webp",
"assets/sprites/shield_drone/frame_29.webp"
  ],
  void_hound: [
"assets/sprites/void_hound/frame-00.webp",
"assets/sprites/void_hound/frame-01.webp",
"assets/sprites/void_hound/frame-02.webp",
"assets/sprites/void_hound/frame-03.webp",
"assets/sprites/void_hound/frame-04.webp",
"assets/sprites/void_hound/frame-05.webp",
"assets/sprites/void_hound/frame-06.webp",
"assets/sprites/void_hound/frame-07.webp",
"assets/sprites/void_hound/frame-08.webp",
"assets/sprites/void_hound/frame-09.webp",
"assets/sprites/void_hound/frame-10.webp",
"assets/sprites/void_hound/frame-11.webp",
"assets/sprites/void_hound/frame-12.webp",
"assets/sprites/void_hound/frame-13.webp",
"assets/sprites/void_hound/frame-14.webp",
"assets/sprites/void_hound/frame-15.webp",
"assets/sprites/void_hound/frame-16.webp",
"assets/sprites/void_hound/frame-17.webp",
"assets/sprites/void_hound/frame-18.webp",
"assets/sprites/void_hound/frame-19.webp",
"assets/sprites/void_hound/frame-20.webp",
"assets/sprites/void_hound/frame-21.webp",
"assets/sprites/void_hound/frame-22.webp",
"assets/sprites/void_hound/frame-23.webp",
"assets/sprites/void_hound/frame-24.webp",
"assets/sprites/void_hound/frame-25.webp",
"assets/sprites/void_hound/frame-26.webp",
"assets/sprites/void_hound/frame-27.webp",
"assets/sprites/void_hound/frame-28.webp",
"assets/sprites/void_hound/frame-29.webp"
  ],
  spore_knight: [
"assets/sprites/spore_knight/frame-00.webp",
"assets/sprites/spore_knight/frame-01.webp",
"assets/sprites/spore_knight/frame-02.webp",
"assets/sprites/spore_knight/frame-03.webp",
"assets/sprites/spore_knight/frame-04.webp",
"assets/sprites/spore_knight/frame-05.webp",
"assets/sprites/spore_knight/frame-06.webp",
"assets/sprites/spore_knight/frame-07.webp",
"assets/sprites/spore_knight/frame-08.webp",
"assets/sprites/spore_knight/frame-09.webp",
"assets/sprites/spore_knight/frame-10.webp",
"assets/sprites/spore_knight/frame-11.webp",
"assets/sprites/spore_knight/frame-12.webp",
"assets/sprites/spore_knight/frame-13.webp",
"assets/sprites/spore_knight/frame-14.webp",
"assets/sprites/spore_knight/frame-15.webp",
"assets/sprites/spore_knight/frame-16.webp",
"assets/sprites/spore_knight/frame-17.webp",
"assets/sprites/spore_knight/frame-18.webp",
"assets/sprites/spore_knight/frame-19.webp",
"assets/sprites/spore_knight/frame-20.webp",
"assets/sprites/spore_knight/frame-21.webp",
"assets/sprites/spore_knight/frame-22.webp",
"assets/sprites/spore_knight/frame-23.webp",
"assets/sprites/spore_knight/frame-24.webp",
"assets/sprites/spore_knight/frame-25.webp",
"assets/sprites/spore_knight/frame-26.webp",
"assets/sprites/spore_knight/frame-27.webp",
"assets/sprites/spore_knight/frame-28.webp",
"assets/sprites/spore_knight/frame-29.webp"
  ],

  twin_rat: [
"assets/sprites/twin_rat/frame-00.webp",
"assets/sprites/twin_rat/frame-01.webp",
"assets/sprites/twin_rat/frame-02.webp",
"assets/sprites/twin_rat/frame-03.webp",
"assets/sprites/twin_rat/frame-04.webp",
"assets/sprites/twin_rat/frame-05.webp",
"assets/sprites/twin_rat/frame-06.webp",
"assets/sprites/twin_rat/frame-07.webp",
"assets/sprites/twin_rat/frame-08.webp",
"assets/sprites/twin_rat/frame-09.webp",
"assets/sprites/twin_rat/frame-10.webp",
"assets/sprites/twin_rat/frame-11.webp",
"assets/sprites/twin_rat/frame-12.webp",
"assets/sprites/twin_rat/frame-13.webp",
"assets/sprites/twin_rat/frame-14.webp",
"assets/sprites/twin_rat/frame-15.webp",
"assets/sprites/twin_rat/frame-16.webp",
"assets/sprites/twin_rat/frame-17.webp",
"assets/sprites/twin_rat/frame-18.webp",
"assets/sprites/twin_rat/frame-19.webp",
"assets/sprites/twin_rat/frame-20.webp",
"assets/sprites/twin_rat/frame-21.webp",
"assets/sprites/twin_rat/frame-22.webp",
"assets/sprites/twin_rat/frame-23.webp",
"assets/sprites/twin_rat/frame-24.webp",
"assets/sprites/twin_rat/frame-25.webp",
"assets/sprites/twin_rat/frame-26.webp",
"assets/sprites/twin_rat/frame-27.webp",
"assets/sprites/twin_rat/frame-28.webp",
"assets/sprites/twin_rat/frame-29.webp",
"assets/sprites/twin_rat/frame-30.webp",
"assets/sprites/twin_rat/frame-31.webp",
"assets/sprites/twin_rat/frame-32.webp",
"assets/sprites/twin_rat/frame-33.webp",
"assets/sprites/twin_rat/frame-34.webp"
  ],

  void_eye: [
"assets/sprites/void_eye/frame-00.webp",
"assets/sprites/void_eye/frame-01.webp",
"assets/sprites/void_eye/frame-02.webp",
"assets/sprites/void_eye/frame-03.webp",
"assets/sprites/void_eye/frame-04.webp",
"assets/sprites/void_eye/frame-05.webp",
"assets/sprites/void_eye/frame-06.webp",
"assets/sprites/void_eye/frame-07.webp",
"assets/sprites/void_eye/frame-08.webp",
"assets/sprites/void_eye/frame-09.webp",
"assets/sprites/void_eye/frame-10.webp",
"assets/sprites/void_eye/frame-11.webp",
"assets/sprites/void_eye/frame-12.webp",
"assets/sprites/void_eye/frame-13.webp",
"assets/sprites/void_eye/frame-14.webp",
"assets/sprites/void_eye/frame-15.webp",
"assets/sprites/void_eye/frame-16.webp",
"assets/sprites/void_eye/frame-17.webp",
"assets/sprites/void_eye/frame-18.webp",
"assets/sprites/void_eye/frame-19.webp",
"assets/sprites/void_eye/frame-20.webp",
"assets/sprites/void_eye/frame-21.webp",
"assets/sprites/void_eye/frame-22.webp",
"assets/sprites/void_eye/frame-23.webp",
"assets/sprites/void_eye/frame-24.webp",
"assets/sprites/void_eye/frame-25.webp",
"assets/sprites/void_eye/frame-26.webp",
"assets/sprites/void_eye/frame-27.webp",
"assets/sprites/void_eye/frame-28.webp",
"assets/sprites/void_eye/frame-29.webp"
  ],

  skeleton_archer: [
"assets/sprites/skeleton_archer/frame-00.webp",
"assets/sprites/skeleton_archer/frame-01.webp",
"assets/sprites/skeleton_archer/frame-02.webp",
"assets/sprites/skeleton_archer/frame-03.webp",
"assets/sprites/skeleton_archer/frame-04.webp",
"assets/sprites/skeleton_archer/frame-05.webp",
"assets/sprites/skeleton_archer/frame-06.webp",
"assets/sprites/skeleton_archer/frame-07.webp",
"assets/sprites/skeleton_archer/frame-08.webp",
"assets/sprites/skeleton_archer/frame-09.webp",
"assets/sprites/skeleton_archer/frame-10.webp",
"assets/sprites/skeleton_archer/frame-11.webp",
"assets/sprites/skeleton_archer/frame-12.webp",
"assets/sprites/skeleton_archer/frame-13.webp",
"assets/sprites/skeleton_archer/frame-14.webp",
"assets/sprites/skeleton_archer/frame-15.webp",
"assets/sprites/skeleton_archer/frame-16.webp",
"assets/sprites/skeleton_archer/frame-17.webp",
"assets/sprites/skeleton_archer/frame-18.webp",
"assets/sprites/skeleton_archer/frame-19.webp",
"assets/sprites/skeleton_archer/frame-20.webp",
"assets/sprites/skeleton_archer/frame-21.webp",
"assets/sprites/skeleton_archer/frame-22.webp",
"assets/sprites/skeleton_archer/frame-23.webp",
"assets/sprites/skeleton_archer/frame-24.webp",
"assets/sprites/skeleton_archer/frame-25.webp",
"assets/sprites/skeleton_archer/frame-26.webp",
"assets/sprites/skeleton_archer/frame-27.webp",
"assets/sprites/skeleton_archer/frame-28.webp",
"assets/sprites/skeleton_archer/frame-29.webp",
"assets/sprites/skeleton_archer/frame-30.webp",
"assets/sprites/skeleton_archer/frame-31.webp",
"assets/sprites/skeleton_archer/frame-32.webp"
  ],

  burst: [
"assets/sprites/burst/frame-00.png",
"assets/sprites/burst/frame-01.png",
"assets/sprites/burst/frame-02.png",
"assets/sprites/burst/frame-03.png",
"assets/sprites/burst/frame-04.png",
"assets/sprites/burst/frame-05.png"
  ],

  slash_red: [
"assets/sprites/slash_red/frame-00.webp",
"assets/sprites/slash_red/frame-01.webp",
"assets/sprites/slash_red/frame-02.webp",
"assets/sprites/slash_red/frame-03.webp",
"assets/sprites/slash_red/frame-04.webp",
"assets/sprites/slash_red/frame-05.webp",
"assets/sprites/slash_red/frame-06.webp",
"assets/sprites/slash_red/frame-07.webp",
"assets/sprites/slash_red/frame-08.webp",
"assets/sprites/slash_red/frame-09.webp",
"assets/sprites/slash_red/frame-10.webp",
"assets/sprites/slash_red/frame-11.webp"
  ],

  slash_blue: [
"assets/sprites/slash_blue/frame-00.webp",
"assets/sprites/slash_blue/frame-01.webp",
"assets/sprites/slash_blue/frame-02.webp",
"assets/sprites/slash_blue/frame-03.webp",
"assets/sprites/slash_blue/frame-04.webp",
"assets/sprites/slash_blue/frame-05.webp",
"assets/sprites/slash_blue/frame-06.webp",
"assets/sprites/slash_blue/frame-07.webp",
"assets/sprites/slash_blue/frame-08.webp",
"assets/sprites/slash_blue/frame-09.webp",
"assets/sprites/slash_blue/frame-10.webp",
"assets/sprites/slash_blue/frame-11.webp"
  ],

  slash_purple: [
"assets/sprites/slash_purple/frame-00.webp",
"assets/sprites/slash_purple/frame-01.webp",
"assets/sprites/slash_purple/frame-02.webp",
"assets/sprites/slash_purple/frame-03.webp",
"assets/sprites/slash_purple/frame-04.webp",
"assets/sprites/slash_purple/frame-05.webp",
"assets/sprites/slash_purple/frame-06.webp",
"assets/sprites/slash_purple/frame-07.webp",
"assets/sprites/slash_purple/frame-08.webp",
"assets/sprites/slash_purple/frame-09.webp",
"assets/sprites/slash_purple/frame-10.webp",
"assets/sprites/slash_purple/frame-11.webp"
  ],

  ult_slash: [
"assets/sprites/ult_slash/frame-00.webp",
"assets/sprites/ult_slash/frame-01.webp",
"assets/sprites/ult_slash/frame-02.webp",
"assets/sprites/ult_slash/frame-03.webp",
"assets/sprites/ult_slash/frame-04.webp",
"assets/sprites/ult_slash/frame-05.webp",
"assets/sprites/ult_slash/frame-06.webp",
"assets/sprites/ult_slash/frame-07.webp",
"assets/sprites/ult_slash/frame-08.webp",
"assets/sprites/ult_slash/frame-09.webp",
"assets/sprites/ult_slash/frame-10.webp",
"assets/sprites/ult_slash/frame-11.webp",
"assets/sprites/ult_slash/frame-12.webp",
"assets/sprites/ult_slash/frame-13.webp",
"assets/sprites/ult_slash/frame-14.webp",
"assets/sprites/ult_slash/frame-15.webp",
"assets/sprites/ult_slash/frame-16.webp",
"assets/sprites/ult_slash/frame-17.webp",
"assets/sprites/ult_slash/frame-18.webp",
"assets/sprites/ult_slash/frame-19.webp"
  ],

  fireball: [
"assets/sprites/fireball/frame-00.webp",
"assets/sprites/fireball/frame-01.webp",
"assets/sprites/fireball/frame-02.webp",
"assets/sprites/fireball/frame-03.webp",
"assets/sprites/fireball/frame-04.webp",
"assets/sprites/fireball/frame-05.webp",
"assets/sprites/fireball/frame-06.webp",
"assets/sprites/fireball/frame-07.webp"
  ],

  waterball: [
"assets/sprites/waterball/frame-00.webp",
"assets/sprites/waterball/frame-01.webp",
"assets/sprites/waterball/frame-02.webp",
"assets/sprites/waterball/frame-03.webp",
"assets/sprites/waterball/frame-04.webp",
"assets/sprites/waterball/frame-05.webp",
"assets/sprites/waterball/frame-06.webp",
"assets/sprites/waterball/frame-07.webp",
"assets/sprites/waterball/frame-08.webp",
"assets/sprites/waterball/frame-09.webp",
"assets/sprites/waterball/frame-10.webp",
"assets/sprites/waterball/frame-11.webp"
  ],
  proj: [
"assets/sprites/proj/frame-00.webp",
"assets/sprites/proj/frame-01.webp",
"assets/sprites/proj/frame-02.webp",
"assets/sprites/proj/frame-03.png",
"assets/sprites/proj/frame-04.png",
"assets/sprites/proj/frame-05.png"
  ],
  void_orb: [
"assets/sprites/void_orb/frame_00.webp",
"assets/sprites/void_orb/frame_01.webp",
"assets/sprites/void_orb/frame_02.webp",
"assets/sprites/void_orb/frame_03.webp",
"assets/sprites/void_orb/frame_04.webp",
"assets/sprites/void_orb/frame_05.webp",
"assets/sprites/void_orb/frame_06.webp",
"assets/sprites/void_orb/frame_07.webp",
"assets/sprites/void_orb/frame_08.webp",
"assets/sprites/void_orb/frame_09.webp",
"assets/sprites/void_orb/frame_10.webp",
"assets/sprites/void_orb/frame_11.webp",
"assets/sprites/void_orb/frame_12.webp",
"assets/sprites/void_orb/frame_13.webp",
"assets/sprites/void_orb/frame_14.webp",
"assets/sprites/void_orb/frame_15.webp",
"assets/sprites/void_orb/frame_16.webp",
"assets/sprites/void_orb/frame_17.webp",
"assets/sprites/void_orb/frame_18.webp",
"assets/sprites/void_orb/frame_19.webp",
"assets/sprites/void_orb/frame_20.webp",
"assets/sprites/void_orb/frame_21.webp",
"assets/sprites/void_orb/frame_22.webp",
"assets/sprites/void_orb/frame_23.webp",
"assets/sprites/void_orb/frame_24.webp",
"assets/sprites/void_orb/frame_25.webp",
"assets/sprites/void_orb/frame_26.webp",
"assets/sprites/void_orb/frame_27.webp",
"assets/sprites/void_orb/frame_28.webp",
"assets/sprites/void_orb/frame_29.webp"
  ],
  crystal_spider: [
"assets/sprites/crystal_spider/frame_00.webp",
"assets/sprites/crystal_spider/frame_01.webp",
"assets/sprites/crystal_spider/frame_02.webp",
"assets/sprites/crystal_spider/frame_03.webp",
"assets/sprites/crystal_spider/frame_04.webp",
"assets/sprites/crystal_spider/frame_05.webp",
"assets/sprites/crystal_spider/frame_06.webp",
"assets/sprites/crystal_spider/frame_07.webp",
"assets/sprites/crystal_spider/frame_08.webp",
"assets/sprites/crystal_spider/frame_09.webp",
"assets/sprites/crystal_spider/frame_10.webp",
"assets/sprites/crystal_spider/frame_11.webp",
"assets/sprites/crystal_spider/frame_12.webp",
"assets/sprites/crystal_spider/frame_13.webp",
"assets/sprites/crystal_spider/frame_14.webp",
"assets/sprites/crystal_spider/frame_15.webp",
"assets/sprites/crystal_spider/frame_16.webp",
"assets/sprites/crystal_spider/frame_17.webp",
"assets/sprites/crystal_spider/frame_18.webp",
"assets/sprites/crystal_spider/frame_19.webp",
"assets/sprites/crystal_spider/frame_20.webp",
"assets/sprites/crystal_spider/frame_21.webp",
"assets/sprites/crystal_spider/frame_22.webp",
"assets/sprites/crystal_spider/frame_23.webp",
"assets/sprites/crystal_spider/frame_24.webp",
"assets/sprites/crystal_spider/frame_25.webp",
"assets/sprites/crystal_spider/frame_26.webp",
"assets/sprites/crystal_spider/frame_27.webp",
"assets/sprites/crystal_spider/frame_28.webp",
"assets/sprites/crystal_spider/frame_29.webp"
  ],


  // Hooks (2026-10-16): per-hero VFX — 8 effect + 6 projectile frames each.
  // Effect kinds ('vfx_<hero>') play via spawnFx; projectile kinds ('proj_<hero>')
  // play via pr.fxKind in the projectile renderer. Shared VFX entries untouched.
  vfx_bastion: [
"assets/sprites/vfx-bastion/frame-00.webp",
"assets/sprites/vfx-bastion/frame-01.webp",
"assets/sprites/vfx-bastion/frame-02.webp",
"assets/sprites/vfx-bastion/frame-03.webp",
"assets/sprites/vfx-bastion/frame-04.webp",
"assets/sprites/vfx-bastion/frame-05.webp",
"assets/sprites/vfx-bastion/frame-06.webp",
"assets/sprites/vfx-bastion/frame-07.webp",
  ],

  proj_bastion: [
"assets/sprites/proj-bastion/frame-00.webp",
"assets/sprites/proj-bastion/frame-01.webp",
"assets/sprites/proj-bastion/frame-02.webp",
"assets/sprites/proj-bastion/frame-03.webp",
"assets/sprites/proj-bastion/frame-04.webp",
"assets/sprites/proj-bastion/frame-05.webp",
  ],

  vfx_rampart: [
"assets/sprites/vfx-rampart/frame-00.webp",
"assets/sprites/vfx-rampart/frame-01.webp",
"assets/sprites/vfx-rampart/frame-02.webp",
"assets/sprites/vfx-rampart/frame-03.webp",
"assets/sprites/vfx-rampart/frame-04.webp",
"assets/sprites/vfx-rampart/frame-05.webp",
"assets/sprites/vfx-rampart/frame-06.webp",
"assets/sprites/vfx-rampart/frame-07.webp",
  ],

  proj_rampart: [
"assets/sprites/proj-rampart/frame-00.webp",
"assets/sprites/proj-rampart/frame-01.webp",
"assets/sprites/proj-rampart/frame-02.webp",
"assets/sprites/proj-rampart/frame-03.webp",
"assets/sprites/proj-rampart/frame-04.webp",
"assets/sprites/proj-rampart/frame-05.webp",
  ],

  vfx_deadeye: [
"assets/sprites/vfx-deadeye/frame-00.webp",
"assets/sprites/vfx-deadeye/frame-01.webp",
"assets/sprites/vfx-deadeye/frame-02.webp",
"assets/sprites/vfx-deadeye/frame-03.webp",
"assets/sprites/vfx-deadeye/frame-04.webp",
"assets/sprites/vfx-deadeye/frame-05.webp",
"assets/sprites/vfx-deadeye/frame-06.webp",
"assets/sprites/vfx-deadeye/frame-07.webp",
  ],

  proj_deadeye: [
"assets/sprites/proj-deadeye/frame-00.webp",
"assets/sprites/proj-deadeye/frame-01.webp",
"assets/sprites/proj-deadeye/frame-02.webp",
"assets/sprites/proj-deadeye/frame-03.webp",
"assets/sprites/proj-deadeye/frame-04.webp",
"assets/sprites/proj-deadeye/frame-05.webp",
  ],

  vfx_vigil: [
"assets/sprites/vfx-vigil/frame-00.webp",
"assets/sprites/vfx-vigil/frame-01.webp",
"assets/sprites/vfx-vigil/frame-02.webp",
"assets/sprites/vfx-vigil/frame-03.webp",
"assets/sprites/vfx-vigil/frame-04.webp",
"assets/sprites/vfx-vigil/frame-05.webp",
"assets/sprites/vfx-vigil/frame-06.webp",
"assets/sprites/vfx-vigil/frame-07.webp",
  ],

  proj_vigil: [
"assets/sprites/proj-vigil/frame-00.webp",
"assets/sprites/proj-vigil/frame-01.webp",
"assets/sprites/proj-vigil/frame-02.webp",
"assets/sprites/proj-vigil/frame-03.webp",
"assets/sprites/proj-vigil/frame-04.webp",
"assets/sprites/proj-vigil/frame-05.webp",
  ],

  vfx_hex: [
"assets/sprites/vfx-hex/frame-00.webp",
"assets/sprites/vfx-hex/frame-01.webp",
"assets/sprites/vfx-hex/frame-02.webp",
"assets/sprites/vfx-hex/frame-03.webp",
"assets/sprites/vfx-hex/frame-04.webp",
"assets/sprites/vfx-hex/frame-05.webp",
"assets/sprites/vfx-hex/frame-06.webp",
"assets/sprites/vfx-hex/frame-07.webp",
  ],

  proj_hex: [
"assets/sprites/proj-hex/frame-00.webp",
"assets/sprites/proj-hex/frame-01.webp",
"assets/sprites/proj-hex/frame-02.webp",
"assets/sprites/proj-hex/frame-03.webp",
"assets/sprites/proj-hex/frame-04.webp",
"assets/sprites/proj-hex/frame-05.webp",
  ],

  vfx_ember: [
"assets/sprites/vfx-ember/frame-00.webp",
"assets/sprites/vfx-ember/frame-01.webp",
"assets/sprites/vfx-ember/frame-02.webp",
"assets/sprites/vfx-ember/frame-03.webp",
"assets/sprites/vfx-ember/frame-04.webp",
"assets/sprites/vfx-ember/frame-05.webp",
"assets/sprites/vfx-ember/frame-06.webp",
"assets/sprites/vfx-ember/frame-07.webp",
  ],

  proj_ember: [
"assets/sprites/proj-ember/frame-00.webp",
"assets/sprites/proj-ember/frame-01.webp",
"assets/sprites/proj-ember/frame-02.webp",
"assets/sprites/proj-ember/frame-03.webp",
"assets/sprites/proj-ember/frame-04.webp",
"assets/sprites/proj-ember/frame-05.webp",
  ],

  vfx_mercy: [
"assets/sprites/vfx-mercy/frame-00.webp",
"assets/sprites/vfx-mercy/frame-01.webp",
"assets/sprites/vfx-mercy/frame-02.webp",
"assets/sprites/vfx-mercy/frame-03.webp",
"assets/sprites/vfx-mercy/frame-04.webp",
"assets/sprites/vfx-mercy/frame-05.webp",
"assets/sprites/vfx-mercy/frame-06.webp",
"assets/sprites/vfx-mercy/frame-07.webp",
  ],

  proj_mercy: [
"assets/sprites/proj-mercy/frame-00.webp",
"assets/sprites/proj-mercy/frame-01.webp",
"assets/sprites/proj-mercy/frame-02.webp",
"assets/sprites/proj-mercy/frame-03.webp",
"assets/sprites/proj-mercy/frame-04.webp",
"assets/sprites/proj-mercy/frame-05.webp",
  ],

  vfx_sage: [
"assets/sprites/vfx-sage/frame-00.webp",
"assets/sprites/vfx-sage/frame-01.webp",
"assets/sprites/vfx-sage/frame-02.webp",
"assets/sprites/vfx-sage/frame-03.webp",
"assets/sprites/vfx-sage/frame-04.webp",
"assets/sprites/vfx-sage/frame-05.webp",
"assets/sprites/vfx-sage/frame-06.webp",
"assets/sprites/vfx-sage/frame-07.webp",
  ],

  proj_sage: [
"assets/sprites/proj-sage/frame-00.webp",
"assets/sprites/proj-sage/frame-01.webp",
"assets/sprites/proj-sage/frame-02.webp",
"assets/sprites/proj-sage/frame-03.webp",
"assets/sprites/proj-sage/frame-04.webp",
"assets/sprites/proj-sage/frame-05.webp",
  ],

  vfx_rook: [
"assets/sprites/vfx-rook/frame-00.webp",
"assets/sprites/vfx-rook/frame-01.webp",
"assets/sprites/vfx-rook/frame-02.webp",
"assets/sprites/vfx-rook/frame-03.webp",
"assets/sprites/vfx-rook/frame-04.webp",
"assets/sprites/vfx-rook/frame-05.webp",
"assets/sprites/vfx-rook/frame-06.webp",
"assets/sprites/vfx-rook/frame-07.webp",
  ],

  proj_rook: [
"assets/sprites/proj-rook/frame-00.webp",
"assets/sprites/proj-rook/frame-01.webp",
"assets/sprites/proj-rook/frame-02.webp",
"assets/sprites/proj-rook/frame-03.webp",
"assets/sprites/proj-rook/frame-04.webp",
"assets/sprites/proj-rook/frame-05.webp",
  ],

  vfx_dusk: [
"assets/sprites/vfx-dusk/frame-00.webp",
"assets/sprites/vfx-dusk/frame-01.webp",
"assets/sprites/vfx-dusk/frame-02.webp",
"assets/sprites/vfx-dusk/frame-03.webp",
"assets/sprites/vfx-dusk/frame-04.webp",
"assets/sprites/vfx-dusk/frame-05.webp",
"assets/sprites/vfx-dusk/frame-06.webp",
"assets/sprites/vfx-dusk/frame-07.webp",
  ],

  proj_dusk: [
"assets/sprites/proj-dusk/frame-00.webp",
"assets/sprites/proj-dusk/frame-01.webp",
"assets/sprites/proj-dusk/frame-02.webp",
"assets/sprites/proj-dusk/frame-03.webp",
"assets/sprites/proj-dusk/frame-04.webp",
"assets/sprites/proj-dusk/frame-05.webp",
  ],

  vfx_shade: [
"assets/sprites/vfx-shade/frame-00.webp",
"assets/sprites/vfx-shade/frame-01.webp",
"assets/sprites/vfx-shade/frame-02.webp",
"assets/sprites/vfx-shade/frame-03.webp",
"assets/sprites/vfx-shade/frame-04.webp",
"assets/sprites/vfx-shade/frame-05.webp",
"assets/sprites/vfx-shade/frame-06.webp",
"assets/sprites/vfx-shade/frame-07.webp",
  ],

  proj_shade: [
"assets/sprites/proj-shade/frame-00.webp",
"assets/sprites/proj-shade/frame-01.webp",
"assets/sprites/proj-shade/frame-02.webp",
"assets/sprites/proj-shade/frame-03.webp",
"assets/sprites/proj-shade/frame-04.webp",
"assets/sprites/proj-shade/frame-05.webp",
  ],

  vfx_specter: [
"assets/sprites/vfx-specter/frame-00.webp",
"assets/sprites/vfx-specter/frame-01.webp",
"assets/sprites/vfx-specter/frame-02.webp",
"assets/sprites/vfx-specter/frame-03.webp",
"assets/sprites/vfx-specter/frame-04.webp",
"assets/sprites/vfx-specter/frame-05.webp",
"assets/sprites/vfx-specter/frame-06.webp",
"assets/sprites/vfx-specter/frame-07.webp",
  ],

  proj_specter: [
"assets/sprites/proj-specter/frame-00.webp",
"assets/sprites/proj-specter/frame-01.webp",
"assets/sprites/proj-specter/frame-02.webp",
"assets/sprites/proj-specter/frame-03.webp",
"assets/sprites/proj-specter/frame-04.webp",
"assets/sprites/proj-specter/frame-05.webp",
  ],

  // arena (2026-10-16): Photoshop-Team-cleaned Arena assets. Single-frame
  // entries (frame-00 only); animated sets cycle via SPRITE_ANIM as usual.
  arena_hit_spark: ["assets/sprites/arena_hit_spark/frame-00.webp"],
  arena_plasma_blast: ["assets/sprites/arena_plasma_blast/frame-00.webp"],
  arena_arcane_burst: ["assets/sprites/arena_arcane_burst/frame-00.webp"],
  // Phase 2: 11 pooled VFX variants (pool only — no call-site changes)
  impact_flash: ["assets/sprites/fx_impact_flash/frame-00.webp"],
  impact_spark: ["assets/sprites/fx_impact_spark/frame-00.webp"],
  spark_shower: ["assets/sprites/fx_spark_shower/frame-00.webp"],
  plasma_eruption: ["assets/sprites/fx_plasma_eruption/frame-00.webp"],
  plasma_explosion: ["assets/sprites/fx_plasma_explosion/frame-00.webp"],
  plasma_fireball: ["assets/sprites/fx_plasma_fireball/frame-00.webp"],
  plasma_shockwave: ["assets/sprites/fx_plasma_shockwave/frame-00.webp"],
  arcane_explosion: ["assets/sprites/fx_arcane_explosion/frame-00.webp"],
  arcane_implosion: ["assets/sprites/fx_arcane_implosion/frame-00.webp"],
  arcane_nova: ["assets/sprites/fx_arcane_nova/frame-00.webp"],
  arcane_pillar: ["assets/sprites/fx_arcane_pillar/frame-00.webp"],
  arena_slime: ["assets/sprites/arena_slime/frame-00.webp"],
  arena_skeleton: ["assets/sprites/arena_skeleton/frame-00.webp"],
  arena_dread_warden: ["assets/sprites/arena_dread_warden/frame-00.webp"],
  arena_potion: ["assets/sprites/arena_potion/frame-00.webp"],
  arena_energy_bolt: ["assets/sprites/arena_energy_bolt/frame-00.webp"],
  arena_gold_coin: ["assets/sprites/arena_gold_coin/frame-00.webp"],
  arena_gem: ["assets/sprites/arena_gem/frame-00.webp"],
  arena_ticket: ["assets/sprites/arena_ticket/frame-00.webp"],
  arena_sword: ["assets/sprites/arena_sword/frame-00.webp"],
  arena_staff: ["assets/sprites/arena_staff/frame-00.webp"],
  arena_dagger: ["assets/sprites/arena_dagger/frame-00.webp"],
  arena_hammer: ["assets/sprites/arena_hammer/frame-00.webp"],
  arena_crown: ["assets/sprites/arena_crown/frame-00.webp"],
  arena_armor: ["assets/sprites/arena_armor/frame-00.webp"],
  arena_shield: ["assets/sprites/arena_shield/frame-00.webp"],
  arena_forge_backdrop: ["assets/sprites/arena_forge_backdrop/frame-00.jpg"],
  sentinel: [
"assets/sprites/sentinel/frame-00.webp",
"assets/sprites/sentinel/frame-01.webp",
"assets/sprites/sentinel/frame-02.webp",
"assets/sprites/sentinel/frame-03.webp",
"assets/sprites/sentinel/frame-04.webp",
"assets/sprites/sentinel/frame-05.webp",
"assets/sprites/sentinel/frame-06.webp",
"assets/sprites/sentinel/frame-07.webp",
"assets/sprites/sentinel/frame-08.webp",
"assets/sprites/sentinel/frame-09.webp",
"assets/sprites/sentinel/frame-10.webp",
"assets/sprites/sentinel/frame-11.webp",
"assets/sprites/sentinel/frame-12.webp",
"assets/sprites/sentinel/frame-13.webp",
"assets/sprites/sentinel/frame-14.webp",
"assets/sprites/sentinel/frame-15.webp",
"assets/sprites/sentinel/frame-16.webp",
"assets/sprites/sentinel/frame-17.webp",
"assets/sprites/sentinel/frame-18.webp",
"assets/sprites/sentinel/frame-19.webp",
"assets/sprites/sentinel/frame-20.webp",
"assets/sprites/sentinel/frame-21.webp",
"assets/sprites/sentinel/frame-22.webp",
"assets/sprites/sentinel/frame-23.webp",
"assets/sprites/sentinel/frame-24.webp",
"assets/sprites/sentinel/frame-25.webp",
"assets/sprites/sentinel/frame-26.webp",
"assets/sprites/sentinel/frame-27.webp",
"assets/sprites/sentinel/frame-28.webp",
"assets/sprites/sentinel/frame-29.webp",
"assets/sprites/sentinel/frame-30.webp",
"assets/sprites/sentinel/frame-31.webp",
"assets/sprites/sentinel/frame-32.webp",
"assets/sprites/sentinel/frame-33.webp",
"assets/sprites/sentinel/frame-34.webp",
"assets/sprites/sentinel/frame-35.webp",
"assets/sprites/sentinel/frame-36.webp",
"assets/sprites/sentinel/frame-37.webp",
"assets/sprites/sentinel/frame-38.webp",
"assets/sprites/sentinel/frame-39.webp",
"assets/sprites/sentinel/frame-40.webp",
"assets/sprites/sentinel/frame-41.webp",
"assets/sprites/sentinel/frame-42.webp",
"assets/sprites/sentinel/frame-43.webp",
"assets/sprites/sentinel/frame-44.webp",
"assets/sprites/sentinel/frame-45.webp",
"assets/sprites/sentinel/frame-46.webp",
"assets/sprites/sentinel/frame-47.webp",
"assets/sprites/sentinel/frame-48.webp",
"assets/sprites/sentinel/frame-49.webp",
"assets/sprites/sentinel/frame-50.webp",
"assets/sprites/sentinel/frame-51.webp",
"assets/sprites/sentinel/frame-52.webp",
"assets/sprites/sentinel/frame-53.webp",
  ],
  hymn: [
"assets/sprites/hymn/frame-00.webp",
"assets/sprites/hymn/frame-01.webp",
"assets/sprites/hymn/frame-02.webp",
"assets/sprites/hymn/frame-03.webp",
"assets/sprites/hymn/frame-04.webp",
"assets/sprites/hymn/frame-05.webp",
"assets/sprites/hymn/frame-06.webp",
"assets/sprites/hymn/frame-07.webp",
"assets/sprites/hymn/frame-08.webp",
"assets/sprites/hymn/frame-09.webp",
"assets/sprites/hymn/frame-10.webp",
"assets/sprites/hymn/frame-11.webp",
"assets/sprites/hymn/frame-12.webp",
"assets/sprites/hymn/frame-13.webp",
"assets/sprites/hymn/frame-14.webp",
"assets/sprites/hymn/frame-15.webp",
"assets/sprites/hymn/frame-16.webp",
"assets/sprites/hymn/frame-17.webp",
"assets/sprites/hymn/frame-18.webp",
"assets/sprites/hymn/frame-19.webp",
"assets/sprites/hymn/frame-20.webp",
"assets/sprites/hymn/frame-21.webp",
"assets/sprites/hymn/frame-22.webp",
"assets/sprites/hymn/frame-23.webp",
"assets/sprites/hymn/frame-24.webp",
"assets/sprites/hymn/frame-25.webp",
"assets/sprites/hymn/frame-26.webp",
"assets/sprites/hymn/frame-27.webp",
"assets/sprites/hymn/frame-28.webp",
"assets/sprites/hymn/frame-29.webp",
"assets/sprites/hymn/frame-30.webp",
"assets/sprites/hymn/frame-31.webp",
"assets/sprites/hymn/frame-32.webp",
"assets/sprites/hymn/frame-33.webp",
"assets/sprites/hymn/frame-34.webp",
"assets/sprites/hymn/frame-35.webp",
"assets/sprites/hymn/frame-36.webp",
"assets/sprites/hymn/frame-37.webp",
"assets/sprites/hymn/frame-38.webp",
"assets/sprites/hymn/frame-39.webp",
"assets/sprites/hymn/frame-40.webp",
"assets/sprites/hymn/frame-41.webp",
"assets/sprites/hymn/frame-42.webp",
"assets/sprites/hymn/frame-43.webp",
"assets/sprites/hymn/frame-44.webp",
"assets/sprites/hymn/frame-45.webp",
"assets/sprites/hymn/frame-46.webp",
"assets/sprites/hymn/frame-47.webp",
"assets/sprites/hymn/frame-48.webp",
"assets/sprites/hymn/frame-49.webp",
"assets/sprites/hymn/frame-50.webp",
"assets/sprites/hymn/frame-51.webp",
"assets/sprites/hymn/frame-52.webp",
"assets/sprites/hymn/frame-53.webp",
  ],
};
const SPRITES = {};
// Phase 3: sprites start as placeholder Images (naturalWidth 0) so every
// existing `img.complete && img.naturalWidth` guard skips them until the real
// frame lands. loadAllAssets() fills them in as files resolve.
for (const k in SPRITE_SRC) SPRITES[k] = SPRITE_SRC[k].map(() => new Image());
let ASSETS_READY = false;
const ASSETS_FAILED = [];
function loadImage(url, timeoutMs, onLate) {
  // BUG-08: every image load has a timeout + error containment. Never rejects.
  // Late-load fill: if the image arrives after the timeout, onLate swaps the
  // placeholder so a slow frame still lands instead of staying blank.
  return new Promise(resolve => {
    const img = new Image();
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; ASSETS_FAILED.push(url);
        img.onload = () => { if (onLate) onLate(img); };
        resolve(new Image()); }
    }, timeoutMs || 30000);
    img.onload = () => { if (!done) { done = true; clearTimeout(timer); resolve(img); } };
    img.onerror = () => { if (!done) { done = true; clearTimeout(timer); ASSETS_FAILED.push(url); resolve(new Image()); } };
    img.src = url;
  });
}
// Phase 3: bounded-concurrency loader. Firing all ~1000 Image loads at once
// starves the decode queue (later sets timed out at 10 s in headless tests);
// 32 in flight keeps every load inside its timeout on real devices too.
async function runPool(tasks, concurrency) {
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < tasks.length) { const t = tasks[idx++]; await t(); }
  });
  await Promise.all(workers);
}
async function loadAllAssets(onProgress) {
  let done = 0;
  const tasks = [];
  const total = Object.values(SPRITE_SRC).reduce((n, a) => n + a.length, 0)
    + Object.values(ENV_RAW).reduce((n, f) => n + f.floors.length + f.accents.length + f.props.length + 1, 0) + 2;
  const tick = () => { done++; if (onProgress) onProgress(done, total); };
  const lateFill = (url, slot) => img => {
    const fi = ASSETS_FAILED.indexOf(url); if (fi >= 0) ASSETS_FAILED.splice(fi, 1);
    slot(img);
  };
  for (const k in SPRITE_SRC) {
    SPRITE_SRC[k].forEach((url, i) => {
      tasks.push(async () => {
        const img = await loadImage(url, 30000, lateFill(url, v => { if (SPRITES[k][i] && !SPRITES[k][i].naturalWidth) SPRITES[k][i] = v; }));
        SPRITES[k][i] = img; tick();
      });
    });
  }
  // ENV sets are built here (async) instead of at parse time.
  for (const f of ['red', 'blue', 'purple']) {
    const r = ENV_RAW[f];
    const set = { floors: [], accents: [], wall: new Image(), props: [], propW: r.propW.slice(), faction: f };
    ENV_SETS[f] = set;
    r.floors.forEach((url, i) => { tasks.push(async () => { set.floors[i] = await loadImage(url, 30000, lateFill(url, v => { if (set.floors[i] && !set.floors[i].naturalWidth) set.floors[i] = v; })); tick(); }); });
    r.accents.forEach((a, i) => { tasks.push(async () => { const img = await loadImage(a[3], 30000, lateFill(a[3], v => { if (set.accents[i] && set.accents[i].img && !set.accents[i].img.naturalWidth) set.accents[i].img = v; })); set.accents[i] = { x: a[0], y: a[1], s: a[2], img }; tick(); }); });
    tasks.push(async () => { set.wall = await loadImage(r.wall, 30000, lateFill(r.wall, v => { if (set.wall && !set.wall.naturalWidth) set.wall = v; })); tick(); });
    r.props.forEach((url, i) => { tasks.push(async () => { set.props[i] = await loadImage(url, 30000, lateFill(url, v => { if (set.props[i] && !set.props[i].naturalWidth) set.props[i] = v; })); tick(); }); });
  }
  tasks.push(async () => { BUSH_IMG = await loadImage(BUSH_SRC, 30000, lateFill(BUSH_SRC, v => { if (BUSH_IMG && !BUSH_IMG.naturalWidth) BUSH_IMG = v; })); tick(); });
  tasks.push(async () => { CHEST_IMG = await loadImage(CHEST_SRC, 30000, lateFill(CHEST_SRC, v => { if (CHEST_IMG && !CHEST_IMG.naturalWidth) CHEST_IMG = v; })); tick(); });
  await runPool(tasks, 32);
  ENV = ENV_SETS.red;
  ASSETS_READY = true;
}
function cardSprite(id, set) { document.querySelector('#' + id + ' .dot').outerHTML = '<img src="' + SPRITE_SRC[set][0] + '" style="width:64px;max-height:96px;image-rendering:pixelated;margin:0 auto 10px;display:block">'; }
cardSprite('faction-red', 'bastion');
cardSprite('faction-blue', 'hex');
cardSprite('faction-purple', 'shade');

const ENV_RAW = {
  red: {
    floors: ["assets/env/red/floor-0.webp", "assets/env/red/floor-1.webp", "assets/env/red/floor-2.webp"],
    accents: [[800, 1000, 300, "assets/env/red/accent-0.webp"], [1300, 800, 260, "assets/env/red/accent-1.webp"], [350, 500, 280, "assets/env/red/accent-2.webp"]],
    wall: "assets/env/red/wall.webp",
    props: ["assets/env/red/prop-0.webp", "assets/env/red/prop-1.webp", "assets/env/red/prop-2.webp", "assets/env/red/prop-3.webp", "assets/env/red/prop-4.webp"],
    propW: [96, 88, 92, 84, 88],
  },
  blue: {
    floors: ["assets/env/blue/floor-0.webp", "assets/env/blue/floor-1.webp", "assets/env/blue/floor-2.webp", "assets/env/blue/floor-3.webp"],
    accents: [[800, 1000, 300, "assets/env/blue/accent-0.webp"], [1300, 800, 260, "assets/env/blue/accent-1.webp"], [350, 500, 280, "assets/env/blue/accent-2.webp"]],
    wall: "assets/env/blue/wall.webp",
    props: ["assets/env/blue/prop-0.webp", "assets/env/blue/prop-1.webp", "assets/env/blue/prop-2.webp", "assets/env/blue/prop-3.webp", "assets/env/blue/prop-4.webp"],
    propW: [84, 96, 88, 80, 84],
  },
  purple: {
    floors: ["assets/env/purple/floor-0.webp", "assets/env/purple/floor-1.webp", "assets/env/purple/floor-2.webp", "assets/env/purple/floor-3.webp"],
    accents: [[800, 1000, 300, "assets/env/purple/accent-0.webp"], [1300, 800, 260, "assets/env/purple/accent-1.webp"], [350, 500, 280, "assets/env/purple/accent-2.webp"]],
    wall: "assets/env/purple/wall.webp",
    props: ["assets/env/purple/prop-0.webp", "assets/env/purple/prop-1.webp", "assets/env/purple/prop-2.webp", "assets/env/purple/prop-3.webp", "assets/env/purple/prop-4.webp"],
    propW: [88, 92, 84, 88, 80],
  }
};
// Phase 3: ENV_SETS is populated by loadAllAssets() (async). ENV starts null;
// render() already guards `ENV && ...`.
const ENV_SETS = {};
let ENV = null;
function selectEnv(faction){ if (ENV_SETS[faction]) ENV = ENV_SETS[faction]; }
const BUSH_SRC = "assets/env/bush.png";
let BUSH_IMG = new Image(); // assigned by loadAllAssets (BUG-08)
const CHEST_SRC = "assets/env/chest.webp";
let CHEST_IMG = new Image(); // assigned by loadAllAssets (BUG-08)
const PROJ_IDX = { tech: 0, magic: 1, hybrid: 2 };
function spawnFx(x, y, kind, opts) {
  opts = opts || {};
  if (G.fx.length >= MAX_FX) return; // drop new FX over budget; never grow unbounded
  G.fx.push({ x, y, kind, t: 0, dur: opts.dur || (kind === 'burst' ? 0.45 : 0.3), rot: opts.rot || 0, size: opts.size || 1, r: opts.r || 0 });
}
function slashSetFor(faction) { // faction-colored slash arcs (CraftPix magic slash pack)
  return faction === 'red' ? 'slash_red' : faction === 'blue' ? 'slash_blue' : 'slash_purple';
}



'use strict';
/* ===== chunk 2: fighters, input, camera ===== */

// ---------- faction kits ----------
const FACTIONS = {
  red:   { color:'#ff5252', dark:'#7a1010', name:'RED // TECH',
           s1:{name:'Plasma Burst', cd:5, en:20}, s2:{name:'Overdrive', cd:12, en:25}, ult:{name:'Orbital Strike', cd:30, en:50} },
  blue:  { color:'#4da3ff', dark:'#0f2f6e', name:'BLUE // MAGIC',
           s1:{name:'Arcane Bolt', cd:5, en:20}, s2:{name:'Frost Nova', cd:12, en:25}, ult:{name:'Meteor', cd:30, en:50} },
  purple:{ color:'#c77dff', dark:'#3d1063', name:'PURPLE // HYBRID',
           s1:{name:'Phase Blades', cd:5, en:20}, s2:{name:'Blink', cd:10, en:25}, ult:{name:'Singularity', cd:30, en:50} },
};

function makePlayer(faction, heroId) {
  const F = FACTIONS[faction];
  // Phase 3 integration: hero base stats from GrindchainGameplay.heroStats
  // (canonical Balance 2.2 values); flat prototype stats are the fallback.
  let HS = null;
  try { if (typeof GrindchainGameplay !== 'undefined' && heroId) HS = GrindchainGameplay.heroStats(heroId); } catch (e) {}
  const _hp = HS ? HS.hp : 100, _atk = HS ? HS.atk : 14, _spd = HS ? HS.speed : 235, _enR = HS ? HS.enRegen : 9;
  return {
    isPlayer: true, faction, x: ARENA.w/2, y: ARENA.h/2 + 200, r: 16,
    vx: 0, vy: 0, speed: _spd, face: -Math.PI/2,
    hp: _hp, maxhp: _hp, en: 100, maxen: 100, enRegen: _enR,
    atk: _atk, atkCd: 0, atkRate: HS ? HS.atkInterval : 0.42,
    potions: { hp: 3, en: 2 }, potionCd: 0,
    cds: { s1: 0, s2: 0, ult: 0, dash: 0 },
    dashT: 0, dashDx: 0, dashDy: 0,
    stun: 0, poison: 0, poisonT: 0, slow: 0, slowT: 0,
    overdriveT: 0, shield: 0,
    alive: true, deadT: 0, color: F.color,
    sprite: null, animT: 0, atkAnimT: 0, hurtT: 0, skillAnimT: 0, skillAnimDur: 1.0, moving: false, px: 0, py: 0,
  };
}
function makeAlly(idx, faction, name, sprite) {
  // Phase 4 rec-fix (BUG-P4-04): allies use FULL base stats via
  // GrindchainGameplay.allyStats() (=== heroStats, Balance 2.2). The old
  // flat 80 HP / 10 ATK override is deleted, not amended. Revive splits are
  // untouched: manual revive 50% / auto-respawn 60% of maxhp (OBS-04).
  let _as = null;
  try { if (typeof GrindchainGameplay !== 'undefined' && sprite) _as = GrindchainGameplay.allyStats(sprite); } catch (e) {}
  const p = makePlayer(faction, sprite); // makePlayer already seeds heroStats; re-assert allyStats explicitly
  p.isPlayer = false; p.name = name;
  p.sprite = sprite;
  p.x += (idx === 1 ? -70 : 70);
  if (_as) { p.hp = _as.hp; p.maxhp = _as.maxhp || _as.hp; p.atk = _as.atk; }
  p.ai = { t: rand(0, 1), tx: p.x, ty: p.y };
  return p;
}
let player = null, allies = [];

// ---------- camera ----------
const cam = { x: 0, y: 0 };
const CAM_Z = 0.85; // zoomed out a bit; player stays dead-center
function updateCamera() {
  const tx = player.x - (W / CAM_Z) / 2, ty = player.y - (H / CAM_Z) / 2;
  cam.x += (tx - cam.x) * 0.15; cam.y += (ty - cam.y) * 0.15;
}

// ---------- input: joystick ----------
const joy = { active: false, id: null, dx: 0, dy: 0 };
const jzone = document.getElementById('joystick-zone');
const jknob = document.getElementById('joystick-knob');
function joyPos(e) {
  const r = jzone.getBoundingClientRect();
  return { cx: r.left + r.width/2, cy: r.top + r.height/2, rad: r.width/2 };
}
jzone.addEventListener('pointerdown', e => {
  joy.active = true; joy.id = e.pointerId; jzone.setPointerCapture(e.pointerId); joyMove(e);
});
jzone.addEventListener('pointermove', e => { if (joy.active && e.pointerId === joy.id) joyMove(e); });
function joyEnd(e) {
  if (e.pointerId === joy.id) {
    joy.active = false; joy.id = null; joy.dx = 0; joy.dy = 0;
    jknob.style.transform = 'translate(-50%,-50%)';
  }
}
jzone.addEventListener('pointerup', joyEnd); jzone.addEventListener('pointercancel', joyEnd);
function joyMove(e) {
  const { cx, cy, rad } = joyPos(e);
  let dx = (e.clientX - cx) / rad, dy = (e.clientY - cy) / rad;
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  joy.dx = dx; joy.dy = dy;
  jknob.style.transform = `translate(calc(-50% + ${dx*38}px), calc(-50% + ${dy*38}px))`;
}

// ---------- input: buttons ----------
function bindHold(id, down, up) {
  const el = document.getElementById(id);
  el.addEventListener('pointerdown', e => { e.preventDefault(); down(); });
  if (up) { el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); }
}
let attackHeld = false;
bindHold('btn-attack', () => attackHeld = true, () => attackHeld = false);
bindHold('btn-skill1', () => castSkill('s1'));
bindHold('btn-skill2', () => castSkill('s2'));
bindHold('btn-ult', () => castSkill('ult'));
bindHold('btn-dash', () => doDash());
bindHold('btn-lock', () => toggleLock());
bindHold('btn-interact', () => doInteract());
bindHold('potion-hp', () => drinkPotion('hp'));
bindHold('potion-en', () => drinkPotion('en'));
document.getElementById('minimap').addEventListener('pointerdown', e => {
  e.preventDefault();
  const w = document.getElementById('minimap-wrap');
  w.classList.toggle('expanded');
  if (!inspectMinimapAt(e)) pingAt(e); // A-12: marker click inspects instead of pinging
});
// A-12: block-typed minimap markers for click-to-inspect (HA-5 pattern).
// Labels/colors come from the shared BLOCK_TYPE_META legend (A-11).
function minimapMarkers() {
  const _btm = (typeof GrindchainGameplay !== 'undefined' && GrindchainGameplay.BLOCK_TYPE_META) || {};
  const _m = (t) => _btm[t] || { label: t, blurb: '' };
  const out = [];
  for (const c of chests) if (!c.opened) out.push({ x: c.x, y: c.y, type: 'vault', label: _m('vault').label, blurb: _m('vault').blurb });
  for (const en of G.enemies) if (en.alive && (en.isBoss || en.elite)) {
    const t = en.isBoss ? 'boss_arena' : 'elite_camp';
    out.push({ x: en.x, y: en.y, type: t, label: _m(t).label, blurb: _m(t).blurb, name: en.name || null });
  }
  return out;
}
function inspectMinimapAt(e) {
  // Returns true when the click landed on a block marker (chip shown, no
  // ping); false lets the existing ping path run. Camera/zoom untouched.
  try {
    let chip = document.getElementById('minimap-inspect');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'minimap-inspect';
      document.getElementById('minimap-wrap').appendChild(chip);
    }
    const mm = document.getElementById('minimap');
    const r = mm.getBoundingClientRect();
    const s = 256, k = s / ARENA.w / mmZoom;
    const ox = s/2 - (cam.x + W / (2 * CAM_Z)) * k, oy = s/2 - (cam.y + H / (2 * CAM_Z)) * k;
    const mx = (e.clientX - r.left) / r.width * s, my = (e.clientY - r.top) / r.height * s;
    let best = null, bd = 14; // hit radius in minimap px
    for (const m of minimapMarkers()) {
      const d = Math.hypot(ox + m.x * k - mx, oy + m.y * k - my);
      if (d < bd) { bd = d; best = m; }
    }
    if (!best) { chip.style.display = 'none'; return false; }
    chip.innerHTML = '<b>' + best.label + '</b>' + (best.name ? ' — ' + best.name : '') + '<br><span>' + best.blurb + '</span>';
    chip.style.display = 'block';
    clearTimeout(chip._t);
    chip._t = setTimeout(() => { chip.style.display = 'none'; }, 4000);
    return true;
  } catch (err) { return false; }
}
document.getElementById('zoom-in').addEventListener('pointerdown', e => { e.stopPropagation(); mmZoom = clamp(mmZoom * 0.8, 0.5, 1.4); });
document.getElementById('zoom-out').addEventListener('pointerdown', e => { e.stopPropagation(); mmZoom = clamp(mmZoom * 1.25, 0.5, 1.4); });
let mmZoom = 1, pings = [];
function pingAt(e) {
  const r = mm.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
  const wx = (px - 0.5) * ARENA.w * mmZoom + cam.x + W / (2 * CAM_Z) - ARENA.w/2 + ARENA.w/2;
  pings.push({ x: clamp(wx, 0, ARENA.w), y: clamp((py - 0.5) * ARENA.h * mmZoom + cam.y + H / (2 * CAM_Z), 0, ARENA.h), t: 3 });
  toast('PING');
}
// keyboard (desktop testing)
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === '1') castSkill('s1'); if (e.key === '2') castSkill('s2');
  if (e.key === '3' || e.key === 'q') castSkill('ult');
  if (e.key === ' ') doDash(); if (e.key === 'f') doInteract();
});
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
document.getElementById('btn-retry').addEventListener('click', () => Game.softReset()); // BUG-06: in-place soft reset


'use strict';
/* ===== chunk 3: combat, skills, enemies, boss ===== */

function nearestEnemy(from, maxD, filterFn) {
  let best = null, bd = maxD;
  for (const e of G.enemies) {
    if (!e.alive || (filterFn && !filterFn(e))) continue;
    const d = dist(from, e);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function aimAt(p, target) {
  if (target) return Math.atan2(target.y - p.y, target.x - p.x);
  return p.face;
}
function fireProjectile(o) {
  G.projectiles.push(o);
}
function applyMageCc(e) { // Hex: attacks slow; repeated hits root (larger monsters need more)
  if (!e.alive) return;
  e.slowT = Math.max(e.slowT || 0, 2);
  e.mageHits = (e.mageHits || 0) + 1;
  e.mageT = 3;
  const need = e.isBoss ? 6 : e.elite ? 5 : e.tanky ? 4 : 3;
  if (e.mageHits >= need) {
    e.mageHits = 0; e.mageT = 0;
    e.rootT = e.isBoss ? 1 : 2;
    addFloater(e.x, e.y - e.r - 14, 'ROOTED', '#7dd3fc');
    addParticles(e.x, e.y, '#7dd3fc', 10);
  }
}
function damageEnemy(e, dmg, dtype, from) {
  if (!e.alive) return;
  // Phase 3 integration: boss damage routes through Gameplay.applyBossDamage
  // (hard-gate shields: wrong-faction damage is exactly 0 / IMMUNE).
  if (e.isBoss && typeof GrindchainGameplay !== 'undefined' && G._gcBoss) {
    const _b = G._gcBoss, _prevPhase = _b.phase, _prevShield = _b.shield;
    const out = GrindchainGameplay.applyBossDamage(_b, dmg, dtype, G.time || 0, {});
    GrindchainGameplay.syncBossToG(_b, e);
    if (out.immune) { addFloater(e.x, e.y - e.r - 6, 'IMMUNE', '#888'); e.hurtT = 0.35; return; }
    if (out.brokeShield) {
      addFloater(e.x, e.y - e.r - 20, 'SHIELD BROKEN', '#2e9cff'); addParticles(e.x, e.y, '#2e9cff', 18);
      try { if (typeof GameAudio !== 'undefined') GameAudio.sfx('shield_break'); } catch (err) {}
      try { if (typeof Analytics !== 'undefined') Analytics.event('shield_break', { tier: G.tier || 1, phase: _b.phase }); } catch (err) {}
    }
    const dealt = out.appliedToHP || out.appliedToShield || 0;
    if (dealt > 0) { addFloater(e.x, e.y - e.r - 6, dealt, '#fff'); addParticles(e.x, e.y, e.color || '#f66', 4); }
    if (out.note) toast(out.note);
    if (_b.phase !== _prevPhase) {
      try { if (typeof GameAudio !== 'undefined') GameAudio.sfx('boss_phase'); } catch (err) {}
      try { if (typeof Analytics !== 'undefined') Analytics.event('boss_phase', { tier: G.tier || 1, phase: _b.phase }); } catch (err) {}
    }
    e.hurtT = 0.35;
    spawnFx(e.x, e.y, 'burst', { size: 2.2 });
    spawnFx(e.x, e.y, 'arena_plasma_blast', { size: 1.4, dur: 0.4 }); // arena: additive boss-hit blast
    if (from && from.isPlayer && from.faction === 'purple' && from.alive) from.hp = Math.min(from.maxhp, from.hp + dealt * 0.06);
    if (e.hp <= 0 && e.alive) killEnemy(e);
    return;
  }
  let mult = 1;
  if (e.resist && e.resist[dtype] !== undefined) mult = 1 - e.resist[dtype];
  // Phase 3 integration: fighter damage runs through Gameplay.damageMultiplier
  // (affinity x synergy x counter, capped 2.00 / floored 0.10) on top of the
  // Wave 1 resist factor. Class passives below still apply after this.
  try {
    if (typeof GrindchainGameplay !== 'undefined' && from && from.faction) {
      const _hs = GrindchainGameplay.heroStats(from.sprite);
      const _syn = GrindchainGameplay.synergyBonus([player && player.sprite, ...allies.map(a => a.sprite)].filter(Boolean));
      const _synDmg = (_syn && from.sprite && _syn[from.sprite]) ? _syn[from.sprite].dmg : 1;
      const _ctr = GrindchainGameplay.counterMultiplier(_hs ? _hs.cls : 'fighter', (GrindchainGameplay.MONSTER_CLASS || {})[e.type] || 'fighter');
      mult = mult * GrindchainGameplay.damageMultiplier({ affinity: GrindchainGameplay.affinityMultiplier(dtype, from.faction), synergy: _synDmg, counter: _ctr, resist: 0 });
      if (from && from.isPlayer && typeof GameAudio !== 'undefined') GameAudio.sfx('hit');
    }
  } catch (err) {}
  let dealt = Math.max(1, Math.round(dmg * mult));
  if (from && heroCls(from.sprite) === 'assassin' && e.tgt && e.tgt !== from) { // ASSASSIN: backstab
    const fa = Math.atan2(e.tgt.y - e.y, e.tgt.x - e.x);
    const sa = Math.atan2(from.y - e.y, from.x - e.x);
    let da = Math.abs(fa - sa); if (da > Math.PI) da = TAU - da;
    if (da > 1.9) { dealt = Math.round(dealt * 1.6); addFloater(e.x, e.y - e.r - 20, 'BACKSTAB', '#e879f9'); addParticles(e.x, e.y, '#e879f9', 6); }
  }
  if (from && heroCls(from.sprite) === 'marksman') { // MARKSMAN: execute — more damage to wounded targets
    const miss = 1 - clamp(e.hp / e.maxhp, 0, 1);
    dealt = Math.round(dealt * (1 + miss * 0.8));
  }
  if (e.shield > 0) { const s = Math.min(e.shield, dealt); e.shield -= s; e.hp -= (dealt - s); }
  else e.hp -= dealt;
  addFloater(e.x, e.y - e.r - 6, dealt, mult < 0.6 ? '#888' : '#fff');
  addParticles(e.x, e.y, e.color || '#f66', 4);
  e.hurtT = 0.35;
  spawnFx(e.x, e.y, 'burst', { size: e.isBoss ? 2.2 : e.elite ? 1.5 : 1 });
  spawnFx(e.x, e.y, 'arena_hit_spark', { size: 0.8, dur: 0.3 }); // arena: additive hit spark
  if (from && heroCls(from.sprite) === 'mage') applyMageCc(e);
  if (from && from.isPlayer && from.faction === 'purple' && from.alive) {
    from.hp = Math.min(from.maxhp, from.hp + dealt * 0.06); // purple lifesteal
  }
  if (e.hp <= 0 && e.alive) killEnemy(e);
}
function damagePlayer(p, dmg, effect, source) {
  if (!p.alive || p.dashT > 0) return;
  if (p.shield > 0) { const s = Math.min(p.shield, dmg); p.shield -= s; dmg -= s; }
  p.hp -= dmg;
  // Combo reset (spec §2.3): ONLY when the PLAYER loses HP from a DIRECT
  // hit. Shield-full-absorb (dmg <= 0 after shield) does not reset;
  // DoT ticks (source 'dot') never reset; ally damage never resets.
  // I-frame hits already early-returned above.
  if (p.isPlayer && (source || 'direct') === 'direct' && dmg > 0) { G.combo = 0; G.comboT = 0; }
  p.hurtT = 0.4;
  G.shake = Math.min(8, G.shake + 3);
  if (p.isPlayer) {
    const v = document.getElementById('vignette');
    v.style.opacity = 0.9; setTimeout(() => v.style.opacity = 0, 130);
  }
  if (effect === 'stun') p.stun = Math.max(p.stun, 1.6);
  if (effect === 'poison') { p.poison = Math.min(5, p.poison + 1); p.poisonT = 4; }
  if (effect === 'slow') p.slowT = 2.5;
  addParticles(p.x, p.y, '#f66', 5);
  try { if (p.isPlayer && typeof GameAudio !== 'undefined') GameAudio.sfx('player_hurt'); } catch (err) {}
  if (p.hp <= 0) {
    p.hp = 0; p.alive = false; p.deadT = p.isPlayer ? 0 : 15; p.deathAnimT = 0; // hooks: death anim (heroes) / game-over backdrop (player)
    addParticles(p.x, p.y, p.color, 24);
    if (p.isPlayer) gameOver(false);
    else toast(p.name + ' DOWN');
  }
}
function killEnemy(e) {
  e.alive = false; G.slain++; G.kills++; e.deathAnimT = 0; // hooks: reserved — enemies have no death frames, so no render path consumes this
  spawnFx(e.x, e.y, 'arena_arcane_burst', { size: 1.0, dur: 0.4 }); // arena: additive kill burst
  // Combo counter (spec §2–§5): party-wide, run-scoped. Combo at kill
  // time is the POST-increment value — the kill that reaches ×5 earns +1.
  G.combo = (G.combo || 0) + 1;
  G.comboT = COMBO_WINDOW;
  if (G.combo > (G.bestComboRun || 0)) G.bestComboRun = G.combo;
  // Kill floater: combo count, sized/colored per spec §4. (No kill floater
  // existed before — killEnemy emitted particles only — so this adds one
  // floater per kill into the existing G.floaters array; cap unchanged.)
  const _fs = comboFloaterStyle(G.combo);
  addFloater(e.x, e.y - e.r - 20, '×' + G.combo, _fs.color, _fs.size);
  // Milestones: once per run per tier (spec §5).
  if (COMBO_MILESTONES.indexOf(G.combo) !== -1) {
    if (!G.milestonesHit) G.milestonesHit = new Set();
    if (!G.milestonesHit.has(G.combo)) {
      G.milestonesHit.add(G.combo);
      toast('COMBO ×' + G.combo + '!');
      try { if (typeof GCIntegration !== 'undefined') GCIntegration.onGameplayEvent('combo_milestone', { tier: G.combo }); } catch (err) {}
      // onGameplayEvent ignores unknown kinds today, so also emit through
      // the established analytics path so the event actually lands.
      try { if (typeof Analytics !== 'undefined') Analytics.event('combo_milestone', { tier: G.combo }); } catch (err) {}
      // Tutorial hint (spec §6): first combo ≥ 5, once per run. Delayed
      // past the milestone toast's 1600 ms fade so both are readable.
      if (G.combo === 5 && !G.comboHintShown) {
        G.comboHintShown = true;
        // FIX 2: run-token guard — a pending hint must never fire in a
        // different run than the one that earned it. Capture the token at
        // schedule time; startGame/softReset increment it, so a fast
        // restart inside the 1700 ms window makes the check below fail
        // and the stale hint is silently dropped.
        const _hintRun = G.runToken || 0;
        setTimeout(() => { try { if (G.running && G.runToken === _hintRun) toast('Combos build as you chain kills — don\'t get hit!'); } catch (err) {} }, 1700);
      }
    }
  }
  // Phase 4 rec-fix (BUG-P4-05): a dying summon frees a cap slot.
  if (e.isSummon && G._gcBoss) G._gcBoss.addsAlive = Math.max(0, (G._gcBoss.addsAlive || 0) - 1);
  try { if (typeof GameAudio !== 'undefined') GameAudio.sfx('kill'); } catch (err) {}
  // Phase 4 rec-fix (OBS-09): honor loot:false — T3 no-loot summons grant NO
  // run gold. addKill() bundles run.kills++ with the gold, and run.kills is
  // never read anywhere (displays use G.kills), so the whole call is skipped
  // for no-loot kills. Normal enemies (loot undefined) and loot:true adds
  // still call addKill exactly as before.
  if (e.loot !== false) { try { if (G._gcRun && typeof GrindchainGameplay !== 'undefined') GrindchainGameplay.addKill(G._gcRun, e.elite ? 'elite' : 'trash', G.combo); } catch (err) {} }
  try { if (typeof GCIntegration !== 'undefined') GCIntegration.onGameplayEvent('kill'); } catch (err) {}
  addParticles(e.x, e.y, e.color || '#f66', 14);
  // loot: potion drops
  if (Math.random() < 0.12) G.pickups.push({ x: e.x, y: e.y, kind: Math.random() < 0.6 ? 'hp' : 'en', t: 20 });
  if (e.isBoss) { onBossDown(e); }
  updateObjective();
  if (G.slain >= G.slainGoal && !G.boss && G.waveState === 'waves') startBoss();
}

// ---------- player actions ----------
function meleeStrike(p, a, range, dmgMul, knockback, dtype) {
  const dmg = p.atk * dmgMul;
  let hit = false;
  for (const e of G.enemies) {
    if (!e.alive) continue;
    if (dist(p, e) > range + e.r) continue;
    const ea = Math.atan2(e.y - p.y, e.x - p.x);
    let da = Math.abs(ea - a); if (da > Math.PI) da = TAU - da;
    if (da > 1.2) continue; // frontal arc only
    damageEnemy(e, dmg, dtype, p);
    if (knockback) {
      const ks = e.isBoss ? knockback * 0.3 : e.elite ? knockback * 0.6 : knockback;
      e.kbx = (e.kbx || 0) + Math.cos(ea) * ks;
      e.kby = (e.kby || 0) + Math.sin(ea) * ks;
    }
    hit = true;
  }
  return hit;
}
function tryAttack(p) {
  if (!p.alive || p.stun > 0 || p.atkCd > 0) return;
  try { if (p.isPlayer && typeof GameAudio !== 'undefined') GameAudio.sfx('attack'); } catch (err) {}
  try { if (p.isPlayer && typeof GCIntegration !== 'undefined') GCIntegration.onGameplayEvent('attack'); } catch (err) {}
  const tgt = (p.isPlayer && G.locked && G.locked.alive) ? G.locked : nearestEnemy(p, heroCls(p.sprite) === 'marksman' ? 560 : 420);
  if (!tgt) return;
  p.atkCd = p.atkRate * (p.overdriveT > 0 ? 0.55 : 1);
  p.atkAnimT = 0.35;
  const a = aimAt(p, tgt); p.face = a;
  if (heroCls(p.sprite) === 'support') { // SUPPORT: healing bolt on most-injured ally + shield
    let hurt = null, worst = 1;
    for (const m of [player, ...allies]) {
      if (!m || m === p || !m.alive) continue;
      const f = m.hp / m.maxhp;
      if (f < worst) { worst = f; hurt = m; }
    }
    if (hurt && worst < 0.999) {
      const amt = Math.round(8 + p.atk * 0.6);
      hurt.hp = Math.min(hurt.maxhp, hurt.hp + amt);
      hurt.shield = Math.min((hurt.shield || 0) + 6, 25);
      addFloater(hurt.x, hurt.y - 26, '+' + amt, '#7dff9a');
      addParticles(hurt.x, hurt.y, '#7dff9a', 10);
      spawnFx(hurt.x, hurt.y, 'burst', { size: 0.7 });
    } else {
      fireProjectile({ x: p.x, y: p.y, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560,
        r: 5, dmg: p.atk, dtype: 'magic', from: p, life: 0.9, color: p.color, friendly: true, arc: true });
    }
    return;
  }
  if (heroCls(p.sprite) === 'tank') { // TANK: melee shield bash with knockback
    const hit = meleeStrike(p, a, 115, 1.3, 430, 'tech');
    spawnFx(tgt.x, tgt.y, slashSetFor(p.faction), { rot: a, size: 1.35 });
    if (hit) { G.shake = Math.max(G.shake, 5); addParticles(p.x + Math.cos(a) * 60, p.y + Math.sin(a) * 60, '#ff5a4e', 8); }
    return;
  }
  if (heroCls(p.sprite) === 'assassin') { // ASSASSIN: fast twin slash
    const hit = meleeStrike(p, a, 100, 1.15, 150, 'hybrid');
    spawnFx(tgt.x, tgt.y, slashSetFor(p.faction), { rot: a, size: 1.0 });
    if (hit) { addParticles(p.x + Math.cos(a) * 56, p.y + Math.sin(a) * 56, '#e879f9', 6); }
    return;
  }
  if (heroCls(p.sprite) === 'fighter') { // FIGHTER: proximity stance — melee up close, ranged at distance
    if (dist(p, tgt) < 140) {
      const hit = meleeStrike(p, a, 115, 1.2, 150, 'hybrid');
      spawnFx(tgt.x, tgt.y, slashSetFor(p.faction), { rot: a, size: 1.1 });
      if (hit) { G.shake = Math.max(G.shake, 3); addParticles(p.x + Math.cos(a) * 56, p.y + Math.sin(a) * 56, '#c084fc', 6); }
    } else {
      fireProjectile({ x: p.x, y: p.y, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560,
        r: 5, dmg: p.atk, dtype: 'hybrid', from: p, life: 0.9, color: p.color, friendly: true, arc: true });
    }
    return;
  }
  const dtype = p.faction === 'red' ? 'tech' : p.faction === 'blue' ? 'magic' : 'hybrid';
  fireProjectile({ x: p.x, y: p.y, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560,
    r: 5, dmg: p.atk, dtype, from: p, life: 0.9, color: p.color, friendly: true, arc: true });
}
// Hooks (2026-10-16): per-hero skill hook. Visual-only: sets the skill-anim
// timer (drawSpriteFighter plays skill frames [44-53]) and spawns the hero's
// own VFX (kind 'vfx_<hero>') ADDITIVELY alongside the existing faction FX.
// No energy/cooldown/damage/projectile/particle/shake behavior changes here.
function spawnHeroSkillFx(p, slot) {
  p.skillAnimT = 1.0; p.skillAnimDur = 1.0; // 10 skill frames at 10 fps
  const kind = 'vfx_' + p.sprite;
  if (typeof SPRITE_SRC !== 'undefined' && SPRITE_SRC[kind]) spawnFx(p.x, p.y, kind, { size: 1.2, dur: 0.8 });
}
function castSkill(slot) {
  const p = player; if (!p || !p.alive || p.stun > 0 || !G.running || G.paused) return;
  const F = FACTIONS[p.faction], cfg = F[slot];
  if (p.cds[slot] > 0 || p.en < cfg.en) { if (p.en < cfg.en) toast('LOW ENERGY'); return; }
  const tgt = (G.locked && G.locked.alive) ? G.locked : nearestEnemy(p, 520);
  const a = aimAt(p, tgt);
  p.en -= cfg.en; p.cds[slot] = cfg.cd; p.face = a;
  spawnHeroSkillFx(p, slot); // hooks: skill anim + per-hero VFX (additive; faction FX below unchanged)
  try { if (typeof GameAudio !== 'undefined') GameAudio.skill(slot, p.faction); } catch (err) {}
  try { if (typeof GCIntegration !== 'undefined') GCIntegration.onGameplayEvent('skill'); } catch (err) {}
  const D = p.faction, dmg = p.atk;
  if (D === 'red') {
    if (slot === 's1') {
      spawnFx(p.x + Math.cos(a) * 44, p.y + Math.sin(a) * 44, 'burst', { size: 1.0 });
      G.shake = Math.max(G.shake, 2.5);
      for (let i = -1; i <= 1; i++)
        fireProjectile({ x: p.x, y: p.y, vx: Math.cos(a + i * 0.22) * 520, vy: Math.sin(a + i * 0.22) * 520,
          r: 6, dmg: dmg * 1.6, dtype: 'tech', from: p, life: 0.8, color: '#ff6b6b', fxKind: 'proj_' + p.sprite, friendly: true });
    }
    if (slot === 's2') { p.overdriveT = 6; toast('OVERDRIVE'); addParticles(p.x, p.y, '#ff6b6b', 16);
      spawnFx(p.x, p.y, 'burst', { size: 1.7 }); hitstop(0.08); G.shake = Math.max(G.shake, 4); }
    if (slot === 'ult') {
      const tx = p.x + Math.cos(a) * 260, ty = p.y + Math.sin(a) * 260;
      showTelegraph(tx, ty, 170, 0.8, '#ff6b6b');
      toast('ORBITAL STRIKE INCOMING'); hitstop(0.1); G.shake = Math.max(G.shake, 3);
      const ultTokenRed = ++G.ultSeq, ultCasterRed = p; // BUG-02: invalidated by game over / soft reset
      if (G.ultTelegraph) G.ultTelegraph.token = ultTokenRed; // Phase 4: telegraph owns its ult token
      setTimeout(() => { if (!G.running || G.ultSeq !== ultTokenRed || !ultCasterRed.alive) { if (G.ultTelegraph && G.ultTelegraph.token === ultTokenRed) G.ultTelegraph = null; return; }
        if (G.ultTelegraph && G.ultTelegraph.token === ultTokenRed) G.ultTelegraph = null;
        ultFlash('#ff6b6b', 0.35); hitstop(0.18); G.shake = 16;
        spawnFx(tx, ty, 'burst', { size: 2.4 });
        spawnFx(tx, ty, 'ult_slash', { size: 2.2, dur: 0.5 });
        addParticles(tx, ty, '#ff6b6b', 40); addParticles(tx, ty, '#ffd75e', 24);
        for (const e of G.enemies) if (e.alive && dist({x:tx,y:ty}, e) < 170) damageEnemy(e, dmg * 5, 'tech', p);
      }, 800);
    }
  } else if (D === 'blue') {
    if (slot === 's1') {
      spawnFx(p.x + Math.cos(a) * 44, p.y + Math.sin(a) * 44, 'burst', { size: 1.0 });
      G.shake = Math.max(G.shake, 2.5);
      fireProjectile({ x: p.x, y: p.y, vx: Math.cos(a) * 620, vy: Math.sin(a) * 620,
        r: 7, dmg: dmg * 1.9, dtype: 'magic', from: p, life: 1.1, color: '#4da3ff', fxKind: 'proj_' + p.sprite, friendly: true, pierce: 2 });
    }
    if (slot === 's2') { addParticles(p.x, p.y, '#4da3ff', 26);
      spawnFx(p.x, p.y, 'burst', { size: 2.0 });
      spawnFx(p.x, p.y, 'waterball', { size: 2.6, dur: 0.6 }); hitstop(0.1); G.shake = Math.max(G.shake, 6);
      toast('FROST NOVA');
      for (const e of G.enemies) if (e.alive && dist(p, e) < 230) { damageEnemy(e, dmg * 1.2, 'magic', p); e.slowT = 3; } }
    if (slot === 'ult') {
      const tx = tgt ? tgt.x : p.x + Math.cos(a) * 260, ty = tgt ? tgt.y : p.y + Math.sin(a) * 260;
      showTelegraph(tx, ty, 200, 0.7, '#ffb14d');
      hitstop(0.1); G.shake = Math.max(G.shake, 3);
      const ultTokenBlue = ++G.ultSeq, ultCasterBlue = p; // BUG-02: invalidated by game over / soft reset
      if (G.ultTelegraph) G.ultTelegraph.token = ultTokenBlue; // Phase 4: telegraph owns its ult token
      setTimeout(() => { if (!G.running || G.ultSeq !== ultTokenBlue || !ultCasterBlue.alive) { if (G.ultTelegraph && G.ultTelegraph.token === ultTokenBlue) G.ultTelegraph = null; return; }
        if (G.ultTelegraph && G.ultTelegraph.token === ultTokenBlue) G.ultTelegraph = null;
        ultFlash('#ffb14d', 0.35); hitstop(0.2); G.shake = 18;
        spawnFx(tx, ty, 'burst', { size: 2.4 });
        spawnFx(tx, ty, 'ult_slash', { size: 2.2, dur: 0.5 });
        spawnFx(tx, ty, 'fireball', { size: 2.0, dur: 0.5 });
        addParticles(tx, ty, '#ffb14d', 46); addParticles(tx, ty, '#fff3d6', 26);
        for (const e of G.enemies) if (e.alive && dist({x:tx,y:ty}, e) < 200) {
          damageEnemy(e, dmg * 5.5, 'magic', p); e.stun = Math.max(e.stun, 1.5);
        }
      }, 700);
      toast('METEOR INCOMING');
    }
  } else {
    if (slot === 's1') {
      spawnFx(p.x + Math.cos(a) * 44, p.y + Math.sin(a) * 44, 'burst', { size: 1.0 });
      G.shake = Math.max(G.shake, 2.5);
      fireProjectile({ x: p.x, y: p.y, vx: Math.cos(a) * 480, vy: Math.sin(a) * 480,
        r: 8, dmg: dmg * 1.4, dtype: 'hybrid', from: p, life: 1.4, color: '#c77dff', fxKind: 'proj_' + p.sprite, friendly: true, boomerang: true, ax: a });
    }
    if (slot === 's2') { // blink
      const d = 190, nx = clamp(p.x + Math.cos(a) * d, 20, ARENA.w - 20), ny = clamp(p.y + Math.sin(a) * d, 20, ARENA.h - 20);
      spawnFx(p.x, p.y, 'burst', { size: 1.2 }); addParticles(p.x, p.y, '#c77dff', 14);
      p.x = nx; p.y = ny;
      spawnFx(p.x, p.y, 'burst', { size: 1.2 }); addParticles(p.x, p.y, '#c77dff', 14);
      hitstop(0.06); toast('BLINK');
    }
    if (slot === 'ult') {
      const tx = tgt ? tgt.x : p.x + Math.cos(a) * 240, ty = tgt ? tgt.y : p.y + Math.sin(a) * 240;
      ultFlash('#c77dff', 0.35); hitstop(0.18); G.shake = 16;
      spawnFx(tx, ty, 'burst', { size: 2.4 });
      spawnFx(tx, ty, 'ult_slash', { size: 2.2, dur: 0.5 });
      addParticles(tx, ty, '#c77dff', 40); addParticles(tx, ty, '#f3e8ff', 24);
      for (const e of G.enemies) if (e.alive && dist({x:tx,y:ty}, e) < 220) {
        const ang = Math.atan2(ty - e.y, tx - e.x);
        e.x += Math.cos(ang) * 60; e.y += Math.sin(ang) * 60;
        damageEnemy(e, dmg * 4, 'hybrid', p);
      }
      toast('SINGULARITY');
    }
  }
}
function doDash() {
  const p = player; if (!p || !p.alive || p.stun > 0 || p.cds.dash > 0 || !G.running || G.paused) return;
  let dx = joy.dx, dy = joy.dy;
  if (Math.hypot(dx, dy) < 0.1) { dx = Math.cos(p.face); dy = Math.sin(p.face); }
  const m = Math.hypot(dx, dy); dx /= m; dy /= m;
  p.cds.dash = 3; p.dashT = 0.18; p.dashDx = dx; p.dashDy = dy;
  addParticles(p.x, p.y, '#9fd8ff', 8);
}
function toggleLock() {
  if (G.locked && G.locked.alive) { G.locked = null; document.getElementById('btn-lock').classList.remove('locked'); }
  else {
    const b = G.boss && G.boss.alive ? G.boss : nearestEnemy(player, 700, e => e.elite);
    const t = b || nearestEnemy(player, 700);
    if (t) { G.locked = t; document.getElementById('btn-lock').classList.add('locked'); toast('TARGET LOCKED'); }
  }
}
function doInteract() {
  const p = player; if (!p || !p.alive) return;
  for (const c of chests) {
    if (!c.opened && dist(p, c) < 70) {
      c.opened = true;
      try { if (G._gcRun && typeof GrindchainGameplay !== 'undefined') GrindchainGameplay.openChest(G._gcRun); } catch (err) {}
      try { if (typeof GameAudio !== 'undefined') GameAudio.sfx('chest'); } catch (err) {}
      const what = Math.random();
      if (what < 0.5) { p.potions.hp = Math.min(5, p.potions.hp + 1); toast('+1 HEAL POTION'); }
      else if (what < 0.8) { p.potions.en = Math.min(5, p.potions.en + 1); toast('+1 ENERGY CELL'); }
      else { p.hp = Math.min(p.maxhp, p.hp + 40); toast('+40 HP'); }
      addParticles(c.x, c.y, '#ffd75e', 18); updatePotionUI(); return;
    }
  }
  for (const a of allies) {
    if (!a.alive && dist(p, a) < 80) { a.alive = true; a.hp = a.maxhp * 0.5; toast(a.name + ' REVIVED'); try { if (typeof GameAudio !== 'undefined') GameAudio.sfx('revive'); } catch (err) {} return; }
  }
}
function drinkPotion(kind) {
  const p = player; if (!p || !p.alive || p.potionCd > 0 || !G.running || G.paused) return;
  if (kind === 'hp' && p.potions.hp > 0 && p.hp < p.maxhp) {
    p.potions.hp--; p.hp = Math.min(p.maxhp, p.hp + 45); p.potionCd = 1; addParticles(p.x, p.y, '#7dff8a', 12);
  } else if (kind === 'en' && p.potions.en > 0 && p.en < p.maxen) {
    p.potions.en--; p.en = Math.min(p.maxen, p.en + 50); p.potionCd = 1; addParticles(p.x, p.y, '#4da3ff', 12);
  } else return;
  try { if (typeof GameAudio !== 'undefined') GameAudio.sfx('potion'); } catch (err) {}
  try { if (typeof GCIntegration !== 'undefined') GCIntegration.onGameplayEvent('potion'); } catch (err) {}
  updatePotionUI();
}

// ---------- enemies ----------
const ETYPES = {
  // fast skirmishers
  lava_imp:   { hp: 26, speed: 165, r: 11, atk: 7,  color: '#ff6b35', score: 1 },
  void_hound: { hp: 34, speed: 175, r: 13, atk: 9,  color: '#7c3aed', score: 1 },
  twin_rat:   { hp: 22, speed: 185, r: 10, atk: 6,  color: '#a8a29e', score: 1 },
  // ranged attackers
  skeleton_archer: { hp: 28, speed: 105, r: 12, atk: 8, color: '#e7e5e4', score: 1, ranged: true },
  void_orb:   { hp: 24, speed: 95,  r: 12, atk: 8,  color: '#c084fc', score: 1, ranged: true },
  void_eye:   { hp: 30, speed: 90,  r: 13, atk: 9,  color: '#e879f9', score: 2, ranged: true },
  // tanky bruisers
  shield_drone:   { hp: 110, speed: 70, r: 18, atk: 14, color: '#64748b', score: 2, tanky: true },
  spore_knight:   { hp: 130, speed: 65, r: 20, atk: 17, color: '#65a30d', score: 2, tanky: true, stuns: true },
  crystal_spider: { hp: 160, speed: 75, r: 22, atk: 20, color: '#22d3ee', score: 3, tanky: true, stuns: true },
  // arena (2026-10-16): reskins — stats cloned from lava_imp / void_hound, no new AI, no balance change
  arena_slime:    { hp: 26, speed: 165, r: 11, atk: 7,  color: '#4ade80', score: 1 },
  arena_skeleton: { hp: 34, speed: 175, r: 13, atk: 9,  color: '#e7e5e4', score: 1 },
};
// weighted spawn pool — crystal_spider only joins from wave 3
const EPOOL = ['lava_imp','lava_imp','void_hound','void_hound','twin_rat','twin_rat',
  'skeleton_archer','skeleton_archer','void_orb','void_eye',
  'shield_drone','spore_knight','arena_slime','arena_skeleton'];
function spawnEnemy(type, x, y, elite) {
  const T = ETYPES[type];
  // Phase 3 integration: monster stats from Gameplay.monsterStats (tier-scaled,
  // R-11/R-12/R-20). Wave-1 wave scaling is retired; blocksCleared ~ wave depth.
  let _ms = null;
  try { if (typeof GrindchainGameplay !== 'undefined') _ms = GrindchainGameplay.monsterStats(type, G.tier || 1, G.wave || 0, { elite: !!elite }); } catch (err) {}
  const _hp = _ms ? _ms.hp : T.hp * (1 + G.wave * 0.22) * (elite ? 3 : 1);
  const _atk = _ms ? _ms.atk : T.atk * (1 + G.wave * 0.12);
  const e = { type, x, y, r: T.r * (elite ? 1.5 : 1), hp: _hp,
    maxhp: _hp, speed: T.speed * rand(0.9, 1.1), atk: _atk,
    color: T.color, alive: true, elite: !!elite, atkCd: rand(0, 1), slowT: 0, stun: 0,
    poison: 0, poisonT: 0, windup: 0, shield: 0,
    ranged: !!T.ranged, tanky: !!T.tanky, stuns: !!T.stuns,
    resist: { tech: 0, magic: 0, hybrid: 0 },
    sprite: type, animT: rand(0, 1), atkAnimT: 0, hurtT: 0, moving: false, px: x, py: y, kbx: 0, kby: 0,
    rootT: 0, mageHits: 0, mageT: 0 };
  if (_ms) e.resist = _ms.resist;
  else { if (T.tanky) e.resist.tech = 0.4; if (T.ranged) e.resist.magic = 0.3; if (elite) { e.resist.tech += 0.15; e.resist.magic += 0.15; } }
  G.enemies.push(e); return e;
}
function spawnWave(n) {
  G.wave = n;
  // Phase 3 integration: checkpoint blocks (draft + checkpoint shop) surface
  // once per run at wave 2, and again at wave 4 for T3/T4 (2 checkpoints).
  try {
    if (typeof GCIntegration !== 'undefined' && !new URLSearchParams(location.search).get('gc-autotest')) {
      const _done = G._gcCheckpointsDone || 0;
      if ((_done === 0 && n === 2) || (_done === 1 && n === 4 && (G.tier || 1) >= 3)) {
        G._gcCheckpointsDone = _done + 1;
        setTimeout(() => { try { GCIntegration.checkpoint(); } catch (err) {} }, 600);
      }
    }
  } catch (err) {}
  const count = 4 + n * 2;
  for (let i = 0; i < count; i++) {
    const edge = Math.floor(rand(0, 4));
    let x, y;
    if (edge === 0) { x = rand(60, ARENA.w - 60); y = 60; }
    else if (edge === 1) { x = rand(60, ARENA.w - 60); y = ARENA.h - 60; }
    else if (edge === 2) { x = 60; y = rand(60, ARENA.h - 60); }
    else { x = ARENA.w - 60; y = rand(60, ARENA.h - 60); }
    // don't spawn on top of player
    if (dist({x, y}, player) < 300) { x = ARENA.w - x; y = ARENA.h - y; }
    const pool = n >= 3 ? EPOOL.concat(['crystal_spider','crystal_spider']) : EPOOL;
    const type = pool[(Math.random()*pool.length)|0];
    // Phase 3 integration: no random elite roll (elites are placed, Elite Camp
    // blocks only). The Wave 1 arena has no Elite Camp blocks, so waves are
    // trash-only; the boss spawns as a placed elite in startBoss().
    G.spawnQueue.push({ type, x, y, elite: false, delay: i * 0.35 });
  }
  G.waveState = 'spawning';
  toast('WAVE ' + n);
}
function startBoss() {
  G.waveState = 'boss';
  // Phase 3 integration: boss built from Gameplay.createBoss (T1/T2 keeper
  // names + swap resists; T3/T4 Dread Warden + hard-gate shields).
  const _tier = G.tier || 1;
  let _gb = null;
  try { if (typeof GrindchainGameplay !== 'undefined') _gb = GrindchainGameplay.createBoss(_tier, { vaultName: 'Ember Caves' }); } catch (err) {}
  const e = spawnEnemy('spore_knight', ARENA.w/2, 200, true);
  e.isBoss = true; e.name = _gb ? _gb.name : (_tier >= 3 ? 'Dread Warden' : 'Vault-Keeper of Ember Caves');
  if (_gb) {
    e.hp = e.maxhp = _gb.hp; e.atk = _gb.atk;
    e.shield = _gb.shield; e.shieldMax = _gb.shieldMax; e.shieldType = _gb.shieldType;
    e.phase = _gb.phase; e.resist = _tier >= 3 ? { tech: 0, magic: 0, hybrid: 0 } : { tech: 0.5, magic: 0.1, hybrid: 0.3 };
    G._gcBoss = _gb;
  } else {
    e.hp = e.maxhp = 900 + G.kills * 4; e.atk = 22;
    e.resist = { tech: 0.5, magic: 0.1, hybrid: 0.3 };
    e.phase = 1; e.shield = 0; e.shieldMax = 200; e.shieldType = 'aegis';
  }
  e.r = 34; e.speed = 95; e.sprite = _tier >= 3 ? 'arena_dread_warden' : 'spore_knight'; e.r = 46; // arena: T3/T4 boss IS the Dread Warden — cleaned art
  G.boss = e;
  document.getElementById('boss-bar-wrap').style.display = 'block';
  document.getElementById('boss-name').textContent = e.name;
  toast('⚠ BOSS: ' + e.name + ' ⚠');
  try { if (typeof GameAudio !== 'undefined') GameAudio.sfx('boss_spawn'); } catch (err) {}
  try { if (typeof Analytics !== 'undefined') Analytics.event('boss_phase', { tier: _tier, phase: 1 }); } catch (err) {}
}
function onBossDown(e) {
  document.getElementById('boss-bar-wrap').style.display = 'none';
  G.boss = null; G.locked = null; G._specialZone = null; // A-1: drop any armed special zone
  document.getElementById('btn-lock').classList.remove('locked');
  for (let i = 0; i < 3; i++)
    G.pickups.push({ x: e.x + rand(-60, 60), y: e.y + rand(-60, 60), kind: 'hp', t: 30 });
  gameOver(true);
}
function updateBossPhase(e, dt) {
  // Phase 3 integration: phase swaps / shield transitions live in
  // Gameplay.applyBossDamage (called from damageEnemy). This tick only drives
  // enrage + summons via Gameplay.bossTick. Legacy swap path kept as fallback
  // when the Gameplay module is absent.
  if (typeof GrindchainGameplay !== 'undefined' && G._gcBoss) {
    const _bt = GrindchainGameplay.bossTick(G._gcBoss, dt || 0, G.time || 0);
    e.atk = G._gcBoss.atk;
    // A-1: telegraphed boss special — pendingSpecial -> windup (>= 0.7s, danger
    // zone marked) -> detonation through the existing damage path (damagePlayer,
    // boss.atk). No new damage numbers; boss stats untouched.
    (_bt.specials || []).forEach(sp => {
      if (sp.trigger && player && player.alive) {
        // Danger zone marks the player's position at trigger time; the full
        // windup is the dodge window.
        G._specialZone = { x: player.x, y: player.y, r: sp.zoneR || 130 };
        spawnFx(player.x, player.y, 'telegraph_zone', { dur: sp.windup || 1.2, r: sp.zoneR || 130 });
        try { if (typeof GameAudio !== 'undefined') GameAudio.sfx('telegraph'); } catch (err) {}
        toast('⚠ ' + e.name + ' IS CHARGING AN ATTACK — MOVE! ⚠');
      }
      if (sp.detonate) {
        const _z = G._specialZone;
        G._specialZone = null;
        spawnFx(_z ? _z.x : e.x, _z ? _z.y : e.y, 'burst', { size: 1.6, dur: 0.5 });
        try { if (typeof GameAudio !== 'undefined') GameAudio.sfx('telegraph_stun'); } catch (err) {}
        if (_z) {
          for (const p of [player, ...allies]) {
            if (p && p.alive && dist(p, _z) < _z.r) damagePlayer(p, e.atk);
          }
        }
      }
    });
    (_bt.summons || []).forEach(s => {
      // Phase 4 rec-fix (BUG-P4-05): enforce the spec summon cap — track adds
      // alive on G._gcBoss.addsAlive (increment on summon, decrement in
      // killEnemy). Capped waves (T1/T2, cap 4) spawn only up to the
      // remaining slots, so addsAlive can never exceed 4 even when bossTick
      // emits 2 while 3 are alive. Every summon is tagged isSummon + its
      // loot flag so killEnemy can honor loot:false (OBS-09). T3 summons
      // carry no cap field and spawn their full count, still tracked.
      const _cap = (typeof s.cap === 'number') ? s.cap : Infinity;
      const _room = Math.max(0, Math.min(s.count || 0, _cap - (G._gcBoss.addsAlive || 0)));
      for (let i = 0; i < _room; i++) {
        const _add = spawnEnemy('void_hound', e.x + rand(-120, 120), e.y + rand(-120, 120));
        if (_add) { _add.isSummon = true; _add.loot = (s.loot !== false); G._gcBoss.addsAlive = (G._gcBoss.addsAlive || 0) + 1; }
      }
      if (_room > 0) toast(e.name + ' SUMMONS MINIONS');
    });
    if (_bt.enraged) toast(e.name + ' IS ENRAGED');
    return;
  }
  const frac = e.hp / e.maxhp;
  if (frac < 0.66 && e.phase === 1) { e.phase = 2; e.shieldType = 'mana-ward'; e.resist = { tech: 0.1, magic: 0.5, hybrid: 0.3 }; toast('WARDEN ADAPTS — MAGIC RESISTANT'); }
  if (frac < 0.33 && e.phase === 2) { e.phase = 3; e.shieldType = 'fusion-core'; e.resist = { tech: 0.3, magic: 0.3, hybrid: 0.55 }; toast('WARDEN ADAPTS — HYBRID RESISTANT'); }
  if (e.phase >= 2 && Math.random() < 0.004) {
    for (let i = 0; i < 2; i++) spawnEnemy('void_hound', e.x + rand(-120, 120), e.y + rand(-120, 120));
    toast('WARDEN SUMMONS MINIONS');
  }
}


'use strict';
/* ===== chunk 4: loop, AI, render, minimap, HUD ===== */

// Phase 3 perf budgets: Orbital Strike emits 64 particles (40 + 24) — inside budget.
let MAX_PARTICLES = 220, MAX_FLOATERS = 40, MAX_FX = 24;
const DEATH_ANIM_DUR = 0.8;
// Hooks (2026-10-16): hero death-anim window. Death frames [36-43] (8 frames) play
// at 10 fps => 0.8 s. No removal-timing change: enemies keep the 0.5 s filter
// (they have no death frames); allies stay in the allies array; the player
// death anim plays on the game-over backdrop because gameOver stops the loop.
// Phase 3 integration: quality budgets from Settings (settings.js).
// Applied at run start; a quality change applies on the next run start.
function applyQualityCaps() { try { if (typeof Settings !== 'undefined' && Settings.qualityCaps) { const c = Settings.qualityCaps(Settings.get().quality); MAX_PARTICLES = c.particleCap; MAX_FX = c.fxCap; } } catch (e) {} }
function addParticles(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(40, 200);
    G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: rand(0.3, 0.7), color, r: rand(2, 4) });
  }
  if (G.particles.length > MAX_PARTICLES) G.particles.splice(0, G.particles.length - MAX_PARTICLES);
}
function addFloater(x, y, txt, color, size) {
  G.floaters.push({ x, y, txt: String(txt), color: color || '#fff', t: 0.8, size: size || 13 });
  if (G.floaters.length > MAX_FLOATERS) G.floaters.splice(0, G.floaters.length - MAX_FLOATERS);
}
function hitstop(t) { G.hitstop = Math.max(G.hitstop || 0, t); }
function ultFlash(color, dur) { G.flash = { t: dur || 0.3, dur: dur || 0.3, color: color || '#ffffff' }; }
function showTelegraph(x, y, r, dur, color) { G.ultTelegraph = { x, y, r, t: 0, dur, color }; try { if (typeof GameAudio !== 'undefined') GameAudio.telegraph('aoe'); } catch (err) {} }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.opacity = 1;
  clearTimeout(t._h); t._h = setTimeout(() => t.style.opacity = 0, 1600);
}
function updateObjective() {
  document.getElementById('objective').textContent =
    `Floor 1 · Slain ${Math.min(G.slain, G.slainGoal)}/${G.slainGoal}` + (G.waveState === 'boss' ? ' · BOSS' : '');
}
function updatePotionUI() {
  document.getElementById('php-count').textContent = player.potions.hp;
  document.getElementById('pen-count').textContent = player.potions.en;
}

function collideWalls(o) {
  // Movement pass (2026-10-20): two resolution passes + center-inside escape.
  // The old single pass skipped resolution entirely when the center was
  // inside a rect (d < 0.01 guard): a unit knocked/teleported inside a wall
  // stayed buried (measured: center 100px inside a block, still inside
  // after 90 idle steps, zero collision while walking out through it).
  // Pass 2 also clears the residual penetration when resolving wall A
  // pushes the unit into an adjacent wall B at concave corners.
  for (let pass = 0; pass < 2; pass++) {
    for (const w of walls) {
      const nx = clamp(o.x, w.x, w.x + w.w), ny = clamp(o.y, w.y, w.y + w.h);
      const dx = o.x - nx, dy = o.y - ny;
      const d = Math.hypot(dx, dy);
      if (d >= o.r) continue;
      if (d > 0.01) { o.x = nx + dx / d * o.r; o.y = ny + dy / d * o.r; }
      else {
        // center inside the rect: escape along the smallest penetration axis
        const pl = o.x - w.x, pr = w.x + w.w - o.x, pt = o.y - w.y, pb = w.y + w.h - o.y;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) o.x = w.x - o.r; else if (m === pr) o.x = w.x + w.w + o.r;
        else if (m === pt) o.y = w.y - o.r; else o.y = w.y + w.h + o.r;
      }
    }
  }
  o.x = clamp(o.x, o.r, ARENA.w - o.r); o.y = clamp(o.y, o.r, ARENA.h - o.r);
}

// Movement pass (2026-10-20): unit separation. There was NO unit-vs-unit
// separation anywhere: units chasing the same target converged to the
// identical point (measured: 6 melee enemies spawned apart ended at
// pairwise distance 0.0 — a single stacked sprite). Positional push-apart
// only, applied once per step; the player is never pushed, bosses are
// immovable. Pushed units are re-resolved against walls.
function separateUnits() {
  const pair = (a, b, fa, fb) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const min = (a.r + b.r) * 0.85;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return false;
    let ux, uy, ov;
    if (d2 > 0.0001) { const d = Math.sqrt(d2); ux = dx / d; uy = dy / d; ov = min - d; }
    else { ux = ((a.x * 31 + b.y * 17) % 2) ? 1 : -1; uy = 0; ov = min; } // exact overlap: deterministic split
    a.x -= ux * ov * fa; a.y -= uy * ov * fa;
    b.x += ux * ov * fb; b.y += uy * ov * fb;
    return true;
  };
  const es = G.enemies;
  for (let i = 0; i < es.length; i++) {
    const a = es[i]; if (!a.alive) continue;
    let pushed = false;
    for (let j = i + 1; j < es.length; j++) {
      const b = es[j]; if (!b.alive) continue;
      if (a.isBoss && b.isBoss) continue;
      if (a.isBoss) pushed = pair(b, a, 1, 0) || pushed;
      else if (b.isBoss) pushed = pair(a, b, 1, 0) || pushed;
      else pushed = pair(a, b, 0.5, 0.5) || pushed;
    }
    if (pushed) collideWalls(a);
  }
  for (let i = 0; i < allies.length; i++) {
    const a = allies[i]; if (!a || !a.alive) continue;
    let pushed = pair(a, player, 1, 0);
    for (let j = i + 1; j < allies.length; j++) {
      const b = allies[j]; if (!b || !b.alive) continue;
      pushed = pair(a, b, 0.5, 0.5) || pushed;
    }
    if (pushed) collideWalls(a);
  }
}
function inBush(o) { return bushes.some(b => o.x > b.x && o.x < b.x + b.w && o.y > b.y && o.y < b.y + b.h); }

function updatePlayer(p, dt, isMain) {
  if (!p.alive) {
    if (p.deathAnimT !== undefined) p.deathAnimT = Math.min(DEATH_ANIM_DUR, p.deathAnimT + dt); // hooks: ally death anim
    if (!isMain) { p.deadT -= dt; if (p.deadT <= 0) { p.alive = true; p.hp = p.maxhp * 0.6; p.x = player.x + 40; p.y = player.y + 40; } }
    return;
  }
  for (const k in p.cds) p.cds[k] = Math.max(0, p.cds[k] - dt);
  p.atkCd = Math.max(0, p.atkCd - dt);
  p.potionCd = Math.max(0, p.potionCd - dt);
  p.overdriveT = Math.max(0, p.overdriveT - dt);
  p.en = Math.min(p.maxen, p.en + p.enRegen * dt);
  // status
  if (p.stun > 0) { p.stun -= dt; }
  if (p.poisonT > 0) { p.poisonT -= dt; p.hp -= p.poison * 2.2 * dt; if (p.hp <= 0) { damagePlayer(p, 1, undefined, 'dot'); return; } }
  if (p.slowT > 0) p.slowT -= dt;

  if (isMain) {
    let dx = joy.dx, dy = joy.dy;
    if (keys['w'] || keys['arrowup']) dy -= 1; if (keys['s'] || keys['arrowdown']) dy += 1;
    if (keys['a'] || keys['arrowleft']) dx -= 1; if (keys['d'] || keys['arrowright']) dx += 1;
    const m = Math.hypot(dx, dy);
    if (p.stun <= 0) {
      if (p.dashT > 0) {
        p.dashT -= dt;
        p.x += p.dashDx * 900 * dt; p.y += p.dashDy * 900 * dt;
      } else if (m > 0.12) {
        const sp = p.speed * (p.faction === 'red' ? 1.1 : 1) * (p.slowT > 0 ? 0.55 : 1);
        p.x += dx / Math.max(1, m) * sp * dt; p.y += dy / Math.max(1, m) * sp * dt;
        p.face = Math.atan2(dy, dx);
      }
      if (attackHeld || keys['j']) tryAttack(p);
    }
    // interact prompt
    const nearChest = chests.some(c => !c.opened && dist(p, c) < 70);
    const nearDead = allies.some(a => !a.alive && dist(p, a) < 80);
    document.getElementById('btn-interact').style.display = (nearChest || nearDead) ? 'flex' : 'none';
    // pickups
    for (const pk of G.pickups) {
      if (pk.t > 0 && dist(p, pk) < 30) {
        pk.t = 0;
        if (pk.kind === 'hp') { p.potions.hp = Math.min(5, p.potions.hp + 1); toast('+1 HEAL POTION'); }
        else { p.potions.en = Math.min(5, p.potions.en + 1); toast('+1 ENERGY CELL'); }
        updatePotionUI(); addParticles(pk.x, pk.y, '#ffd75e', 10);
        try { if (typeof GameAudio !== 'undefined') GameAudio.sfx('pickup'); } catch (err) {}
      }
    }
  } else {
    // ally AI
    p.ai.t -= dt;
    if (p.ai.t <= 0) { p.ai.t = rand(0.4, 0.9); }
    const tgt = nearestEnemy(p, 460);
    if (p.stun <= 0 && tgt) {
      const d = dist(p, tgt);
      // Movement pass (2026-10-20): engage hysteresis. The single 260px
      // threshold toggled allies between chase and stand on every step a
      // target drifted across it. Chase until inside 245, hold the stance
      // until the target is past 275.
      if (d > 275) p.ai.hold = false; else if (d < 245) p.ai.hold = true;
      if (!p.ai.hold) { const a = Math.atan2(tgt.y - p.y, tgt.x - p.x); p.x += Math.cos(a) * p.speed * 0.85 * dt; p.y += Math.sin(a) * p.speed * 0.85 * dt; p.face = a; }
      else { p.face = Math.atan2(tgt.y - p.y, tgt.x - p.x); tryAttack(p); }
    } else if (p.stun <= 0) {
      // Follow hysteresis (start past 150, stop inside 115) — same fix.
      // Also gated on stun now: the old else-if could move a stunned ally.
      const pd = dist(p, player);
      if (pd > 150) p.ai.follow = true; else if (pd < 115) p.ai.follow = false;
      if (p.ai.follow) {
        const a = Math.atan2(player.y - p.y, player.x - p.x);
        p.x += Math.cos(a) * p.speed * 0.9 * dt; p.y += Math.sin(a) * p.speed * 0.9 * dt;
      }
    }
  }
  p.atkAnimT = Math.max(0, p.atkAnimT - dt);
  p.hurtT = Math.max(0, p.hurtT - dt);
  p.skillAnimT = Math.max(0, (p.skillAnimT || 0) - dt); // hooks: skill anim
  p.animT += dt;
  const _disp = Math.hypot(p.x - p.px, p.y - p.py);
  p.moving = _disp > 0.6;
  // Movement pass (2026-10-20): walk phase advances with DISTANCE, not
  // time. The time-based cycle desynced legs from ground whenever actual
  // speed differed from the cycle's implicit rate: slowed movement (0.55x)
  // kept full-rate legs (measured stride 127px/cycle vs 231 normal),
  // allies at 0.85/0.9x slid ~15%, fast heroes slid more than slow ones.
  // 230px of travel = one full walk cycle for every unit and state.
  // Phase freezes during a dash (a dash is a glide, not a run) and the
  // per-step advance is capped so teleports/respawns can't spin the cycle.
  if ((p.dashT || 0) <= 0) p.walkPh = (p.walkPh || 0) + Math.min(_disp, 8) / 230;
  p.px = p.x; p.py = p.y;
  collideWalls(p);
}

function updateEnemies(dt) {
  // spawn queue
  if (G.spawnQueue.length) {
    G.spawnT -= dt;
    const s = G.spawnQueue[0];
    s.delay -= dt;
    if (s.delay <= 0) { spawnEnemy(s.type, s.x, s.y, s.elite); G.spawnQueue.shift(); }
  } else if (G.waveState === 'spawning' && !G.enemies.some(e => e.alive)) {
    try { if (G._gcRun && typeof GrindchainGameplay !== 'undefined') GrindchainGameplay.clearBlock(G._gcRun); } catch (err) {}
    if (G.slain >= G.slainGoal) startBoss();
    else { G.waveState = 'waves'; spawnWave(G.wave + 1); }
  }
  for (const e of G.enemies) {
    if (!e.alive) continue;
    e.atkAnimT = Math.max(0, (e.atkAnimT || 0) - dt);
    e.hurtT = Math.max(0, (e.hurtT || 0) - dt);
    e.animT = (e.animT || 0) + dt;
    const _ed = Math.hypot(e.x - e.px, e.y - e.py);
    e.moving = _ed > 0.6;
    e.walkPh = (e.walkPh || 0) + Math.min(_ed, 8) / 230; // see updatePlayer: distance-based walk phase
    e.px = e.x; e.py = e.y;
    if (e.kbx || e.kby) {
      e.x += e.kbx * dt; e.y += e.kby * dt;
      const dk = Math.max(0, 1 - 7 * dt); e.kbx *= dk; e.kby *= dk;
      collideWalls(e);
    }
    e.rootT = Math.max(0, (e.rootT || 0) - dt);
    if (e.mageT > 0) { e.mageT -= dt; if (e.mageT <= 0) e.mageHits = 0; }
    const rooted = e.rootT > 0;
    if (e.stun > 0) { e.stun -= dt; continue; }
    if (e.slowT > 0) e.slowT -= dt;
    if (e.poisonT > 0) { e.poisonT -= dt; e.hp -= e.poison * 3 * dt; if (e.hp <= 0) { killEnemy(e); continue; } }
    if (e.isBoss) updateBossPhase(e, dt);
    // target: nearest alive party member
    let tgt = player.alive ? player : null, bd = tgt ? dist(e, tgt) : 1e9;
    for (const a of allies) if (a.alive) { const d = dist(e, a); if (d < bd) { bd = d; tgt = a; } }
    e.tgt = tgt;
    if (!tgt || inBush(e)) { // ambush: wait in bush
      if (!tgt) continue;
    }
    e.atkCd -= dt;
    const sp = e.speed * (e.slowT > 0 ? 0.5 : 1);
    if (e.ranged) {
      if (!rooted && bd > 320) { const a = Math.atan2(tgt.y - e.y, tgt.x - e.x); e.x += Math.cos(a) * sp * dt; e.y += Math.sin(a) * sp * dt; }
      else if (!rooted && bd < 200) { const a = Math.atan2(e.y - tgt.y, e.x - tgt.x); e.x += Math.cos(a) * sp * dt; e.y += Math.sin(a) * sp * dt; }
      if (e.atkCd <= 0 && bd < 420) {
        e.atkCd = 2.2; e.atkAnimT = 0.4; const a = Math.atan2(tgt.y - e.y, tgt.x - e.x);
        fireProjectile({ x: e.x, y: e.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
          r: 6, dmg: e.atk, dtype: 'magic', from: e, life: 2, color: e.color, friendly: false, effect: 'poison' });
      }
    } else {
      // melee: windup telegraph for brute stun slam
      if (bd > e.r + (tgt.r || 14) + 6) {
        if (!rooted) { const a = Math.atan2(tgt.y - e.y, tgt.x - e.x); e.x += Math.cos(a) * sp * dt; e.y += Math.sin(a) * sp * dt; }
        e.windup = 0; e._telePlayed = false;
      } else {
        if (e.stuns) {
          e.windup += dt;
          if (e.windup > 0.35 && !e._telePlayed) { e._telePlayed = true; try { if (typeof GameAudio !== 'undefined') GameAudio.telegraph('stun'); } catch (err) {} }
          if (e.windup > 0.7 && e.atkCd <= 0) {
            e.atkCd = 3; e.windup = 0; e._telePlayed = false; e.atkAnimT = 0.4; G.shake = 6;
            addParticles(e.x, e.y, '#c026d3', 20);
            if (dist(e, tgt) < 120) damagePlayer(tgt, e.atk, 'stun');
          }
        } else if (e.atkCd <= 0) {
          e.atkCd = 1.4; e.atkAnimT = 0.35; damagePlayer(tgt, e.atk);
        }
      }
    }
    collideWalls(e);
  }
  G.enemies = G.enemies.filter(e => e.alive || (e.deathT = (e.deathT || 0) + dt) < 0.5);
}

function updateProjectiles(dt) {
  for (const pr of G.projectiles) {
    pr.life -= dt;
    pr.x += pr.vx * dt; pr.y += pr.vy * dt;
    if (pr.boomerang && pr.life < 0.7) { // curve back
      const a = Math.atan2(player.y - pr.y, player.x - pr.x);
      pr.vx = Math.cos(a) * 480; pr.vy = Math.sin(a) * 480;
      if (dist(pr, player) < 30) pr.life = 0;
    }
    if (pr.life <= 0 || pr.x < 0 || pr.x > ARENA.w || pr.y < 0 || pr.y > ARENA.h) continue;
    let hitWall = false;
    for (const w of walls) {
      if (pr.x > w.x && pr.x < w.x + w.w && pr.y > w.y && pr.y < w.y + w.h) { hitWall = true; break; }
    }
    if (hitWall) { pr.life = 0; addParticles(pr.x, pr.y, pr.color, 4); continue; }
    if (pr.friendly) {
      for (const e of G.enemies) {
        if (!e.alive) continue;
        if (dist(pr, e) < pr.r + e.r) {
          damageEnemy(e, pr.dmg, pr.dtype, pr.from);
          addParticles(pr.x, pr.y, pr.color, 5);
          if (pr.arc) spawnFx(e.x, e.y, slashSetFor(pr.from && pr.from.faction), { rot: Math.atan2(pr.vy, pr.vx), size: 0.8 });
          if (pr.pierce && pr.pierce > 0) pr.pierce--; else { pr.life = 0; break; }
        }
      }
    } else {
      for (const p of [player, ...allies]) {
        if (!p.alive || dist(pr, p) > pr.r + p.r) continue;
        damagePlayer(p, pr.dmg, pr.effect); spawnFx(pr.x, pr.y, 'burst', { size: 0.8 }); pr.life = 0; break;
      }
    }
  }
  G.projectiles = G.projectiles.filter(p => p.life > 0);
  for (const pt of G.particles) { pt.t -= dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= 0.96; pt.vy *= 0.96; }
  G.particles = G.particles.filter(p => p.t > 0);
  for (const f of G.floaters) { f.t -= dt; f.y -= 34 * dt; }
  G.floaters = G.floaters.filter(f => f.t > 0);
  for (const f of G.fx) f.t += dt;
  G.fx = G.fx.filter(f => f.t < f.dur);
  if (G.flash) { G.flash.t -= dt; if (G.flash.t <= 0) G.flash = null; }
  if (G.ultTelegraph) { G.ultTelegraph.t += dt; if (G.ultTelegraph.t >= G.ultTelegraph.dur) G.ultTelegraph = null; }
  for (const pk of G.pickups) pk.t -= dt;
  G.pickups = G.pickups.filter(p => p.t > 0);
  for (let i = pings.length - 1; i >= 0; i--) { pings[i].t -= dt; if (pings[i].t <= 0) pings.splice(i, 1); }
}

// ---------- render ----------
const SPRITE_ANIM = {
  _def: { idle: [0, 0, 4], walk: [1, 2, 7], attack: [3, 4, 12], hurt: [5, 5, 15] },
  // 2026-10-16 sprite upgrade: all 12 heroes use the 54-frame map —
  // idle 0-7, walk 8-17, attack 18-29, hurt 30-35, death 36-43, skill 44-53.
  // drawSpriteFighter consumes idle/walk/attack/hurt only; death/skill are
  // data for a future death/skill hook (no gameplay change here).
  ember: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
  rook: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
  void_orb: { idle: [0, 4, 4], walk: [5, 14, 10], attack: [15, 24, 12], hurt: [25, 29, 15] },
  shield_drone: { idle: [0, 4, 4], walk: [5, 14, 10], attack: [15, 24, 12], hurt: [25, 29, 15] },
  crystal_spider: { idle: [0, 4, 4], walk: [5, 14, 10], attack: [15, 24, 12], hurt: [25, 29, 15] },
  void_hound: { idle: [0, 5, 4], walk: [6, 17, 10], attack: [18, 23, 12], hurt: [24, 29, 15] },
  shade: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
  deadeye: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
  mercy: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
  sage: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
  hex: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
  spore_knight: { idle: [0, 4, 4], walk: [5, 14, 10], attack: [15, 24, 12], hurt: [25, 29, 15] },
  bastion: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
  lava_imp: { idle: [0, 4, 4], walk: [5, 14, 10], attack: [15, 24, 12], hurt: [25, 29, 15] },
  void_eye: { idle: [0, 4, 4], walk: [5, 14, 10], attack: [15, 24, 12], hurt: [25, 29, 15] },
  twin_rat: { idle: [0, 4, 4], walk: [5, 14, 10], attack: [15, 29, 12], hurt: [30, 34, 15] },
  skeleton_archer: { idle: [0, 4, 4], walk: [5, 14, 10], attack: [15, 26, 12], hurt: [27, 32, 15] },
  vigil: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
  rampart: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
  dusk: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
  specter: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
  // arena (2026-10-16): single static pose — all ranges [0,0], existing bob/sway juice applies
  arena_slime: { idle: [0, 0, 4], walk: [0, 0, 7], attack: [0, 0, 12], hurt: [0, 0, 15] },
  arena_skeleton: { idle: [0, 0, 4], walk: [0, 0, 7], attack: [0, 0, 12], hurt: [0, 0, 15] },
  arena_dread_warden: { idle: [0, 0, 4], walk: [0, 0, 7], attack: [0, 0, 12], hurt: [0, 0, 15] },
  sentinel: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
  hymn: { idle: [0, 7, 4], walk: [8, 17, 10], attack: [18, 29, 12], hurt: [30, 35, 15], death: [36, 43, 8], skill: [44, 53, 10] },
};
function drawSpriteFighter(p) {
  const F = SPRITES[p.sprite] || SPRITES.bastion;
  const A = SPRITE_ANIM[p.sprite] || SPRITE_ANIM._def;
  const _cyc = (r, t) => r[0] + (Math.floor(t * (r[2] || 7)) % (r[1] - r[0] + 1));
  let fi;
  // Hooks (2026-10-16): death anim wins over everything — a killing blow also
  // sets hurtT, and death must win. Only heroes have A.death (enemies don't).
  if (!p.alive && p.deathAnimT !== undefined && p.deathAnimT < DEATH_ANIM_DUR && A.death) {
    fi = A.death[0] + Math.min(A.death[1] - A.death[0], Math.floor(p.deathAnimT * 10));
  }
  else if (p.atkAnimT > 0) {
    const n = A.attack[1] - A.attack[0], half = Math.ceil((n + 1) / 2);
    fi = p.atkAnimT > 0.18 ? A.attack[0] + (Math.floor(p.animT * A.attack[2]) % half)
                           : A.attack[0] + half + (Math.floor(p.animT * A.attack[2]) % (n + 1 - half));
  }
  else if (p.hurtT > 0) fi = A.hurt[0] + Math.min(A.hurt[1] - A.hurt[0], Math.floor(Math.max(0, 0.4 - p.hurtT) * A.hurt[2]));
  else if (p.skillAnimT > 0 && A.skill) fi = _cyc(A.skill, (p.skillAnimDur || 1.0) - p.skillAnimT); // hooks: skill anim yields to attack/hurt
  else if (p.moving) fi = _cyc(A.walk, p.walkPh || 0); // distance-based phase (movement pass 2026-10-20)
  else fi = _cyc(A.idle, p.animT);
  if (fi >= F.length) fi = F.length - 1; // a short strip can never be indexed out of range
  const img = F[fi];
  ctx.fillStyle = 'rgba(0,0,0,.4)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y + p.r * 1.1, p.r * 1.1, p.r * 0.4, 0, 0, TAU); ctx.fill();
  const h = p.r * 5.2, w = h * (img.naturalWidth || 112) / (img.naturalHeight || 160);
  // --- procedural animation juice ---
  let ox = 0, oy = 0, rot = 0, sc = 1;
  const attacking = p.atkAnimT > 0, hurting = p.hurtT > 0;
  if (p.moving && !attacking && !hurting) {
    const wt = (p.walkPh || 0) * 11;         // walk bob + sway, phased to distance so bob and legs stay in sync
    oy = -Math.abs(Math.sin(wt)) * 3;
    rot = Math.sin(wt) * 0.035;
  } else if (!attacking && !hurting) {
    sc = 1 + Math.sin(p.animT * 3) * 0.018;  // idle breathing
  }
  if (attacking) {                           // lunge toward facing + pop
    const k = clamp(p.atkAnimT / 0.35, 0, 1);
    ox = Math.cos(p.face) * 10 * k; oy = Math.sin(p.face) * 10 * k - 2 * k;
    sc = 1 + 0.07 * k;
  }
  if (hurting) sc = 1 - 0.06 * clamp(p.hurtT / 0.4, 0, 1); // squash on hit
  ctx.save();
  ctx.translate(p.x + ox, p.y - p.r * 0.6 + oy);
  if (Math.cos(p.face) < 0) ctx.scale(-1, 1);
  ctx.rotate(rot);
  ctx.scale(sc, sc);
  // Phase 3: smoothing is batched by render(); only the hit-flash filter toggles here.
  if (hurting) ctx.filter = 'brightness(2.2)'; // white hit-flash
  if (img && img.complete && img.naturalWidth) ctx.drawImage(img, -w/2, -h/2, w, h);
  if (hurting) ctx.filter = 'none';
  ctx.restore();
  if (p.stun > 0) { ctx.fillStyle = '#ffe14d'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('💫', p.x, p.y - p.r * 2.6); }
  const bw = p.r * 2.4;
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(p.x - bw/2, p.y - p.r * 2.6 - 8, bw, 6);
  ctx.fillStyle = p.hp / p.maxhp > 0.35 ? '#7dff8a' : '#ff5252';
  ctx.fillRect(p.x - bw/2, p.y - p.r * 2.6 - 8, bw * clamp(p.hp / p.maxhp, 0, 1), 6);
  if (p.poisonT > 0) { ctx.fillStyle = '#a3e635'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('☠', p.x + p.r + 10, p.y); }
  if (p.shield > 0) { ctx.strokeStyle = '#9fd8ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 5, 0, TAU); ctx.stroke(); }
  if (p.elite && !p.isBoss) { ctx.strokeStyle = 'rgba(255,70,70,' + (0.45 + 0.25 * Math.sin((p.animT || 0) * 6)) + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 9, 0, TAU); ctx.stroke(); }
}
const _gradCache = new Map();
function fighterGradient(color, r) {
  const key = color + '|' + r;
  let g = _gradCache.get(key);
  if (!g) {
    if (_gradCache.size > 64) _gradCache.clear();
    g = ctx.createRadialGradient(0, 0, 2, 0, 0, r);
    g.addColorStop(0, color); g.addColorStop(1, '#111');
    _gradCache.set(key, g);
  }
  return g;
}
function drawFighter(p) {
  if (p.sprite && SPRITES[p.sprite]) { drawSpriteFighter(p); return; }
  ctx.save(); ctx.translate(p.x, p.y);
  if (p.stun > 0) { ctx.fillStyle = '#ffe14d'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('💫', 0, -26); }
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(0, p.r * 0.85, p.r * 0.9, p.r * 0.35, 0, 0, TAU); ctx.fill();
  // body
  ctx.rotate(p.face);
  const g = fighterGradient(p.color, p.r); // Phase 3: cached, was per-frame per-fighter
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
  ctx.strokeStyle = p.isPlayer ? '#fff' : 'rgba(255,255,255,.4)'; ctx.lineWidth = 2; ctx.stroke();
  // facing gun
  ctx.fillStyle = '#222'; ctx.fillRect(p.r * 0.4, -4, p.r * 0.9, 8);
  ctx.fillStyle = p.color; ctx.fillRect(p.r * 1.0, -3, p.r * 0.4, 6);
  ctx.restore();
  // hp bar
  const w = p.r * 2.4;
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(p.x - w/2, p.y - p.r - 12, w, 6);
  ctx.fillStyle = p.hp / p.maxhp > 0.35 ? '#7dff8a' : '#ff5252';
  ctx.fillRect(p.x - w/2, p.y - p.r - 12, w * clamp(p.hp / p.maxhp, 0, 1), 6);
  if (p.poisonT > 0) { ctx.fillStyle = '#a3e635'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('☠', p.x + p.r + 8, p.y); }
  if (p.shield > 0) { ctx.strokeStyle = '#9fd8ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 5, 0, TAU); ctx.stroke(); }
}
// Wall top-cap tints per faction (wall readability pass, 2026-10-20).
const WALL_CAP = { red: 'rgba(255,166,120,0.55)', blue: 'rgba(168,204,255,0.55)', purple: 'rgba(226,188,255,0.55)' };
function render() {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (G.shake > 0) { ctx.translate(rand(-G.shake, G.shake), rand(-G.shake, G.shake)); G.shake *= 0.88; if (G.shake < 0.4) G.shake = 0; }
  // floor
  ctx.fillStyle = '#0b0b13'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(-cam.x * CAM_Z, -cam.y * CAM_Z); ctx.scale(CAM_Z, CAM_Z);
  if (ENV && ENV.floors.length) {
    const ts = 320;
    for (let ty = Math.max(0, Math.floor(cam.y / ts) * ts), ry = Math.round(Math.max(0, Math.floor(cam.y / ts) * ts) / ts); ty < Math.min(ARENA.h, cam.y + H / CAM_Z + ts); ty += ts, ry++)
      for (let tx = Math.max(0, Math.floor(cam.x / ts) * ts), rx = Math.round(Math.max(0, Math.floor(cam.x / ts) * ts) / ts); tx < Math.min(ARENA.w, cam.x + W / CAM_Z + ts); tx += ts, rx++) {
        ctx.save(); ctx.translate(tx + ts/2, ty + ts/2);
        ctx.scale(rx % 2 ? -1 : 1, ry % 2 ? -1 : 1);
        const ft = ENV.floors[(rx * 7 + ry * 13) % ENV.floors.length];
        if (ft && ft.complete && ft.naturalWidth) ctx.drawImage(ft, -ts/2, -ts/2, ts, ts);
        ctx.restore();
      }
  }
  for (const a of ENV.accents) {
    if (a.img && a.img.complete && a.img.naturalWidth) ctx.drawImage(a.img, a.x - a.s/2, a.y - a.s/2, a.s, a.s);
  }
  // bushes
  for (const b of bushes) {
    if (BUSH_IMG && BUSH_IMG.complete && BUSH_IMG.naturalWidth) {
      ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
      const ts = 96;
      for (let ty = b.y; ty < b.y + b.h; ty += ts)
        for (let tx = b.x; tx < b.x + b.w; tx += ts)
          ctx.drawImage(BUSH_IMG, tx, ty, ts, ts);
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(20,80,30,.5)'; ctx.fillRect(b.x, b.y, b.w, b.h);
    }
  }
  // walls — readability pass (2026-10-20, player report "hard to tell where
  // the walls are"): wall.webp used to be byte-identical to floor-0.webp
  // (ΔL = 0) with only a 2px mid-grey stroke as the boundary cue. Now: raised
  // wall textures (per-faction wall.webp re-valued) + drop shadow on the
  // floor + lit top cap in the faction tint + hard dark outline. Visuals stay
  // inside the exact collision rects (shadow excepted — it shades the floor
  // south-east of a real wall, standard height cue, not a fake wall).
  for (const w of walls) {
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(w.x + 4, w.y + 8, w.w, w.h);
    if (ENV.wall && ENV.wall.complete && ENV.wall.naturalWidth) {
      ctx.save(); ctx.beginPath(); ctx.rect(w.x, w.y, w.w, w.h); ctx.clip();
      const ts = 128;
      for (let ty = w.y; ty < w.y + w.h; ty += ts)
        for (let tx = w.x; tx < w.x + w.w; tx += ts)
          ctx.drawImage(ENV.wall, tx, ty, ts, ts);
      ctx.restore();
    } else {
      ctx.fillStyle = '#2c2c3d'; ctx.fillRect(w.x, w.y, w.w, w.h);
    }
    ctx.fillStyle = WALL_CAP[(ENV && ENV.faction) || ''] || 'rgba(255,255,255,0.35)';
    ctx.fillRect(w.x, w.y, w.w, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(w.x, w.y, w.w, 2);
    ctx.strokeStyle = 'rgba(6,5,12,0.9)'; ctx.lineWidth = 3; ctx.strokeRect(w.x, w.y, w.w, w.h);
  }
  // chests
  for (const c of chests) {
    if (c.opened) continue;
    if (CHEST_IMG && CHEST_IMG.complete && CHEST_IMG.naturalWidth) {
      const cw = 64, ch = 64 * CHEST_IMG.naturalHeight / CHEST_IMG.naturalWidth;
      ctx.drawImage(CHEST_IMG, c.x - cw/2, c.y - ch/2, cw, ch);
    } else {
      ctx.fillStyle = '#8a6d2f'; ctx.fillRect(c.x - 12, c.y - 10, 24, 20);
      ctx.fillStyle = '#ffd75e'; ctx.fillRect(c.x - 12, c.y - 2, 24, 4);
    }
  }
  for (const pr2 of props) {
    const pi = ENV.props[(pr2.kind || 0) % ENV.props.length], pw = ENV.propW[(pr2.kind || 0) % ENV.propW.length];
    if (pi && pi.complete && pi.naturalWidth) {
      const ph = pw * pi.naturalHeight / pi.naturalWidth;
      ctx.drawImage(pi, pr2.x - pw/2, pr2.y - ph/2, pw, ph);
    }
  }
  // pickups — arena icons with emoji fallback (visual only; kinds/timers unchanged)
  for (const pk of G.pickups) {
    const _pkImg = SPRITES[pk.kind === 'hp' ? 'arena_potion' : pk.kind === 'en' ? 'arena_energy_bolt' : '']?.[0];
    if (_pkImg && _pkImg.complete && _pkImg.naturalWidth) {
      const _ps = 30, _ar = _pkImg.naturalHeight / (_pkImg.naturalWidth || 1);
      ctx.drawImage(_pkImg, pk.x - _ps/2, pk.y - _ps*_ar/2, _ps, _ps*_ar);
    } else {
      ctx.font = '18px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(pk.kind === 'hp' ? '🧪' : '🔷', pk.x, pk.y + 6);
    }
  }
  // pings
  for (const pg of pings) {
    ctx.strokeStyle = `rgba(255,215,94,${pg.t / 3})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(pg.x, pg.y, (3 - pg.t) * 22 + 10, 0, TAU); ctx.stroke();
  }
  // projectiles
  ctx.globalCompositeOperation = 'lighter';
  for (const pr of G.projectiles) {
    const _heroProj = (pr.fxKind && SPRITES[pr.fxKind]) ? SPRITES[pr.fxKind] : null; // hooks: per-hero projectile art
    const img = _heroProj
      ? _heroProj[Math.floor(G.time * 12) % _heroProj.length]
      : SPRITES.proj?.[pr.effect === 'poison' ? 3 : (PROJ_IDX[pr.dtype] !== undefined ? PROJ_IDX[pr.dtype] : 1)];
    if (!img) continue; // missing projectile sprite must never kill the render loop
    const s = pr.r * 8, pa = Math.atan2(pr.vy, pr.vx), ar = img.naturalHeight / (img.naturalWidth || 1);
    ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(pa);
    if (img && img.complete && img.naturalWidth) ctx.drawImage(img, -s/2, -s*ar/2, s, s*ar);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  // enemies + fighters: smoothing ON once for all sprite draws (Phase 3 perf)
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for (const e of G.enemies) {
    if (!e.alive) continue;
    if (e.windup > 0.35) { // telegraph
      ctx.strokeStyle = 'rgba(255,60,60,.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(e.x, e.y, 120, 0, TAU); ctx.stroke();
    }
    drawFighter({ ...e, face: Math.atan2((player.y - e.y), (player.x - e.x)), isPlayer: false, color: e.color, hp: e.hp, maxhp: e.maxhp, r: e.r, stun: e.stun, poisonT: e.poisonT, shield: e.shield });
    if (e.rootT > 0) { ctx.strokeStyle = 'rgba(125,211,252,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 6, 0, TAU); ctx.stroke(); }
    if (e.elite || e.isBoss) { ctx.fillStyle = '#ffd75e'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(e.isBoss ? '👑' : '★', e.x, e.y - e.r - 18); }
  }
  // fighters
  for (const a of allies) if (a.alive || (a.deathAnimT !== undefined && a.deathAnimT < DEATH_ANIM_DUR)) drawFighter(a); // hooks: ally death anim
  if (player.alive || (player.deathAnimT !== undefined && player.deathAnimT < DEATH_ANIM_DUR)) drawFighter(player); // hooks: player death anim (loop stops at gameOver, so the backdrop anim below is what shows)
  else { ctx.fillStyle = '#f66'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('💀', player.x, player.y); }
  ctx.imageSmoothingEnabled = false;
  // fx (additive)
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for (const f of G.fx) {
    if (f.kind === 'telegraph_zone') { // A-1: vector danger-zone decal (no sprite set; world space)
      const _p = clamp(f.t / f.dur, 0, 1), _r = f.r || 130;
      ctx.save(); ctx.translate(f.x, f.y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#ff2e4d'; ctx.globalAlpha = 0.95; ctx.lineWidth = 4;
      ctx.setLineDash([14, 10]); ctx.lineDashOffset = -G.time * 60;
      ctx.beginPath(); ctx.arc(0, 0, _r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.16 + 0.30 * _p; ctx.fillStyle = '#ff2e4d';
      ctx.beginPath(); ctx.arc(0, 0, _r * (0.35 + 0.65 * _p), 0, TAU); ctx.fill();
      ctx.restore();
      continue;
    }
    const set = SPRITES[f.kind];
    if (!set || !set.length) continue; // a missing fx sprite set must never kill the render loop
    const fi = Math.max(0, Math.min(set.length - 1, Math.floor(f.t / f.dur * set.length)));
    const img = set[fi], s = (f.kind === 'burst' ? 120 : 150) * f.size;
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot || 0);
    if (img && img.complete && img.naturalWidth) ctx.drawImage(img, -s/2, -s/2, s, s);
    ctx.restore();
  }
  ctx.imageSmoothingEnabled = false;
  // ult telegraph ring (world space)
  const _ut = G.ultTelegraph;
  if (_ut) {
    const _f = clamp(_ut.t / _ut.dur, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = _ut.color; ctx.globalAlpha = 0.95; ctx.lineWidth = 4;
    ctx.setLineDash([14, 10]); ctx.lineDashOffset = -G.time * 60;
    ctx.beginPath(); ctx.arc(_ut.x, _ut.y, _ut.r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.18 + 0.3 * _f; ctx.fillStyle = _ut.color;
    ctx.beginPath(); ctx.arc(_ut.x, _ut.y, _ut.r * (0.3 + 0.7 * _f), 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  // particles
  for (const pt of G.particles) {
    ctx.globalAlpha = clamp(pt.t * 2, 0, 1); ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // floaters
  ctx.textAlign = 'center';
  for (const f of G.floaters) {
    ctx.globalAlpha = clamp(f.t * 1.6, 0, 1); ctx.fillStyle = f.color;
    ctx.font = `bold ${f.size || 13}px sans-serif`; ctx.fillText(f.txt, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore(); // world
  ctx.restore(); // shake
  if (G.flash) {
    ctx.fillStyle = G.flash.color;
    ctx.globalAlpha = clamp(G.flash.t / G.flash.dur, 0, 1) * 0.32;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  drawMinimap();
}

// ---------- minimap ----------
function drawMinimap() {
  const s = 256, k = s / ARENA.w / mmZoom;
  mmc.clearRect(0, 0, s, s);
  mmc.fillStyle = '#0a0a12'; mmc.fillRect(0, 0, s, s);
  const ox = s/2 - (cam.x + W / (2 * CAM_Z)) * k, oy = s/2 - (cam.y + H / (2 * CAM_Z)) * k;
  mmc.strokeStyle = '#2a2a3a'; mmc.strokeRect(ox, oy, ARENA.w * k, ARENA.h * k);
  const dot = (x, y, c, r) => { mmc.fillStyle = c; mmc.beginPath(); mmc.arc(ox + x * k, oy + y * k, r, 0, TAU); mmc.fill(); };
  // A-12: block-type colors from the shared BLOCK_TYPE_META legend (A-11).
  // Vault gold and boss magenta match the pre-existing dot colors; elites
  // map to the Elite Camp block color. Trash dots and all geometry unchanged.
  const _btm = (typeof GrindchainGameplay !== 'undefined' && GrindchainGameplay.BLOCK_TYPE_META) || {};
  const _bcol = (t, fb) => (_btm[t] && _btm[t].color) || fb;
  for (const c of chests) if (!c.opened) dot(c.x, c.y, _bcol('vault', '#ffd75e'), 3);
  for (const e of G.enemies) if (e.alive) dot(e.x, e.y, e.isBoss ? _bcol('boss_arena', '#ff00ff') : (e.elite ? _bcol('elite_camp', '#ff9f1c') : '#ff3333'), e.isBoss ? 6 : 2.5);
  for (const a of allies) {
    const ax = ox + a.x * k, ay = oy + a.y * k;
    if (a.alive) {
      dot(a.x, a.y, '#7dff8a', 3);
      const frac = clamp(a.hp / a.maxhp, 0, 1), bw = 20, bh = 4;
      mmc.fillStyle = 'rgba(0,0,0,0.85)'; mmc.fillRect(ax - bw / 2 - 1, ay + 6, bw + 2, bh + 2);
      mmc.fillStyle = frac > 0.6 ? '#7dff8a' : frac > 0.3 ? '#ffd75e' : '#ff5252';
      mmc.fillRect(ax - bw / 2, ay + 7, bw * frac, bh);
    } else {
      const pr = 4 + Math.sin(G.time * 6) * 1.6;
      mmc.strokeStyle = '#ff5252'; mmc.lineWidth = 2;
      mmc.beginPath(); mmc.arc(ax, ay, pr, 0, TAU); mmc.stroke();
      mmc.fillStyle = '#ff5252'; mmc.font = 'bold 9px sans-serif'; mmc.textAlign = 'center';
      mmc.fillText('!', ax, ay + 3.5);
    }
  }
  for (const pg of pings) dot(pg.x, pg.y, '#ffd75e', 4);
  dot(player.x, player.y, '#ffffff', 4);
  // facing tick
  mmc.strokeStyle = '#fff'; mmc.beginPath();
  mmc.moveTo(ox + player.x * k, oy + player.y * k);
  mmc.lineTo(ox + (player.x + Math.cos(player.face) * 40) * k, oy + (player.y + Math.sin(player.face) * 40) * k);
  mmc.stroke();
}

// ---------- HUD ----------
const SKILL_META = { s1: '1', s2: '2', ult: 'ULT', dash: 'dash' };
function setCd(id, frac, text) {
  const el = document.getElementById(id);
  const ov = el.querySelector('.cd-overlay'), tx = el.querySelector('.cd-text');
  ov.style.height = (frac * 100) + '%';
  if (text) { tx.style.display = 'block'; tx.textContent = text; } else tx.style.display = 'none';
}
function updateComboHUD() {
  // DOM contract (Frontend builds the element): #combo > #combo-num
  // (textContent 'COMBO ×N') + #combo-bar (style.width = comboT/window %).
  // 'show' class toggles visibility when combo > 0. All lookups guarded —
  // the element does not exist until Frontend lands it.
  const el = document.getElementById('combo');
  if (!el) return;
  const num = document.getElementById('combo-num');
  const bar = document.getElementById('combo-bar');
  if (num) num.textContent = 'COMBO ×' + (G.combo || 0);
  if (bar) bar.style.width = (100 * clamp((G.comboT || 0) / COMBO_WINDOW, 0, 1)) + '%';
  el.classList.toggle('show', (G.combo || 0) > 0);
  // FIX 1 (T14(b), hide option): suppress the meter while the boss bar is
  // visible. Boss-active is true when a live boss exists OR the boss bar
  // is inline-displayed (the two are set/cleared together in startBoss /
  // onBossDown / run reset, so either signal covers a desync). .show above
  // keeps tracking combo > 0 untouched, and num/bar keep updating under
  // the suppression, so when the boss bar hides and .boss-active drops,
  // the meter returns instantly at its normal position with current values.
  const _bossWrap = document.getElementById('boss-bar-wrap');
  const _bossActive = !!((G.boss && G.boss.alive) || (_bossWrap && _bossWrap.style.display === 'block'));
  el.classList.toggle('boss-active', _bossActive);
}
function updateHUD() {
  document.getElementById('ps-hp').style.width = (100 * player.hp / player.maxhp) + '%';
  document.getElementById('ps-en').style.width = (100 * player.en / player.maxen) + '%';
  document.getElementById('orb-hp-fill').style.height = (100 * clamp(player.hp / player.maxhp, 0, 1)) + '%';
  document.getElementById('orb-en-fill').style.height = (100 * clamp(player.en / player.maxen, 0, 1)) + '%';
  const icons = [];
  if (player.stun > 0) icons.push('💫'); if (player.poisonT > 0) icons.push('☠');
  if (player.slowT > 0) icons.push('🐌'); if (player.overdriveT > 0) icons.push('⚡');
  document.getElementById('status-icons').textContent = icons.join(' ');
  // D3: live totem count on the Wave 1 HUD, read from live run state every tick.
  const _tc = document.getElementById('totem-count');
  if (_tc) _tc.textContent = 'Totems ' + (G._gcTotems || 0);
  const F = FACTIONS[player.faction];
  setCd('btn-skill1', player.cds.s1 / F.s1.cd, player.cds.s1 > 0.05 ? Math.ceil(player.cds.s1) : '');
  setCd('btn-skill2', player.cds.s2 / F.s2.cd, player.cds.s2 > 0.05 ? Math.ceil(player.cds.s2) : '');
  setCd('btn-ult', player.cds.ult / F.ult.cd, player.cds.ult > 0.05 ? Math.ceil(player.cds.ult) : '');
  setCd('btn-dash', player.cds.dash / 3, '');
  setCd('btn-attack', player.atkCd / player.atkRate, '');
  const pf = [[player, 0], ...allies.map((a, i) => [a, i + 1])];
  pf.forEach(([p, i]) => {
    /* Phase 4 rec-fix P4-BUG-01: party frames (pfhp/pfen/ult0) were removed
       from the live HUD — guard every lookup so updateHUD never throws on
       the missing elements. Party HP/energy still live in sim state. */
    const _h = document.getElementById('pfhp' + i); if (_h) _h.style.width = (100 * clamp(p.hp / p.maxhp, 0, 1)) + '%';
    const _e = document.getElementById('pfen' + i); if (_e) _e.style.width = (100 * clamp(p.en / p.maxen, 0, 1)) + '%';
  });
  const _u0 = document.getElementById('ult0'); if (_u0) _u0.textContent = player.cds.ult <= 0 ? 'ULT' : '';
  if (G.boss && G.boss.alive) {
    document.getElementById('boss-bar').style.width = (100 * G.boss.hp / G.boss.maxhp) + '%';
    // Phase 3 integration: boss shield bar / pips / banner driven ONLY by
    // Game.getBossState() — never by the hidden #boss-shield element.
    try {
      const _bs = Game.getBossState();
      const _bar = document.getElementById('gc-boss-shieldbar');
      const _fill = document.getElementById('gc-boss-shieldfill');
      const _label = document.getElementById('gc-boss-shieldlabel');
      const _pips = document.getElementById('gc-boss-pips');
      const _banner = document.getElementById('gc-boss-banner');
      if (_bs && _bar && _fill && _label && _pips && _banner) {
        const _t3 = (G.tier || 1) >= 3;
        const _showBar = _t3 && _bs.shield > 0;
        _bar.style.display = _showBar ? 'block' : 'none';
        if (_showBar) {
          _fill.style.width = (100 * _bs.shield / Math.max(1, _bs.shieldMax)) + '%';
          const _lbl = { aegis: 'AEGIS SHIELD — TECH ONLY', 'mana-ward': 'MANA WARD — MAGIC ONLY', 'fusion-core': 'FUSION CORE — HYBRID ONLY' }[_bs.shieldType] || '';
          _label.textContent = _lbl + ' · ' + Math.round(_bs.shield) + ' / ' + Math.round(_bs.shieldMax);
          _banner.textContent = _lbl;
        } else {
          _banner.textContent = (G.tier || 1) >= 3 ? 'EXPOSED — VULNERABLE' : 'KEEPER ADAPTS';
        }
        _pips.textContent = 'PHASE ' + (_bs.phase || 1) + ' / 3';
        _pips.style.display = 'block'; _banner.style.display = 'block';
      }
    } catch (err) {}
  } else {
    try {
      const _bar2 = document.getElementById('gc-boss-shieldbar');
      const _pips2 = document.getElementById('gc-boss-pips');
      const _banner2 = document.getElementById('gc-boss-banner');
      if (_bar2) _bar2.style.display = 'none';
      if (_pips2) _pips2.style.display = 'none';
      if (_banner2) _banner2.style.display = 'none';
    } catch (err) {}
  }
  document.getElementById('potion-hp').classList.toggle('cd', player.potionCd > 0);
  updateComboHUD();
}

// ---------- main loop: FIXED TIMESTEP (Phase 3) ----------
// Approach: rAF drives rendering; simulation advances in fixed 1/60 s steps
// from an accumulator. Frame dt is clamped (0.1 s) so a backgrounded tab can
// never dump a huge backlog; after 5 steps the remainder is dropped
// (spiral-of-death guard). No interpolation: the render shows the latest
// stepped state, which is correct for this game's speeds. Hitstop freezes
// stepping but still renders. Portrait is a PAUSE (BUG-01), never an
// early-return freeze. While hidden or paused, no sim and no render work.
const FIXED_DT = 1 / 60;
let lastT = 0, acc = 0, rafId = 0, loopActive = false;
function stepSim(dt) {
  G.time += dt;
  // Combo window (spec §2.1): drains on GAME-time dt only — stepSim never
  // runs while paused / hidden / portrait, so the timer freezes for free.
  // Never wall-clock time. On expiry the combo hard-resets to 0.
  if ((G.combo || 0) > 0) {
    G.comboT = (G.comboT || 0) - dt;
    if (G.comboT <= 0) { G.combo = 0; G.comboT = 0; }
  }
  updatePlayer(player, dt, true);
  for (const a of allies) updatePlayer(a, dt, false);
  updateEnemies(dt);
  separateUnits();
  updateProjectiles(dt);
  updateCamera();
}
function loop(t) {
  if (!G.running) { loopActive = false; rafId = 0; return; }
  // Phase 4 rec-fix OBS-02 (crash): STOP rAF while paused / hidden /
  // portrait — do NOT schedule the next frame on these paths. Resume paths
  // restart the chain: setPaused(false) on resume, maybeRestartLoop() on
  // resize / orientationchange / visibilitychange. Pre-fix this function
  // re-scheduled unconditionally and spun ~47-60 callbacks/s doing nothing
  // while paused.
  if (document.hidden) { lastT = t; acc = 0; loopActive = false; rafId = 0; return; } // no rAF work while hidden
  if (checkOrientation()) { // BUG-01: portrait = pause state + overlay
    if (!G.paused) setPaused(true, 'orientation');
    lastT = t; acc = 0; loopActive = false; rafId = 0; return;
  }
  if (G.paused && G.pauseReason === 'orientation') setPaused(false);
  if (G.paused) { lastT = t; acc = 0; loopActive = false; rafId = 0; return; } // frozen frame already rendered by setPaused
  rafId = requestAnimationFrame(loop);
  if (window.__gcTest && !window.__gcTest.done) window.__gcTest.frames++;
  const frameDt = Math.min(0.1, (t - lastT) / 1000 || FIXED_DT); lastT = t;
  if (G.hitstop > 0) { G.hitstop -= frameDt; render(); updateHUD(); return; }
  acc += frameDt;
  let steps = 0;
  while (acc >= FIXED_DT && steps < 5) { stepSim(FIXED_DT); acc -= FIXED_DT; steps++; }
  if (steps === 5) acc = 0;
  render();
  updateHUD();
}
function startLoop() {
  if (loopActive) return;
  loopActive = true; lastT = performance.now(); acc = 0;
  rafId = requestAnimationFrame(loop);
}
function stopLoop() {
  loopActive = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}
// Phase 4 rec-fix OBS-02: restart entry points for a stopped loop. Called on
// resize / orientationchange (portrait→landscape resume) and from the DPR
// listener below. Manual / hidden pauses do NOT restart here — only
// setPaused(false) (resume button, visibilitychange-visible, settings toggle)
// restarts those, so a manual pause survives a resize.
function maybeRestartLoop() {
  if (!G.running || loopActive || document.hidden) return;
  if (G.paused) {
    // Portrait pause is the only pause a resize/orientationchange may lift:
    // the loop is stopped, so nothing else would notice the rotation back.
    if (G.pauseReason === 'orientation' && !checkOrientation()) setPaused(false); // setPaused(false) restarts the loop
    return;
  }
  startLoop();
}
window.addEventListener('resize', maybeRestartLoop);
window.addEventListener('orientationchange', () => setTimeout(maybeRestartLoop, 200));
// Phase 4 rec-fix compat OBS-07: DPR change without a resize (e.g. window
// dragged across monitors with different scaling) left the canvas stale
// until the next resize. Re-arming matchMedia listener: the query pins the
// CURRENT DPR, so its change event fires exactly when DPR moves; the handler
// re-runs resize() (DPR governor / quality caps inside resize() untouched)
// and re-arms for the new DPR. If matchMedia is absent, this is a no-op and
// OBS-07 stays open. Never restarts a manually-paused loop (maybeRestartLoop
// guards that); a stopped loop stays stopped.
if (typeof window.matchMedia === 'function') {
  let _dprMql = null;
  const _onDprChange = () => { try { resize(); } catch (e) {} _armDprListener(); maybeRestartLoop(); };
  const _armDprListener = () => {
    try {
      if (_dprMql && _dprMql.removeEventListener) _dprMql.removeEventListener('change', _onDprChange);
      else if (_dprMql && _dprMql.removeListener) _dprMql.removeListener(_onDprChange);
      _dprMql = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
      if (_dprMql && _dprMql.addEventListener) _dprMql.addEventListener('change', _onDprChange);
      else if (_dprMql && _dprMql.addListener) _dprMql.addListener(_onDprChange);
    } catch (e) {}
  };
  _armDprListener();
}

// ---------- flow ----------
function buildArena() {
  walls = [
    { x: 300, y: 300, w: 260, h: 40 }, { x: 1040, y: 300, w: 260, h: 40 },
    { x: 300, y: 1260, w: 260, h: 40 }, { x: 1040, y: 1260, w: 260, h: 40 },
    { x: 700, y: 640, w: 200, h: 200 },
    { x: 120, y: 700, w: 40, h: 220 }, { x: 1440, y: 700, w: 40, h: 220 },
  ];
  bushes = [
    { x: 120, y: 120, w: 200, h: 140 }, { x: 1280, y: 120, w: 200, h: 140 },
    { x: 120, y: 1340, w: 200, h: 140 }, { x: 1280, y: 1340, w: 200, h: 140 },
    { x: 700, y: 1100, w: 220, h: 120 },
  ];
  chests = [
    { x: 200, y: 800, opened: false }, { x: 1400, y: 800, opened: false },
    { x: 800, y: 200, opened: false },
  ];
  props = [
    { x: 640, y: 560, kind: 0 }, { x: 960, y: 560, kind: 1 },
    { x: 640, y: 920, kind: 2 }, { x: 960, y: 920, kind: 3 },
    { x: 800, y: 420, kind: 1 }, { x: 800, y: 1180, kind: 1 },
    { x: 220, y: 320, kind: 4 }, { x: 1380, y: 1280, kind: 2 },
  ];
}
function gameOver(won) {
  G.running = false; G.ultSeq++; // invalidate any pending ult timers (BUG-02)
  G.ultTelegraph = null; // Phase 4: no stale telegraph may survive death (mirrors softReset)
  // Combo is run-scoped (spec §2.1): live combo clears at run end, but
  // bestComboRun survives for the results-screen line below.
  G.combo = 0; G.comboT = 0;
  /* Phase 4 rec-fix round 2 (O1): clear stale #combo classes at run end —
     the loop stops, so updateComboHUD() never re-runs to clear them. Do NOT
     call updateComboHUD() here: with a live boss it would re-add
     .boss-active. Direct removal only; the next run's first frame
     re-applies the classes from live state. */
  try { var _comboEl = document.getElementById('combo'); if (_comboEl) _comboEl.classList.remove('show', 'boss-active'); } catch (e) {}
  try {
    if (typeof GameAudio !== 'undefined') { GameAudio.music('hub'); GameAudio.sfx(won ? 'victory' : 'death'); }
    if (typeof Analytics !== 'undefined') Analytics.event('run_end', { won: !!won, tier: G.tier || 1, kills: G.kills });
    if (typeof GCIntegration !== 'undefined') GCIntegration.onRunEnd(!!won, G._gcRun, G.bestComboRun || 0); /* T15: thread run peak combo — onRunEnd reads it here, before startGame/softReset clear it; integration.js's G shadows app.js's G, so it cannot read bestComboRun itself. */
  } catch (err) {}
  G.paused = false; G.pauseReason = null;
  const _po = document.getElementById('pause-overlay'); if (_po) _po.style.display = 'none';
  try { Save.recordRun({ won: !!won, kills: G.kills, wave: G.wave, bestCombo: G.bestComboRun || 0, faction: player ? player.faction : null, hero: player ? player.sprite : null }); } catch (e) { /* save must never break game over */ }
  const go = document.getElementById('gameover');
  document.getElementById('go-title').textContent = won ? 'DUNGEON CLEARED' : 'YOU DIED';
  document.getElementById('go-title').style.color = won ? '#7dff8a' : '#ff5252';
  document.getElementById('go-sub').textContent = won
    ? `Boss slain · ${G.kills} monsters destroyed · Best combo ×${G.bestComboRun || 0}` : `Survived to wave ${G.wave} · ${G.kills} slain · Best combo ×${G.bestComboRun || 0}`;
  go.style.display = 'flex';
  // Hooks (2026-10-16): player death anim on the game-over backdrop. The loop
  // stops at game over, so the in-world death frames can't play; cycle the
  // hero's death frames in #go-death instead (0.8 s, then hold last frame).
  // Screen shows immediately — the anim runs concurrently, never delays it.
  try {
    const _goImg = document.getElementById('go-death');
    if (G._goDeathTimer) { clearInterval(G._goDeathTimer); G._goDeathTimer = 0; }
    if (_goImg) {
      if (won || !player || !player.sprite) { _goImg.style.display = 'none'; }
      else {
        const _death = SPRITE_ANIM[player.sprite] && SPRITE_ANIM[player.sprite].death;
        if (_death && SPRITE_SRC[player.sprite]) {
          _goImg.style.display = 'block';
          let _di = 0;
          const _step = () => {
            _goImg.src = SPRITE_SRC[player.sprite][_death[0] + Math.min(_death[1] - _death[0], _di)];
            _di++;
            if (_di > _death[1] - _death[0]) clearInterval(G._goDeathTimer);
          };
          _step();
          G._goDeathTimer = setInterval(_step, 100);
        } else _goImg.style.display = 'none';
      }
    }
  } catch (err) {}
}
function startGame(faction, opts) {
  opts = opts || {};
  const _tier = opts.tier || 1;
  applyQualityCaps();
  // Phase 3 integration: age gate — gameplay REFUSES a run without the 18+ flag.
  const _ageOk = (typeof GCIntegration !== 'undefined' && GCIntegration.ageConfirmed && GCIntegration.ageConfirmed())
    || (typeof GCUI !== 'undefined' && GCUI.canStartRun && GCUI.canStartRun());
  if (!_ageOk) {
    toast('ADULTS ONLY · 18+ — confirm you are 18 or older to play.');
    try { if (typeof GCUI !== 'undefined') GCUI.show('age'); } catch (err) {}
    return false;
  }
  // Phase 3 integration: energy deducted at ENTER via Economy (refused entry
  // shows its exact reason). Wipe/quit keeps energy spent.
  if (typeof GrindchainEconomy !== 'undefined' && typeof Save !== 'undefined' && Save.data && Save.data.meta) {
    const _ed = GrindchainEconomy.enterDungeon(Save.data.meta.energy, _tier);
    if (!_ed.ok) { toast(_ed.reason); try { if (typeof GameAudio !== 'undefined') GameAudio.sfx('error'); } catch (err) {} return false; }
    Save.data.meta.energy = _ed.energy;
    Save.data.energy.session = _ed.energy.value;
    try { Save.save(); } catch (err) {}
  }
  G.tier = _tier; G._gcCheckpointsDone = 0; G._gcTotems = 0;
  // Phase 4: startGame is self-sufficient — a run entered from the results
  // screen (claim → hub → enter) never passes through softReset, so a new
  // run MUST NOT inherit the previous run's counters/entities (pre-fix it
  // inherited slain/kills/time and spawned the boss instantly). Reset the
  // run-sim state here, AFTER the energy gate above: a refused entry must
  // never wipe a live run. Tier is set from opts on the line above;
  // player/allies/_gcRun are rebuilt below.
  G.enemies = []; G.projectiles = []; G.particles = []; G.pickups = [];
  G.floaters = []; G.fx = []; G.spawnQueue = []; G.spawnT = 0;
  G.boss = null; G.locked = null; G.hitstop = 0; G.flash = null; G._specialZone = null; // A-1
  G.ultTelegraph = null; G.shake = 0;
  G.wave = 0; G.slain = 0; G.kills = 0; G.time = 0; G.waveState = 'idle';
  G.combo = 0; G.comboT = 0; G.bestComboRun = 0; G.milestonesHit = new Set(); G.comboHintShown = false;
  G.runToken = (G.runToken || 0) + 1; // FIX 2: new run invalidates any pending hint from a previous run
  G._gcBoss = null; G._gcRun = null; // _gcRun is rebuilt below (or stays null)
  document.getElementById('start-screen').style.display = 'none';
  selectEnv(faction);
  document.getElementById('hud').classList.add('on');
  buildArena();
  player = makePlayer(faction, selHero[faction]);
  player.sprite = selHero[faction];
  const allyFactions = ['red', 'blue', 'purple'].filter(f => f !== faction);
  const allySprites = allyFactions.map(f => FACTION_HEROES[f][0]);
  allies = [makeAlly(1, allyFactions[0], HEROES[allySprites[0]].name, allySprites[0]),
            makeAlly(2, allyFactions[1], HEROES[allySprites[1]].name, allySprites[1])];
  /* Phase 4 rec-fix P4-BUG-01: party-name plaques (pn1/pn2) were removed with
     the party column — guard so startGame never throws on the missing nodes. */
  const _pn1 = document.getElementById('pn1'); if (_pn1) _pn1.textContent = HEROES[allySprites[0]].name;
  const _pn2 = document.getElementById('pn2'); if (_pn2) _pn2.textContent = HEROES[allySprites[1]].name;
  // tint skill buttons to faction + swap in that faction's skill icons
  const col = FACTIONS[faction].color;
  ['btn-skill1', 'btn-skill2', 'btn-ult'].forEach(id => document.getElementById(id).style.borderColor = col);
  const SKILL_ICONS = {
    red:   { s1: 'assets/icons/plasma-burst.webp',  s2: 'assets/icons/overdrive.webp',     ult: 'assets/icons/orbital-strike.webp' },
    blue:  { s1: 'assets/icons/arcane-bolt.webp',   s2: 'assets/icons/frost-nova.webp',    ult: 'assets/icons/meteor.webp' },
    purple:{ s1: 'assets/icons/phase-blades.webp',  s2: 'assets/icons/blink.webp',         ult: 'assets/icons/singularity.webp' },
  }[faction];
  document.getElementById('icon-skill1').src = SKILL_ICONS.s1;
  document.getElementById('icon-skill2').src = SKILL_ICONS.s2;
  document.getElementById('icon-ult').src = SKILL_ICONS.ult;
  updatePotionUI(); updateObjective();
  G.paused = false; G.pauseReason = null;
  const _po2 = document.getElementById('pause-overlay'); if (_po2) _po2.style.display = 'none';
  document.getElementById('gameover').style.display = 'none';
  if (G._goDeathTimer) { clearInterval(G._goDeathTimer); G._goDeathTimer = 0; } // hooks: stop backdrop death anim
  // Phase 3 integration: run model from Gameplay.createRun (refuses without
  // the 18+ flag — already checked above; dungeon block list from the run).
  try {
    if (typeof GrindchainGameplay !== 'undefined') {
      const _party = [selHero[faction], ...allySprites];
      G._gcRun = GrindchainGameplay.createRun({ tier: _tier, party: _party, ageConfirmed: true });
      G._gcBoss = null;
    }
  } catch (err) { G._gcRun = null; }
  G.ultSeq++; // no pending ult may survive into a new run (BUG-02)
  G.running = true; G.waveState = 'waves';
  spawnWave(1);
  toast(FACTIONS[faction].name);
  try { Save.data.lastRun = { faction, hero: selHero[faction] }; Save.save(); } catch (e) { /* save must never break start */ }
  try {
    if (typeof GameAudio !== 'undefined') GameAudio.music('combat');
    if (typeof Analytics !== 'undefined') Analytics.event('run_start', { tier: _tier });
    if (typeof GCIntegration !== 'undefined') GCIntegration.onRunStart(_tier);
  } catch (err) {}
  startLoop();
  return true;
}
const selHero = { red:'bastion', blue:'hex', purple:'rook' };
document.querySelectorAll('.hero-btn').forEach(b => b.addEventListener('click', ev => {
  ev.stopPropagation();
  const f = b.closest('.faction-card').dataset.faction;
  selHero[f] = b.dataset.hero;
  b.closest('.hero-pick').querySelectorAll('.hero-btn').forEach(x => x.classList.toggle('sel', x === b));
}));
document.querySelectorAll('.faction-card').forEach(c =>
  c.addEventListener('click', () => startGame(c.dataset.faction)));
document.getElementById('btn-score').addEventListener('click', () =>
  toast(`KILLS ${G.kills} · WAVE ${G.wave}`));
document.getElementById('btn-settings').addEventListener('click', () => {
  if (G.paused) Game.resume(); else Game.pause('manual');
});


/* ============================================================
   PHASE 3 — Game API, pause, soft reset, boot, PWA, QA hook
   ============================================================ */
function setPaused(on, reason) {
  // Phase 3 integration: audio follows the Game pause state.
  try { if (typeof GameAudio !== 'undefined') { if (on) GameAudio.pauseAll(); else GameAudio.resumeAll(); } } catch (err) {}
  if (on) {
    if (G.paused) return;
    G.paused = true; G.pauseReason = reason || 'manual';
    const ov = document.getElementById('pause-overlay');
    if (ov) {
      const rt = document.getElementById('pause-reason');
      if (rt) rt.textContent = reason === 'orientation' ? 'ROTATE TO LANDSCAPE TO CONTINUE'
        : reason === 'hidden' ? 'GAME PAUSED WHILE HIDDEN' : 'GAME PAUSED';
      ov.style.display = 'flex';
    }
    if (player) { try { render(); } catch (e) {} } // one frozen frame under the overlay
  } else {
    if (!G.paused) return;
    G.paused = false; G.pauseReason = null;
    const ov = document.getElementById('pause-overlay');
    if (ov) ov.style.display = 'none';
    lastT = performance.now(); acc = 0; // never carry a pause gap into dt
    // Phase 4 rec-fix OBS-02: the loop STOPS while paused, so resume must
    // restart it. Guarded: no restart when no run is live (softReset /
    // startGame call setPaused(false) before G.running is true) and no
    // double-schedule when the loop is already running (loopActive true
    // when setPaused(false) is called from inside loop() itself).
    if (G.running && !loopActive) startLoop();
  }
}
function softReset() {
  // BUG-06: in-place soft reset. No page reload, no re-parse, no re-decode.
  G.ultSeq++; // invalidate pending ult timers (BUG-02)
  G.running = false; stopLoop();
  G.enemies = []; G.projectiles = []; G.particles = []; G.pickups = [];
  G.floaters = []; G.fx = []; G.spawnQueue = []; G.spawnT = 0;
  G.boss = null; G.locked = null; G.hitstop = 0; G.flash = null; G._specialZone = null; // A-1
  G.ultTelegraph = null; G.shake = 0;
  G.wave = 0; G.slain = 0; G.kills = 0; G.time = 0; G.waveState = 'idle';
  G.combo = 0; G.comboT = 0; G.bestComboRun = 0; G.milestonesHit = new Set(); G.comboHintShown = false;
  /* Phase 4 rec-fix round 2 (O1): clear stale #combo classes on soft reset
     (same run-end staleness as gameOver — the loop stops, so
     updateComboHUD() never re-runs). Direct removal only. */
  try { var _comboEl2 = document.getElementById('combo'); if (_comboEl2) _comboEl2.classList.remove('show', 'boss-active'); } catch (e) {}
  G.runToken = (G.runToken || 0) + 1; // FIX 2: reset invalidates any pending hint from the previous run
  G.tier = 1; G._gcBoss = null; G._gcRun = null; G._gcCheckpointsDone = 0; G._gcTotems = 0;
  try { if (typeof GameAudio !== 'undefined') GameAudio.music('hub'); } catch (err) {}
  setPaused(false);
  document.getElementById('gameover').style.display = 'none';
  if (G._goDeathTimer) { clearInterval(G._goDeathTimer); G._goDeathTimer = 0; } // hooks: stop backdrop death anim
  document.getElementById('hud').classList.remove('on');
  document.getElementById('boss-bar-wrap').style.display = 'none';
  const bs = document.getElementById('boss-shield'); if (bs) bs.style.display = 'none';
  player = null; allies = [];
  try { Save.save(); } catch (e) { /* save must never break reset */ }
  refreshStartScreen();
  document.getElementById('start-screen').style.display = 'flex';
}
function refreshStartScreen() {
  try {
    const btn = document.getElementById('btn-continue');
    const lr = Save.data && Save.data.lastRun;
    if (btn) {
      if (lr && lr.faction) {
        btn.style.display = 'block';
        btn.textContent = 'CONTINUE — ' + String(lr.faction).toUpperCase() + ' / ' + String(lr.hero || '').toUpperCase();
      } else btn.style.display = 'none';
    }
    const meta = document.getElementById('save-meta');
    if (meta && Save.data) {
      meta.textContent = 'BEST ' + Save.data.progression.bestKills + ' KILLS · STREAK ' + Save.data.streak.current + ' DAY(S)';
    }
  } catch (e) { /* start screen must render even if save is broken */ }
}
// visibilitychange: pause when hidden, resume when visible (battery).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (G.running && !G.paused) setPaused(true, 'hidden');
    try { Save.save(); } catch (e) {}
  } else {
    if (G.paused && G.pauseReason === 'hidden') setPaused(false);
    lastT = performance.now(); acc = 0;
  }
});
window.addEventListener('beforeunload', () => { try { Save.save(); } catch (e) {} });

// ---------- public Game API (Wave 2 UI builds on this) ----------
window.Game = {
  version: 'phase3-1.0.0',
  startGame(faction, opts) { return startGame(faction, opts); },
  setHero(faction, hero) { selHero[faction] = hero; },
  getTier() { return G.tier || 1; },
  getRunState() { return { tier: G.tier || 1, runGold: (G._gcRun && G._gcRun.runGold) || 0, kills: G.kills, totems: G._gcTotems || 0,
    /* A-11/A-13: live dungeon progress + seed for the fogged preview and the expedition report. Additive only. */
    blocksCleared: (G._gcRun && G._gcRun.blocksCleared) || 0,
    dungeonSeed: (G._gcRun && G._gcRun.dungeon && G._gcRun.dungeon.seed !== undefined) ? String(G._gcRun.dungeon.seed) : null,
    runActive: !!(G._gcRun && G.running) }; },
  // Read-only diagnostics for verification (no state mutation).
  getDiag() { return { running: G.running, paused: !!G.paused, pauseReason: G.pauseReason || null, wave: G.wave, waveState: G.waveState, slain: G.slain, kills: G.kills, spawnQueue: G.spawnQueue.length, enemiesAlive: G.enemies.filter(e => e.alive).length, time: Math.round(G.time * 10) / 10, attackHeld, loopActive }; },
  // Checkpoint shop (run-gold only) + checkpoint heal, via Economy/Gameplay.
  buyCheckpointItem(key) {
    if (!G._gcRun || !G.running || typeof GrindchainEconomy === 'undefined') return { ok: false, reason: 'No active run.' };
    const res = GrindchainEconomy.buyShopItem(G._gcRun, key);
    if (!res.ok) return res;
    if (key === 'totem') G._gcTotems = (G._gcTotems || 0) + 1;
    if (key === 'healingTotem' && player) player.hp = Math.min(player.maxhp, player.hp + Math.round((player.maxhp - player.hp) * 0.5));
    if (key === 'aegis' && player) player.shield = Math.max(player.shield || 0, 50);
    return res;
  },
  // Checkpoint draft re-roll (REROLL-DECISION, Adrian 2026-10-19): 75 run
  // gold for a NEW draft. Draws first via Gameplay, deducts only after a
  // differing draft is secured (no-op protection inside Economy). Run-gold
  // only — B2-3, no bought-gold path.
  rerollCheckpointDraft(tier, blocksCleared, currentIds) {
    if (!G._gcRun || !G.running || typeof GrindchainEconomy === 'undefined' || typeof GrindchainGameplay === 'undefined') return { ok: false, reason: 'No active run.' };
    return GrindchainEconomy.rerollDraft(G._gcRun, currentIds || [], function () {
      return GrindchainGameplay.rollDraft(tier || 1, blocksCleared || 0);
    });
  },
  checkpointHeal() {
    if (!player || typeof GrindchainGameplay === 'undefined') return null;
    const healed = GrindchainGameplay.checkpointHeal([player, ...allies].map(p => ({ hp: p.hp, maxhp: p.maxhp, maxen: p.maxen })));
    [player, ...allies].forEach((p, i) => { if (healed[i]) { p.hp = healed[i].hp; p.en = healed[i].en; } });
    return healed;
  },
  getCombatSnapshot() {
    if (!player) return null;
    const _status = [];
    if (player.stun > 0) _status.push('STUNNED');
    if (player.poisonT > 0) _status.push('POISONED');
    if (player.slowT > 0) _status.push('SLOWED');
    if (player.overdriveT > 0) _status.push('OVERDRIVE');
    return {
      hp: Math.round(player.hp), maxHp: player.maxhp, en: Math.round(player.en), maxEn: player.maxen,
      totemCharges: G._gcTotems || 0,
      cooldowns: { attack: Math.max(0, player.atkCd), skill1: Math.max(0, player.cds.s1), skill2: Math.max(0, player.cds.s2), ult: Math.max(0, player.cds.ult), dash: Math.max(0, player.cds.dash) },
      resists: (G.boss && G.boss.alive) ? { tech: G.boss.resist.tech || 0, magic: G.boss.resist.magic || 0, hybrid: G.boss.resist.hybrid || 0 } : { tech: 0, magic: 0, hybrid: 0 },
      status: _status,
      party: [player, ...allies].map(p => ({ name: p.isPlayer ? 'YOU' : (p.name || 'ALLY'), hp: Math.round(p.hp), maxHp: p.maxhp, state: p.alive ? 'FIGHTING' : 'DOWN' })),
      phase: (G.boss && G.boss.alive) ? (G.boss.phase || 1) : 1,
      boss: Game.getBossState(),
    };
  },
  pause(reason) { if (G.running) setPaused(true, reason || 'manual'); },
  resume() { setPaused(false); },
  isPaused() { return !!G.paused; },
  softReset() { softReset(); },
  getBossState() {
    const b = G.boss;
    if (!b || !b.alive) return null;
    return { shield: b.shield || 0, shieldMax: b.shieldMax || 0, shieldType: b.shieldType || 'none', phase: b.phase || 1, hp: b.hp, maxhp: b.maxhp, name: b.name || null, tier: G.tier || 1 };
  },
  // QA-only hooks (defined only under ?gc-autotest=). Zero effect in normal play.
  __qaDamageBoss(dtype, amount) { if (!GC_AUTOTEST || !G.boss || !G.boss.alive) return null; damageEnemy(G.boss, amount || 100, dtype || 'tech', player); return Game.getBossState(); },
  __qaSpawnBoss() { if (!GC_AUTOTEST) return null; startBoss(); return Game.getBossState(); },
  save() { return Save.save(); },
  load() { return Save.load(); },
  get assetsReady() { return ASSETS_READY; },
  get assetsFailed() { return ASSETS_FAILED.slice(); },
};

// ---------- QA autotest hook (query-gated; zero effect in normal play) ----------
// ?gc-autotest=combat | boss | death — drives the game and writes a JSON
// result into #gc-test-result + document.title for headless verification.
const _gcParams = new URLSearchParams(location.search);
const GC_AUTOTEST = _gcParams.get('gc-autotest');
function finishAutotest(note) {
  const T = window.__gcTest; if (!T || T.done) return; T.done = true;
  T.result = { note, frames: T.frames, kills: G.kills, wave: G.wave, slain: G.slain,
    bossSeen: T.bossSeen || null,
    gameoverVisible: document.getElementById('gameover').style.display,
    gameoverTitle: document.getElementById('go-title').textContent };
  let el = document.getElementById('gc-test-result');
  if (!el) { el = document.createElement('div'); el.id = 'gc-test-result'; document.body.appendChild(el); }
  el.textContent = JSON.stringify(T.result);
  document.title = 'GC-TEST-DONE ' + JSON.stringify(T.result);
}
function startAutotest() {
  window.__gcTest = { mode: GC_AUTOTEST, frames: 0, done: false, result: null, bossSeen: null };
  const T = window.__gcTest;
  setTimeout(() => {
    try {
      // QA-only: autotest bypasses the age gate (never in normal play).
      try { if (typeof Save !== 'undefined' && Save.data && Save.data.meta) Save.data.meta.ageConfirmed = true; } catch (err) {}
      const _qaTier = parseInt(new URLSearchParams(location.search).get('gc-tier') || '1', 10) || 1;
      startGame('red', { tier: _qaTier });
      if (GC_AUTOTEST === 'boss') {
        player.atk = 100000;
        const turbo = setInterval(() => {
          try {
            for (const s of G.spawnQueue) s.delay = 0; // QA only: drain the spawn stagger
            if (G.boss && G.boss.alive && !T.bossSeen) {
              T.bossSeen = { shield: G.boss.shield, shieldMax: G.boss.shieldMax, shieldType: G.boss.shieldType, phase: G.boss.phase };
            }
            for (const e of [...G.enemies]) if (e.alive) damageEnemy(e, 999999, 'tech', player);
            const go = document.getElementById('gameover');
            if (go && go.style.display === 'flex') { clearInterval(turbo); finishAutotest('boss-cleared'); }
          } catch (e) { clearInterval(turbo); finishAutotest('boss-error:' + e.message); }
        }, 400);
        setTimeout(() => { clearInterval(turbo); if (!T.done) finishAutotest('boss-timeout'); }, 60000);
      } else if (GC_AUTOTEST === 'death') {
        setTimeout(() => { try { damagePlayer(player, 99999); } catch (e) {} finishAutotest('death-forced'); }, 800);
      } else if (GC_AUTOTEST === 'shield') {
        // QA-only: T3 boss spawned directly, no turbo damage. The harness
        // probes shield gates via Game.__qaDamageBoss(dtype, amount).
        setTimeout(() => { try { startBoss(); } catch (e) {} }, 800);
      } else { // combat: hold attack for 6 s and report
        attackHeld = true;
        setTimeout(() => { attackHeld = false; finishAutotest('combat-6s'); }, 6000);
      }
    } catch (e) { finishAutotest('start-error:' + e.message); }
  }, 300);
}

// ---------- boot ----------
function updateLoading(frac, msg) {
  const bar = document.getElementById('loading-bar');
  const txt = document.getElementById('loading-text');
  if (bar) bar.style.width = (Math.round(frac * 100)) + '%';
  if (txt && msg) txt.textContent = msg;
}
async function boot() {
  try { Save.load(); } catch (e) { /* fresh start on save failure */ }
  // BUG-03: dead boss-shield UI stays hidden until Wave 2 wires it.
  const bs = document.getElementById('boss-shield'); if (bs) bs.style.display = 'none';
  const resumeBtn = document.getElementById('btn-resume');
  if (resumeBtn) resumeBtn.addEventListener('click', () => Game.resume());
  const restartBtn = document.getElementById('btn-restart');
  if (restartBtn) restartBtn.addEventListener('click', () => Game.softReset());
  const contBtn = document.getElementById('btn-continue');
  if (contBtn) contBtn.addEventListener('click', () => {
    const lr = Save.data && Save.data.lastRun;
    if (lr && lr.faction) { selHero[lr.faction] = lr.hero || selHero[lr.faction]; startGame(lr.faction); }
  });
  const clearBtn = document.getElementById('btn-clear-save');
  if (clearBtn) clearBtn.addEventListener('click', () => { Save.reset(); refreshStartScreen(); toast('SAVE CLEARED'); });
  updateLoading(0.05, 'LOADING ASSETS…');
  try {
    await Promise.race([
      loadAllAssets((d, t) => updateLoading(0.05 + 0.9 * (d / Math.max(1, t)), 'LOADING ASSETS… ' + d + '/' + t)),
      new Promise(resolve => setTimeout(resolve, 25000)), // proceed with placeholders on timeout (BUG-08)
    ]);
  } catch (e) { console.warn('[GRINDCHAIN] asset load failed; continuing with placeholders.', e); }
  if (ASSETS_FAILED.length) {
    console.warn('[GRINDCHAIN] ' + ASSETS_FAILED.length + ' asset(s) failed to load; playing with placeholders.', ASSETS_FAILED.slice(0, 10));
    updateLoading(1, 'SOME ART FAILED TO LOAD — PLAYING WITH PLACEHOLDERS');
  } else {
    updateLoading(1, 'READY');
  }
  const ls = document.getElementById('loading-screen');
  if (ls) ls.style.display = 'none';
  refreshStartScreen();
  // P4: boot must NOT re-show the start screen over a live run. The GCUI
  // flow can start a run before asset boot completes (startGame hides the
  // start screen); without this guard boot's unconditional flex here put
  // the faction-select screen over the live run with no way back except
  // restarting. Normal boot (no live run) still shows it, as before.
  if (!G.running) document.getElementById('start-screen').style.display = 'flex';
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(
        () => console.info('[GRINDCHAIN] service worker registered'),
        err => console.warn('[GRINDCHAIN] service worker registration failed', err));
    });
  }
  if (GC_AUTOTEST) startAutotest();
}
boot();
