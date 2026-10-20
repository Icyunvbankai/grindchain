/* GRINDCHAIN Phase 3 — Gameplay Systems (Wave 2).
   Pure-logic module: heroes, dungeon generation, monster/boss scaling,
   CC/DoT, counters/synergy/stacking, weapons/loot, drafts, shrines,
   totems, tutorial, lobby validation, run flow, Abyss rotation.
   NO DOM, NO network, NO storage, NO checkout, NO server, NO accounts.
   Loads after app.js/save.js; does NOT modify them. All randomness flows
   through an injected RNG (default Math.random) so tests are deterministic.
   Canonical values: phase2-design/reconciliation/numbers-table.md R-1..R-20.
   Player-facing strings live in COPY below. Hard rules honored here:
   - No purchasable power; no paid refill designed/priced/implemented.
   - No marketplace UI/settlement (item-preservation rules live in the
     data model only, in economy.js).
   - No server/co-op networking, no matchmaking, no on-chain wiring.
   - Bought gold never enters any system in this file (all costs here are
     run gold, farmed gold, or materials — see economy.js for ledgers).
   - The operations cut is NEVER stated as a number in any string here.
   - The word for the tournament deduction in player-facing copy is
     "operations cut" only.
   - T1/T2 bosses are lesser vault-keepers, never the Dread Warden.
   - Dungeon name is "Ember Caves" consistently.
   - The reveal trait is "Scout's Eye". */
