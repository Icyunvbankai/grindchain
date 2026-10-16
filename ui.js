/* GRINDCHAIN Phase 3 UI — real game UI layer (Wave 2).
   NEW file. Never edits Wave 1 files (app.js, index.html, styles.css,
   save.js, sw.js). The integrator includes ui.css + this file and calls
   GCUI.init(). Nothing auto-runs on script load.
   Binding: UI.bind(state) merges a partial state object. Every bar and number
   is read from live state on each tick or render. Where a gameplay system
   has not landed yet, the value renders as a slot (em dash + MOCK tag) and
   the binding point is listed in docs/INTEGRATION-ui.md. No gameplay number
   is baked into this file as a real value.
   Sources of live truth: window.Save (save.js), window.Game (Game API).
   Boss shield state is read ONLY through Game.getBossState(). */
'use strict';
(function () {
  var AGE_KEY = 'grindchain.agegate.v1';
  var UI_KEY = 'grindchain.ui.v1';
  var B2_LOCK = 'Locked — awaiting design ruling (B2-3). Purchasable gold cannot buy power until resolved.';
  var ENERGY_QUALIFIER = 'Energy Refill — pending Adrian\'s B2-3 ruling.';
  var SEASON_RESET = 'At season end, season power partially resets; cosmetics, collection log, and guild standing persist.';
  var TOURNAMENT_SKILL = 'Skill-based. Crew power + team composition decide it. No chance-based outcomes.';
  var GUILD_FRAMING = 'No one clears the Chain alone. A guild is a crew that covers what you can\'t — your Tech, their Magic, someone else\'s Hybrid. Guild dungeons need everyone contributing.';
  var GUILD_COST = 'Founding cost: shown before you confirm. Founding grants no power.';
  var RETURNING = 'Your crew earned while you slept.';
  var ABYSS_ROTATION = 'The Abyss has turned. This week\'s resistances have shifted — check the preview before you enter.';
  var PHASE_CALLOUTS = {
    1: 'AEGIS SHIELD — TECH DAMAGE ONLY',
    2: 'MANA WARD — MAGIC DAMAGE ONLY',
    3: 'FUSION CORE — HYBRID DAMAGE ONLY'
  };
  var SHIELD_LABELS = {
    aegis: 'AEGIS SHIELD — TECH ONLY',
    'mana-ward': 'MANA WARD — MAGIC ONLY',
    'fusion-core': 'FUSION CORE — HYBRID ONLY',
    none: ''
  };
  var HEROES = [
    { id: 'bastion', name: 'Bastion', faction: 'red', cls: 'Tank', line: 'Tower shield + war hammer. Immovable wall; shield-bash + knockback.' },
    { id: 'rampart', name: 'Rampart', faction: 'red', cls: 'Tank', line: 'Iron golem siege wall. Immovable; holds the breach.' },
    { id: 'deadeye', name: 'Deadeye', faction: 'red', cls: 'Marksman', line: 'Long-range rifle. One shot, kept in a ledger.' },
    { id: 'vigil', name: 'Vigil', faction: 'red', cls: 'Marksman', line: 'Drone sniper. Her recon drone flies every approach first.' },
    { id: 'hex', name: 'Hex', faction: 'blue', cls: 'Mage', line: 'Void bound in blue sigils. Artillery range; immobile while casting.' },
    { id: 'ember', name: 'Ember', faction: 'blue', cls: 'Mage', line: 'Spellfire mage. Burn spreader; mid-range damage over time.' },
    { id: 'mercy', name: 'Mercy', faction: 'blue', cls: 'Support', line: 'Heals the most-injured first; cleanse strips poison, burn, and crowd control.' },
    { id: 'sage', name: 'Sage', faction: 'blue', cls: 'Support', line: 'Nature mage. Sustain heals and shields for the crew.' },
    { id: 'rook', name: 'Rook', faction: 'purple', cls: 'Fighter', line: 'Bladed gauntlets, rune-etched. Heals on hit; never stops swinging.' },
    { id: 'dusk', name: 'Dusk', faction: 'purple', cls: 'Fighter', line: 'Hooded shadow duelist. Measured, lethal, sword for hire.' },
    { id: 'shade', name: 'Shade', faction: 'purple', cls: 'Assassin', line: 'Twin daggers, blink in, delete one target, vanish.' },
    { id: 'specter', name: 'Specter', faction: 'purple', cls: 'Assassin', line: 'Arcane sniper. Range, angle, timing, one round.' }
  ];
  var FACTIONS = {
    red: { label: 'RED // TECH', codex: 'RED // TECH — Powered armor, plasma, drones. Fast. Relentless. Cracks the Aegis Shield — and nothing else.', kit: 'Plasma Burst / Overdrive / Orbital Strike', passive: 'Passive: move speed' },
    blue: { label: 'BLUE // MAGIC', codex: 'BLUE // MAGIC — Arcane runes, elemental spells. Control the field. Breaks the Mana Ward — and nothing else.', kit: 'Arcane / Frost / Meteor', passive: 'Passive: energy regen' },
    purple: { label: 'PURPLE // HYBRID', codex: 'PURPLE // HYBRID — Tech fused with magic. Lifesteal. Unpredictable. Collapses the Fusion Core — and nothing else.', kit: 'Phase Blades / Blink / Singularity', passive: 'Passive: lifesteal' }
  };
  var TUTORIAL_BEATS = [
    { title: 'Beat 1 — MOVE', line: 'Move — drag the joystick. The dungeon doesn\'t wait.' },
    { title: 'Beat 2 — ATTACK', line: 'Attack — tap ATTACK. One shot is enough here. It won\'t be later.' },
    { title: 'Beat 3 — SKILL', line: 'Skills cost Energy. Tap PLASMA BURST. Spend it on something worth killing.' },
    { title: 'Beat 4 — POTION', line: 'Potions drop from kills. Tap HP POTION. Pick up everything — the Chain charges for what you leave.' },
    { title: 'Beat 5 — DONE', line: 'You cleared your first fight. Now pick your faction. The Chain only gets deeper from here.' }
  ];
  var PARTY_SLOTS = 3;
  var FUSION_INPUTS = 3;
  var BOSS_PHASES = 3;

  var S = {
    screen: 'age', faction: 'red', hero: 'bastion', crew: ['bastion'],
    party: [null, null, null], partyAI: true, dungeon: null, dungeonTier: 'T1',
    combat: null, results: null, trade: null, idle: null,
    meta: {}, settings: {}, passClaims: {}, tutorialBeat: 0,
    confirm: null, shopTab: 'cosmetics', lastPhase: 0, started: false
  };

  /* ---------- helpers ---------- */
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function val(v) { return (v === null || v === undefined || v === '') ? null : v; }
  function slot(v) { var x = val(v); return x === null ? '— <span class="gcui-mock">MOCK</span>' : esc(x); }
  function num(v) { var x = val(v); if (x === null) return null; var n = Number(x); return isFinite(n) ? n : null; }
  function fmtInt(v) { var n = num(v); return n === null ? null : Math.round(n).toLocaleString('en-US'); }
  function fmtPct(frac) {
    if (frac === null || frac === undefined || frac === '') return null;
    if (typeof frac === 'string') return frac;
    var n = Number(frac); if (!isFinite(n)) return null;
    return Math.round(n * 100) + '%';
  }
  function pctOf(cur, max) {
    var c = num(cur), m = num(max); if (c === null || m === null || m <= 0) return 0;
    return Math.max(0, Math.min(100, (c / m) * 100));
  }
  function saveData() { try { return (typeof Save !== 'undefined' && Save.data) ? Save.data : null; } catch (e) { return null; } }
  function gameApi() { try { return (typeof Game !== 'undefined') ? Game : null; } catch (e) { return null; } }
  function bossState() {
    try { var g = gameApi(); if (g && g.getBossState) return g.getBossState(); } catch (e) {}
    if (S.combat && S.combat.boss) return S.combat.boss;
    return null;
  }
  function uiStore() {
    try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function uiStoreSave(obj) { try { localStorage.setItem(UI_KEY, JSON.stringify(obj)); } catch (e) {} }
  function agePassed() {
    try { var r = JSON.parse(localStorage.getItem(AGE_KEY) || 'null'); return !!(r && r.verified); } catch (e) { return false; }
  }
  function canStartRun() { return agePassed(); }
  function meta() { return S.meta || {}; }
  function heroById(id) { for (var i = 0; i < HEROES.length; i++) if (HEROES[i].id === id) return HEROES[i]; return null; }
  function factionOf(heroId) { var h = heroById(heroId); return h ? h.faction : null; }
  function coverageOf(ids) {
    var cov = { red: false, blue: false, purple: false };
    (ids || []).forEach(function (id) { var f = factionOf(id); if (f) cov[f] = true; });
    return cov;
  }
  function requiredFactions(tier) {
    if (tier === 'T2') return ['red', 'blue', 'purple'].slice(0, 0).concat(['any2']);
    if (tier === 'T3' || tier === 'T4') return ['red', 'blue', 'purple'];
    return [];
  }
  function partyGate() {
    var tier = S.dungeonTier;
    var ids = S.party.filter(Boolean);
    var cov = coverageOf(ids);
    if (S.partyAI) { /* AI allies fill empty slots with the crew's factions when bound; coverage counts chosen slots only until AI binding lands. */ }
    if (tier === 'T1') return { ok: ids.length > 0, reason: ids.length > 0 ? '' : 'Pick at least one fighter for the crew.' };
    if (tier === 'T2') {
      var count = (cov.red ? 1 : 0) + (cov.blue ? 1 : 0) + (cov.purple ? 1 : 0);
      return { ok: count >= 2 && ids.length >= 2, reason: (count >= 2 && ids.length >= 2) ? '' : 'Tier 2 needs at least 2 factions in the party. Add a fighter from a missing faction.' };
    }
    var missing = [];
    if (!cov.red) missing.push('TECH');
    if (!cov.blue) missing.push('MAGIC');
    if (!cov.purple) missing.push('HYBRID');
    return { ok: missing.length === 0 && ids.length >= PARTY_SLOTS, reason: missing.length ? 'Tier ' + tier.slice(1) + ' requires all 3 factions — add a ' + missing.join(' / ') + ' fighter.' : 'Fill all party slots.' };
  }
  function goldTotal() { var d = saveData(); return d && d.gold ? d.gold.balance : null; }
  function goldBreakdown() {
    var m = meta(); var l = m.goldLedger;
    if (!l) return { farmed: null, bought: null };
    return { farmed: l.farmed, bought: l.bought };
  }
  function energyNow() { var d = saveData(); return d && d.energy ? d.energy.session : null; }
  function root() { return document.getElementById('gcui-root'); }
  function el(id) { var r = root(); return r ? r.querySelector('#' + id) : null; }

  /* ---------- screen shell ---------- */
  function banner() {
    return '<div class="gcui-banner">UI preview — values marked <span class="gcui-mock">MOCK</span> are layout slots until live systems land. No purchase, trade, or transaction executes from this UI.</div>';
  }
  function backBtn(target, label) {
    return '<button class="gcui-btn ghost sm inline" data-gcui-nav="' + target + '">' + (label || 'Back') + '</button>';
  }
  function topbar(title, back) {
    return '<div class="gcui-topbar"><h2 class="gcui-title">' + esc(title) + '</h2>' +
      (back ? backBtn(back, 'Back to Hub') : '') + '</div>';
  }
  function screen(id, inner) {
    return '<section class="gcui-screen" data-gcui-screen="' + id + '">' + inner + '</section>';
  }
  function lockBox(text) { return '<div class="gcui-lock">' + esc(text) + '</div>'; }
  function refillRow(context) {
    var m = meta(); var e = m.energy || {};
    var now = energyNow(); var cap = num(e.cap); var rate = val(e.regenLabel);
    var timer = '— <span class="gcui-mock">MOCK</span>';
    if (now !== null && cap !== null && cap > now && val(e.regenMinutes) !== null) {
      var mins = (cap - now) * Number(e.regenMinutes);
      var h = Math.floor(mins / 60); var mm = Math.round(mins % 60);
      timer = 'Full in ' + h + 'h ' + mm + 'm';
    } else if (now !== null && cap !== null && now >= cap) { timer = 'Full'; }
    return '<div class="gcui-card"><h3>Energy Refill</h3>' +
      '<div class="gcui-kv"><span>Session energy</span><b>' + slot(fmtInt(now)) + (cap !== null ? ' / ' + esc(cap) : '') + '</b></div>' +
      '<div class="gcui-kv"><span>Natural regen</span><b>' + (rate !== null ? esc(rate) : timer) + '</b></div>' +
      '<p>' + esc(ENERGY_QUALIFIER) + '</p>' +
      '<p class="gcui-small gcui-muted">Shown on: ' + esc(context) + '. No price, no gold cost, no purchase button while the ruling is open.</p></div>';
  }

  /* ---------- screens ---------- */
  function renderAge() {
    var months = ''; for (var i = 1; i <= 12; i++) months += '<option value="' + i + '">' + i + '</option>';
    var days = ''; for (var d = 1; d <= 31; d++) days += '<option value="' + d + '">' + d + '</option>';
    var years = ''; for (var y = new Date().getFullYear(); y >= new Date().getFullYear() - 100; y--) years += '<option value="' + y + '">' + y + '</option>';
    return screen('age',
      '<div class="gcui-card" style="border-color:#ff2e4d"><h2 class="gcui-title" style="text-align:center">ADULTS ONLY · 18+</h2>' +
      '<p style="text-align:center">GRINDCHAIN involves real cryptocurrency on mainnet and real-money purchases. You must be 18 or older to play.</p></div>' +
      '<label class="gcui-label">DATE OF BIRTH</label>' +
      '<div class="gcui-row"><select class="gcui-select" id="gcui-dob-m" style="flex:1"><option value="">Month</option>' + months + '</select>' +
      '<select class="gcui-select" id="gcui-dob-d" style="flex:1"><option value="">Day</option>' + days + '</select>' +
      '<select class="gcui-select" id="gcui-dob-y" style="flex:1"><option value="">Year</option>' + years + '</select></div>' +
      '<label style="font-size:14px"><input type="checkbox" id="gcui-age-confirm"> I confirm I am 18 years of age or older.</label>' +
      '<p class="gcui-small">By continuing you confirm your date of birth is accurate. Providing a false age violates the Terms of Service.</p>' +
      '<div id="gcui-age-error" class="gcui-warn" style="display:none"></div>' +
      '<button class="gcui-btn red" data-gcui-action="age-verify">VERIFY AGE &amp; CONTINUE</button>' +
      '<p class="gcui-small gcui-muted" style="text-align:center">Your date of birth is stored on this device only, to enforce the age gate. It is never sold or shared.</p>' +
      '<p class="gcui-small" style="text-align:center">Terms of Service · Privacy Policy · Crypto Risk Disclosure</p>');
  }
  function renderBlocked() {
    return screen('blocked',
      '<div class="gcui-card" style="border-color:#ff2e4d;text-align:center;padding:30px 14px"><h2 class="gcui-title">ACCESS BLOCKED</h2>' +
      '<p>You must be 18 or older to play GRINDCHAIN.</p>' +
      '<p class="gcui-small gcui-muted">GRINDCHAIN involves real cryptocurrency and real-money purchases. This device is blocked from entering the game.</p>' +
      '<button class="gcui-btn ghost" data-gcui-action="exit">EXIT GAME</button>' +
      '<p class="gcui-small gcui-muted">If you believe this is an error, re-check the date of birth you entered. There is no other way in.</p></div>');
  }
  function renderTitle() {
    var d = saveData();
    var cont = d && d.lastRun ? '<button class="gcui-btn gold" data-gcui-action="continue">CONTINUE</button>' : '';
    return screen('title',
      '<div style="text-align:center;padding-top:20px"><div><span class="gcui-chip red">RED TECH</span> <span class="gcui-chip blue">BLUE MAGIC</span> <span class="gcui-chip purple">PURPLE HYBRID</span></div>' +
      '<h1 class="gcui-title" style="font-size:48px">GRIND<br><span style="color:#ffc93c">CHAIN</span></h1>' +
      '<p class="gcui-muted" style="letter-spacing:.3em;font-size:12px">THE GRIND NEVER SLEEPS</p>' +
      '<div style="margin-top:10px"><span class="gcui-chip gold">ADULTS 18+</span> <span class="gcui-chip gray">ANDROID · WEB</span></div>' +
      '<div style="max-width:420px;margin:24px auto">' + cont +
      '<button class="gcui-btn gold" data-gcui-action="new-game">TAP TO START</button>' +
      '<button class="gcui-btn ghost" data-gcui-nav="settings">SETTINGS</button></div>' +
      '<p class="gcui-small gcui-muted">Real crypto on mainnet. Skill-based tournaments. No ads.</p></div>');
  }
  function renderFaction() {
    var cards = ['red', 'blue', 'purple'].map(function (f) {
      var F = FACTIONS[f];
      var sel = S.faction === f ? ' style="border-color:#ffc93c"' : '';
      return '<div class="gcui-card" data-gcui-faction="' + f + '"' + sel + '><h3>' + esc(F.label) + '</h3>' +
        '<p>Kit: ' + esc(F.kit) + '. ' + esc(F.passive) + '.</p>' +
        '<p>' + esc(F.codex) + '</p>' +
        '<button class="gcui-btn sm ' + f + '" data-gcui-faction-pick="' + f + '">START AS ' + esc(F.label.split(' // ')[1]) + '</button></div>';
    }).join('');
    return screen('faction', topbar('CHOOSE YOUR FACTION', 'title') + cards +
      '<p class="gcui-small gcui-muted" style="text-align:center">No single faction clears everything. Raids need all three — collect them all or bring friends.</p>');
  }
  function renderHero() {
    var grid = HEROES.map(function (h) {
      return '<div class="gcui-hero' + (S.crew.indexOf(h.id) >= 0 ? ' sel' : '') + '" data-gcui-hero="' + h.id + '">' +
        '<div class="nm">' + esc(h.name) + '</div><div class="cl">' + esc(h.faction.toUpperCase()) + ' · ' + esc(h.cls) + '</div></div>';
    }).join('');
    var sel = heroById(S.hero) || HEROES[0];
    return screen('hero', topbar('SELECT YOUR CREW', 'hub') +
      '<div class="gcui-tabs"><span data-gcui-herofilter="all" class="on">ALL</span><span data-gcui-herofilter="red">RED</span><span data-gcui-herofilter="blue">BLUE</span><span data-gcui-herofilter="purple">PURPLE</span></div>' +
      '<div class="gcui-grid3">' + grid + '</div>' +
      '<div class="gcui-card"><h3>' + esc(sel.name) + ' · ' + esc(sel.faction.toUpperCase()) + ' · ' + esc(sel.cls) + '</h3><p>' + esc(sel.line) + '</p>' +
      '<p class="gcui-small">Tap a hero card to select it for the crew. Crew: ' + esc(S.crew.join(', ') || '—') + '</p></div>' +
      '<button class="gcui-btn gold" data-gcui-action="confirm-crew">CONFIRM CREW</button>');
  }
  function renderHub() {
    var m = meta(); var d = saveData();
    var gb = goldBreakdown();
    var streak = d && d.streak ? d.streak.current : null;
    var season = m.season || {};
    var quests = Array.isArray(m.quests) ? m.quests : [];
    var done = quests.filter(function (q) { return q.claimed; }).length;
    var seasonLabel = val(season.timeLeft) !== null ? esc(season.timeLeft) : '— <span class="gcui-mock">MOCK</span>';
    return screen('hub', banner() + topbar('GRINDCHAIN — HOME BASE') +
      '<div class="gcui-row"><button class="gcui-btn gold inline" data-gcui-action="gold-breakdown">Gold: ' + slot(fmtInt(goldTotal())) + '</button>' +
      '<span class="gcui-chip gold">Farmed: ' + slot(fmtInt(gb.farmed)) + '</span>' +
      '<span class="gcui-chip gray">Bought: ' + slot(fmtInt(gb.bought)) + '</span>' +
      '<span class="gcui-chip gray">Streak: ' + slot(fmtInt(streak)) + ' day(s)</span>' +
      '<span class="gcui-chip gray">Season ends in: ' + seasonLabel + '</span></div>' +
      '<div class="gcui-grid2"><div class="gcui-card"><h3>SESSION ENERGY</h3><p>' + slot(fmtInt(energyNow())) + (num((m.energy || {}).cap) !== null ? ' / ' + esc((m.energy || {}).cap) : '') + '</p>' +
      '<button class="gcui-btn ghost sm" data-gcui-action="energy-tap">ENERGY DETAILS</button></div>' +
      '<div class="gcui-card"><h3>DAILY QUESTS</h3><p>' + esc(done) + ' / ' + esc(quests.length || '—') + ' complete</p>' +
      '<button class="gcui-btn ghost sm" data-gcui-nav="quests">VIEW QUESTS</button></div></div>' +
      refillRow('Hub energy tap') +
      '<div class="gcui-grid2">' +
      '<button class="gcui-btn red" data-gcui-nav="dungeons">PLAY · DUNGEONS</button>' +
      '<button class="gcui-btn blue" data-gcui-nav="guild">GUILD</button>' +
      '<button class="gcui-btn purple" data-gcui-nav="tournaments">TOURNAMENT</button>' +
      '<button class="gcui-btn ghost" data-gcui-nav="inventory">INVENTORY</button>' +
      '<button class="gcui-btn ghost" data-gcui-nav="shop">SHOP</button>' +
      '<button class="gcui-btn ghost" data-gcui-nav="quests">QUESTS</button>' +
      '<button class="gcui-btn ghost" data-gcui-nav="seasons">SEASON</button>' +
      '<button class="gcui-btn ghost" data-gcui-nav="settings">SETTINGS</button></div>' +
      '<p class="gcui-small gcui-muted">' + esc(SEASON_RESET) + '</p>');
  }

  function dungeonCard(dg) {
    var locked = val(dg.lockedReason) !== null;
    var out = val(dg.lockedOut) === true;
    var head = '<div class="gcui-card"><h3>TIER ' + esc(String(dg.tier || '').replace(/^T/, '')) + ' · ' + esc(dg.tierName || '') + '</h3>';
    if (dg.tier === 'T4') head += '<p>' + esc(ABYSS_ROTATION) + '</p>';
    head += '<div class="gcui-kv"><span>Resistances</span><b>' + (dg.resistances ? esc(dg.resistances) : slot(null)) + '</b></div>' +
      '<div class="gcui-kv"><span>CC profile</span><b>' + (dg.cc ? esc(dg.cc) : slot(null)) + '</b></div>' +
      '<div class="gcui-kv"><span>Debuff profile</span><b>' + (dg.debuffs ? esc(dg.debuffs) : slot(null)) + '</b></div>' +
      '<div class="gcui-kv"><span>Blocks</span><b>' + (dg.blocks ? esc(dg.blocks) : slot(null)) + '</b></div>' +
      '<p class="gcui-small">Map shuffles every run.</p>' +
      '<div class="gcui-kv"><span>Party requirement</span><b>' + esc(dg.partyRequirement || '—') + '</b></div>' +
      '<div class="gcui-kv"><span>Energy cost</span><b>' + slot(fmtInt(dg.energyCost)) + '</b></div>' +
      '<div class="gcui-kv"><span>Loot tier</span><b>' + (dg.lootTier ? esc(dg.lootTier) : slot(null)) + '</b></div>';
    if (out) head += '<div class="gcui-warn">Already cleared this week — weekly lockout. Entry is closed until the next rotation.</div>';
    if (locked) head += '<div class="gcui-lock">' + esc(dg.lockedReason) + '</div>';
    head += '<button class="gcui-btn red" data-gcui-dungeon="' + esc(dg.id) + '"' + ((locked || out) ? ' disabled' : '') + '>VIEW PREVIEW</button></div>';
    return head;
  }
  function renderDungeons() {
    var m = meta(); var list = Array.isArray(m.dungeons) ? m.dungeons : [];
    var tiers = ['T1', 'T2', 'T3', 'T4'];
    var tabs = tiers.map(function (t) {
      return '<span data-gcui-tier="' + t + '" class="' + (S.dungeonTier === t ? 'on' : '') + '">' + t + '</span>';
    }).join('');
    var cards = list.filter(function (d) { return d.tier === S.dungeonTier; }).map(dungeonCard).join('');
    if (!cards) cards = '<div class="gcui-card"><p>Dungeon data not connected for this tier. <span class="gcui-mock">MOCK</span></p>' +
      '<p class="gcui-small">Bind dungeon previews with GCUI.setDungeons([...]) — resistances, CC profile, debuff profile, block count, party requirement, energy cost, loot tier, lockout state.</p></div>';
    var preview = '';
    if (S.dungeon) {
      var dg = S.dungeon; var gate = partyGate();
      preview = '<div class="gcui-card"><h3>PREVIEW — ' + esc(dg.tierName || dg.tier || '') + '</h3>' +
        '<p>Missing a faction hard-walls at that boss phase. The lobby validates before entry — you cannot queue without all three.</p>' +
        '<div class="gcui-kv"><span>Faction coverage</span><b>' + (function () {
          var cov = coverageOf(S.party.filter(Boolean));
          return 'TECH ' + (cov.red ? '✓' : '✗') + ' · MAGIC ' + (cov.blue ? '✓' : '✗') + ' · HYBRID ' + (cov.purple ? '✓' : '✗');
        })() + '</b></div>' +
        (gate.ok ? '<div class="gcui-ok">Party ready — entry allowed.</div>' : '<div class="gcui-warn">' + esc(gate.reason) + '</div>') +
        '<button class="gcui-btn ghost sm" data-gcui-nav="party">CHANGE CREW / PARTY</button>' +
        '<button class="gcui-btn red" data-gcui-action="enter-dungeon"' + (gate.ok && canStartRun() ? '' : ' disabled') + '>ENTER</button>' +
        (!canStartRun() ? '<p class="gcui-small">Age gate required before any run.</p>' : '') + '</div>';
    }
    return screen('dungeons', banner() + topbar('DUNGEON SELECT', 'hub') +
      '<div class="gcui-tabs">' + tabs + '</div>' + cards + preview +
      '<div class="gcui-card"><h3>Energy</h3>' + refillRow('Dungeon Select no-energy state') + '</div>');
  }
  function renderParty() {
    var gate = partyGate();
    var slots = '';
    for (var i = 0; i < PARTY_SLOTS; i++) {
      var cur = S.party[i] || '';
      var opts = '<option value="">— Empty slot —</option>' + HEROES.map(function (h) {
        return '<option value="' + h.id + '"' + (cur === h.id ? ' selected' : '') + '>' + esc(h.name) + ' · ' + esc(h.faction.toUpperCase()) + ' · ' + esc(h.cls) + '</option>';
      }).join('');
      slots += '<div class="gcui-card"><h3>Slot ' + (i + 1) + '</h3><select class="gcui-select" data-gcui-party-slot="' + i + '">' + opts + '</select></div>';
    }
    var cov = coverageOf(S.party.filter(Boolean));
    return screen('party', banner() + topbar('LOCAL PARTY SETUP', 'dungeons') +
      '<p>Local party — slot heroes and AI allies here. This is not server matchmaking; no other players are queued or enforced.</p>' +
      '<div class="gcui-card"><h3>Faction coverage</h3><p>TECH ' + (cov.red ? '✓' : '✗') + ' · MAGIC ' + (cov.blue ? '✓' : '✗') + ' · HYBRID ' + (cov.purple ? '✓' : '✗') + '</p>' +
      '<p class="gcui-small">Tier ' + esc(S.dungeonTier) + ' requirement: ' + (S.dungeonTier === 'T1' ? 'any faction' : S.dungeonTier === 'T2' ? 'at least 2 factions' : 'all 3 factions') + '.</p></div>' +
      slots +
      '<label style="font-size:14px"><input type="checkbox" id="gcui-party-ai"' + (S.partyAI ? ' checked' : '') + '> Fill empty slots with AI allies</label>' +
      (gate.ok ? '<div class="gcui-ok">Party ready — entry allowed.</div>' : '<div class="gcui-warn">' + esc(gate.reason) + '</div>') +
      '<button class="gcui-btn red" data-gcui-action="enter-dungeon"' + (gate.ok && canStartRun() ? '' : ' disabled') + '>ENTER</button>' +
      (!canStartRun() ? '<p class="gcui-small">Age gate required before any run.</p>' : ''));
  }
  function combatSnapshot() {
    var c = S.combat || {};
    var b = bossState();
    return { c: c, b: b };
  }
  function renderCombat() {
    var snap = combatSnapshot(); var c = snap.c; var b = snap.b;
    var cd = c.cooldowns || {};
    function cdBtn(label, key, cls) {
      var v = cd[key];
      var txt = (v === null || v === undefined) ? '—' : (Number(v) <= 0 ? 'READY' : String(Number(v)));
      return '<button class="gcui-hud gcui-skillbtn ' + (cls || '') + ' ' + (Number(v) <= 0 ? 'ready' : '') + '" data-gcui-skill="' + key + '"><span>' + esc(label) + '</span><span class="gcui-cdnum" data-gcui-cd="' + key + '">' + esc(txt) + '</span></button>';
    }
    var hp = c.hp, maxHp = c.maxHp, en = c.en, maxEn = c.maxEn;
    var phase = b ? (b.phase || 1) : (c.phase || 1);
    var shieldVisible = false; var shieldLabel = '';
    if (b && (S.dungeonTier === 'T3' || S.dungeonTier === 'T4')) {
      if (num(b.shield) !== null && Number(b.shield) > 0) { shieldVisible = true; shieldLabel = SHIELD_LABELS[b.shieldType] || PHASE_CALLOUTS[phase] || ''; }
    }
    var resists = c.resists || {};
    var resistLine = 'Tech ' + slot(fmtPct(resists.tech)) + ' · Magic ' + slot(fmtPct(resists.magic)) + ' · Hybrid ' + slot(fmtPct(resists.hybrid));
    var status = Array.isArray(c.status) ? c.status.map(function (s) { return '<span class="gcui-chip gray">' + esc(s) + '</span>'; }).join(' ') : '';
    var party = Array.isArray(c.party) ? c.party.map(function (p) {
      return '<div class="gcui-card" style="flex:1;margin:0"><b>' + esc(p.name || '—') + '</b><div class="gcui-bar"><i style="width:' + pctOf(p.hp, p.maxHp) + '%;background:#ff3b30"></i><span class="gcui-num">' + slot(fmtInt(p.hp)) + '</span></div><div class="gcui-small gcui-muted">' + esc(p.state || '') + '</div></div>';
    }).join('') : '';
    var bossBlock = b ? '<div><b>' + esc(b.name || 'Boss') + ' · BOSS</b> <span class="gcui-chip red">PHASE ' + esc(phase) + ' / ' + BOSS_PHASES + '</span></div>' +
      '<div class="gcui-bar big"><i id="gcui-boss-hp" style="width:' + pctOf(b.hp, b.maxhp) + '%;background:linear-gradient(90deg,#ff2e4d,#ff7a3c)"></i><span class="gcui-num" id="gcui-boss-hp-num">' + slot(fmtInt(b.hp)) + ' / ' + slot(fmtInt(b.maxhp)) + '</span></div>' +
      '<div class="gcui-bar big" id="gcui-boss-shieldbar" style="margin-top:4px;display:' + (shieldVisible ? 'block' : 'none') + '"><i id="gcui-boss-shield" style="width:' + pctOf(b.shield, b.shieldMax) + '%;background:#2e9cff"></i><span class="gcui-num" id="gcui-boss-shield-num">' + esc(shieldLabel) + ' · ' + slot(fmtInt(b.shield)) + ' / ' + slot(fmtInt(b.shieldMax)) + '</span></div>' +
      '<div class="gcui-hud gcui-phasebanner" id="gcui-phase-banner">' + esc(PHASE_CALLOUTS[phase] || '') + '</div>' +
      '<p class="gcui-small">Phase pips (text): <span class="gcui-hud gcui-phasepip" id="gcui-phase-pips">' + esc(phase) + ' / ' + BOSS_PHASES + '</span></p>' +
      '<p class="gcui-small">Live resistances: <span id="gcui-resist-line">' + resistLine + '</span></p>' : '<p class="gcui-small gcui-muted">No live boss. Boss block hides when no boss is active.</p>';
    var totem = (c.totemCharges === null || c.totemCharges === undefined) ? '—' : String(c.totemCharges);
    return screen('combat', '<div class="gcui-hud">' + topbar('COMBAT HUD') +
      '<div class="gcui-row"><div style="flex:1;min-width:220px"><div class="gcui-small"><b>HP</b></div><div class="gcui-bar"><i id="gcui-hp" style="width:' + pctOf(hp, maxHp) + '%;background:#ff3b30"></i><span class="gcui-num" id="gcui-hp-num">' + slot(fmtInt(hp)) + ' / ' + slot(fmtInt(maxHp)) + '</span></div>' +
      '<div class="gcui-small"><b>EN</b></div><div class="gcui-bar"><i id="gcui-en" style="width:' + pctOf(en, maxEn) + '%;background:#2e9cff"></i><span class="gcui-num" id="gcui-en-num">' + slot(fmtInt(en)) + ' / ' + slot(fmtInt(maxEn)) + '</span></div>' +
      '<p class="gcui-small">Session energy: ' + slot(fmtInt(energyNow())) + ' · Gold: ' + slot(fmtInt(goldTotal())) + '</p></div>' +
      '<div style="flex:2;min-width:260px">' + bossBlock + '</div></div>' +
      '<div>' + status + '</div>' +
      '<div class="gcui-hud gcui-arena" id="gcui-arena"><span class="gcui-muted">Combat canvas lives in the game view. This panel is a HUD overlay placeholder — integration hides it and mounts the HUD over the real canvas. <span class="gcui-mock">MOCK</span></span></div>' +
      '<div class="gcui-row" style="margin-top:8px">' + party + '</div>' +
      '<div class="gcui-row" style="margin-top:10px;align-items:flex-end">' +
      cdBtn('ATTACK', 'attack') + cdBtn('SKILL 1', 'skill1') + cdBtn('SKILL 2', 'skill2') + cdBtn('ULT', 'ult', 'ready') + cdBtn('DASH', 'dash') +
      '<button class="gcui-hud gcui-skillbtn" data-gcui-action="totem"><span>TOTEM</span><span class="gcui-cdnum" id="gcui-totem-count">' + esc(totem) + '</span><span class="gcui-small">charges</span></button>' +
      '<button class="gcui-btn ghost sm inline" data-gcui-action="pause">PAUSE</button></div>' +
      '<p class="gcui-small gcui-muted">Cooldown numerals are 18px. Phase changes are shown in the persistent banner above, never by toast alone.</p></div>');
  }
  function renderPause() {
    var c = S.combat || {};
    var bs = bossState();
    return screen('pause', '<h2 class="gcui-title" style="text-align:center">PAUSED</h2><p class="gcui-small gcui-muted" style="text-align:center">Combat frozen · Timers frozen · Your crew is safe</p>' +
      '<div class="gcui-card"><h3>RUN STATUS</h3>' +
      '<div class="gcui-kv"><span>Boss</span><b>' + (bs ? esc(bs.name || 'Boss') + ' · ' + slot(fmtInt(bs.hp)) + ' HP · Phase ' + esc(bs.phase || 1) : 'No live boss') + '</b></div>' +
      '<div class="gcui-kv"><span>Session energy</span><b>' + slot(fmtInt(energyNow())) + '</b></div></div>' +
      '<button class="gcui-btn gold" data-gcui-action="resume">RESUME</button>' +
      '<button class="gcui-btn ghost" data-gcui-action="restart">RESTART RUN</button>' +
      '<button class="gcui-btn ghost" data-gcui-nav="settings">SETTINGS</button>' +
      '<button class="gcui-btn ghost" data-gcui-action="abandon">ABANDON RUN → HOME</button>' +
      '<p class="gcui-small gcui-muted" style="text-align:center">Abandoning a run keeps earned loot + gold. Progress inside the run is lost.</p>');
  }
  function renderSettings() {
    var d = saveData(); var st = (d && d.settings) || {};
    var cur = S.settings;
    function sel(name, options, current) {
      return '<select class="gcui-select" data-gcui-setting="' + name + '">' + options.map(function (o) {
        return '<option value="' + o.v + '"' + (String(current) === String(o.v) ? ' selected' : '') + '>' + esc(o.l) + '</option>';
      }).join('') + '</select>';
    }
    return screen('settings', topbar('SETTINGS', 'hub') +
      '<div class="gcui-card"><h3>AUDIO</h3>' +
      '<label class="gcui-label">MUSIC VOLUME</label><input class="gcui-input" type="range" min="0" max="100" data-gcui-setting="musicVolume" value="' + esc(cur.musicVolume !== undefined ? cur.musicVolume : (typeof Settings !== 'undefined' ? Math.round(Settings.get().volume * 100) : (st.musicVolume !== undefined ? st.musicVolume : 70))) + '">' +
      '<label class="gcui-label">SOUND EFFECTS VOLUME</label><input class="gcui-input" type="range" min="0" max="100" data-gcui-setting="sfxVolume" value="' + esc(cur.sfxVolume !== undefined ? cur.sfxVolume : (st.sfxVolume !== undefined ? st.sfxVolume : 85)) + '"></div>' +
      '<div class="gcui-card"><h3>GAMEPLAY</h3><label class="gcui-label">GRAPHICS QUALITY</label>' +
      sel('quality', [{ v: 'low', l: 'Low' }, { v: 'med', l: 'Medium' }, { v: 'high', l: 'High' }], cur.quality !== undefined ? cur.quality : (typeof Settings !== 'undefined' ? Settings.get().quality : st.quality)) + '</div>' +
      '<div class="gcui-card"><h3>CONTROLS</h3><label class="gcui-label">JOYSTICK SIDE</label>' +
      sel('joystickSide', [{ v: 'left', l: 'Left' }, { v: 'right', l: 'Right' }], cur.joystickSide || st.joystickSide || 'left') +
      '<label class="gcui-label">JOYSTICK SIZE</label>' +
      sel('joystickSize', [{ v: 'medium', l: 'Medium' }, { v: 'large', l: 'Large' }, { v: 'small', l: 'Small' }], cur.joystickSize || st.joystickSize || 'large') +
      '<label class="gcui-label">LOCK-ON TARGETING</label>' +
      sel('lockOn', [{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }], cur.lockOn || st.lockOn || 'on') + '</div>' +
      '<div class="gcui-card"><h3>ACCESSIBILITY</h3><label class="gcui-label">COLORBLIND MODE</label>' +
      sel('colorblind', [{ v: 'none', l: 'Off' }, { v: 'deutan', l: 'Deutan' }, { v: 'protan', l: 'Protan' }, { v: 'tritan', l: 'Tritan' }], cur.colorblind || (typeof Settings !== 'undefined' ? Settings.get().colorblind : st.colorblind) || 'none') +
      '<label class="gcui-label">TEXT SIZE</label>' +
      sel('textSize', [{ v: 'small', l: 'Small' }, { v: 'medium', l: 'Medium' }, { v: 'large', l: 'Large' }], cur.textSize || (typeof Settings !== 'undefined' ? Settings.get().textSize : st.textSize) || 'medium') +
      '<p class="gcui-small">Status icons always carry text — never color alone.</p></div>' +
      '<div class="gcui-card"><h3>ACCOUNT · ADULTS 18+</h3><div class="gcui-kv"><span>Age verified</span><b>' + (agePassed() ? 'Verified 18+ on this device' : 'Not verified') + '</b></div>' +
      '<div class="gcui-kv"><span>Wallet</span><b>Not connected</b></div>' +
      '<button class="gcui-btn ghost sm" data-gcui-action="legal">VIEW TERMS · PRIVACY · RISK DISCLOSURE</button></div>' +
      '<button class="gcui-btn gold sm" data-gcui-action="save-settings">SAVE SETTINGS</button>' +
      '<button class="gcui-btn ghost sm" data-gcui-action="replay-tutorial">REPLAY TUTORIAL</button>');
  }
  function renderTutorial() {
    var beat = TUTORIAL_BEATS[S.tutorialBeat] || TUTORIAL_BEATS[0];
    var skip = S.tutorialBeat >= 2 ?
      '<button class="gcui-btn ghost sm" data-gcui-action="tutorial-skip">SKIP</button>' +
      '<div id="gcui-skip-confirm" style="display:none"><p>Skip tutorial? You can replay it from Settings.</p>' +
      '<button class="gcui-btn gold sm inline" data-gcui-action="tutorial-skip-yes">SKIP</button>' +
      '<button class="gcui-btn ghost sm inline" data-gcui-action="tutorial-skip-no">KEEP GOING</button></div>' : '<p class="gcui-small gcui-muted">Skip unlocks after Beat 3.</p>';
    return screen('tutorial', topbar('TUTORIAL', 'title') +
      '<div class="gcui-card"><h3>' + esc(beat.title) + '</h3><p>' + esc(beat.line) + '</p>' +
      '<p class="gcui-small">Beat ' + (S.tutorialBeat + 1) + ' of ' + TUTORIAL_BEATS.length + ' · Quartermaster</p></div>' +
      '<button class="gcui-btn gold" data-gcui-action="tutorial-next">' + (S.tutorialBeat >= TUTORIAL_BEATS.length - 1 ? 'CONTINUE TO FACTION SELECT' : 'NEXT BEAT') + '</button>' + skip);
  }

  function itemRow(it, ctx) {
    var actions = '';
    if (ctx === 'results') {
      actions = '<button class="gcui-btn gold sm inline" data-gcui-result="equip" data-gcui-item="' + esc(it.id) + '">EQUIP</button>' +
        '<button class="gcui-btn ghost sm inline" data-gcui-result="sell" data-gcui-item="' + esc(it.id) + '">SELL ' + slot(fmtInt(it.sell)) + 'g</button>' +
        '<button class="gcui-btn ghost sm inline" data-gcui-result="salvage" data-gcui-item="' + esc(it.id) + '">SALVAGE</button>';
    } else {
      actions = '<button class="gcui-btn gold sm inline" data-gcui-inv="equip" data-gcui-item="' + esc(it.id) + '">EQUIP</button>' +
        '<button class="gcui-btn ghost sm inline" data-gcui-inv="sell" data-gcui-item="' + esc(it.id) + '">SELL ' + slot(fmtInt(it.sell)) + 'g</button>' +
        '<button class="gcui-btn ghost sm inline" data-gcui-inv="salvage" data-gcui-item="' + esc(it.id) + '">SALVAGE</button>';
    }
    var epic = (it.rarity === 'Epic' || it.rarity === 'Legendary' || it.rarity === 'Mythic');
    return '<div class="gcui-loot"><div style="flex:1"><b>' + esc(it.name) + ' · ' + esc(it.tier || '') + ' · ' + esc(it.rarity || '') + '</b>' +
      '<small>' + esc(it.detail || '') + '</small>' +
      (it.upgradeLevel ? '<small>Upgrade +' + esc(it.upgradeLevel) + '</small>' : '') + '</div>' + actions +
      (epic ? '<p class="gcui-small">Epic+ actions ask for confirm first.</p>' : '') + '</div>';
  }
  function renderResults() {
    var r = S.results;
    if (!r) return screen('results', banner() + topbar('RUN RESULTS', 'hub') + '<div class="gcui-card"><p>No run results loaded. Bind results with GCUI.setResults(...). <span class="gcui-mock">MOCK</span></p></div>');
    var items = (r.items || []).map(function (it) { return itemRow(it, 'results'); }).join('');
    var rb = bossState();
    var fallback = rb && rb.name ? (r.won ? rb.name + ' defeated.' : 'The ' + rb.name + ' stands. Your crew retreats.')
      : (r.won ? 'Boss defeated.' : 'The boss stands. Your crew retreats.');
    /* T15: always render Best combo (×0 on a zero-kill run — truthful, matches
       the canvas #go-sub line). Sanitized here so the render never shows
       undefined/NaN even if S.results was set without setResults. */
    var bestComboShown = (typeof r.bestCombo === 'number' && isFinite(r.bestCombo)) ? Math.max(0, Math.floor(r.bestCombo)) : 0;
    return screen('results', banner() + topbar('RUN RESULTS', 'hub') +
      '<div class="gcui-card"><h3>' + (r.won ? 'VICTORY' : 'DEFEAT') + '</h3>' +
      '<p>' + esc(r.headline || fallback) + '</p>' +
      '<div class="gcui-kv"><span>Gold earned</span><b>' + slot(fmtInt(r.gold)) + '</b></div>' +
      '<div class="gcui-kv"><span>XP</span><b>' + slot(fmtInt(r.xp)) + '</b></div>' +
      '<div class="gcui-kv"><span>Best combo</span><b>×' + esc(String(bestComboShown)) + '</b></div>' +
      '<div class="gcui-kv"><span>Session gold delta</span><b>' + slot(fmtInt(S.resultsGoldDelta || 0)) + '</b></div></div>' +
      items + '<button class="gcui-btn gold" data-gcui-action="claim-results">CLAIM ALL KEPT → HUB</button>');
  }
  function inventoryItems() {
    var m = meta();
    if (Array.isArray(m.inventory)) return m.inventory;
    var d = saveData();
    return (d && Array.isArray(d.inventory)) ? d.inventory : [];
  }
  function renderInventory() {
    var items = inventoryItems();
    var body = items.length ? items.map(function (it) { return itemRow(it, 'inventory'); }).join('')
      : '<div class="gcui-card"><p>No loot yet — run a dungeon to earn gear.</p><button class="gcui-btn gold sm" data-gcui-nav="dungeons">PLAY</button></div>';
    var m = meta(); var mats = m.materials || {};
    return screen('inventory', banner() + topbar('INVENTORY', 'hub') +
      '<div class="gcui-row"><span class="gcui-chip gold">Gold: ' + slot(fmtInt(goldTotal())) + '</span>' +
      '<span class="gcui-chip red">Tech Cores: ' + slot(fmtInt(mats.tech)) + '</span>' +
      '<span class="gcui-chip blue">Mana Shards: ' + slot(fmtInt(mats.mana)) + '</span></div>' +
      '<div class="gcui-tabs"><span class="on">ALL</span><span>WEAPONS</span><span>ARMOR</span><span>TRINKETS</span><span>MATERIALS</span></div>' +
      body + '<div class="gcui-grid2"><button class="gcui-btn ghost sm" data-gcui-nav="upgrade">UPGRADE</button><button class="gcui-btn ghost sm" data-gcui-nav="fusion">FUSION</button></div>');
  }
  function renderUpgrade() {
    var items = inventoryItems();
    var selId = S.upgradeItem || (items[0] && items[0].id);
    var it = null; items.forEach(function (x) { if (x.id === selId) it = x; });
    var opts = items.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === selId ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('');
    var costLine = '<p>Cost: — <span class="gcui-mock">MOCK</span></p>';
    var failLine = '';
    var confirmBtn = '<button class="gcui-btn gold" disabled>UPGRADE — NO ITEM BOUND</button>';
    if (it) {
      var up = it.upgrade || {};
      costLine = '<div class="gcui-kv"><span>Materials cost</span><b>' + (up.materials ? esc(up.materials) : slot(null)) + '</b></div>' +
        '<div class="gcui-kv"><span>Gold cost</span><b>Upgrades cost materials only — no gold path.</b></div>';
      if (Number(it.upgradeLevel || 0) >= 11 || Number(up.toLevel || 0) >= 11) {
        failLine = '<div class="gcui-warn">Confirm required. Failure rate: ' + slot(fmtPct(up.failureRate)) + ' — on failure, materials are consumed, the item is kept at its current level (never destroyed, never downgraded).</div>';
      }
      confirmBtn = '<button class="gcui-btn gold" data-gcui-action="upgrade-confirm">UPGRADE TO +' + esc(Number(it.upgradeLevel || 0) + 1) + '</button>';
      if (failLine) confirmBtn = '<button class="gcui-btn gold" data-gcui-action="upgrade-confirm-ask">UPGRADE TO +' + esc(Number(it.upgradeLevel || 0) + 1) + ' — CONFIRM COST + FAILURE RATE</button>';
    }
    return screen('upgrade', banner() + topbar('UPGRADE', 'inventory') +
      '<label class="gcui-label">ITEM</label><select class="gcui-select" data-gcui-upgrade-item>' + opts + '</select>' +
      (it ? '<div class="gcui-card"><h3>' + esc(it.name) + ' · +' + esc(it.upgradeLevel || 0) + '</h3>' + costLine + failLine + '</div>' : '<div class="gcui-card"><p>No item bound. <span class="gcui-mock">MOCK</span></p></div>') +
      confirmBtn +
      '<div id="gcui-upgrade-confirm" style="display:none"><p>Confirm this upgrade with the cost and failure rate shown above.</p>' +
      '<button class="gcui-btn gold sm inline" data-gcui-action="upgrade-confirm-yes">CONFIRM UPGRADE</button>' +
      '<button class="gcui-btn ghost sm inline" data-gcui-action="upgrade-confirm-no">CANCEL</button></div>' +
      '<div class="gcui-lock">' + esc(B2_LOCK) + ' — Upgrades never accept purchasable gold.</div>');
  }
  function renderFusion() {
    var items = inventoryItems();
    var selects = '';
    for (var i = 0; i < FUSION_INPUTS; i++) {
      var cur = (S.fusionInputs || [])[i] || '';
      selects += '<label class="gcui-label">INPUT ' + (i + 1) + '</label><select class="gcui-select" data-gcui-fusion-slot="' + i + '"><option value="">— Choose an item —</option>' +
        items.map(function (x) { return '<option value="' + esc(x.id) + '"' + (cur === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>';
    }
    var m = meta(); var fc = m.fusion || {};
    try {
      var _sel = (S.fusionInputs || []).map(function (id) { var f = null; inventoryItems().forEach(function (x) { if (String(x.id) === String(id)) f = x; }); return f; }).filter(Boolean);
      if (_sel.length === 3 && typeof GrindchainEconomy !== 'undefined' && _sel[0].tier) {
        var _tierNum = parseInt(String(_sel[0].tier).replace(/\D/g, ''), 10) || 1;
        fc = { farmedGoldCost: (GrindchainEconomy.FUSION_COST || {})[_tierNum] || fc.farmedGoldCost };
      }
    } catch (e) {}
    return screen('fusion', banner() + topbar('FUSION', 'inventory') +
      '<p>Combine 3 items of the same tier + same rarity into 1 item of the same tier, next rarity up. The 3 input items are consumed.</p>' +
      selects +
      '<div class="gcui-kv"><span>Farmed-gold cost</span><b>' + slot(fmtInt(fc.farmedGoldCost)) + ' (farmed gold only)</b></div>' +
      '<button class="gcui-btn gold" data-gcui-action="fusion-confirm">FUSE — CONFIRM</button>' +
      '<div class="gcui-lock">' + esc(B2_LOCK) + '</div>');
  }
  function renderVendor() {
    var m = meta(); var v = m.vendor || {};
    return screen('vendor', banner() + topbar('MATERIAL VENDOR', 'hub') +
      '<p>Farmed gold only. Bought gold cannot buy or sell materials here.</p>' +
      '<div class="gcui-card"><h3>BUY CORE</h3><div class="gcui-kv"><span>Price per core</span><b>' + slot(fmtInt(v.buy)) + ' farmed gold</b></div>' +
      '<button class="gcui-btn gold sm" data-gcui-action="vendor-buy">BUY 1 CORE</button></div>' +
      '<div class="gcui-card"><h3>SELL CORE</h3><div class="gcui-kv"><span>Price per core</span><b>' + slot(fmtInt(v.sell)) + ' farmed gold</b></div>' +
      '<button class="gcui-btn ghost sm" data-gcui-action="vendor-sell">SELL 1 CORE</button></div>' +
      '<p class="gcui-small gcui-muted">Vendor trades are stubbed until the Economy ledger binds — no gold moves.</p>');
  }
  function renderQuests() {
    var m = meta(); var quests = Array.isArray(m.quests) ? m.quests : [];
    var body = quests.length ? quests.map(function (q) {
      return '<div class="gcui-card"><h3>' + esc(q.title || 'Quest') + ' (' + esc(q.progress || '—') + ')</h3>' +
        '<div class="gcui-kv"><span>Reward</span><b>' + (q.reward ? esc(q.reward) : slot(null)) + '</b></div>' +
        (q.claimed ? '<p>Claimed ✓</p>' : '<button class="gcui-btn gold sm" data-gcui-quest-claim="' + esc(q.id) + '">CLAIM</button>') + '</div>';
    }).join('') : '<div class="gcui-card"><p>Quest data not connected. <span class="gcui-mock">MOCK</span></p></div>';
    return screen('quests', banner() + topbar('DAILY QUESTS', 'hub') + body +
      '<p class="gcui-small gcui-muted">Streak resets if a day is missed. All quests done — come back tomorrow.</p>');
  }
  function renderPass() {
    var m = meta(); var p = m.pass || {}; var tiers = Array.isArray(p.tiers) ? p.tiers : [];
    var rows = tiers.map(function (t) {
      var claimed = !!S.passClaims[t.tier];
      var freeBtn = claimed ? '<span>Claimed ✓</span>' : '<button class="gcui-btn gold sm inline" data-gcui-pass-claim="' + esc(t.tier) + '">CLAIM</button>';
      return '<div class="gcui-kv"><span>Tier ' + esc(t.tier) + ' · Free: ' + esc(t.freeReward || '—') + ' · Premium: ' + esc(t.premiumReward || '—') + '</span><span>' + freeBtn +
        ' <button class="gcui-btn ghost sm inline" disabled>Premium — buy to claim</button></span></div>';
    }).join('');
    if (!rows) rows = '<p>Pass data not connected. <span class="gcui-mock">MOCK</span></p>';
    return screen('pass', banner() + topbar('BATTLE PASS', 'seasons') +
      '<div class="gcui-card"><h3>PREMIUM TRACK</h3><p>Premium pass — $10 / season. Label only; no checkout is built here.</p>' +
      '<p>Premium is cosmetics + convenience. No power.</p></div>' +
      '<div class="gcui-card"><h3>TRACKS</h3>' + rows + '</div>' +
      '<p class="gcui-small gcui-muted">' + esc(SEASON_RESET) + ' Unclaimed rewards expire — stated before the final week, never silent.</p>');
  }
  function renderTournaments() {
    var m = meta(); var t = m.tournament || {};
    var entry = num(t.entryGold);
    var receipt = 'Entry: ' + (entry !== null ? fmtInt(entry) + ' gold' : '[amount] gold') + '. Operations cut: [disclosed at confirm]. Prizes: cosmetic + gold.';
    return screen('tournaments', banner() + topbar('WEEKLY TOURNAMENT', 'hub') +
      '<div class="gcui-card"><h3>SUNDAY SHOWDOWN · SUN 8:00 PM ET</h3>' +
      '<p>' + esc(TOURNAMENT_SKILL) + '</p>' +
      '<div class="gcui-kv"><span>Entry</span><b>' + (entry !== null ? fmtInt(entry) + ' gold (farmed only)' : slot(null)) + '</b></div>' +
      '<div class="gcui-kv"><span>Prize pool</span><b>' + (t.prizePool ? esc(t.prizePool) : slot(null)) + '</b></div>' +
      '<div class="gcui-kv"><span>House / operations cut</span><b>disclosed before you confirm entry</b></div>' +
      '<div class="gcui-kv"><span>Starts in</span><b>' + (t.startsIn ? esc(t.startsIn) : slot(null)) + '</b></div>' +
      '<button class="gcui-btn gold" data-gcui-action="tournament-enter">ENTER TOURNAMENT</button>' +
      '<p class="gcui-small gcui-muted">No chance-based outcomes. No real-money prize claims. 18+ only.</p></div>' +
      '<div class="gcui-card"><h3>ENTRY RECEIPT — SHOWN BEFORE ANY DEDUCTION</h3><p>' + esc(receipt) + '</p>' +
      '<p class="gcui-small">Entry is confirmed before deduction — never silent. Full tournament rules are one tap away.</p>' +
      '<button class="gcui-btn ghost sm" data-gcui-action="tournament-rules">READ FULL TOURNAMENT RULES</button>' +
      '<div id="gcui-tournament-rules" style="display:none"><p>' + esc(TOURNAMENT_SKILL) + ' Entry is confirmed before deduction. Operations cut is disclosed before entry. Prizes are virtual cosmetics + gold. Eligibility 18+. The full rules document is linked one tap from the entry screen.</p></div></div>' +
      '<div class="gcui-card"><h3>PAST TOURNAMENTS</h3><p>' + (t.history ? esc(t.history) : 'No tournaments yet — first one Sunday 8pm ET. <span class="gcui-mock">MOCK</span>') + '</p></div>');
  }
  function renderGuild() {
    var m = meta(); var g = m.guild || null;
    var body = g ? '<div class="gcui-card"><h3>' + esc(g.name || 'Guild') + ' · Lv ' + slot(fmtInt(g.level)) + '</h3>' +
      '<p>Members: ' + slot(fmtInt(g.members)) + '</p><p>Faction coverage: ' + esc(g.coverage || '—') + '</p>' +
      '<div class="gcui-grid2"><button class="gcui-btn blue sm" data-gcui-action="guild-dungeon">GUILD DUNGEON</button>' +
      '<button class="gcui-btn ghost sm" data-gcui-action="guild-chat">GUILD CHAT</button></div>' +
      '<p class="gcui-small">Guild chat requires server (B2-2). Not available in the client-only build.</p></div>'
      : '<div class="gcui-card"><h3>NO GUILD YET</h3><p>Browse guilds or found one.</p>' +
      '<button class="gcui-btn gold sm" data-gcui-action="guild-create">FOUND A GUILD</button>' +
      '<p>' + esc(GUILD_COST) + '</p>' +
      '<div id="gcui-guild-confirm" style="display:none"><p>Founding cost is shown before you confirm. Founding grants no power.</p>' +
      '<button class="gcui-btn gold sm inline" data-gcui-action="guild-create-yes">CONFIRM</button>' +
      '<button class="gcui-btn ghost sm inline" data-gcui-action="guild-create-no">CANCEL</button></div></div>';
    return screen('guild', banner() + topbar('GUILD', 'hub') +
      '<div class="gcui-card"><p>' + esc(GUILD_FRAMING) + '</p><p>' + esc(GUILD_COST) + '</p></div>' + body +
      '<p class="gcui-small gcui-muted">Server-dependent features are labeled as such pending B2-2 confirm. UI ships; server planning only.</p>');
  }
  function renderSeasons() {
    var m = meta(); var s = m.season || {}; var board = Array.isArray(s.leaderboard) ? s.leaderboard : [];
    var rows = board.map(function (r) {
      return '<div class="gcui-kv"><span>#' + esc(r.rank) + ' ' + esc(r.name) + '</span><b>' + slot(fmtInt(r.power)) + '</b></div>';
    }).join('');
    return screen('seasons', banner() + topbar('SEASON + LEADERBOARDS', 'hub') +
      '<div class="gcui-card"><h3>SEASON ' + slot(fmtInt(s.number)) + '</h3><p>Ends in: ' + (val(s.timeLeft) !== null ? esc(s.timeLeft) : slot(null)) + '</p>' +
      '<p>' + esc(SEASON_RESET) + '</p><button class="gcui-btn gold sm" data-gcui-nav="pass">VIEW BATTLE PASS</button></div>' +
      '<div class="gcui-card"><h3>LEADERBOARD</h3>' + (rows || '<p>No rankings yet — run a dungeon to set the first score. <span class="gcui-mock">MOCK</span></p>') + '</div>');
  }
  function renderIdle() {
    var idle = S.idle;
    if (!idle) return screen('idle', '');
    return screen('idle', '<div class="gcui-card"><h2 class="gcui-title">WELCOME BACK</h2><p>' + esc(RETURNING) + '</p>' +
      '<div class="gcui-kv"><span>Gold</span><b>+' + slot(fmtInt(idle.gold)) + '</b></div>' +
      '<div class="gcui-kv"><span>Materials</span><b>' + esc(idle.materials || '—') + '</b></div>' +
      '<p class="gcui-small">Away: ' + esc(idle.awayLabel || '—') + (idle.capped ? ' (capped)' : '') + '</p>' +
      '<button class="gcui-btn gold" data-gcui-action="idle-collect">COLLECT</button>' +
      '<button class="gcui-btn ghost" data-gcui-action="idle-collect">X — COLLECT</button>' +
      '<p class="gcui-small gcui-muted">COLLECT and X both collect — never lose earnings to a misclick.</p></div>');
  }
  function renderShop() {
    var m = meta(); var shop = m.shop || {};
    var cosmetics = Array.isArray(shop.cosmetics) ? shop.cosmetics.map(function (c) {
      return '<div class="gcui-loot"><div style="flex:1"><b>' + esc(c.name) + '</b><small>Visual only · No stat change</small></div>' +
        '<button class="gcui-btn gold sm inline" data-gcui-action="shop-mock">BUY</button></div>';
    }).join('') : '<p>Cosmetic data not connected. <span class="gcui-mock">MOCK</span></p>';
    var packs = ['Small Pack', 'Medium Pack', 'Large Pack'].map(function (p) {
      return '<button class="gcui-btn ghost sm" data-gcui-action="shop-mock">' + esc(p) + '<br><span class="gcui-small">Price shown at store listing</span></button>';
    }).join('');
    return screen('shop', banner() + topbar('SHOP', 'hub') +
      '<div class="gcui-tabs"><span data-gcui-shoptab="cosmetics" class="' + (S.shopTab === 'cosmetics' ? 'on' : '') + '">COSMETICS</span><span data-gcui-shoptab="convenience" class="' + (S.shopTab === 'convenience' ? 'on' : '') + '">CONVENIENCE</span><span data-gcui-shoptab="gold" class="' + (S.shopTab === 'gold' ? 'on' : '') + '">GOLD</span></div>' +
      '<div class="gcui-card"><h3>COSMETICS · ZERO POWER</h3>' + cosmetics + '</div>' +
      '<div class="gcui-card"><h3>CONVENIENCE · NO POWER GAIN</h3>' + refillRow('Shop') +
      '<p class="gcui-small">Totem charges and checkpoint-shop items are run-gold-only. Bought gold cannot buy in-run items.</p></div>' + /* Phase 4 rec-fix (BUG-P4-06): "Loadout re-rolls" removed from shop copy — no reroll is sold. */
      '<div class="gcui-card"><h3>POWER / UPGRADES</h3>' + lockBox(B2_LOCK) +
      '<button class="gcui-btn ghost sm" disabled>UNAVAILABLE · PENDING RULING (B2-3)</button></div>' +
      '<div class="gcui-card"><h3>BUY GOLD · FARM OR PAY</h3><p class="gcui-small">Gold is earned by playing or bought via Play Billing. Bought gold buys cosmetics only — never power (B2-3). Tournament entry is farmed only: entry spends farmed gold, never bought gold. Pricing set at store listing — no placeholder prices shown as real.</p>' +
      '<div class="gcui-grid3">' + packs + '</div>' +
      '<p class="gcui-small gcui-muted">Purchase flow: pending Play account + server verification (B2-1/B2-2). No checkout is built in this build — no purchase executes here. Confirm before spending gold defaults ON.</p></div>' +
      '<p class="gcui-small gcui-muted" style="text-align:center">18+ only. No paid random items. No ads.</p>');
  }
  function renderTrade() {
    var t = S.trade;
    if (!t) return screen('trade', banner() + topbar('TRADE CONFIRM', 'inventory') + '<div class="gcui-card"><p>No trade loaded. Bind a trade with GCUI.setTrade(...). <span class="gcui-mock">MOCK</span></p></div>');
    var feeLine = (t.ownerFee === null || t.ownerFee === undefined) ? 'owner fee disclosed at confirm' : 'owner fee ' + esc(t.ownerFee);
    var totalLine = (t.total === null || t.total === undefined) ? 'total shown at confirm' : esc(t.total);
    return screen('trade', banner() + topbar('TRADE CONFIRM', 'inventory') +
      '<div class="gcui-card"><h3>PEER-TO-PEER TRADE</h3><p>Every trade shows: seller, item, upgrade level, price, owner fee, and total — before confirm. No trade executes without wallet confirmation.</p>' +
      '<div class="gcui-kv"><span>Seller</span><b>' + esc(t.seller || '—') + '</b></div>' +
      '<div class="gcui-kv"><span>Item</span><b>' + esc(t.item || '—') + '</b></div>' +
      '<div class="gcui-kv"><span>Upgrade level</span><b>' + slot(fmtInt(t.upgradeLevel)) + '</b></div>' +
      '<div class="gcui-kv"><span>Price</span><b>' + (t.price ? esc(t.price) : slot(null)) + '</b></div>' +
      '<div class="gcui-kv"><span>Owner fee</span><b>' + esc(feeLine) + '</b></div>' +
      '<div class="gcui-kv"><span>Total</span><b>' + esc(totalLine) + '</b></div>' +
      '<div class="gcui-warn">No trade executes without wallet confirmation. Confirm only if every line above matches what you expect. If anything looks wrong, cancel.</div>' +
      '<button class="gcui-btn gold" data-gcui-action="trade-confirm">CONFIRM TRADE</button>' +
      '<button class="gcui-btn ghost" data-gcui-nav="inventory">CANCEL</button></div>' +
      '<p class="gcui-small gcui-muted">Marketplace screens are BLOCKED (B2-4 + compliance). This confirm screen is a standalone preview; no settlement is wired.</p>');
  }
  function renderMint() {
    return screen('mint', banner() + topbar('MINT CONFIRM — MOCK', 'hub') +
      '<div class="gcui-card"><h3>MINT <span class="gcui-mock">MOCK</span></h3>' +
      '<p>This mint confirm is fully mocked. No transaction is submitted, no wallet is called, no contract exists here.</p>' +
      '<p>You are about to sign a real on-chain transaction. Confirm only if every line above matches what you expect. If anything looks wrong, cancel.</p>' +
      '<button class="gcui-btn ghost" disabled>CONFIRM IN WALLET (MOCK — DISABLED)</button>' +
      '<button class="gcui-btn ghost" data-gcui-nav="hub">CANCEL</button></div>');
  }

  /* ---------- render / navigation ---------- */
  var RENDERERS = {
    age: renderAge, blocked: renderBlocked, title: renderTitle, faction: renderFaction,
    hero: renderHero, hub: renderHub, dungeons: renderDungeons, party: renderParty,
    combat: renderCombat, pause: renderPause, settings: renderSettings, tutorial: renderTutorial,
    results: renderResults, inventory: renderInventory, upgrade: renderUpgrade, fusion: renderFusion,
    vendor: renderVendor, quests: renderQuests, pass: renderPass, tournaments: renderTournaments,
    guild: renderGuild, seasons: renderSeasons, idle: renderIdle, shop: renderShop,
    trade: renderTrade, mint: renderMint
  };
  function applySettingsClasses() {
    var r = root(); if (!r) return;
    // Phase 3 integration: colorblind + text size come from Settings
    // (canonical values: none/protan/deutan/tritan, small/medium/large).
    var cur = null;
    try { if (typeof Settings !== 'undefined') cur = Settings.get(); } catch (e) {}
    var d = saveData(); var st = (d && d.settings) || {};
    var cbRaw = (cur && cur.colorblind) || S.settings.colorblind || st.colorblind || 'none';
    var cb = (cbRaw === 'off') ? 'none' : cbRaw;
    var tsRaw = (cur && cur.textSize) || S.settings.textSize || st.textSize || 'medium';
    var ts = (tsRaw === 's') ? 'small' : (tsRaw === 'l') ? 'large' : (tsRaw === 'm') ? 'medium' : tsRaw;
    r.classList.remove('gcui-cb-deutan', 'gcui-cb-protan', 'gcui-cb-tritan', 'gcui-text-s', 'gcui-text-m', 'gcui-text-l');
    if (cb !== 'none') r.classList.add('gcui-cb-' + cb);
    r.classList.add('gcui-text-' + ({ small: 's', medium: 'm', large: 'l' }[ts] || 'm'));
  }
  function renderAll() {
    var r = root(); if (!r) return;
    var html = '';
    Object.keys(RENDERERS).forEach(function (k) { html += RENDERERS[k](); });
    html += '<div id="gcui-toast" style="position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#14141f;border:1px solid #2a2a3d;border-radius:8px;padding:10px 14px;display:none;z-index:10000;font-size:14px"></div>';
    r.innerHTML = html;
    applySettingsClasses();
    show(S.screen, true);
  }
  /* Phase 4 rec-fix P4-BUG-03 (Tab leak): while the opaque GCUI overlay is
     open, the Wave 1 controls underneath it (#start-screen hero buttons /
     CONTINUE / CLEAR SAVE, plus the in-run #hud buttons) must not be Tab-
     reachable or screen-reader reachable. `inert` removes the subtree from
     sequential focus navigation and AT browsing; aria-hidden is set alongside
     for AT that predates inert. Restored by hide(). GCUI's own controls are
     inside #gcui-root and stay focusable. */
  function setWave1Inert(on) {
    ['start-screen', 'hud'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (on) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
      else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
    });
  }
  function show(name, skipRender) {
    if (name === 'idle' && !S.idle) name = 'hub';
    if (name !== 'age' && name !== 'blocked' && !agePassed() && (name === 'dungeons' || name === 'party' || name === 'combat')) name = 'age';
    S.screen = name;
    var r = root(); if (!r) return;
    if (!skipRender) renderAll();
    var secs = r.querySelectorAll('[data-gcui-screen]');
    secs.forEach(function (s) { s.classList.toggle('gcui-active', s.getAttribute('data-gcui-screen') === name); });
    r.classList.add('gcui-open');
    setWave1Inert(true); /* Phase 4 rec-fix P4-BUG-03 */
    try { window.scrollTo(0, 0); } catch (e) {}
    if (name === 'combat') S.lastPhase = 0;
  }
  function toast(msg) {
    var t = el('gcui-toast'); if (!t) return;
    t.textContent = msg; t.style.display = 'block';
    setTimeout(function () { t.style.display = 'none'; }, 2600);
  }
  function mockNote(msg) { toast('MOCK — ' + msg + ' No transaction, purchase, or ledger change executed.'); }
  function persistSettings() {
    var d = saveData();
    if (d && d.settings) {
      Object.keys(S.settings).forEach(function (k) { d.settings[k] = S.settings[k]; });
      try { if (typeof Save !== 'undefined') Save.save(); } catch (e) {}
    }
    applySettingsClasses();
  }
  function handleAction(action, target) {
    // Phase 3 integration: actions that execute real systems (spending,
    // upgrades, entry, settings) delegate to GCIntegration first.
    try { if (typeof GCIntegration !== 'undefined' && GCIntegration.handleAction(action, target)) return; } catch (e) {}
    if (action === 'age-verify') {
      var m = el('gcui-dob-m'), dd = el('gcui-dob-d'), yy = el('gcui-dob-y'), cb = el('gcui-age-confirm'), err = el('gcui-age-error');
      var mv = m ? m.value : '', dv = dd ? dd.value : '', yv = yy ? yy.value : '';
      function showErr(msg) { if (err) { err.textContent = msg; err.style.display = 'block'; } }
      if (!mv || !dv || !yv) { showErr('Enter a complete birthdate.'); return; }
      if (!cb || !cb.checked) { showErr('Confirm you are 18 or older to continue.'); return; }
      var birth = new Date(Number(yv), Number(mv) - 1, Number(dv));
      var now = new Date(); var age = now.getFullYear() - birth.getFullYear();
      var md = (now.getMonth() - birth.getMonth()) || (now.getDate() - birth.getDate());
      if (md < 0) age--;
      if (age >= 18) {
        try { localStorage.setItem(AGE_KEY, JSON.stringify({ verified: true, at: Date.now() })); } catch (e) {}
        try { if (typeof GCIntegration !== 'undefined') GCIntegration.onAgeVerified(); } catch (e) {}
        show('title');
      } else { show('blocked'); }
      return;
    }
    if (action === 'exit') { try { window.close(); } catch (e) {} toast('Exit the game from your device.'); return; }
    if (action === 'new-game') { show('tutorial'); S.tutorialBeat = 0; renderAll(); return; }
    if (action === 'continue') {
      var idle = S.idle;
      if (idle && (Number(idle.gold) > 0 || idle.materials)) { show('idle'); return; }
      show('hub'); return;
    }
    if (action === 'gold-breakdown') { toast('Gold breakdown: farmed and bought ledgers bind via GCUI.bind({ meta: { goldLedger: { farmed, bought } } }).'); return; }
    if (action === 'energy-tap') { show('shop'); S.shopTab = 'convenience'; renderAll(); return; }
    if (action === 'confirm-crew') { show('hub'); return; }
    if (action === 'enter-dungeon') {
      if (!canStartRun()) { show('age'); return; }
      show('combat'); return;
    }
    if (action === 'pause') {
      try { var g = gameApi(); if (g && g.pause) g.pause('manual'); } catch (e) {}
      show('pause'); return;
    }
    if (action === 'resume') {
      try { var g2 = gameApi(); if (g2 && g2.resume) g2.resume(); } catch (e) {}
      show('combat'); return;
    }
    if (action === 'restart') {
      try { var g3 = gameApi(); if (g3 && g3.softReset) g3.softReset(); } catch (e) {}
      show('combat'); return;
    }
    if (action === 'abandon') { show('hub'); return; }
    if (action === 'save-settings') { persistSettings(); toast('Settings saved.'); return; }
    if (action === 'legal') { toast('Terms of Service · Privacy Policy · Crypto Risk Disclosure — linked here at build.'); return; }
    if (action === 'replay-tutorial') { S.tutorialBeat = 0; show('tutorial'); return; }
    if (action === 'tutorial-next') {
      if (S.tutorialBeat >= TUTORIAL_BEATS.length - 1) { show('faction'); return; }
      S.tutorialBeat++; renderAll(); return;
    }
    if (action === 'tutorial-skip') { var sc = el('gcui-skip-confirm'); if (sc) sc.style.display = 'block'; return; }
    if (action === 'tutorial-skip-yes') { show('faction'); return; }
    if (action === 'tutorial-skip-no') { var sc2 = el('gcui-skip-confirm'); if (sc2) sc2.style.display = 'none'; return; }
    if (action === 'claim-results') { show('hub'); return; }
    if (action === 'upgrade-confirm-ask') { var uc = el('gcui-upgrade-confirm'); if (uc) uc.style.display = 'block'; return; }
    if (action === 'upgrade-confirm' || action === 'upgrade-confirm-yes') { mockNote('Upgrade not executed — upgrade system not connected.'); return; }
    if (action === 'upgrade-confirm-no') { var uc2 = el('gcui-upgrade-confirm'); if (uc2) uc2.style.display = 'none'; return; }
    if (action === 'fusion-confirm') { mockNote('Fusion not executed — fusion system not connected.'); return; }
    if (action === 'vendor-buy' || action === 'vendor-sell') { mockNote('Vendor trade not executed — Economy ledger not connected.'); return; }
    if (action === 'tournament-enter') { mockNote('Tournament entry not deducted — tournament system not connected. Receipt shown before any deduction.'); return; }
    if (action === 'tournament-rules') { var tr = el('gcui-tournament-rules'); if (tr) tr.style.display = (tr.style.display === 'none' ? 'block' : 'none'); return; }
    if (action === 'guild-dungeon') { show('dungeons'); return; }
    if (action === 'guild-chat') { mockNote('Guild chat requires server (B2-2) — not available in the client-only build.'); return; }
    if (action === 'guild-create') { var gc = el('gcui-guild-confirm'); if (gc) gc.style.display = 'block'; return; }
    if (action === 'guild-create-yes') { mockNote('Guild not founded — guild system not connected. Cost shown before confirm.'); return; }
    if (action === 'guild-create-no') { var gc2 = el('gcui-guild-confirm'); if (gc2) gc2.style.display = 'none'; return; }
    if (action === 'idle-collect') { S.idle = null; show('hub'); return; }
    if (action === 'shop-mock') { mockNote('Checkout not connected — no charge, no grant.'); return; }
    if (action === 'trade-confirm') { mockNote('Trade not executed — settlement not wired. Confirm screen only.'); return; }
    if (action === 'totem') { mockNote('Totem deploy is a gameplay-system call — bind via GCUI.setCombat({ totemCharges }).'); return; }
  }
  function bindEvents() {
    var r = root(); if (!r || r.dataset.gcuiBound) return;
    r.dataset.gcuiBound = '1';
    r.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-gcui-nav],[data-gcui-action],[data-gcui-faction-pick],[data-gcui-faction],[data-gcui-hero],[data-gcui-tier],[data-gcui-dungeon],[data-gcui-shoptab],[data-gcui-herofilter]');
      if (!t) return;
      if (t.hasAttribute('data-gcui-nav')) { show(t.getAttribute('data-gcui-nav')); return; }
      if (t.hasAttribute('data-gcui-action')) { handleAction(t.getAttribute('data-gcui-action'), t); return; }
      if (t.hasAttribute('data-gcui-faction-pick')) { S.faction = t.getAttribute('data-gcui-faction-pick'); S.crew = [S.crew[0] || 'bastion']; show('hero'); return; }
      if (t.hasAttribute('data-gcui-faction')) { S.faction = t.getAttribute('data-gcui-faction'); renderAll(); return; }
      if (t.hasAttribute('data-gcui-hero')) { S.hero = t.getAttribute('data-gcui-hero'); if (S.crew.indexOf(S.hero) < 0) S.crew = [S.hero]; renderAll(); return; }
      if (t.hasAttribute('data-gcui-tier')) { S.dungeonTier = t.getAttribute('data-gcui-tier'); S.dungeon = null; renderAll(); return; }
      if (t.hasAttribute('data-gcui-dungeon')) {
        var m = meta(); var list = Array.isArray(m.dungeons) ? m.dungeons : [];
        list.forEach(function (d) { if (String(d.id) === t.getAttribute('data-gcui-dungeon')) { S.dungeon = d; S.dungeonTier = d.tier || S.dungeonTier; } });
        renderAll(); return;
      }
      if (t.hasAttribute('data-gcui-shoptab')) { S.shopTab = t.getAttribute('data-gcui-shoptab'); renderAll(); return; }
      if (t.hasAttribute('data-gcui-herofilter')) { renderAll(); return; }
    });
    r.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.hasAttribute && t.hasAttribute('data-gcui-party-slot')) { S.party[Number(t.getAttribute('data-gcui-party-slot'))] = t.value || null; renderAll(); return; }
      if (t.hasAttribute && t.hasAttribute('data-gcui-upgrade-item')) { S.upgradeItem = t.value; renderAll(); return; }
      if (t.hasAttribute && t.hasAttribute('data-gcui-fusion-slot')) { S.fusionInputs = S.fusionInputs || []; S.fusionInputs[Number(t.getAttribute('data-gcui-fusion-slot'))] = t.value || null; return; }
      if (t.hasAttribute && t.hasAttribute('data-gcui-setting')) {
        S.settings[t.getAttribute('data-gcui-setting')] = (t.type === 'range') ? Number(t.value) : t.value; return;
      }
      if (t.id === 'gcui-party-ai') { S.partyAI = !!t.checked; renderAll(); return; }
    });
    r.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-gcui-result],[data-gcui-inv],[data-gcui-quest-claim],[data-gcui-pass-claim]');
      if (!t) return;
      // Phase 3 integration: real ledger execution for sell/salvage/equip,
      // quest claims, and pass claims.
      try {
        if (typeof GCIntegration !== 'undefined' && GCIntegration.handleItemClick(t)) return;
      } catch (e) {}
      if (t.hasAttribute('data-gcui-result')) {
        var it = (S.results && S.results.items || []).filter(function (x) { return String(x.id) === t.getAttribute('data-gcui-item'); })[0];
        var kind = t.getAttribute('data-gcui-result');
        if (kind === 'sell' && it) S.resultsGoldDelta = (S.resultsGoldDelta || 0) + (Number(it.sell) || 0);
        mockNote('Run-result ' + kind + ' recorded locally — ledger binds when the Economy system lands.');
        return;
      }
      if (t.hasAttribute('data-gcui-inv')) { mockNote('Inventory action recorded locally — ledger binds when the Economy system lands.'); return; }
      if (t.hasAttribute('data-gcui-quest-claim')) {
        var qid = t.getAttribute('data-gcui-quest-claim');
        (meta().quests || []).forEach(function (q) { if (String(q.id) === qid) q.claimed = true; });
        renderAll(); return;
      }
      if (t.hasAttribute('data-gcui-pass-claim')) {
        S.passClaims[t.getAttribute('data-gcui-pass-claim')] = true;
        try { var store = uiStore(); store.passClaims = S.passClaims; uiStoreSave(store); } catch (e) {}
        renderAll(); return;
      }
    });
  }

  /* ---------- live tick: re-read Game + Save, update HUD in place ---------- */
  function tick() {
    var r = root(); if (!r || !r.classList.contains('gcui-open')) return;
    if (S.screen !== 'combat' && S.screen !== 'pause') {
      if (S.screen === 'hub') {
        var g = el('gcui-hp-num'); /* hub refreshes on render; tick keeps boss phase only */
      }
      return;
    }
    var b = bossState();
    if (b) {
      var hpBar = el('gcui-boss-hp'); if (hpBar) hpBar.style.width = pctOf(b.hp, b.maxhp) + '%';
      var hpNum = el('gcui-boss-hp-num'); if (hpNum) hpNum.innerHTML = slot(fmtInt(b.hp)) + ' / ' + slot(fmtInt(b.maxhp));
      var shBar = el('gcui-boss-shield'); if (shBar) shBar.style.width = pctOf(b.shield, b.shieldMax) + '%';
      var shWrap = el('gcui-boss-shieldbar'); if (shWrap) shWrap.style.display = ((S.dungeonTier === 'T3' || S.dungeonTier === 'T4') && Number(b.shield) > 0) ? 'block' : 'none';
      var shNum = el('gcui-boss-shield-num'); if (shNum) shNum.innerHTML = esc(SHIELD_LABELS[b.shieldType] || PHASE_CALLOUTS[b.phase] || '') + ' · ' + slot(fmtInt(b.shield)) + ' / ' + slot(fmtInt(b.shieldMax));
      var pips = el('gcui-phase-pips'); if (pips) pips.textContent = String(b.phase || 1) + ' / ' + BOSS_PHASES;
      if (b.phase && b.phase !== S.lastPhase) {
        S.lastPhase = b.phase;
        var bannerEl = el('gcui-phase-banner');
        if (bannerEl) bannerEl.textContent = PHASE_CALLOUTS[b.phase] || '';
      }
    }
    var c = S.combat || {};
    if (c.hp !== undefined) {
      var hpB = el('gcui-hp'); if (hpB) hpB.style.width = pctOf(c.hp, c.maxHp) + '%';
      var hpN = el('gcui-hp-num'); if (hpN) hpN.innerHTML = slot(fmtInt(c.hp)) + ' / ' + slot(fmtInt(c.maxHp));
    }
    if (c.en !== undefined) {
      var enB = el('gcui-en'); if (enB) enB.style.width = pctOf(c.en, c.maxEn) + '%';
      var enN = el('gcui-en-num'); if (enN) enN.innerHTML = slot(fmtInt(c.en)) + ' / ' + slot(fmtInt(c.maxEn));
    }
    if (c.totemCharges !== undefined) { var tc = el('gcui-totem-count'); if (tc) tc.textContent = String(c.totemCharges); }
    var cds = c.cooldowns || {};
    Object.keys(cds).forEach(function (k) {
      var node = r.querySelector('[data-gcui-cd="' + k + '"]');
      if (node) node.textContent = (Number(cds[k]) <= 0 ? 'READY' : String(Number(cds[k])));
    });
  }
  var tickTimer = null;
  function startTick() { if (!tickTimer) tickTimer = setInterval(tick, 250); }

  /* ---------- public API ---------- */
  window.GCUI = {
    version: 'phase3-ui-1.0.0',
    bind: function (state) {
      if (!state || typeof state !== 'object') return S;
      if (state.meta) S.meta = Object.assign({}, S.meta, state.meta);
      if (state.combat) S.combat = Object.assign({}, S.combat || {}, state.combat);
      if (state.settings) S.settings = Object.assign({}, S.settings, state.settings);
      ['faction', 'hero', 'crew', 'party', 'partyAI', 'dungeon', 'dungeonTier', 'results', 'trade', 'idle', 'shopTab', 'tutorialBeat', 'upgradeItem', 'fusionInputs'].forEach(function (k) {
        if (state[k] !== undefined) S[k] = state[k];
      });
      if (S.screen === 'combat' || S.screen === 'hub') renderAll();
      return S;
    },
    setCombat: function (snap) { S.combat = Object.assign({}, S.combat || {}, snap || {}); tick(); return S.combat; },
    setMeta: function (m) { S.meta = Object.assign({}, S.meta, m || {}); return S.meta; },
    setDungeons: function (list) { S.meta = S.meta || {}; S.meta.dungeons = list || []; return S.meta.dungeons; },
    setResults: function (r) { S.results = r || null; if (S.results) S.results.bestCombo = (typeof S.results.bestCombo === 'number' && isFinite(S.results.bestCombo)) ? Math.max(0, Math.floor(S.results.bestCombo)) : 0; S.resultsGoldDelta = 0; return S.results; },
    setTrade: function (t) { S.trade = t || null; return S.trade; },
    setIdle: function (idle) { S.idle = idle || null; return S.idle; },
    setQuests: function (q) { S.meta = S.meta || {}; S.meta.quests = q || []; return S.meta.quests; },
    setPass: function (p) { S.meta = S.meta || {}; S.meta.pass = p || {}; return S.meta.pass; },
    show: show,
    hide: function () { var r = root(); if (r) r.classList.remove('gcui-open'); setWave1Inert(false); /* Phase 4 rec-fix P4-BUG-03: normal Tab order restores when GCUI closes. */ },
    toast: toast,
    tick: tick,
    gatePassed: agePassed,
    canStartRun: canStartRun,
    getBossState: bossState,
    state: function () { return S; },
    init: function (startScreen) {
      var existing = document.getElementById('gcui-root');
      if (!existing) {
        existing = document.createElement('div');
        existing.id = 'gcui-root';
        document.body.appendChild(existing);
      }
      try { var store = uiStore(); S.passClaims = store.passClaims || {}; } catch (e) {}
      S.started = true;
      if (startScreen) S.screen = startScreen;
      else S.screen = agePassed() ? 'title' : 'age';
      renderAll();
      bindEvents();
      startTick();
      return S;
    }
  };
})();
