/* GRINDCHAIN — Phase 3 save system (GAP-09).
   localStorage persistence: progression, inventory, settings, energy,
   gold ledgers, streak, idle timestamp. Versioned key + corruption fallback
   (fresh start, never crash). No accounts, no cloud, no transfers.
   API: Save.save() / Save.load() / Save.reset() / Save.recordRun(). */
'use strict';
const Save = (() => {
  const KEY = 'grindchain.save.v1';
  const VERSION = 1;
  // Phase 3 Wave 2 meta (game-state.md §2). Lives inside the v1 save object
  // (optional field — old saves without it migrate in load()). The Wave 2
  // modules persist nothing themselves; this is the single persistence seam.
  const freshMeta = () => ({
    ledgers: { gold_farmed: 0, gold_bought: 0 },
    materials: { tech: 0, magic: 0 },
    energy: { value: 72, updatedAt: Date.now() },
    inventory: [],
    equipped: {},
    everOwned: [], /* Phase 4b A-7: collection-log catalog keys (kind|tier|rarity) ever owned. */
    quests: { day: null, items: [] },
    streak: { day: 0, lastDateUTC: null },
    idle: { lastSeen: Date.now(), highestTierCleared: 0, pending: null },
    pass: { xp: 0, claimedTiers: [], premium: false },
    season: { id: 'S1', weekId: null, mythicClaimed: false },
    tournament: { entered: false, entries: 0 },
    guild: null,
    tutorial: { beat: 0, skipped: false, done: false, run: 1 },
    ageConfirmed: false,
    abyssLockoutWeek: null,
  });
  function migrateMeta(m, d) {
    const base = freshMeta();
    if (!m || typeof m !== 'object') m = {};
    const out = Object.assign({}, base, m);
    out.ledgers = Object.assign({}, base.ledgers, m.ledgers || {});
    out.materials = Object.assign({}, base.materials, m.materials || {});
    out.energy = Object.assign({}, base.energy, m.energy || {});
    out.quests = Object.assign({}, base.quests, m.quests || {});
    out.streak = Object.assign({}, base.streak, m.streak || {});
    out.idle = Object.assign({}, base.idle, m.idle || {});
    out.pass = Object.assign({}, base.pass, m.pass || {});
    out.season = Object.assign({}, base.season, m.season || {});
    out.tournament = Object.assign({}, base.tournament, m.tournament || {});
    out.tutorial = Object.assign({}, base.tutorial, m.tutorial || {});
    if (!Array.isArray(out.inventory)) out.inventory = [];
    if (!Array.isArray(out.pass.claimedTiers)) out.pass.claimedTiers = [];
    if (!Array.isArray(out.quests.items)) out.quests.items = [];
    // Seed from legacy v1 top-level fields when meta is absent.
    if (d && !d.meta) {
      if (Array.isArray(d.inventory) && d.inventory.length) out.inventory = d.inventory;
      if (d.gold && typeof d.gold.balance === 'number') out.ledgers.gold_farmed = d.gold.balance;
      if (d.energy && typeof d.energy.session === 'number') out.energy.value = d.energy.session;
      if (d.streak && typeof d.streak.current === 'number') out.streak.day = d.streak.current;
      if (d.idle && typeof d.idle.lastSeen === 'number') out.idle.lastSeen = d.idle.lastSeen;
    }
    /* Phase 4b A-4/A-6/A-7: additive schema backfills (corruption fallback
       path above untouched). */
    if (!out.equipped || typeof out.equipped !== 'object' || Array.isArray(out.equipped)) out.equipped = {};
    Object.keys(out.equipped).forEach(function (heroId) {
      var s = out.equipped[heroId];
      if (!s || typeof s !== 'object' || Array.isArray(s)) s = out.equipped[heroId] = {};
      /* A-4 loadout slot schema {weapon, armor, trinket}; unknown extra keys preserved. */
      ['weapon', 'armor', 'trinket'].forEach(function (sl) {
        if (!(sl in s)) s[sl] = null;
      });
    });
    if (!Array.isArray(out.everOwned)) out.everOwned = [];
    out.inventory.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      if (typeof it.locked !== 'boolean') it.locked = false; /* A-6 */
      var k = catalogKey(it); /* A-7: backfill discovered from currently held items */
      if (k && out.everOwned.indexOf(k) < 0) out.everOwned.push(k);
    });
    return out;
  }
  /* A-7 catalog key: kind|tier|rarity (e.g. 'weapon|3|epic'). Shared shape
     with integration.js (recorder) and ui.js (collection screen). */
  function catalogKey(it) {
    if (!it || typeof it !== 'object') return null;
    if (!it.kind || it.tier === undefined || it.tier === null || !it.rarity) return null;
    var t = parseInt(String(it.tier).replace(/\D/g, ''), 10);
    if (!isFinite(t)) return null;
    return String(it.kind).toLowerCase() + '|' + t + '|' + String(it.rarity).toLowerCase();
  }
  const fresh = () => ({
    version: VERSION,
    settings: { quality: 'auto', sound: true, music: true, vibration: true },
    progression: { bestKills: 0, bestWave: 0, totalRuns: 0, wins: 0, totalKills: 0, bestCombo: 0 },
    inventory: [],
    gold: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
    // Session energy (1 per 20 min, cap 72) is stored here; run
    // consumption is Phase 2 work — this build never spends it, never sells it.
    energy: { session: 72, updatedAt: Date.now() },
    streak: { current: 0, best: 0, lastPlayDate: null },
    idle: { lastSeen: Date.now(), idleGoldPending: 0 },
    lastRun: null,
    createdAt: Date.now(),
    meta: freshMeta(),
  });
  let data = fresh();
  const isNum = n => typeof n === 'number' && isFinite(n);
  function isValid(d) {
    if (!d || typeof d !== 'object' || d.version !== VERSION) return false;
    if (!d.settings || !d.progression || !d.gold || !d.energy || !d.streak || !d.idle) return false;
    if (!Array.isArray(d.inventory)) return false;
    if (!isNum(d.progression.bestKills) || !isNum(d.progression.bestWave)
      || !isNum(d.progression.totalRuns) || !isNum(d.progression.wins)
      || !isNum(d.progression.totalKills)) return false;
    // bestCombo: old saves predate it — accept missing (migrated to 0 on
    // load), reject only a present-but-corrupt value.
    if (d.progression.bestCombo !== undefined && !isNum(d.progression.bestCombo)) return false;
    if (!isNum(d.gold.balance) || !isNum(d.gold.lifetimeEarned) || !isNum(d.gold.lifetimeSpent)) return false;
    if (!isNum(d.energy.session) || !isNum(d.streak.current) || !isNum(d.streak.best)) return false;
    if (d.lastRun !== null && (typeof d.lastRun !== 'object' || typeof d.lastRun.faction !== 'string')) return false;
    return true;
  }
  /* Phase 4 rec-fix (OBS-01): clamp finite-but-absurd values on load.
     Non-finite values still fail closed via isValid (fresh start); finite
     values are clamped into range instead of loading as-is. No new caps
     invented: gold / counters floor at 0, energy clamps to 0..72. */
  function clampNum(v, lo, hi) {
    var n = (typeof v === 'number' && isFinite(v)) ? v : lo;
    if (n < lo) return lo;
    if (hi !== undefined && n > hi) return hi;
    return n;
  }
  function clampLoaded(d) {
    if (!d) return;
    if (d.gold) {
      d.gold.balance = clampNum(d.gold.balance, 0);
      d.gold.lifetimeEarned = clampNum(d.gold.lifetimeEarned, 0);
      d.gold.lifetimeSpent = clampNum(d.gold.lifetimeSpent, 0);
    }
    if (d.energy) d.energy.session = clampNum(d.energy.session, 0, 72);
    if (d.progression) {
      d.progression.bestKills = clampNum(d.progression.bestKills, 0);
      d.progression.bestWave = clampNum(d.progression.bestWave, 0);
      d.progression.totalRuns = clampNum(d.progression.totalRuns, 0);
      d.progression.wins = clampNum(d.progression.wins, 0);
      d.progression.totalKills = clampNum(d.progression.totalKills, 0);
      d.progression.bestCombo = clampNum(d.progression.bestCombo, 0); // missing -> 0 (migration)
    }
    if (d.streak) {
      d.streak.current = clampNum(d.streak.current, 0);
      d.streak.best = clampNum(d.streak.best, 0);
    }
    if (d.idle) d.idle.idleGoldPending = clampNum(d.idle.idleGoldPending, 0);
    if (d.meta) {
      if (d.meta.ledgers) {
        d.meta.ledgers.gold_farmed = clampNum(d.meta.ledgers.gold_farmed, 0);
        d.meta.ledgers.gold_bought = clampNum(d.meta.ledgers.gold_bought, 0);
      }
      if (d.meta.materials) {
        d.meta.materials.tech = clampNum(d.meta.materials.tech, 0);
        d.meta.materials.magic = clampNum(d.meta.materials.magic, 0);
      }
      if (d.meta.energy) d.meta.energy.value = clampNum(d.meta.energy.value, 0, 72);
      if (d.meta.streak) d.meta.streak.day = clampNum(d.meta.streak.day, 0);
      if (d.meta.pass) d.meta.pass.xp = clampNum(d.meta.pass.xp, 0);
      if (d.meta.tournament) d.meta.tournament.entries = clampNum(d.meta.tournament.entries, 0);
    }
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { data = fresh(); return data; }
      const parsed = JSON.parse(raw);
      if (!isValid(parsed)) { data = fresh(); return data; }
      data = parsed;
      data.meta = migrateMeta(data.meta, parsed);
      clampLoaded(data);
    } catch (e) { data = fresh(); } // corruption / storage denied -> fresh start, never crash
    return data;
  }
  function save() {
    try {
      data.idle.lastSeen = Date.now();
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) { return false; } // storage denied (private mode) -> session-only
  }
  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    data = fresh();
    save();
    return data;
  }
  /* Phase 4 rec-fix round 2 (F2): dayStr() is UTC-based, so recordRun()'s
     streak bookkeeping (same-day hold / yesterday +1 / else reset) uses
     UTC days, matching meta.streak. getUTC* + setUTCDate throughout —
     a local-date mix here would reintroduce the local/UTC split. */
  function dayStr(d) {
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function recordRun(r) {
    const p = data.progression;
    p.totalRuns += 1;
    p.totalKills += r.kills || 0;
    if ((r.kills || 0) > p.bestKills) p.bestKills = r.kills || 0;
    if ((r.wave || 0) > p.bestWave) p.bestWave = r.wave || 0;
    if ((r.bestCombo || 0) > (p.bestCombo || 0)) p.bestCombo = r.bestCombo || 0;
    if (r.won) p.wins += 1;
    // streak: same day = hold, yesterday = +1, otherwise restart at 1 (UTC days — see dayStr)
    const today = new Date();
    const y = new Date(today); y.setUTCDate(y.getUTCDate() - 1);
    if (data.streak.lastPlayDate === dayStr(today)) { /* hold */ }
    else if (data.streak.lastPlayDate === dayStr(y)) data.streak.current += 1;
    else data.streak.current = 1;
    if (data.streak.current > data.streak.best) data.streak.best = data.streak.current;
    data.streak.lastPlayDate = dayStr(today);
    data.lastRun = { faction: r.faction || null, hero: r.hero || null };
    save();
    return data;
  }
  load();
  return { save, load, reset, recordRun, KEY, VERSION, get data() { return data; } };
})();