'use strict';
(function (root) {
  var G = {};

  /* ---------- deterministic RNG ---------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function range(rng, lo, hi) { return lo + rng() * (hi - lo); }
  function round(v) { return Math.round(v); }

  /* ---------- SHA-256 (pure JS, for Abyss seed derivation) ---------- */
  var K256 = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256Hex(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else if (c < 2048) { bytes.push(192 | (c >> 6), 128 | (c & 63)); }
      else { bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
    }
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var b = 7; b >= 0; b--) bytes.push((bitLen / Math.pow(2, b * 8)) & 255);
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    for (var off = 0; off < bytes.length; off += 64) {
      var W = [];
      for (var t = 0; t < 16; t++) W[t] = (bytes[off + t * 4] << 24) | (bytes[off + t * 4 + 1] << 16) | (bytes[off + t * 4 + 2] << 8) | bytes[off + t * 4 + 3];
      for (t = 16; t < 64; t++) {
        var s0 = rotr(W[t-15],7) ^ rotr(W[t-15],18) ^ (W[t-15] >>> 3);
        var s1 = rotr(W[t-2],17) ^ rotr(W[t-2],19) ^ (W[t-2] >>> 10);
        W[t] = (W[t-16] + s0 + W[t-7] + s1) | 0;
      }
      var a=H[0],bb=H[1],cc=H[2],d=H[3],e=H[4],f=H[5],gg=H[6],h=H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        var ch = (e & f) ^ (~e & gg);
        var t1 = (h + S1 + ch + K256[t] + W[t]) | 0;
        var S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        var maj = (a & bb) ^ (a & cc) ^ (bb & cc);
        var t2 = (S0 + maj) | 0;
        h=gg; gg=f; f=e; e=(d+t1)|0; d=cc; cc=bb; bb=a; a=(t1+t2)|0;
      }
      H[0]=(H[0]+a)|0; H[1]=(H[1]+bb)|0; H[2]=(H[2]+cc)|0; H[3]=(H[3]+d)|0;
      H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+gg)|0; H[7]=(H[7]+h)|0;
    }
    var out = '';
    for (var j = 0; j < 8; j++) { var v = H[j] >>> 0; out += ('00000000' + v.toString(16)).slice(-8); }
    return out;
  }

  /* ---------- copy bank (player-facing strings, verbatim where marked) ---------- */
  var COPY = {
    dungeonName: 'Ember Caves',
    title: 'GRINDCHAIN',
    tagline: 'THE GRIND NEVER SLEEPS',
    ageGate: 'ADULTS ONLY · 18+',
    ageGateBody: 'GRINDCHAIN involves real cryptocurrency on mainnet and real-money purchases. You must be 18 or older to play.',
    factionCodex: {
      red: 'RED // TECH — Powered armor, plasma, drones. Fast. Relentless. Cracks the Aegis Shield — and nothing else.',
      blue: 'BLUE // MAGIC — Arcane runes, elemental spells. Control the field. Breaks the Mana Ward — and nothing else.',
      purple: 'PURPLE // HYBRID — Tech fused with magic. Lifesteal. Unpredictable. Collapses the Fusion Core — and nothing else.'
    },
    factionFooter: 'No single faction clears everything. Raids need all three — collect them all or bring friends.',
    bossPhase1: 'AEGIS SHIELD — TECH DAMAGE ONLY',
    bossPhase2: 'MANA WARD — MAGIC DAMAGE ONLY',
    bossPhase3: 'FUSION CORE — HYBRID DAMAGE ONLY',
    keeperAdapts: 'KEEPER ADAPTS',
    victoryWarden: 'Dread Warden defeated.',
    defeatWarden: 'The Dread Warden stands. Your crew retreats.',
    keeperDefeated: function (name) { return name + ' defeated.'; },
    keeperStands: function (name) { return name + ' stands. Your crew retreats.'; },
    playerDeath: 'YOU DIED / The dungeon claims another.',
    abyssTurned: "The Abyss has turned. This week's resistances have shifted — check the preview before you enter.",
    seasonReset: 'At season end, season power partially resets; cosmetics, collection log, and guild standing persist.',
    tournamentSkill: 'Skill-based. Crew power + team composition decide it. No chance-based outcomes.',
    guildFraming: "No one clears the Chain alone. A guild is a crew that covers what you can't — your Tech, their Magic, someone else's Hybrid. Guild dungeons need everyone contributing.",
    guildFoundingCost: 'Founding cost: shown before you confirm. Founding grants no power.',
    returningPlayer: 'Your crew earned while you slept.',
    energyRefillQualifier: "pending Adrian's B2-3 ruling",
    tournamentReceipt: 'Entry: 250 gold. Operations cut: [disclosed at confirm]. Prizes: cosmetic + gold.',
    premiumClaimLocked: 'Premium — buy to claim',
    passNoPower: 'Premium is cosmetics + convenience. No power.',
    dungeonPreviewCoverage: 'Missing a faction hard-walls at that boss phase. The lobby validates before entry — you cannot queue without all three.',
    tutorial: [
      'Move — drag the joystick. The dungeon doesn\'t wait.',
      'Attack — tap ATTACK. One shot is enough here. It won\'t be later.',
      'Skills cost Energy. Tap PLASMA BURST. Spend it on something worth killing.',
      'Potions drop from kills. Tap HP POTION. Pick up everything — the Chain charges for what you leave.',
      'You cleared your first fight. Now pick your faction. The Chain only gets deeper from here.'
    ]
  };

  /* ---------- heroes: 14 (12 + Sentinel + Hymn, NAR-6) ---------- */
  var HEROES = {
    bastion: { id:'bastion', name:'BASTION', cls:'tank', faction:'red', hp:160, atk:9, range:115, speed:210, atkInterval:0.55, en:100, enRegen:9 },
    rampart: { id:'rampart', name:'RAMPART', cls:'tank', faction:'red', hp:145, atk:11, range:115, speed:215, atkInterval:0.52, en:100, enRegen:9 },
    deadeye: { id:'deadeye', name:'DEADEYE', cls:'marksman', faction:'red', hp:85, atk:16, range:560, speed:225, atkInterval:0.60, en:100, enRegen:9 },
    vigil:   { id:'vigil', name:'VIGIL', cls:'marksman', faction:'red', hp:90, atk:14, range:520, speed:230, atkInterval:0.58, en:100, enRegen:9 },
    sentinel: { id:'sentinel', name:'SENTINEL', cls:'support', faction:'red', hp:100, atk:8, range:420, speed:230, atkInterval:0.55, en:100, enRegen:11 },
    hex:     { id:'hex', name:'HEX', cls:'mage', faction:'blue', hp:85, atk:13, range:420, speed:225, atkInterval:0.50, en:100, enRegen:9 },
    ember:   { id:'ember', name:'EMBER', cls:'mage', faction:'blue', hp:80, atk:14, range:380, speed:230, atkInterval:0.48, en:100, enRegen:9 },
    mercy:   { id:'mercy', name:'MERCY', cls:'support', faction:'blue', hp:100, atk:8, range:420, speed:230, atkInterval:0.55, en:100, enRegen:11 },
    sage:    { id:'sage', name:'SAGE', cls:'support', faction:'blue', hp:90, atk:9, range:420, speed:235, atkInterval:0.52, en:100, enRegen:10 },
    hymn:    { id:'hymn', name:'HYMN', cls:'support', faction:'blue', hp:100, atk:8, range:420, speed:230, atkInterval:0.55, en:100, enRegen:11 },
    rook:    { id:'rook', name:'ROOK', cls:'fighter', faction:'purple', hp:115, atk:15, range:115, rangeRanged:420, speed:235, atkInterval:0.42, en:100, enRegen:9 },
    dusk:    { id:'dusk', name:'DUSK', cls:'fighter', faction:'purple', hp:120, atk:14, range:115, rangeRanged:420, speed:245, atkInterval:0.40, en:100, enRegen:9 },
    shade:   { id:'shade', name:'SHADE', cls:'assassin', faction:'purple', hp:85, atk:17, range:100, speed:255, atkInterval:0.36, en:100, enRegen:9 },
    specter: { id:'specter', name:'SPECTER', cls:'assassin', faction:'purple', hp:95, atk:15, range:520, speed:240, atkInterval:0.44, en:100, enRegen:9 }
  };
  var HERO_LIST = Object.keys(HEROES);
  var FACTION_KITS = {
    red: { s1:{name:'Plasma Burst', cd:5, en:20}, s2:{name:'Overdrive', cd:12, en:25}, ult:{name:'Orbital Strike', cd:30, en:50}, passive:'Move speed bonus (prototype)' },
    blue: { s1:{name:'Arcane Bolt', cd:5, en:20}, s2:{name:'Frost Nova', cd:12, en:25}, ult:{name:'Meteor', cd:30, en:50}, passive:'Energy regen (Mercy 11/s, Sage 10/s)' },
    purple: { s1:{name:'Phase Blades', cd:5, en:20}, s2:{name:'Blink', cd:10, en:25}, ult:{name:'Singularity', cd:30, en:50}, passive:'Lifesteal (prototype)' }
  };
  /* Faction kits only. Per-hero kits are NOT implemented (open item SYS-7). */
  function heroStats(id) {
    var h = HEROES[id]; if (!h) return null;
    return { id:h.id, name:h.name, cls:h.cls, faction:h.faction, hp:h.hp, maxhp:h.hp, atk:h.atk, range:h.range, rangeRanged:h.rangeRanged||null, speed:h.speed, atkInterval:h.atkInterval, en:h.en, maxen:h.en, enRegen:h.enRegen, kit:FACTION_KITS[h.faction] };
  }
  /* Allies use the hero's FULL base stats (Balance 2.2). */
  function allyStats(id) { return heroStats(id); }

  /* ---------- synergy (Balance 2.5) ---------- */
  function synergyBonus(partyIds) {
    var counts = { red:0, blue:0, purple:0 };
    partyIds.forEach(function (id) { var h = HEROES[id]; if (h) counts[h.faction]++; });
    var out = {};
    partyIds.forEach(function (id) {
      var h = HEROES[id]; if (!h) return;
      var n = counts[h.faction];
      out[id] = n >= 3 ? { dmg:1.10, maxhp:1.10, speed:1.05, count:n }
        : n === 2 ? { dmg:1.05, maxhp:1.05, speed:1.00, count:n }
        : { dmg:1.00, maxhp:1.00, speed:1.00, count:n };
    });
    return out;
  }

  /* ---------- affinity (Weapons 3): matching +0.15, off-faction +0.05 ---------- */
  function affinityMultiplier(weaponTag, heroFaction) {
    var factionOfTag = { tech:'red', magic:'blue', hybrid:'purple' }[weaponTag];
    return factionOfTag === heroFaction ? 1.15 : 1.05;
  }

  /* ---------- counter matrix (Balance 2.6) ---------- */
  var COUNTER = {
    tank:     { tank:1.00, fighter:1.00, assassin:1.25, mage:0.85, marksman:0.85, support:1.00 },
    fighter:  { tank:1.25, fighter:1.00, assassin:1.00, mage:0.80, marksman:1.00, support:1.00 },
    assassin: { tank:0.75, fighter:1.00, assassin:1.00, mage:1.30, marksman:1.30, support:0.90 },
    mage:     { tank:1.25, fighter:1.20, assassin:0.80, mage:1.00, marksman:1.00, support:1.00 },
    marksman: { tank:1.25, fighter:1.00, assassin:0.80, mage:1.00, marksman:1.00, support:1.00 },
    support:  { tank:1.00, fighter:1.00, assassin:1.00, mage:1.00, marksman:1.00, support:1.00 }
  };
  function counterMultiplier(attackerCls, defenderCls) {
    return (COUNTER[attackerCls] && COUNTER[attackerCls][defenderCls] !== undefined) ? COUNTER[attackerCls][defenderCls] : 1.00;
  }
  var MONSTER_CLASS = {
    shield_drone:'tank', spore_knight:'tank', boss:'tank',
    crystal_spider:'fighter', lava_imp:'fighter',
    void_hound:'assassin', twin_rat:'assassin',
    skeleton_archer:'marksman',
    void_orb:'mage', void_eye:'mage',
    arena_slime:'fighter', arena_skeleton:'assassin'
  };

  /* ---------- stacking rule + caps (Balance 7) ---------- */
  var CAPS = { totalMax:2.00, totalFloor:0.10, critMult:1.75, critChance:0.50, cdr:0.40, moveBonus:0.30, atkSpeedBonus:0.30, atkIntervalFloor:0.20, armorDR:0.40, tenacity:0.50 };
  function damageMultiplier(o) {
    /* o: {affinity, synergy, counter, resist, loadout, trait, vulnerable}
       resist is a fraction 0..1. vulnerable is a multiplier e.g. 1.25 or 1. */
    var m = (o.affinity||1) * (o.synergy||1) * (o.counter||1) * (1 - (o.resist||0)) * (o.loadout||1) * (o.trait||1) * (o.vulnerable||1);
    if (o.hardGate) return 0; /* hard-gate shield damage is exactly 0; the floor does not rescue it */
    return Math.min(CAPS.totalMax, Math.max(CAPS.totalFloor, m));
  }
  function critRoll(rng, critChance, critDamageBonus) {
    var chance = Math.min(CAPS.critChance, critChance || 0);
    if (rng() < chance) return CAPS.critMult + (critDamageBonus || 0);
    return 1;
  }

  /* ---------- monster bases (prototype ETYPES, kept) ---------- */
  var ETYPES = {
    lava_imp: { hp:26, speed:165, r:11, atk:7 },
    void_hound: { hp:34, speed:175, r:13, atk:9 },
    twin_rat: { hp:22, speed:185, r:10, atk:6 },
    skeleton_archer: { hp:28, speed:105, r:12, atk:8, ranged:true },
    void_orb: { hp:24, speed:95, r:12, atk:8, ranged:true },
    void_eye: { hp:30, speed:90, r:13, atk:9, ranged:true },
    shield_drone: { hp:110, speed:70, r:18, atk:14, tanky:true },
    spore_knight: { hp:130, speed:65, r:20, atk:17, tanky:true, stuns:true },
    crystal_spider: { hp:160, speed:75, r:22, atk:20, tanky:true, stuns:true },
    arena_slime: { hp:26, speed:165, r:11, atk:7 },
    arena_skeleton: { hp:34, speed:175, r:13, atk:9 }
  };
  var TIER_SCALING = {
    1: { tierHP:1.0, tierATK:1.0, depthHP:0.08, depthATK:0.04 },
    2: { tierHP:2.2, tierATK:1.4, depthHP:0.08, depthATK:0.04 },
    3: { tierHP:4.0, tierATK:1.9, depthHP:0.07, depthATK:0.035 },
    4: { tierHP:7, tierATK:2.5, depthHP:0.06, depthATK:0.03 } // P6(C22): T4 x7 (supersedes R-11 tierxdepth T4 x6.5)
  };
  var ELITE_MULT = { 1:{hp:8, atk:1.5}, 2:{hp:10, atk:1.6}, 3:{hp:12, atk:1.8}, 4:{hp:14, atk:2.0} };

  /* Resist composition (R-20): trash base + elite bonus, then tier caps. */
  function trashResists(type, tier) {
    var t = ETYPES[type] || {};
    var r = { tech:0, magic:0, hybrid:0 };
    if (t.tanky) r.tech = 0.40;
    if (t.ranged) r.magic = 0.30;
    if (tier === 1) return r; /* T1 family exception kept as the deliberate onboarding exception */
    return r;
  }
  function eliteResists(type, tier, primary, secondary) {
    var base = trashResists(type, tier);
    var r = { tech: base.tech + 0.15, magic: base.magic + 0.15, hybrid: base.hybrid + 0.00 };
    if (tier === 1) {
      /* No primary/secondary assignment at T1: family type caps at 0.50, others at 0.20. */
      Object.keys(r).forEach(function (k) { r[k] = Math.min(r[k], k === 'tech' && ETYPES[type] && ETYPES[type].tanky ? 0.50 : 0.20); });
      /* A cap never lowers a resist below the trash resist for that type. */
      Object.keys(r).forEach(function (k) { r[k] = Math.max(r[k], base[k]); });
      /* T1 family-type cap: tanky keeps its 0.40 Tech; the 0.50 cap binds the bonus. */
      if (ETYPES[type] && ETYPES[type].tanky) r.tech = Math.min(0.50, Math.max(0.40, r.tech));
      return r;
    }
    /* T2-T4: primary set inside its tier range; secondary capped at 0.40 (T3/T4 only);
       every other type capped at 0.30. Caps never lower below trash resist. */
    var primaryLo = tier === 2 ? 0.40 : 0.60, primaryHi = tier === 2 ? 0.60 : 0.80;
    Object.keys(r).forEach(function (k) {
      var cap = 0.30;
      if (k === primary) cap = primaryHi;
      else if (k === secondary && tier >= 3) cap = 0.40;
      r[k] = Math.min(r[k], cap);
      r[k] = Math.max(r[k], base[k]);
      if (k === primary) r[k] = Math.max(r[k], Math.min(primaryLo, cap));
    });
    return r;
  }
  function monsterStats(type, tier, blocksCleared, opts) {
    opts = opts || {};
    var base = ETYPES[type]; if (!base) return null;
    var s = TIER_SCALING[tier] || TIER_SCALING[1];
    var elite = !!opts.elite;
    var hp, atk;
    if (elite) {
      var em = ELITE_MULT[tier] || ELITE_MULT[1];
      hp = base.hp * s.tierHP * em.hp; /* NO depth factor for elites (R-12) */
      atk = base.atk * s.tierATK * em.atk;
    } else {
      hp = base.hp * s.tierHP * (1 + s.depthHP * (blocksCleared || 0));
      atk = base.atk * s.tierATK * (1 + s.depthATK * (blocksCleared || 0));
    }
    return {
      type:type, tier:tier, elite:elite,
      cls: MONSTER_CLASS[type] || 'fighter',
      hp: hp, maxhp: hp, atk: atk, speed: base.speed, r: base.r * (elite ? 1.5 : 1),
      resist: elite ? eliteResists(type, tier, opts.primary || 'tech', opts.secondary || null) : trashResists(type, tier)
    };
  }

  /* ---------- dungeon generator (Level 1 + block-library) ---------- */
  var BLOCK_CATALOG = ['spawn', 'lane_top', 'lane_mid', 'lane_bot', 'jungle_a', 'jungle_b', 'bush_cluster', 'cave_system', 'river', 'buff_camp', 'elite_camp', 'checkpoint', 'boss_arena', 'vault'];
  var AMBUSH_BLOCKS = ['bush_cluster', 'cave_system'];
  var TIER_CONFIG = {
    1: { name:'Skirmish', blocks:10, checkpoints:1, eliteCamps:1, vault:false, draftRarity:['common'], runMin:[4,6], killCounts:[35,55], energy:6 },
    2: { name:'Expedition', blocks:12, checkpoints:1, eliteCamps:1, vault:true, draftRarity:['common','rare'], runMin:[6,9], killCounts:[45,70], energy:8 }, // P6(SYS-5)
    3: { name:'Raid', blocks:14, checkpoints:2, eliteCamps:1, vault:true, draftRarity:['rare','epic'], runMin:[10,14], killCounts:[55,80], energy:10 }, // P6(SYS-5)
    4: { name:'Abyss', blocks:15, checkpoints:2, eliteCamps:2, vault:true, draftRarity:['epic'], runMin:[14,18], killCounts:[70,100], energy:12 } // P6(SYS-5)
  };
  function middleMultiset(tier) {
    /* DISAGREEMENT FLAGGED (see receipt): Phase 1 block-library 2.2 gives
       T3/T4 one Checkpoint each, but Level 1.1 / 1.6 / 6.1 require TWO
       Checkpoints at T3/T4 (T3: 3 draft events = 1 Elite + 2 Checkpoints;
       T4: 4 = 2 Elite + 2 Checkpoints). This implementation follows the
       Level counts (total block counts 10/12/14/15 hold) and flags the
       multiset conflict instead of resolving it silently. T3 drops Jungle B
       (Cave System itself carries the cave mouths); T4 = T3 + 2nd Elite. */
    if (tier === 1) return ['lane_top','lane_mid','lane_bot','jungle_a','buff_camp','elite_camp','checkpoint','bush_cluster'];
    if (tier === 2) return ['lane_top','lane_mid','lane_bot','jungle_a','jungle_b','buff_camp','elite_camp','checkpoint','bush_cluster','vault'];
    if (tier === 3) return ['lane_top','lane_mid','lane_bot','jungle_a','buff_camp','elite_camp','checkpoint','checkpoint','bush_cluster','vault','cave_system','river'];
    return ['lane_top','lane_mid','lane_bot','jungle_a','buff_camp','elite_camp','elite_camp','checkpoint','checkpoint','bush_cluster','vault','cave_system','river'];
  }
  function middleMultisetFixed(tier) { return middleMultiset(tier); }
  /* ---------- block-type legend (A-11/HA-2 presentation layer; shared by
     A-12 minimap + A-13 expedition report). Colors double as the minimap
     dot colors: vault gold and boss magenta match the existing dots so the
     mapping changes no established minimap color. ---------- */
  var BLOCK_TYPE_META = {
    spawn:        { label:'Spawn Base',     color:'#8affc1', blurb:'Your crew enters here. Safe.' },
    lane_top:     { label:'Lane',           color:'#5a6b7a', blurb:'Patrolled corridor — trash packs.' },
    lane_mid:     { label:'Lane',           color:'#5a6b7a', blurb:'Patrolled corridor — trash packs.' },
    lane_bot:     { label:'Lane',           color:'#5a6b7a', blurb:'Patrolled corridor — trash packs.' },
    jungle_a:     { label:'Jungle',         color:'#3ddc84', blurb:'Wilds — buffs and ambushes.' },
    jungle_b:     { label:'Jungle',         color:'#3ddc84', blurb:'Wilds — buffs and ambushes.' },
    bush_cluster: { label:'Bush Cluster',   color:'#8a8f98', blurb:'Ambush thicket. Never adjacent to safe zones.' },
    cave_system:  { label:'Cave System',    color:'#8a8f98', blurb:'Cave mouths — ambush risk.' },
    river:        { label:'River',          color:'#4da3ff', blurb:'Crossing — watch the banks.' },
    buff_camp:    { label:'Buff Camp',      color:'#c77dff', blurb:'Jungle buffs.' },
    elite_camp:   { label:'Elite Camp',     color:'#ff9f1c', blurb:'Elite pack — draft reward.' },
    checkpoint:   { label:'Checkpoint',     color:'#2e9cff', blurb:'Rest stop: heal, draft, run-gold shop.' },
    vault:        { label:'Treasure Vault', color:'#ffd75e', blurb:'Guarded chest — dead-end branch.' },
    boss_arena:   { label:'Boss Arena',     color:'#ff00ff', blurb:'The boss waits here.' }
  };
  function blockMeta(type) { return BLOCK_TYPE_META[type] || { label:type, color:'#9a9ab0', blurb:'' }; }
  /* ---------- seed discipline (A-10 / HA-1) ----------
     CONTRACT: exploration RNG must never consume generation state. The
     generation RNG is created fresh inside buildDungeon (mulberry32, one
     instance per call) and never escapes — the returned dungeon carries its
     seed string but no rng reference. Exploration/consumption paths
     (dropFor, rollDraft, loot rolls) draw from Math.random (or a
     caller-supplied rng) and MUST never draw from a generation rng.
     assertSeedDiscipline enforces the structural side of this contract on
     every generated dungeon; it fails loudly on violation. */
  function assertSeedDiscipline(d) {
    if (!d || typeof d.seed === 'undefined') throw new Error('[A-10] seed discipline violated: generated dungeon carries no seed.');
    if (!Array.isArray(d.blocks) || d.blocks.length === 0) throw new Error('[A-10] seed discipline violated: dungeon has no blocks.');
    if (d._genRng || d.rng) throw new Error('[A-10] seed discipline violated: generation RNG leaked into the dungeon object.');
    return true;
  }
  function shuffled(rng, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function buildDungeon(tier, seed, opts) {
    opts = opts || {};
    /* A-10 seed discipline: this rng instance is generation-only. It is
       created here, consumed only by the layout code below, and never
       stored on the returned dungeon or shared with exploration paths. */
    var rng = mulberry32(typeof seed === 'number' ? seed : hashSeed(String(seed)));
    var middle = middleMultisetFixed(tier);
    /* Order the critical path: elite before first checkpoint; checkpoint after midpoint. */
    var order = shuffled(rng, middle);
    function idxOf(type) { return order.indexOf(type); }
    var eliteIdx = idxOf('elite_camp'), cpIdx = idxOf('checkpoint');
    if (eliteIdx > cpIdx && cpIdx >= 0) { var tmp = order[eliteIdx]; order[eliteIdx] = order[cpIdx]; order[cpIdx] = tmp; }
    /* Checkpoint after midpoint: ensure at least one checkpoint sits at or
       after the midpoint (T3/T4 keep an additional early checkpoint). */
    var total = TIER_CONFIG[tier].blocks;
    var hasLateCp = order.slice(Math.ceil(total / 2) - 1).indexOf('checkpoint') >= 0;
    if (!hasLateCp) {
      var cp = order.splice(idxOf('checkpoint'), 1)[0];
      order.splice(Math.min(order.length - 1, Math.ceil(order.length / 2)), 0, cp);
    }
    /* Safe-zone adjacency repair: Spawn and Checkpoint blocks are never
       adjacent (via edges) to Bush Cluster / Cave System / Elite Camp.
       Sequence neighbors of a vault are not edges (vault is rewired as a
       branch), so vault counts as safe here. */
    var SAFE_NEIGHBOR = ['lane_top','lane_mid','lane_bot','jungle_a','jungle_b','river','buff_camp','vault'];
    var UNSAFE_NEIGHBOR = ['bush_cluster','cave_system','elite_camp'];
    function checkpointPositions(ord) { var out = []; ord.forEach(function (t, i) { if (t === 'checkpoint') out.push(i); }); return out; }
    function adjacentToCheckpoint(ord, pos) { return checkpointPositions(ord).some(function (p) { return Math.abs(p - pos) <= 1; }); }
    for (var rep = 0; rep < 200; rep++) {
      var bad = -1, badKind = '';
      if (UNSAFE_NEIGHBOR.indexOf(order[0]) >= 0) { bad = 0; badKind = 'spawn'; }
      else {
        var cps = checkpointPositions(order);
        outer: for (var ci = 0; ci < cps.length; ci++) {
          var p = cps[ci];
          var neigh = [];
          if (p > 0) neigh.push(p - 1);
          if (p < order.length - 1) neigh.push(p + 1);
          for (var ni = 0; ni < neigh.length; ni++) {
            var q = neigh[ni];
            if (UNSAFE_NEIGHBOR.indexOf(order[q]) >= 0) { bad = q; badKind = 'checkpoint'; break outer; }
          }
        }
      }
      if (bad < 0) break;
      /* Swap the offender with a safe donor that is not adjacent to any
         checkpoint and is not the spawn-adjacent slot. */
      var donor = -1;
      for (var di = 0; di < order.length; di++) {
        if (di === 0 || di === bad) continue;
        if (SAFE_NEIGHBOR.indexOf(order[di]) < 0) continue;
        if (adjacentToCheckpoint(order, di)) continue;
        donor = di; break;
      }
      if (donor < 0) break;
      var t2 = order[bad]; order[bad] = order[donor]; order[donor] = t2;
    }
    /* Elite must sit before the first Checkpoint with a gap (it may never be
       adjacent to a Checkpoint). If repair broke that, signal retry. */
    var fe = order.indexOf('elite_camp'), fc = order.indexOf('checkpoint');
    if (fe < 0 || fc < 0 || fe > fc || fc - fe < 2) return null;
    var blocks = [{ index:0, type:'spawn', grid:{x:0,y:0}, variant:0, contents:{ heal:'full', shop:false } }];
    order.forEach(function (type, i) {
      blocks.push({ index:i + 1, type:type, grid:{x:i + 1, y:0}, variant: Math.floor(rng() * 3), contents: blockContents(type, tier, rng) });
    });
    blocks.push({ index:blocks.length, type:'boss_arena', grid:{x:blocks.length, y:0}, variant:0, contents:{ boss:true } });
    /* Corridor edges: consecutive path blocks + one shortcut edge (second route). */
    var edges = [];
    for (var i = 0; i < blocks.length - 1; i++) edges.push([i, i + 1]);
    /* Shortcut: spawn links to a mid-path jungle/lane block, giving a second route. */
    var shortcutTarget = -1;
    for (var k = 2; k < blocks.length - 1; k++) {
      if (blocks[k].type === 'jungle_a' || blocks[k].type === 'jungle_b' || blocks[k].type === 'lane_mid') { shortcutTarget = k; break; }
    }
    if (shortcutTarget > 0) edges.push([0, shortcutTarget]);
    /* Vault is a dead-end branch: degree 1. Rewire its path edge to a branch edge. */
    var vaultIdx = -1;
    blocks.forEach(function (b, bi) { if (b.type === 'vault') vaultIdx = bi; });
    if (vaultIdx > 0) {
      edges = edges.filter(function (e) { return !(e[0] === vaultIdx || e[1] === vaultIdx); });
      var parent = Math.max(1, Math.floor(blocks.length / 2));
      if (parent === vaultIdx) parent = vaultIdx - 1;
      edges.push([parent, vaultIdx]);
    }
    /* Shrine assignment: T1 >=1 type, T2 >=2 factions, T3/T4 all 3. */
    var shrines = tier === 1 ? ['tech'] : tier === 2 ? ['tech','magic'] : ['tech','magic','hybrid'];
    return { tier:tier, seed:seed, blocks:blocks, edges:edges, shrines:shrines, buffs: tier >= 3 ? ['red','blue','gold'] : ['red','blue'], vault: tier >= 2 };
  }
  function blockContents(type, tier, rng) {
    if (type === 'elite_camp') return { elite:true, draft:true, totemPocket:true };
    if (type === 'checkpoint') return { heal:'partial', shop:true, draft:true };
    if (type === 'buff_camp') return { buffs: tier >= 3 ? ['red','blue','gold'] : ['red','blue'] };
    if (type === 'vault') return { guardElite:true, chest:true };
    if (type === 'bush_cluster') return { ambush:true, wardSocket:true };
    if (type === 'cave_system') return { ambush:true, caveMouths:2 };
    if (type === 'boss_arena') return { boss:true };
    return { combat:true };
  }
  function validateDungeon(d) {
    var v = [];
    var cfg = TIER_CONFIG[d.tier];
    if (!cfg) { v.push('unknown tier'); return v; }
    if (d.blocks.length !== cfg.blocks) v.push('block count ' + d.blocks.length + ' != ' + cfg.blocks);
    if (d.blocks[0].type !== 'spawn') v.push('first block is not Spawn Base');
    if (d.blocks[d.blocks.length - 1].type !== 'boss_arena') v.push('last block is not Boss Arena');
    var counts = {};
    d.blocks.forEach(function (b) { counts[b.type] = (counts[b.type] || 0) + 1; });
    if ((counts.checkpoint || 0) !== cfg.checkpoints) v.push('checkpoint count ' + (counts.checkpoint || 0) + ' != ' + cfg.checkpoints);
    if ((counts.elite_camp || 0) !== cfg.eliteCamps) v.push('elite camp count ' + (counts.elite_camp || 0) + ' != ' + cfg.eliteCamps);
    if (cfg.vault && !counts.vault) v.push('vault missing');
    if (!cfg.vault && counts.vault) v.push('vault present in T1');
    /* Elite before first checkpoint. */
    var firstElite = -1, firstCp = -1;
    d.blocks.forEach(function (b, i) { if (b.type === 'elite_camp' && firstElite < 0) firstElite = i; if (b.type === 'checkpoint' && firstCp < 0) firstCp = i; });
    if (firstElite < 0) v.push('no Elite Camp');
    if (firstCp >= 0 && firstElite > firstCp) v.push('no Elite Camp before first Checkpoint');
    /* At least one checkpoint after the midpoint (T3/T4 also have an early
       checkpoint at about one-third depth per Level 1.6). */
    var anyCpAfterMid = false;
    d.blocks.forEach(function (b, i) { if (b.type === 'checkpoint' && i >= Math.ceil(cfg.blocks / 2)) anyCpAfterMid = true; });
    if (!anyCpAfterMid) v.push('no checkpoint after midpoint');
    /* Safe-zone adjacency: spawn/checkpoint never adjacent to bush/cave/elite. */
    function adjacent(a, b) { return d.edges.some(function (e) { return (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a); }); }
    d.blocks.forEach(function (b, i) {
      if (b.type === 'spawn' || b.type === 'checkpoint') {
        d.blocks.forEach(function (o, j) {
          if (i !== j && AMBUSH_BLOCKS.indexOf(o.type) >= 0 && adjacent(i, j)) v.push('safe zone adjacent to ' + o.type + ' at block ' + i);
          if (i !== j && o.type === 'elite_camp' && adjacent(i, j)) v.push('safe zone adjacent to Elite Camp at block ' + i);
        });
      }
      if (b.type === 'checkpoint') {
        var ambushNeighbors = 0;
        d.blocks.forEach(function (o, j) { if (i !== j && AMBUSH_BLOCKS.indexOf(o.type) >= 0 && adjacent(i, j)) ambushNeighbors++; });
        if (ambushNeighbors >= 2) v.push('checkpoint adjacent to two ambush blocks');
      }
    });
    /* Vault degree exactly 1. */
    d.blocks.forEach(function (b, i) {
      if (b.type === 'vault') {
        var deg = d.edges.filter(function (e) { return e[0] === i || e[1] === i; }).length;
        if (deg !== 1) v.push('vault degree ' + deg + ' != 1');
      }
    });
    /* Shrine coverage. */
    var need = d.tier === 1 ? 1 : d.tier === 2 ? 2 : 3;
    if ((d.shrines || []).length < need) v.push('shrine coverage ' + (d.shrines || []).length + ' < ' + need);
    return v;
  }
  function generateDungeon(tier, seed, opts) {
    opts = opts || {};
    var attemptSeed = typeof seed === 'number' ? seed : hashSeed(String(seed));
    for (var a = 0; a < 10; a++) {
      var d = buildDungeon(tier, attemptSeed + a, opts);
      if (!d) continue;
      var v = validateDungeon(d);
      if (v.length === 0) { d.attempts = a + 1; d.fallback = false; assertSeedDiscipline(d); return d; }
    }
    var fb = null;
    for (var f = 0; f < 50 && !fb; f++) fb = buildDungeon(tier, attemptSeed + f, opts);
    if (!fb) fb = buildDungeon(tier, attemptSeed, opts) || { tier:tier, seed:attemptSeed, blocks:[], edges:[], shrines:[], buffs:[], vault:false };
    fb.fallback = true; fb.fallbackNote = 'canonical fallback layout';
    assertSeedDiscipline(fb);
    return fb;
  }
  function dungeonPreview(tier, dungeon, opts) {
    opts = opts || {};
    var cfg = TIER_CONFIG[tier];
    var resistText = tier === 1 ? 'Low resistances (family identity: tanky Tech, ranged Magic)' : tier === 2 ? 'Moderate; themed packs resist one type' : tier === 3 ? 'High; elites resist one type strongly, second type capped' : 'Extreme + weekly rotation';
    /* A-10 seed UX: surface the seed string so the preview can show it and
       offer a re-roll. A-11 preview fog-of-war (HA-3 pattern): undiscovered
       structure stays hidden. opts.cleared = blocks cleared so far (0 in the
       pre-run lobby); index < cleared -> 'cleared', index == cleared ->
       'next' (upcoming), boss block -> 'gated' until reached, everything
       else -> 'fogged'. Generation math untouched. */
    var seedStr = dungeon ? String(dungeon.seed) : (opts.seed !== undefined ? String(opts.seed) : null);
    var cleared = Math.max(0, opts.cleared || 0);
    var mapStrip = [], legendSeen = {}, legend = [];
    var totalBlocks = dungeon ? dungeon.blocks.length : (cfg.blocks || 0);
    if (dungeon) {
      dungeon.blocks.forEach(function (b, i) {
        var meta = blockMeta(b.type);
        var state = i < cleared ? 'cleared' : (i === cleared ? 'next' : (b.type === 'boss_arena' ? 'gated' : 'fogged'));
        mapStrip.push({ index:i, type:b.type, label:meta.label, color:meta.color, state:state });
        if (!legendSeen[b.type]) { legendSeen[b.type] = true; legend.push({ type:b.type, label:meta.label, color:meta.color, blurb:meta.blurb }); }
      });
    }
    var progressPct = totalBlocks > 0 ? Math.round(100 * Math.min(cleared, totalBlocks) / totalBlocks) : 0;
    var fogStatus = dungeon
      ? (cleared >= totalBlocks ? 'Dungeon fully scouted — ' + totalBlocks + '/' + totalBlocks + ' blocks cleared.'
        : cleared + '/' + totalBlocks + ' blocks cleared (' + progressPct + '%) — unexplored blocks stay hidden until revealed.')
      : 'No dungeon generated for this preview yet.';
    return {
      name: COPY.dungeonName, tier:tier, tierName: cfg.name, blocks: cfg.blocks,
      resistances: resistText, ccProfile: tier === 1 ? 'No stun/paralyze/silence in trash blocks' : tier === 2 ? 'Stun only, always telegraphed' : 'Full CC roster, all telegraphed',
      debuffProfile: tier <= 2 ? 'Poison + Burn' : 'Poison + Burn + weekly rotation family',
      shrines: dungeon ? dungeon.shrines : [], energyCost: cfg.energy,
      lootTier: 'T' + tier, runMinutes: cfg.runMin, killCounts: cfg.killCounts,
      seedNote: 'Map shuffles every run', partyRequirement: tier === 1 ? 'Solo, any faction' : tier === 2 ? 'At least 2 factions' : 'All 3 factions',
      abyssRotation: tier === 4 ? (opts.abyss || null) : null,
      seed: seedStr, seedDisplay: seedStr !== null ? ('SEED ' + seedStr) : null,
      mapStrip: mapStrip, legend: legend,
      clearedCount: Math.min(cleared, totalBlocks), totalBlocks: totalBlocks,
      progressPct: progressPct, fogStatus: fogStatus
    };
  }

  /* ---------- boss tables (C1 / R-10 / R-15) ---------- */ // P6(C1): HP 900/2200/4500/7500 + party-size scaling x1.25/x1.50 (scaling NOT-IN-CODE)
  var BOSS_TABLE = {
    1: { hp:900, atk:18, fightSeconds:[90,180] }, // P6(C1) hp; P6(C21) fight band
    2: { hp:2200, atk:26, fightSeconds:[45,65] }, // P6(C1) hp (T2 fight band not locked — left)
    3: { hp:4500, atk:36, fightSeconds:[150,300], shields:[{type:'aegis', faction:'tech', frac:0.25},{type:'mana-ward', faction:'magic', frac:0.25},{type:'fusion-core', faction:'hybrid', frac:0.30}] }, // P6(C1) hp; P6(C21) fight band; P6(C2) shield fracs already 25/25/30
    4: { hp:7500, atk:50, fightSeconds:[140,220], shields:[{type:'aegis', faction:'tech', frac:0.25},{type:'mana-ward', faction:'magic', frac:0.25},{type:'fusion-core', faction:'hybrid', frac:0.30}] } // P6(C1) hp (T4 fight band not locked — left); P6(C2) shield fracs already 25/25/30
  };
  var SWAP_RESISTS = [
    { tech:0.50, magic:0.10, hybrid:0.30 },
    { tech:0.10, magic:0.50, hybrid:0.30 },
    { tech:0.30, magic:0.30, hybrid:0.55 }
  ];
  var EXPOSED_RESIST = { 1:0.10, 2:0.15, 3:0.20, 4:0.25 };
  function bossNameFor(tier, vaultName) {
    if (tier >= 3) return tier === 4 ? 'Dread Warden — Abyss' : 'Dread Warden';
    return 'Vault-Keeper of ' + (vaultName || COPY.dungeonName);
  }
  function createBoss(tier, opts) {
    opts = opts || {};
    var t = BOSS_TABLE[tier] || BOSS_TABLE[1];
    var boss = {
      tier:tier, name: bossNameFor(tier, opts.vaultName),
      hp:t.hp, maxhp:t.hp, atk:t.atk, phase:1, isBoss:true,
      shield:0, shieldMax:0, shieldType: tier >= 3 ? 'aegis' : 'none',
      shieldActive: false, shieldIndex:0, exposed: tier < 3,
      vulnerableUntil:0, vulnerableMult:1.25, vulnerableSeconds:3,
      phaseStart:0, enragedPhases:{}, enraged:false,
      exposedSegmentsCleared:0, summonsThisSegment:0,
      summonTimer:0, addsAlive:0,
      resist: tier >= 3 ? { tech:0, magic:0, hybrid:0 } : Object.assign({}, SWAP_RESISTS[0]),
      exposedResist: EXPOSED_RESIST[tier] || 0.10
    };
    if (tier >= 3) activateShield(boss);
    return boss;
  }
  function activateShield(boss) {
    var def = (BOSS_TABLE[boss.tier].shields || [])[boss.shieldIndex];
    if (!def) { boss.shieldActive = false; boss.exposed = true; boss.shieldType = 'none'; return; }
    boss.shieldMax = Math.round(boss.maxhp * def.frac);
    boss.shield = boss.shieldMax;
    boss.shieldType = def.type;
    boss.shieldFaction = def.faction;
    boss.shieldActive = true;
    boss.exposed = false;
    boss.summonsThisSegment = 0;
  }
  function bossPhaseLabel(boss) {
    if (boss.tier < 3) return COPY.keeperAdapts;
    if (boss.shieldActive) return boss.shieldIndex === 0 ? COPY.bossPhase1 : boss.shieldIndex === 1 ? COPY.bossPhase2 : COPY.bossPhase3;
    return 'EXPOSED';
  }
  /* Damage to a boss. Returns {appliedToShield, appliedToHP, immune, brokeShield, killed, note}.
     DoTs call this with isDoT=true; DoTs never damage HP while a shield is up. */
  function applyBossDamage(boss, dmg, dtype, now, opts) {
    opts = opts || {};
    now = now || 0;
    var out = { appliedToShield:0, appliedToHP:0, immune:false, brokeShield:false, killed:false, note:'' };
    if (!boss || boss.hp <= 0) return out;
    if (boss.tier >= 3 && boss.shieldActive) {
      if (dtype !== boss.shieldFaction) {
        out.immune = true; out.note = 'IMMUNE';
        return out; /* Wrong-faction damage deals 0 to shield AND 0 to HP. */
      }
      var s = Math.min(boss.shield, dmg);
      boss.shield -= s; out.appliedToShield = s;
      if (boss.shield <= 0) {
        boss.shield = 0; boss.shieldActive = false; boss.exposed = true;
        boss.vulnerableUntil = now + boss.vulnerableSeconds;
        out.brokeShield = true; out.note = 'SHIELD BROKEN';
      }
      return out;
    }
    /* Exposed state (T3/T4) or swap state (T1/T2): damage HP with resists. */
    var resist = boss.tier >= 3 ? boss.exposedResist : (SWAP_RESISTS[boss.phase - 1] || {})[dtype] || 0;
    var vuln = (now < boss.vulnerableUntil) ? boss.vulnerableMult : 1;
    var dealt = Math.max(0, dmg * (1 - resist) * vuln);
    dealt = Math.round(dealt);
    boss.hp = Math.max(0, boss.hp - dealt);
    out.appliedToHP = dealt;
    if (boss.hp <= 0) { out.killed = true; return out; }
    /* Threshold transitions (T3/T4): from the exposed state only, a shield never interrupts another shield. */
    if (boss.tier >= 3) {
      var frac = boss.hp / boss.maxhp;
      var gate = boss.shieldIndex === 0 ? 0.66 : boss.shieldIndex === 1 ? 0.33 : 0;
      if (frac <= gate && boss.shieldIndex < 3) {
        boss.hp = Math.max(boss.hp, Math.round(boss.maxhp * gate));
        boss.shieldIndex++;
        boss.exposedSegmentsCleared++;
        boss.phase = boss.shieldIndex + 1;
        boss.phaseStart = now;
        boss.enraged = false;
        activateShield(boss);
        out.note = 'SHIELD UP — ' + bossPhaseLabel(boss);
      }
    } else {
      /* T1/T2 swaps at 66% / 33%. Off-type damage is reduced, never zero. */
      var f2 = boss.hp / boss.maxhp;
      var newPhase = f2 < 0.33 ? 3 : f2 < 0.66 ? 2 : 1;
      if (newPhase !== boss.phase) { boss.phase = newPhase; boss.resist = Object.assign({}, SWAP_RESISTS[newPhase - 1]); boss.phaseStart = now; boss.enraged = false; out.note = COPY.keeperAdapts; }
    }
    return out;
  }
  /* A-1 telegraphed boss special (Stormreach SR-4 pattern, game timings only).
     Phase 2+: every SPECIAL_CYCLE_S the boss opens a pendingSpecial — a
     windup of SPECIAL_WINDUP_S (must satisfy telegraphValid, >= 0.7s) with a
     danger-zone mark, then detonation. The engine draws the zone via
     spawnFx(x, y, 'telegraph_zone') and detonates through the existing
     damage path (damagePlayer, boss.atk). Boss names, HP bands, shield
     fractions and damage math are unchanged; only scheduling is added. */
  var SPECIAL_CYCLE_S = 10;
  var SPECIAL_WINDUP_S = 1.2;
  var SPECIAL_ZONE_R = 130;
  if (!telegraphValid(SPECIAL_WINDUP_S)) throw new Error('[A-1] telegraph windup violates telegraphValid (>= 0.7s).');
  function bossTick(boss, dt, now) {
    /* Enrage (C19): at 15% HP -> +20% attack speed, once. Supersedes the old
       ">90s phase, +25% damage, once/phase" rule. The bonus is encoded as
       attackSpeedMult for the engine's attack scheduler to consume. */
    if (!boss.enraged && boss.maxhp > 0 && boss.hp / boss.maxhp <= 0.15) { // P6(C19)
      boss.enraged = true;
      boss.attackSpeedMult = 1.20; // P6(C19)
    }
    var specials = [];
    if (!boss.pendingSpecial && boss.phase >= 2) {
      boss.specialTimer = (boss.specialTimer || 0) + dt;
      if (boss.specialTimer >= SPECIAL_CYCLE_S) {
        boss.specialTimer = 0;
        boss.pendingSpecial = { timer: SPECIAL_WINDUP_S, windup: SPECIAL_WINDUP_S, zoneR: SPECIAL_ZONE_R };
        specials.push({ trigger:true, windup: SPECIAL_WINDUP_S, zoneR: SPECIAL_ZONE_R });
      }
    }
    if (boss.pendingSpecial) {
      boss.pendingSpecial.timer -= dt;
      if (boss.pendingSpecial.timer <= 0) {
        boss.pendingSpecial = null;
        specials.push({ detonate:true, zoneR: SPECIAL_ZONE_R });
      }
    }
    var summons = [];
    if (boss.tier >= 3) {
      /* C20: timed waves every 25s in P2/P3 — 2 adds T3 / 3 adds T4, cap 4 alive.
         Supersedes the old exposed-only summon rule. No-loot behavior for T3+
         summons is preserved (not re-ruled). */ // P6(C20)
      if (boss.phase >= 2) {
        boss.summonTimer = (boss.summonTimer || 0) + dt;
        if (boss.summonTimer >= 25 && (boss.addsAlive || 0) < 4) {
          boss.summonTimer = 0;
          summons = [{ family:'dungeon', count: boss.tier >= 4 ? 3 : 2, loot:false, cap:4 }];
        }
      }
    } else {
      /* T1/T2 timed waves from phase 2: every 25s, 2 adds, cap 4 alive. */
      if (boss.phase >= 2) {
        boss.summonTimer = (boss.summonTimer || 0) + dt;
        if (boss.summonTimer >= 25 && (boss.addsAlive || 0) < 4) {
          boss.summonTimer = 0;
          summons = [{ family:'dungeon', count:2, loot:true, cap:4 }];
        }
      }
    }
    return { summons:summons, enraged: boss.enraged, specials:specials };
  }
  /* Sync gameplay boss state onto a Wave 1 G.boss object (integration hook).
     Does not create DOM; UI reads via Game.getBossState(). */
  function syncBossToG(boss, gBoss) {
    if (!gBoss) return null;
    gBoss.shield = boss.shield || 0;
    gBoss.shieldMax = boss.shieldMax || 0;
    gBoss.shieldType = boss.shieldType || 'none';
    gBoss.phase = boss.phase || 1;
    gBoss.hp = boss.hp; gBoss.maxhp = boss.maxhp;
    return gBoss;
  }

  /* ---------- CC / DoT (Balance 5) ---------- */
  var CC_TYPES = ['stun','paralyze','root','silence','fear'];
  var CC_BASE = { stun:1.6, paralyze:2.0, root:2.0, silence:1.5, fear:1.5 };
  function ensureCC(target) {
    if (!target.cc) target.cc = {};
    if (!target.dr) target.dr = { count:0, windowUntil:0 };
    return target;
  }
  function applyCC(target, type, baseDuration, now) {
    ensureCC(target);
    if (CC_TYPES.indexOf(type) < 0) return { applied:0, immune:false };
    if (now > target.dr.windowUntil) { target.dr.count = 0; }
    if (target.dr.count >= 3) return { applied:0, immune:true };
    var mult = target.dr.count === 0 ? 1.00 : target.dr.count === 1 ? 0.50 : 0.25;
    var tenacity = Math.min(CAPS.tenacity, target.tenacity || 0);
    var applied = (baseDuration !== undefined ? baseDuration : CC_BASE[type]) * mult * (1 - tenacity);
    target.cc[type] = { until: now + applied, duration: applied };
    target.dr.count++;
    target.dr.windowUntil = now + 8;
    return { applied:applied, immune:false, drMult:mult };
  }
  function hasCC(target, type, now) {
    ensureCC(target);
    return !!(target.cc[type] && now < target.cc[type].until);
  }
  function tickCC(target, now) {
    ensureCC(target);
    Object.keys(target.cc).forEach(function (k) { if (now >= target.cc[k].until) delete target.cc[k]; });
    if (now > target.dr.windowUntil) target.dr.count = 0;
  }
  function cleanse(target, mode) {
    ensureCC(target);
    if (mode === 'mercy') { target.cc = {}; target.dots = []; }
    else if (mode === 'mend-circle') { /* Cleanses 1 debuff stack per pulse. */
      if (target.dots && target.dots.length) target.dots.shift();
    }
    return target;
  }
  var DOT_DEFS = {
    poison: { dps:3.0, duration:4, cap:5 },
    burn: { dps:4.0, duration:4, cap:3, healingMult:0.50 },
    bleed: { dps:2.5, duration:5, cap:5, moveBonus:1.50 }
  };
  function applyDoT(target, type, dtype, now) {
    var def = DOT_DEFS[type]; if (!def) return null;
    if (!target.dots) target.dots = [];
    var existing = target.dots.filter(function (d) { return d.type === type; });
    if (existing.length >= def.cap) {
      /* Refresh the oldest stack. */
      existing[0].until = now + def.duration;
      return existing[0];
    }
    var dot = { type:type, dtype:dtype || 'tech', dps:def.dps, until: now + def.duration };
    target.dots.push(dot);
    return dot;
  }
  function tickDoTs(target, dt, now, opts) {
    opts = opts || {};
    if (!target.dots) return 0;
    target.dots = target.dots.filter(function (d) { return now < d.until; });
    var total = 0;
    target.dots.forEach(function (d) {
      var tick = d.dps * dt;
      if (d.type === 'bleed' && opts.moving) tick *= DOT_DEFS.bleed.moveBonus;
      total += tick;
    });
    return total;
  }
  function healingMultiplier(target) {
    if (!target.dots) return 1;
    return target.dots.some(function (d) { return d.type === 'burn'; }) ? DOT_DEFS.burn.healingMult : 1;
  }
  function telegraphValid(windupSeconds) { return windupSeconds >= 0.7; }

  /* ---------- debuffs: slow / blind / weaken / vulnerable ---------- */
  function applyDebuff(target, type, now, duration) {
    if (!target.debuffs) target.debuffs = {};
    var dur = duration || (type === 'slow' ? 2.5 : type === 'blind' ? 3 : 4);
    target.debuffs[type] = { until: now + dur };
    return target.debuffs[type];
  }
  function debuffMultipliers(target, now) {
    var out = { move:1, atkSpeed:1, missChance:0, damageDealt:1, damageTaken:1 };
    if (!target.debuffs) return out;
    if (target.debuffs.slow && now < target.debuffs.slow.until) { out.move = 0.55; out.atkSpeed = 0.75; }
    if (target.debuffs.blind && now < target.debuffs.blind.until) out.missChance = 0.40;
    if (target.debuffs.weaken && now < target.debuffs.weaken.until) out.damageDealt = 0.70;
    if (target.debuffs.vulnerable && now < target.debuffs.vulnerable.until) out.damageTaken = 1.25;
    return out;
  }

  /* ---------- weapons / loot (Weapons 2-4) ---------- */
  var WEAPON_TYPES = {
    hammer: { classes:['tank'] },
    gauntlet: { classes:['tank','fighter'] },
    rifle: { classes:['marksman','assassin'] },
    staff: { classes:['mage','support'] },
    fan: { classes:['mage'], heroes:['ember'] },
    dagger: { classes:['assassin'], heroes:['shade'] },
    blade: { classes:['fighter','assassin'], heroes:['rook','dusk','shade','specter'] }
  };
  var RARITIES = ['common','uncommon','rare','epic','legendary','mythic'];
  var RARITY_MULT = { common:1.00, uncommon:1.15, rare:1.35, epic:1.60, legendary:1.90, mythic:2.30 };
  var TIER_WEAPON_BASE = { 1:[2,4], 2:[5,9], 3:[10,17], 4:[18,30], 5:[30,48] };
  var TIER_ARMOR_BASE = { 1:[10,25], 2:[25,50], 3:[50,100], 4:[100,190], 5:[190,320] };
  var SECONDARY_POOL = [
    { stat:'critChance', lo:0.02, hi:0.08 }, { stat:'critDamage', lo:0.10, hi:0.30 },
    { stat:'cdr', lo:0.02, hi:0.06 }, { stat:'moveSpeed', lo:0.02, hi:0.05 },
    { stat:'lifesteal', lo:0.01, hi:0.03 }, { stat:'attackSpeed', lo:0.03, hi:0.08 }
  ];
  /* Trait pool. The reveal trait is "Scout's Eye" (renamed from a prior
     label that referenced a non-shipped hero; see receipt). */
  var TRAIT_POOL = [
    { id:'slowing_strikes', name:'Slowing Strikes', effect:'Attacks slow the target for 1.5s.' },
    { id:'unstoppable', name:'Unstoppable Window', effect:'After being stunned, gain 1.5s CC immunity (once per 12s).' },
    { id:'totem_synergy', name:'Totem Synergy', effect:'Totems you deploy pulse stronger.' },
    { id:'executioner', name:'Executioner', effect:'Bonus damage vs targets below 30% HP.' },
    { id:'shieldbreaker', name:'Shieldbreaker', effect:'Bonus damage vs shielded targets.' },
    { id:'thorns', name:'Thorns', effect:'Reflect melee damage taken.' },
    { id:'second_wind', name:'Second Wind', effect:'Clear all debuffs when dropping below 30% HP (once per run).' },
    { id:'antidote', name:'Antidote', effect:'Immune to Poison for the first 10s of each run.' },
    { id:'greed', name:'Greed', effect:'Bonus gold from kills while equipped (gold only).' },
    { id:'scouts_eye', name:"Scout's Eye", effect:'Reveal bushes/cave mouths within 200 px.' }
  ];
  var RARITY_SLOTS = { common:{sec:0,traits:0}, uncommon:{sec:1,traits:0}, rare:{sec:1,traits:1}, epic:{sec:2,traits:1}, legendary:{sec:2,traits:2}, mythic:{sec:2,traits:3} };
  function rollSecondaries(rarity, rng) {
    var n = (RARITY_SLOTS[rarity] || {}).sec || 0;
    var pool = shuffled(rng, SECONDARY_POOL);
    var out = [];
    for (var i = 0; i < n && i < pool.length; i++) {
      var s = pool[i];
      out.push({ stat:s.stat, value: range(rng, s.lo, s.hi) });
    }
    return out;
  }
  function rollTraits(rarity, rng) {
    var n = (RARITY_SLOTS[rarity] || {}).traits || 0;
    var pool = shuffled(rng, TRAIT_POOL);
    return pool.slice(0, n).map(function (t) { return { id:t.id, name:t.name, effect:t.effect }; });
  }
  function rollWeapon(tier, rarity, type, tag, rng) {
    rng = rng || Math.random;
    var base = TIER_WEAPON_BASE[tier] || TIER_WEAPON_BASE[1];
    var roll = range(rng, base[0], base[1]);
    var attack = Math.round(roll * (RARITY_MULT[rarity] || 1));
    return { kind:'weapon', slot:'weapon', type:type, tag:tag, tier:tier, rarity:rarity, attack:attack, baseAttack:attack, upgrade:0, secondaries: rollSecondaries(rarity, rng), traits: rollTraits(rarity, rng), id:'w_' + Math.floor(rng() * 1e9).toString(36) };
  }
  function rollArmor(tier, rarity, factionTag, rng) {
    rng = rng || Math.random;
    var base = TIER_ARMOR_BASE[tier] || TIER_ARMOR_BASE[1];
    var roll = range(rng, base[0], base[1]);
    var hp = Math.round(roll * (RARITY_MULT[rarity] || 1));
    return { kind:'armor', slot:'armor', tier:tier, rarity:rarity, factionTag:factionTag, maxHp:hp, baseMaxHp:hp, upgrade:0, secondaries: rollSecondaries(rarity, rng), traits: rollTraits(rarity, rng), id:'a_' + Math.floor(rng() * 1e9).toString(36) };
  }
  var TRINKET_PRIMARIES = ['cdr','moveSpeed','lifesteal','reviveSpeed','enRegen','potionPotency'];
  function rollTrinket(tier, rarity, factionTag, rng) {
    rng = rng || Math.random;
    var primary = pick(rng, TRINKET_PRIMARIES);
    var ranges = { cdr:[0.02,0.10], moveSpeed:[0.02,0.08], lifesteal:[0.01,0.05], reviveSpeed:[0.20,0.50], enRegen:[1,4], potionPotency:[0.10,0.25] };
    var rr = ranges[primary];
    return { kind:'trinket', slot:'trinket', tier:tier, rarity:rarity, factionTag:factionTag, primaryStat:primary, primaryValue: range(rng, rr[0], rr[1]), basePrimaryValue: range(rng, rr[0], rr[1]), upgrade:0, secondaries:[], traits: rollTraits(rarity, rng), id:'t_' + Math.floor(rng() * 1e9).toString(36) };
  }
  function canEquip(heroId, item) {
    var h = HEROES[heroId]; if (!h || !item) return false;
    if (item.slot === 'weapon') {
      var wt = WEAPON_TYPES[item.type]; if (!wt) return false;
      if (wt.classes.indexOf(h.cls) < 0) return false;
      if (item.type === 'fan' && heroId !== 'ember') return false;
      if (item.type === 'dagger' && heroId !== 'shade') return false;
      if (item.type === 'blade' && ['rook','dusk'].indexOf(heroId) < 0 && h.cls !== 'assassin') return false;
      if (item.type === 'rifle' && h.cls === 'assassin' && heroId !== 'specter') return false;
      return true;
    }
    return item.slot === 'armor' || item.slot === 'trinket';
  }
  function equipItem(heroId, item, opts) {
    opts = opts || {};
    if (opts.inRun) return { ok:false, reason:'Equipping is lobby/loadout only — never mid-run.' };
    if (!canEquip(heroId, item)) return { ok:false, reason:'That hero cannot equip this item.' };
    return { ok:true, heroId:heroId, itemId:item.id };
  }
  /* Phase 4b A-4: pure loadout-slot writer. Gives meta.equipped a real slot
     structure {weapon, armor, trinket} per hero. Pure — the caller owns the
     meta object and passes it in; validation (canEquip) unchanged; the
     lobby-only rule lives in equipItem above. itemId null/undefined unequips. */
  function setLoadoutSlot(equipped, heroId, slot, itemId) {
    if (!equipped || typeof equipped !== 'object') return { ok:false, reason:'No loadout store.' };
    if (slot !== 'weapon' && slot !== 'armor' && slot !== 'trinket') return { ok:false, reason:'Unknown slot.' };
    var cur = equipped[heroId];
    if (!cur || typeof cur !== 'object') cur = equipped[heroId] = { weapon:null, armor:null, trinket:null };
    if (itemId === null || itemId === undefined) { cur[slot] = null; return { ok:true, heroId:heroId, slot:slot, itemId:null, unequipped:true }; }
    cur[slot] = itemId;
    return { ok:true, heroId:heroId, slot:slot, itemId:itemId };
  }
  /* Drop tables (Weapons 4). Returns an array of rolled items (empty = no drop). */
  var DROP_CHANCE = { 1:0.08, 2:0.10, 3:0.12, 4:0.12 };
  var TRASH_RARITY = { 1:[['common',0.80],['uncommon',0.20]], 2:[['common',0.80],['uncommon',0.20]], 3:[['common',0.70],['uncommon',0.25],['rare',0.05]], 4:[['common',0.70],['uncommon',0.25],['rare',0.05]] };
  var ELITE_RARITY = {
    1:[['uncommon',0.60],['rare',0.35],['epic',0.05]],
    2:[['uncommon',0.40],['rare',0.45],['epic',0.15]],
    3:[['rare',0.55],['epic',0.35],['legendary',0.10]],
    4:[['rare',0.30],['epic',0.45],['legendary',0.20],['mythic',0.05]]
  };
  var BOSS_RARITY = {
    1:[['rare',0.60],['epic',0.35],['legendary',0.05]],
    2:[['rare',0.40],['epic',0.45],['legendary',0.15]],
    3:[['epic',0.55],['legendary',0.35],['mythic',0.10]],
    4:[['epic',0.40],['legendary',0.40],['mythic',0.20]]
  };
  function rollFromWeights(weights, rng) {
    var r = rng();
    var acc = 0;
    for (var i = 0; i < weights.length; i++) { acc += weights[i][1]; if (r <= acc) return weights[i][0]; }
    return weights[weights.length - 1][0];
  }
  function rollItemTier(dungeonTier, rng) {
    if (dungeonTier === 2) return rng() < 0.90 ? 2 : 1;
    if (dungeonTier === 3) return rng() < 0.85 ? 3 : 2;
    if (dungeonTier === 4) return rng() < 0.70 ? 4 : 5;
    return 1;
  }
  function rollItemType(rng) {
    return pick(rng, ['hammer','gauntlet','rifle','staff','fan','dagger','blade']);
  }
  function rollItemTag(dungeonFaction, rng) {
    /* Dungeon-faction-weighted tags: ~0.50 matching / 0.30 hybrid / 0.20 other. */
    var tags = { red:['tech','hybrid','magic'], blue:['magic','hybrid','tech'], purple:['hybrid','tech','magic'] }[dungeonFaction] || ['tech','magic','hybrid'];
    var r = rng();
    return r < 0.50 ? tags[0] : r < 0.80 ? tags[1] : tags[2];
  }
  function dropFor(source, tier, opts, rng) {
    opts = opts || {}; rng = rng || Math.random;
    var items = [];
    var rarity = null;
    if (source === 'trash') {
      if (rng() >= (DROP_CHANCE[tier] || 0.08)) return items;
      rarity = rollFromWeights(TRASH_RARITY[tier] || TRASH_RARITY[1], rng);
    } else if (source === 'elite') {
      rarity = rollFromWeights(ELITE_RARITY[tier] || ELITE_RARITY[1], rng);
    } else if (source === 'boss') {
      rarity = rollFromWeights(BOSS_RARITY[tier] || BOSS_RARITY[1], rng);
    } else if (source === 'vault') {
      rarity = rollFromWeights(BOSS_RARITY[tier] || BOSS_RARITY[1], rng);
      var idx = RARITIES.indexOf(rarity);
      if (idx >= 0 && idx < RARITIES.length - 1) rarity = RARITIES[idx + 1]; /* Vault: +1 rarity step. */
    } else return items;
    /* Mythic is Abyss-only with a weekly lockout. */
    if (rarity === 'mythic' && !(tier === 4 && opts.mythicEligible)) {
      rarity = 'legendary';
    }
    var count = source === 'boss' ? 2 : 1;
    for (var i = 0; i < count; i++) {
      var itemTier = rollItemTier(tier, rng);
      var kind = rng();
      if (kind < 0.60) items.push(rollWeapon(itemTier, rarity, rollItemType(rng), rollItemTag(opts.dungeonFaction || 'red', rng), rng));
      else if (kind < 0.85) items.push(rollArmor(itemTier, rarity, opts.dungeonFaction || 'red', rng));
      else items.push(rollTrinket(itemTier, rarity, opts.dungeonFaction || 'red', rng));
    }
    return items;
  }

  /* MVP bonus loot roll (Level 7.2): one roll, one rarity step up on the
     bonus roll only — same +1-step rule as a Vault drop. */
  function mvpBonusRoll(tier, opts, rng) { return dropFor('vault', tier, opts, rng); }
  var DRAFT_POOL = [
    { id:'offense_damage', cat:'offense', label:'Damage', full:0.15 },
    { id:'offense_crit', cat:'offense', label:'Crit chance', full:0.10 },
    { id:'offense_faction', cat:'offense', label:'Faction-typed damage', full:0.20 },
    { id:'offense_lifesteal', cat:'offense', label:'Lifesteal', full:0.03 },
    { id:'defense_hp', cat:'defense', label:'Max HP', full:0.25 },
    { id:'defense_armor', cat:'defense', label:'Armor', full:0.10 },
    { id:'defense_resist', cat:'defense', label:'Resistance to one damage type', full:0.30 },
    { id:'utility_speed', cat:'utility', label:'Move speed', full:0.12 },
    { id:'utility_cdr', cat:'utility', label:'Cooldown reduction', full:0.10 },
    { id:'utility_enregen', cat:'utility', label:'Energy regen', full:0.15 },
    { id:'utility_revive', cat:'utility', label:'Revive speed', full:0.20 },
    { id:'totem_pulse', cat:'utility', label:'Totem pulse', full:0.25 },
    { id:'tenacity', cat:'defense', label:'Tenacity (CC resistance)', full:0.15 }
  ];
  function draftRarityFor(tier, blocksCleared) {
    if (tier === 1) return 'common';
    if (tier === 2) return blocksCleared >= 6 ? 'rare' : 'common';
    if (tier === 3) return blocksCleared >= 8 ? 'epic' : 'rare';
    return 'epic';
  }
  function rollDraft(tier, blocksCleared, rng) {
    rng = rng || Math.random;
    var pool = shuffled(rng, DRAFT_POOL);
    var rarity = draftRarityFor(tier, blocksCleared);
    return pool.slice(0, 3).map(function (d) { return { id:d.id, cat:d.cat, label:d.label, rarity:rarity, full:d.full }; });
  }
  /* Faction affinity (LOOT 4): full effect to the matching faction, about
     one third to off-faction fighters. Nothing is ever useless outside its faction. */
  function draftAffinityValue(draft, heroFaction, draftFaction) {
    if (!draftFaction) return draft.full;
    var factionOf = { tech:'red', magic:'blue', hybrid:'purple' };
    return draftFaction && factionOf[draftFaction] === heroFaction ? draft.full : draft.full / 3;
  }
  var SHRINES = {
    tech: { name:'Tech Conduit', faction:'red', channelSeconds:10, match:0.30, other:0.10 },
    magic: { name:'Ley Line', faction:'blue', channelSeconds:10, match:0.30, other:0.10 },
    hybrid: { name:'Fusion Reactor', faction:'purple', channelSeconds:10, match:0.30, other:0.10 },
    warDrum: { name:'War Drum', faction:null, channelSeconds:0, match:0.15, other:0.15, partyWide:true },
    stoneheart: { name:'Stoneheart Altar', faction:null, channelSeconds:0, match:0.25, other:0.25, partyWide:true, maxHp:true }
  };
  var TOTEMS = {
    red: { name:'Repair Pylon', effect:'Heals + restores shields. Strips Burn.', cast:'instant' },
    blue: { name:'Mend Circle', effect:'Biggest heal per pulse + cleanses 1 debuff stack per pulse.', cast:'long' },
    purple: { name:'Suture Spire', effect:'Moderate heal + small damage buff to allies in radius.', cast:'medium' }
  };
  var BUFFS = {
    red: { name:'Red Buff', duration:90, effect:'Damage + slow on attacks' },
    blue: { name:'Blue Buff', duration:90, effect:'Cooldown + energy' },
    gold: { name:'Gold Buff', duration:60, effect:'Bonus loot' }
  };

  /* ---------- tutorial state machine (Level 4) ---------- */
  function createTutorial() {
    return { beat:0, skipped:false, done:false, run:1, guided: true };
  }
  function advanceTutorial(t, action) {
    if (t.done) return t;
    if (action === 'skip' && t.beat >= 3) { t.skipped = true; t.beat = 6; return t; }
    if (action === 'skip' && t.beat < 3) return t; /* SKIP only offered after Beat 3. */
    if (action === 'next') t.beat++;
    if (t.beat > 8) { t.done = true; }
    return t;
  }
  function tutorialRunConfig(runNumber) {
    if (runNumber === 1) return { guided:true, seed:'fixed', note:'Run 1 guided (fixed seed)' };
    if (runNumber === 2) return { guided:false, seed:'random', note:'Run 2 unguided random seed' };
    return { guided:false, seed:'random', shrineRouting:true, note:'Run 3 shrine routing' };
  }

  /* ---------- lobby validation (Level 2.4) ---------- */
  function validateLobby(input) {
    /* input: {tier, party:[heroIds slotted], energy, readyAll, solo, mythicClaimed} */
    var reasons = [];
    var cfg = TIER_CONFIG[input.tier] || TIER_CONFIG[1];
    if ((input.energy || 0) < cfg.energy) reasons.push('Need ' + cfg.energy + ' Energy — you have ' + (input.energy || 0) + '.');
    var party = (input.party || []).slice();
    if (input.tier >= 2) {
      /* Solo entry: player + 2 AI allies, one of each other faction (R-14).
         Coverage is computed from the heroes actually slotted; AI allies
         fill the other two factions for a solo player. */
      var effective = party.slice();
      if (input.solo && party.length === 1) {
        var heroFaction = (HEROES[party[0]] || {}).faction;
        var others = ['red','blue','purple'].filter(function (f) { return f !== heroFaction; });
        others.forEach(function (f) {
          var allyHero = f === 'red' ? 'bastion' : f === 'blue' ? 'hex' : 'rook';
          effective.push(allyHero);
        });
      }
      var factions = {};
      effective.forEach(function (id) { var h = HEROES[id]; if (h) factions[h.faction] = true; });
      var count = Object.keys(factions).length;
      if (input.tier === 2 && count < 2) reasons.push('EXPEDITION REQUIRES AT LEAST 2 FACTIONS — add a fighter of a second faction.');
      if (input.tier >= 3 && count < 3) {
        var missing = ['red','blue','purple'].filter(function (f) { return !factions[f]; });
        var label = missing[0] === 'red' ? 'RED' : missing[0] === 'blue' ? 'BLUE' : 'PURPLE';
        reasons.push('RAID REQUIRES ALL 3 FACTIONS — add a ' + label + ' fighter.');
      }
      if (!input.solo && !input.readyAll) reasons.push('All players must be READY.');
    }
    if (input.tier === 4 && input.mythicClaimed) reasons.push('Abyss weekly lockout — already cleared this week. (Mythic roll spent; the run itself remains enterable.)');
    return { ok: reasons.length === 0, reasons: reasons, enterDisabled: reasons.length > 0 };
  }
  function validateAgeGate(ageConfirmed) {
    return ageConfirmed === true ? { ok:true } : { ok:false, reason:'ADULTS ONLY · 18+ — confirm you are 18 or older to play.' };
  }

  /* ---------- run flow ---------- */
  function createRun(input) {
    /* input: {tier, party, seed, ageConfirmed, energyBefore} — caller deducts
       energy via economy.js before creating the run; this module never spends. */
    var age = validateAgeGate(input.ageConfirmed);
    if (!age.ok) return { ok:false, reason: age.reason };
    var dungeon = generateDungeon(input.tier, input.seed !== undefined ? input.seed : hashSeed('run-' + Date.now()));
    return {
      ok:true, tier: input.tier, party: (input.party || []).slice(), dungeon: dungeon,
      blocksCleared:0, kills:0, elitesSlain:0, chestsOpened:0, runGold:0,
      loot: [], drafts: [], checkpointsVisited:0, status:'active', startedAt: Date.now()
    };
  }
  function runGoldRates() { return { kill:2, elite:6, boss:25, chest:10 }; }
  /* Combo bonus (combo-counter-spec-2026-10-15 §3): flat add per kill,
     credited to run.runGold ONLY — never account gold.
     Self-contained tier table (identical values to app.js COMBO_BONUS_TIERS);
     this module loads before app.js and must not depend on its globals. */
  var COMBO_BONUS_TIERS = [
    { min: 30, bonus: 5 },
    { min: 20, bonus: 3 },
    { min: 10, bonus: 2 },
    { min: 5, bonus: 1 },
    { min: 0, bonus: 0 }
  ];
  function comboBonusFor(combo) {
    var c = (typeof combo === 'number' && isFinite(combo)) ? Math.max(0, Math.floor(combo)) : 0;
    for (var i = 0; i < COMBO_BONUS_TIERS.length; i++) if (c >= COMBO_BONUS_TIERS[i].min) return COMBO_BONUS_TIERS[i].bonus;
    return 0;
  }
  function addKill(run, source, combo) {
    var rates = runGoldRates();
    run.kills++;
    if (source === 'elite') { run.elitesSlain++; run.runGold += rates.elite; }
    else run.runGold += rates.kill;
    run.runGold += comboBonusFor(combo);
    return run;
  }
  function openChest(run) { run.chestsOpened++; run.runGold += runGoldRates().chest; return run; }
  function clearBlock(run) { run.blocksCleared++; return run; }
  function checkpointHeal(party) {
    /* Checkpoint heal: restore 50% of missing HP to each party member + full combat EN. */
    return (party || []).map(function (p) {
      var missing = (p.maxhp || p.hp || 0) - (p.hp || 0);
      return { id: p.id, hp: (p.hp || 0) + Math.round(missing * 0.50), en: p.maxen || 100 };
    });
  }
  function wipeRun(run) {
    /* R-13: keep picked-up loot (sell/salvage), NO clear bonus, energy stays spent. */
    run.status = 'wiped';
    return { keptLoot: run.loot.slice(), clearBonus:0, energyRefunded:0, runGoldKept:0 };
  }
  function completeRun(run, opts) {
    opts = opts || {};
    run.status = 'cleared';
    /* No clear bonus under the locked ECON-BAND-B-4K 4,000/clear band;
       the old 55/105/185/310 table belonged to the superseded R-17 model.
       (MVP x1.15 shape left untouched — LV-L5 still open.) */
    var clearBonus = 0; // P6(ECON-BAND-B-4K)
    var mvp = !!opts.mvp;
    var bonus = mvp ? Math.round(clearBonus * 1.15) : clearBonus;
    return { keptLoot: run.loot.slice(), clearBonus: bonus, mvp: mvp, energyRefunded:0, bonusLootRoll: mvp };
  }

  /* ---------- Abyss rotation (Level 3) ---------- */
  var ABYSS_CYCLE = [
    { week:1, name:'Iron Week', resisted:'tech', favored:'magic', trashCap:0.65, eliteCap:0.75, shrines:'Tech Conduit suppressed; Ley Line + Fusion Reactor weighted', buffs:'Corrupted Red: bonus damage / reduced max HP · Corrupted Blue: CDR / reduced move speed · Corrupted Gold: bonus loot / reduced damage' },
    { week:2, name:'Arcane Week', resisted:'magic', favored:'hybrid', shrines:'Ley Line suppressed; Tech Conduit + Fusion Reactor weighted', buffs:'Corrupted Red: bonus damage / reduced max HP · Corrupted Blue: energy regen / reduced max HP · Corrupted Gold: bonus loot / reduced damage' },
    { week:3, name:'Fusion Week', resisted:'hybrid', favored:'tech', shrines:'Fusion Reactor suppressed; Tech Conduit + Ley Line weighted', buffs:'Corrupted Red: bonus damage / reduced max HP · Corrupted Blue: CDR / reduced move speed · Corrupted Gold: greed spike' },
    { week:4, name:'Stoneheart Week', resisted:'all', favored:'none', shrines:'Stoneheart Altar guaranteed at both Elite Camps; War Drum contested', buffs:'Corrupted Red: damage + lifesteal / reduced move speed · Corrupted Blue: CDR / reduced move speed · Corrupted Gold: bonus loot / reduced damage' },
    { week:5, name:'Venom Week', resisted:'poison', favored:'tech', shrines:'Ley Line weighted; Stoneheart once', buffs:'Corrupted Red: bonus damage / reduced max HP · Corrupted Blue: energy regen / reduced max HP · Corrupted Gold: bonus loot / reduced damage' },
    { week:6, name:'Howl Week', resisted:'fear', favored:'hybrid', shrines:'Fusion Reactor weighted; War Drum contested', buffs:'Corrupted Red: bonus damage / reduced max HP · Corrupted Blue: CDR / reduced move speed · Corrupted Gold: bonus loot / reduced damage' }
  ];
  function isoWeekId(date) {
    var d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    var day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
  }
  function abyssWeekFor(date, seasonId, seasonStartDate) {
    date = date || new Date();
    var weekId = isoWeekId(date);
    var seasonStart = seasonStartDate ? new Date(seasonStartDate) : new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    var weekNumber = Math.max(1, Math.floor((date - seasonStart) / (7 * 86400000)) + 1);
    var entry = ABYSS_CYCLE[(weekNumber - 1) % 6];
    var seedHex = sha256Hex('GRINDCHAIN-ABYSS-' + (seasonId || 'S1') + '-' + weekId);
    return { weekId:weekId, weekNumber:weekNumber, entry:entry, seedHex:seedHex, seedUint32: parseInt(seedHex.slice(0, 8), 16) >>> 0, boundary:'Monday 00:00 UTC' };
  }

  /* ---------- open / blocked registries (flags, not resolutions) ---------- */
  var OPEN_ITEMS = [
    'SYS-6: no hero XP/level curve — progression is gear + loadout + synergy only.',
    'SYS-7: per-hero skill kits deferred — faction kits only in v1.',
    'SYS-4: fusion awaits Adrian confirm — implemented to spec, flagged.',
    'LV-L1: run-duration bands (Level 1.2) vs DESIGN 2-5 min — implemented to Level spec, flagged.',
    'LV-L3: Abyss rotation boundary Monday 00:00 UTC — flagged.',
    'LV-L4: retry = 50% of full energy cost (3/4/5/6). P6(LV-L4)',
    'LV-L5: MVP bonus shape (bonus gold + one bonus loot roll) — flagged.',
    'ECON-L3: season reset — upgrades above +10 reset to +10 — flagged.',
    'B3-GUILD: guild founding price/currency — NOT decided; no price in copy.',
    'C28: dungeon-name conflict — "Ember Caves" used consistently; alternate name flagged, never used.',
    'NAR-2/NAR-3: operations-cut and marketplace-fee figures unconfirmed — never in player-facing copy.',
    'B2-2: server for co-op — planning only, nothing built.',
    'B2-3: gold/power tension — strict gate stands; bought gold buys cosmetics only (economy.js).',
    'B2-4: gold transferability — assumed account-bound closed-loop; no transfers built.'
  ];
  var BLOCKED = [
    'Marketplace UI/settlement (B2-4 + compliance 2.3c) — item-preservation rules in the data model only.',
    'Purchasable power — no gold cost on upgrades, no bought-gold power path.',
    'Paid energy refill — no price, no button, no gold cost; natural-regen timer + qualifier only.',
    'Server/co-op networking, matchmaking presented as server enforcement.',
    'On-chain wiring / contracts / mint / settlement.',
    'Play Billing checkout; accounts/cloud save; external sending.',
    'Gold transfers / gifting / cash-out; bought-gold entry to tournaments/guilds/raids/fusion/marketplace.'
  ];

  G = {
    version: 'phase3-gameplay-1.0.0',
    COPY: COPY,
    HEROES: HEROES, HERO_LIST: HERO_LIST, FACTION_KITS: FACTION_KITS,
    heroStats: heroStats, allyStats: allyStats, synergyBonus: synergyBonus,
    affinityMultiplier: affinityMultiplier,
    COUNTER: COUNTER, MONSTER_CLASS: MONSTER_CLASS, counterMultiplier: counterMultiplier,
    CAPS: CAPS, damageMultiplier: damageMultiplier, critRoll: critRoll,
    ETYPES: ETYPES, TIER_SCALING: TIER_SCALING, ELITE_MULT: ELITE_MULT,
    trashResists: trashResists, eliteResists: eliteResists, monsterStats: monsterStats,
    BLOCK_CATALOG: BLOCK_CATALOG, TIER_CONFIG: TIER_CONFIG,
    generateDungeon: generateDungeon, validateDungeon: validateDungeon, dungeonPreview: dungeonPreview,
    BLOCK_TYPE_META: BLOCK_TYPE_META, blockMeta: blockMeta, assertSeedDiscipline: assertSeedDiscipline,
    BOSS_TABLE: BOSS_TABLE, createBoss: createBoss, applyBossDamage: applyBossDamage,
    bossTick: bossTick, bossPhaseLabel: bossPhaseLabel, bossNameFor: bossNameFor,
    syncBossToG: syncBossToG, EXPOSED_RESIST: EXPOSED_RESIST,
    CC_TYPES: CC_TYPES, applyCC: applyCC, hasCC: hasCC, tickCC: tickCC, cleanse: cleanse,
    DOT_DEFS: DOT_DEFS, applyDoT: applyDoT, tickDoTs: tickDoTs, healingMultiplier: healingMultiplier,
    telegraphValid: telegraphValid, applyDebuff: applyDebuff, debuffMultipliers: debuffMultipliers,
    WEAPON_TYPES: WEAPON_TYPES, RARITIES: RARITIES, RARITY_MULT: RARITY_MULT,
    TIER_WEAPON_BASE: TIER_WEAPON_BASE, TIER_ARMOR_BASE: TIER_ARMOR_BASE,
    TRAIT_POOL: TRAIT_POOL, SECONDARY_POOL: SECONDARY_POOL,
    rollWeapon: rollWeapon, rollArmor: rollArmor, rollTrinket: rollTrinket,
    canEquip: canEquip, equipItem: equipItem, setLoadoutSlot: setLoadoutSlot, dropFor: dropFor, mvpBonusRoll: mvpBonusRoll,
    rollDraft: rollDraft, draftRarityFor: draftRarityFor, draftAffinityValue: draftAffinityValue,
    SHRINES: SHRINES, TOTEMS: TOTEMS, BUFFS: BUFFS,
    createTutorial: createTutorial, advanceTutorial: advanceTutorial, tutorialRunConfig: tutorialRunConfig,
    validateLobby: validateLobby, validateAgeGate: validateAgeGate,
    createRun: createRun, runGoldRates: runGoldRates, addKill: addKill, openChest: openChest, comboBonusFor: comboBonusFor,
    clearBlock: clearBlock, checkpointHeal: checkpointHeal, wipeRun: wipeRun, completeRun: completeRun,
    ABYSS_CYCLE: ABYSS_CYCLE, isoWeekId: isoWeekId, abyssWeekFor: abyssWeekFor, sha256Hex: sha256Hex,
    OPEN_ITEMS: OPEN_ITEMS, BLOCKED: BLOCKED,
    mulberry32: mulberry32, hashSeed: hashSeed
  };
  root.GrindchainGameplay = G;
  if (typeof module !== 'undefined' && module.exports) module.exports = G;
})(typeof window !== 'undefined' ? window : globalThis);
