/* GRINDCHAIN Phase 3 — Integration layer (Wave 2.5).
   Wires Wave 1 (app.js / save.js / styles) + Wave 2 modules
   (gameplay-systems, economy, ui, audio, analytics, settings) into ONE
   working build. Loaded AFTER ui.js, BEFORE onchain-stub.js (which is
   loaded but NEVER called from any production path).

   Owns: meta persistence (Save.data.meta), GCUI binding, real-execution
   action handlers (upgrade / fusion / vendor / tournament / guild / quests /
   pass / sell / salvage / equip / entry / idle / settings), run-end
   results, checkpoint modal (draft + checkpoint shop), tutorial sync,
   age-gate sync, combat snapshot feed, audio/analytics call-site fan-out
   that lives outside app.js.

   No marketplace UI/settlement, no purchasable power, no paid refill,
   no server/co-op, no Play Billing checkout, no accounts, no on-chain
   calls. Bought gold stays 0: there is no purchase inlet anywhere. */
'use strict';
(function () {
  var AGE_KEY = 'grindchain.agegate.v1';
  var G = (typeof window !== 'undefined' ? window : globalThis).GrindchainGameplay;
  var E = (typeof window !== 'undefined' ? window : globalThis).GrindchainEconomy;

  function isAutotest() {
    try { return !!new URLSearchParams(location.search).get('gc-autotest'); } catch (e) { return false; }
  }
  function meta() {
    if (typeof Save !== 'undefined' && Save.data) {
      if (!Save.data.meta) Save.data.meta = {};
      return Save.data.meta;
    }
    return {};
  }
  function persist() {
    try {
      var m = meta();
      if (typeof Save !== 'undefined' && Save.data) {
        Save.data.inventory = m.inventory || [];
        Save.data.gold.balance = (m.ledgers && m.ledgers.gold_farmed || 0) + (m.ledgers && m.ledgers.gold_bought || 0);
        Save.data.gold.lifetimeEarned = Math.max(Save.data.gold.lifetimeEarned || 0, Save.data.gold.balance);
        if (m.energy) Save.data.energy.session = m.energy.value;
        if (m.streak) Save.data.streak.current = m.streak.day;
        Save.save();
      }
    } catch (e) {}
  }
  function toast(msg) {
    try { if (typeof GCUI !== 'undefined') GCUI.toast(msg); } catch (e) {}
  }
  function ev(name, props) {
    try { if (typeof Analytics !== 'undefined') Analytics.event(name, props || {}); } catch (e) {}
  }
  function sfx(name) {
    try { if (typeof GameAudio !== 'undefined') GameAudio.sfx(name); } catch (e) {}
  }
  function utcDay(d) {
    d = d || new Date();
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function yesterdayUTC() {
    var d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
    return utcDay(d);
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* ---------- streak ---------- */
  /* Phase 4 rec-fix (BUG-P4-09) + round 2 (F2): UNIFY on UTC everywhere. The
     quest payout uses meta.streak (UTC days); the hub/start-screen display
     reads Save.data.streak.current. This helper makes the displayed value
     the UTC value. save.js's recordRun() is also UTC-based now (dayStr()
     uses getUTC* since round 2), so both streak states agree; onRunEnd's
     deferred persist() below remains as the last-write reconciler. */
  function syncStreakDisplay() {
    try {
      var m = meta();
      if (m.streak && typeof m.streak.day === 'number' && typeof Save !== 'undefined' && Save.data && Save.data.streak) {
        Save.data.streak.current = m.streak.day;
      }
    } catch (e) {}
  }
  function touchStreak() {
    var m = meta();
    var today = utcDay();
    if (!m.streak) m.streak = { day: 0, lastDateUTC: null };
    if (m.streak.lastDateUTC === today) { syncStreakDisplay(); return m.streak.day; }
    var r = E ? E.streakFor(m.streak.lastDateUTC, today, m.streak.lastDateUTC === yesterdayUTC()) : { day: 1, reset: true };
    if (r.hold) { /* same day */ }
    else if (r.increment) m.streak.day = (m.streak.day || 0) + 1;
    else m.streak.day = 1;
    m.streak.lastDateUTC = today;
    syncStreakDisplay();
    return m.streak.day;
  }

  /* ---------- quests ---------- */
  function refreshQuests() {
    var m = meta();
    var today = utcDay();
    if (!m.quests) m.quests = { day: null, items: [] };
    if (m.quests.day !== today) {
      var items = E ? E.dailyQuests(today) : [];
      m.quests = {
        day: today,
        items: items.map(function (q) {
          return { id: q.id, title: q.label, baseGold: q.baseGold, claimed: false, progress: '0/1', reward: q.baseGold + ' gold' };
        }),
      };
      persist();
    }
    return m.quests.items;
  }

  /* ---------- idle ---------- */
  function computeIdle() {
    var m = meta();
    var now = Date.now();
    var lastSeen = (m.idle && m.idle.lastSeen) || now;
    var hours = (now - lastSeen) / 3600000;
    if (hours < 0.5 || !(m.idle && m.idle.highestTierCleared >= 1)) { if (m.idle) m.idle.lastSeen = now; return null; }
    var res = E ? E.idleEarnings(m.idle.highestTierCleared, hours, m.streak ? m.streak.day : 1, 'red') : { gold: 0, cores: 0, capped: false };
    if (!res || res.gold <= 0) { m.idle.lastSeen = now; return null; }
    // Phase 4 rec-fix (BUG-P4-08): ACCUMULATE — uncollected pending earnings
    // stack instead of being replaced. Pre-fix the old pending was silently
    // lost when a second >30-min idle interval was computed before collect.
    // PAYOUT-BEHAVIOR CHANGE (honest): uncollected earnings now stack, so
    // collect grants the sum of all uncollected intervals, not just the
    // latest one. The returned display totals match what collect grants.
    var _prev = (m.idle && m.idle.pending) || { gold: 0, cores: 0 };
    m.idle.pending = { gold: (_prev.gold || 0) + res.gold, cores: (_prev.cores || 0) + res.cores };
    m.idle.lastSeen = now;
    persist();
    return { gold: m.idle.pending.gold, materials: m.idle.pending.cores + ' cores', awayLabel: Math.floor(hours) + 'h away', capped: !!res.capped };
  }

  /* ---------- item display mapping (Gameplay item -> GCUI row) ---------- */
  function displayName(it) {
    if (!it) return 'Item';
    if (it.kind === 'weapon') return cap(it.rarity) + ' ' + cap(it.type);
    if (it.kind === 'armor') return cap(it.rarity) + ' Armor';
    if (it.kind === 'trinket') return cap(it.rarity) + ' Trinket (' + (it.primaryStat || '') + ')';
    return cap(it.rarity || '') + ' Item';
  }
  function detailLine(it) {
    var parts = [];
    if (it.kind === 'weapon') parts.push('ATK ' + Math.round(it.attack || 0));
    if (it.kind === 'armor') parts.push('HP +' + Math.round(it.maxHp || 0));
    if (it.kind === 'trinket') parts.push(cap(it.primaryStat || '') + ' ' + Math.round((it.primaryValue || 0) * 100) / 100);
    (it.secondaries || []).forEach(function (s) { parts.push(cap(s.stat) + ' ' + Math.round(s.value * 100) / 100); });
    (it.traits || []).forEach(function (t) { parts.push(t.name); });
    return parts.join(' · ');
  }
  function upgradeInfo(it) {
    if (!E) return null;
    var next = (it.upgrade || 0) + 1;
    if (next > 15) return { materials: 'Maxed', failureRate: 0, toLevel: 15 };
    var step = E.upgradeStep(next);
    var cost = E.materialCostFor(it, next);
    var mats = [];
    if (cost.tech) mats.push(cost.tech + ' Tech Cores');
    if (cost.magic) mats.push(cost.magic + ' Mana Shards');
    return { materials: mats.join(' + ') || 'No materials', failureRate: step ? step.fail : 0, toLevel: next };
  }
  function mapItem(it) {
    return {
      id: it.id, name: displayName(it), tier: 'T' + it.tier, rarity: cap(it.rarity),
      detail: detailLine(it), upgradeLevel: it.upgrade || 0,
      sell: E ? E.sellValue(it) : 0, upgrade: upgradeInfo(it), _raw: it,
    };
  }

  /* ---------- GCUI binding ---------- */
  function dungeonList() {
    var out = [];
    for (var t = 1; t <= 4; t++) {
      var prev = G ? G.dungeonPreview(t, null, {}) : null;
      var cfg = G ? G.TIER_CONFIG[t] : null;
      var lockedOut = t === 4 && !!(meta().season && meta().season.mythicClaimed);
      out.push({
        id: 'T' + t, tier: 'T' + t, tierName: prev ? prev.tierName : ('T' + t),
        resistances: prev ? prev.resistances : null, cc: prev ? prev.ccProfile : null,
        debuffs: prev ? prev.debuffProfile : null, blocks: prev ? prev.blocks : null,
        partyRequirement: prev ? prev.partyRequirement : null,
        energyCost: cfg ? cfg.energy : null, lootTier: prev ? prev.lootTier : null,
        lockedReason: null, lockedOut: lockedOut,
      });
    }
    return out;
  }
  function passTiers() {
    if (!E) return [];
    var free = E.passFreeTrack();
    var prem = E.passPremiumTrack();
    return free.map(function (f, i) {
      return {
        tier: f.tier,
        freeReward: 'Gold ' + f.gold + (f.cores ? ' + ' + f.cores + ' cores' : '') + (f.cosmetic ? ' + cosmetic' : ''),
        premiumReward: (prem[i].cosmetic || '') + (prem[i].convenience ? ' + ' + prem[i].convenience : '') || '—',
      };
    });
  }
  function bindAll() {
    if (typeof GCUI === 'undefined') return;
    var m = meta();
    var energy = E && m.energy ? E.energyState(m.energy.value, m.energy.updatedAt, Date.now()) : { value: 72 };
    if (E && m.energy && energy.value !== m.energy.value) { m.energy.value = energy.value; m.energy.updatedAt = Date.now(); }
    refreshQuests();
    var season = {
      number: 1, timeLeft: '—',
      leaderboard: [],
    };
    GCUI.bind({
      meta: {
        goldLedger: { farmed: m.ledgers ? m.ledgers.gold_farmed : 0, bought: m.ledgers ? m.ledgers.gold_bought : 0 },
        energy: { cap: 72, regenMinutes: 20, regenLabel: '1 per 20 min (cap 72)' },
        season: season,
        quests: (m.quests && m.quests.items) || [],
        materials: { tech: m.materials ? m.materials.tech : 0, mana: m.materials ? m.materials.magic : 0 },
        inventory: (m.inventory || []).map(mapItem),
        dungeons: dungeonList(),
        vendor: { buy: E ? E.VENDOR.buyPerCore : 25, sell: E ? E.VENDOR.sellPerCore : 3 },
        fusion: { farmedGoldCost: E ? E.FUSION_COST[1] : 95 },
        tournament: { entryGold: E ? E.TOURNAMENT.entry : 250, prizePool: null, startsIn: 'Sunday 8:00 PM ET', history: null },
        pass: { tiers: passTiers() },
        guild: m.guild,
        shop: { cosmetics: [] },
      },
    });
    GCUI.setDungeons(dungeonList());
    GCUI.setQuests((m.quests && m.quests.items) || []);
    GCUI.setPass({ tiers: passTiers() });
  }
  function refresh() {
    bindAll();
    try {
      var st = (typeof GCUI !== 'undefined') ? GCUI.state() : null;
      if (st && typeof GCUI.show === 'function') GCUI.show(st.screen);
    } catch (e) {}
  }

  /* ---------- two-step confirm state ---------- */
  var pending = {};
  function confirmFirst(key, msg) {
    if (!pending[key]) { pending[key] = true; toast(msg + ' — tap again to confirm.'); sfx('error'); return false; }
    pending[key] = false;
    return true;
  }

  /* ---------- age gate ---------- */
  function ageConfirmed() {
    try {
      if (meta().ageConfirmed === true) return true;
      var r = JSON.parse(localStorage.getItem(AGE_KEY) || 'null');
      return !!(r && r.verified);
    } catch (e) { return false; }
  }
  function onAgeVerified() {
    try { meta().ageConfirmed = true; persist(); } catch (e) {}
  }
  function syncAge() {
    try {
      var viaKey = false;
      try { var r = JSON.parse(localStorage.getItem(AGE_KEY) || 'null'); viaKey = !!(r && r.verified); } catch (e) {}
      if (viaKey && !meta().ageConfirmed) { meta().ageConfirmed = true; persist(); }
      if (meta().ageConfirmed && !viaKey) {
        try { localStorage.setItem(AGE_KEY, JSON.stringify({ verified: true, at: Date.now() })); } catch (e) {}
      }
    } catch (e) {}
  }

  /* ---------- run lifecycle ---------- */
  var lastResultsRaw = [];
  function onRunStart(tier) {
    // run_start analytics is emitted by app.js startGame; nothing to duplicate here.
  }
  function onRunEnd(won, run, bestCombo) {
    /* T15: bestCombo is the run's PEAK combo, threaded from gameOver() as
       the 3rd arg (app.js cannot be read from here — this file's G is
       GrindchainGameplay, shadowing app.js's state G). gameOver() calls
       onRunEnd synchronously before startGame/softReset clear bestComboRun,
       so the arg is the true peak; default 0 when genuinely unavailable
       (e.g. a test harness calling onRunEnd with 2 args). Never read the
       live combo here — gameOver() resets it to 0 by design. */
    var bestComboRun = (typeof bestCombo === 'number' && isFinite(bestCombo)) ? Math.max(0, Math.floor(bestCombo)) : 0;
    try {
      dismissCheckpoint(); /* Phase 4 FIX-P4-01: never leave a stale modal over the results/game-over screens. */
      var m = meta();
      var tier = 1;
      try { tier = (typeof Game !== 'undefined' && Game.getTier) ? Game.getTier() : 1; } catch (e) {}
      var clearBonus = 0;
      var loot = [];
      if (G && run) {
        if (won) {
          var done = G.completeRun(run, { mvp: false });
          clearBonus = done.clearBonus || 0;
          loot = G.dropFor('boss', tier, { mythicEligible: tier === 4 && !(m.season && m.season.mythicClaimed), dungeonFaction: 'red' });
          if (tier === 4) { if (!m.season) m.season = {}; m.season.mythicClaimed = true; }
          if (tier > (m.idle ? m.idle.highestTierCleared : 0)) { if (!m.idle) m.idle = {}; m.idle.highestTierCleared = tier; }
        } else {
          G.wipeRun(run);
        }
      }
      if (clearBonus > 0 && E && m.ledgers) E.addFarmed(m.ledgers, clearBonus);
      loot.forEach(function (it) { m.inventory.push(it); });
      lastResultsRaw = loot.slice();
      if (m.pass) m.pass.xp = (m.pass.xp || 0) + (won ? 64 : 0);
      touchStreak();
      persist();
      /* Phase 4 rec-fix (BUG-P4-09) + round 2 (F2): app.js gameOver() calls
         GCIntegration.onRunEnd() FIRST and Save.recordRun() (UTC-day streak
         since round 2) SECOND. This deferred persist() runs after the whole
         gameOver call stack completes, re-asserting the UTC streak as the
         last write, so the hub display (which reads Save.data.streak.current)
         shows the same UTC-day value the quest payout uses. persist() itself
         writes Save.data.streak.current = meta.streak.day. */
      setTimeout(function () { try { persist(); } catch (e) {} }, 0);
      var headline = won
        ? (tier >= 3 ? 'Dread Warden defeated.' : 'Vault-Keeper defeated.')
        : (tier >= 3 ? 'The Dread Warden stands. Your crew retreats.' : 'The Vault-Keeper stands. Your crew retreats.');
      if (typeof GCUI !== 'undefined') {
        GCUI.setResults({ won: !!won, gold: clearBonus, xp: null, headline: headline, bestCombo: bestComboRun, items: loot.map(mapItem) });
      }
      if (!isAutotest() && typeof GCUI !== 'undefined') {
        setTimeout(function () {
          try {
            var go = document.getElementById('gameover');
            if (go) go.style.display = 'none';
            GCUI.show('results');
          } catch (e) {}
        }, 700);
      }
    } catch (e) { /* run-end must never break game over */ }
  }

  /* ---------- checkpoint modal (draft + checkpoint shop) ---------- */
  var cpOpen = false;
  function dismissCheckpoint() {
    /* Phase 4 FIX-P4-01: a run ending (death/victory) while the checkpoint
       modal is open previously left the stale modal in the DOM and cpOpen
       stuck true, so every later checkpoint() call early-returned and the
       run's real checkpoint was swallowed. Dismissal is idempotent. */
    cpOpen = false;
    try { var box = document.getElementById('gc-checkpoint'); if (box) box.remove(); } catch (e) {}
  }
  function checkpoint() {
    if (cpOpen) return;
    /* Phase 4 rec-fix (OBS-08): G.running guard — the modal must not open
       with no run. Game.getDiag().running is app.js's G.running. A Game
       stub without getDiag (older/test harness) falls through to the
       getRunState check below, preserving old behavior there. */
    try {
      if (typeof Game !== 'undefined' && Game.getDiag) {
        var _diag = Game.getDiag();
        if (!_diag || !_diag.running) return;
      }
    } catch (e) { return; }
    try {
      if (typeof Game === 'undefined' || !Game.getRunState) return;
      var rs = Game.getRunState();
      var run = null;
      // The run model lives in app.js (G._gcRun); reach it via a snapshot:
      // runGold/blocks come from Game.getRunState; draft/shop act on them
      // through the integration bridge below (cpRun).
      cpOpen = true;
      try { if (typeof Game !== 'undefined') Game.pause('manual'); } catch (e) {}
      var tier = rs.tier || 1;
      var blocks = 0;
      var drafts = G ? G.rollDraft(tier, blocks) : [];
      var box = document.createElement('div');
      box.id = 'gc-checkpoint';
      /* Phase 4 rec-fix round 2 (F1): dead SHOP fallback literal — the stale
         reroll entry (price 90) is deleted. The fallback now mirrors live
         E.SHOP (totem 55 / healing 70 / aegis 65) only. Even in this
         fallback world no purchase can deduct gold: Game.buyCheckpointItem
         refuses when GrindchainEconomy is undefined, and
         Economy.buyShopItem refuses 'reroll' outright. */
      var shop = E ? E.SHOP : { totem: { price: 55, label: 'Totem charge' }, healingTotem: { price: 70, label: 'Healing Totem charge' }, aegis: { price: 65, label: 'Aegis Shield pickup' } };
      var shopHtml = Object.keys(shop).map(function (k) {
        return '<button data-cp-shop="' + k + '">' + shop[k].label + ' — ' + shop[k].price + ' run gold</button>';
      }).join('');
      var draftHtml = drafts.map(function (d, i) {
        return '<button data-cp-draft="' + i + '">DRAFT: ' + d.label + ' (' + d.rarity + ')</button>';
      }).join('');
      box.innerHTML = '<div class="gc-cp-box"><h2>CHECKPOINT</h2>' +
        '<p>Your crew catches its breath. 50% of missing HP restored, combat Energy refilled. Pick one draft, spend run gold, then continue.</p>' +
        '<p>Run gold: <b id="gc-cp-gold">' + (rs.runGold || 0) + '</b></p>' +
        draftHtml + shopHtml +
        '<button class="gc-cp-gold" data-cp-close>CONTINUE THE RUN</button></div>';
      document.body.appendChild(box);
      // Checkpoint heal: 50% of missing HP + full combat EN, via Gameplay.
      try { if (typeof Game !== 'undefined' && Game.checkpointHeal) Game.checkpointHeal(); } catch (e) {}
      box.addEventListener('click', function (evt) {
        var dt = evt.target.closest('[data-cp-draft]');
        var st = evt.target.closest('[data-cp-shop]');
        var cl = evt.target.closest('[data-cp-close]');
        if (dt) {
          var d = drafts[Number(dt.getAttribute('data-cp-draft'))];
          if (d) {
            ev('draft_pick', { tier: tier });
            sfx('draft_pick');
            toast('Drafted: ' + d.label + ' (' + d.rarity + ').');
            box.querySelectorAll('[data-cp-draft]').forEach(function (b) { b.disabled = true; });
          }
          return;
        }
        if (st) {
          var key = st.getAttribute('data-cp-shop');
          var res = null;
          try { res = (typeof Game !== 'undefined' && Game.buyCheckpointItem) ? Game.buyCheckpointItem(key) : null; } catch (e) {}
          if (res && res.ok) {
            ev('shop_buy', { tier: tier });
            sfx('shop_buy');
            toast('Bought: ' + (shop[key] && shop[key].label) + '.');
            var goldEl = document.getElementById('gc-cp-gold');
            if (goldEl && typeof Game !== 'undefined') goldEl.textContent = Game.getRunState().runGold;
          } else if (res) { toast(res.reason || 'Cannot buy that.'); sfx('error'); }
          return;
        }
        if (cl) {
          box.remove(); cpOpen = false;
          try { if (typeof Game !== 'undefined') Game.resume(); } catch (e) {}
        }
      });
    } catch (e) { cpOpen = false; try { if (typeof Game !== 'undefined') Game.resume(); } catch (err) {} }
  }

  /* ---------- tutorial ---------- */
  function tut() {
    var m = meta();
    if (!m.tutorial) m.tutorial = { beat: 0, skipped: false, done: false, run: 1 };
    return m.tutorial;
  }
  function onGameplayEvent(kind) {
    try {
      var t = tut();
      if (t.done) return;
      // In-run events advance the persisted tutorial state (beats 1..5 map to
      // gameplay beats; the on-screen tutorial itself advances manually).
      var map = { attack: 1, skill: 2, potion: 3, kill: 4 };
      var target = map[kind];
      if (target && t.beat < target) {
        t.beat = target;
        ev('tutorial_step', { beat: t.beat });
        if (t.beat >= 5) { t.done = true; ev('tutorial_complete', {}); }
        persist();
      }
    } catch (e) {}
  }

  /* ---------- action handlers (delegated from ui.js) ---------- */
  function currentScreen() {
    try { return GCUI.state().screen; } catch (e) { return null; }
  }
  function findInvItem(id) {
    var inv = meta().inventory || [];
    for (var i = 0; i < inv.length; i++) if (String(inv[i].id) === String(id)) return inv[i];
    return null;
  }
  function removeInvItem(id) {
    var inv = meta().inventory || [];
    for (var i = 0; i < inv.length; i++) if (String(inv[i].id) === String(id)) { inv.splice(i, 1); return true; }
    return false;
  }
  function handleAction(action, target) {
    var m = meta();
    var st = null;
    try { st = GCUI.state(); } catch (e) {}
    if (action === 'enter-dungeon') {
      var tierStr = (st && st.dungeonTier) || 'T1';
      var tier = parseInt(String(tierStr).replace(/\D/g, ''), 10) || 1;
      var faction = (st && st.faction) || 'red';
      var hero = (st && st.hero) || 'bastion';
      var party = (st && st.party && st.party.filter(Boolean).length) ? st.party.filter(Boolean) : [hero];
      var energyNow = E && m.energy ? E.energyState(m.energy.value, m.energy.updatedAt, Date.now()).value : 72;
      var lobby = G ? G.validateLobby({ tier: tier, party: party, energy: energyNow, readyAll: true, solo: true, mythicClaimed: !!(m.season && m.season.mythicClaimed) }) : { ok: true, reasons: [] };
      if (!lobby.ok) { toast(lobby.reasons.join(' ')); sfx('error'); return true; }
      try { if (typeof Game !== 'undefined' && Game.setHero) Game.setHero(faction, hero); } catch (e) {}
      var started = false;
      try { started = (typeof Game !== 'undefined' && Game.startGame) ? Game.startGame(faction, { tier: tier, party: party }) : false; } catch (e) { started = false; }
      if (!started) return true;
      try { GCUI.hide(); } catch (e) {}
      return true;
    }
    if (action === 'new-game' || action === 'replay-tutorial') {
      var t0 = G ? G.createTutorial() : { beat: 0, skipped: false, done: false, run: 1 };
      m.tutorial = t0; persist();
      ev('tutorial_start', {});
      return false; // let GCUI show the tutorial screen
    }
    if (action === 'tutorial-next') {
      var t = tut();
      if (st && st.tutorialBeat >= 4) { t.beat = 8; t.done = true; ev('tutorial_complete', {}); persist(); return false; }
      t.beat = (st ? st.tutorialBeat : 0) + 1;
      ev('tutorial_step', { beat: t.beat });
      persist();
      return false;
    }
    if (action === 'tutorial-skip-yes') {
      var tb = st ? st.tutorialBeat : 0;
      if (tb < 2) { toast('Skip unlocks after Beat 3.'); sfx('error'); return true; }
      var t2 = tut();
      if (G) G.advanceTutorial(t2, 'skip');
      else { t2.skipped = true; }
      persist();
      return false;
    }
    if (action === 'upgrade-confirm' || action === 'upgrade-confirm-yes') {
      var itemId = st && st.upgradeItem;
      var inv = m.inventory || [];
      var it = itemId ? findInvItem(itemId) : inv[0];
      if (!it) { toast('No item selected.'); return true; }
      var res = E ? E.attemptUpgrade(it, m.materials, { confirm: true, rng: Math.random }) : { ok: false, reason: 'Upgrade system unavailable.' };
      if (!res.ok) { toast(res.reason || 'Upgrade failed.'); sfx('error'); return true; }
      if (res.failed) {
        toast('Upgrade failed — materials consumed, item kept at +' + (it.upgrade || 0) + ' (never destroyed, never downgraded).');
        ev('upgrade_attempt', { level: (it.upgrade || 0) + 1, success: false });
      } else {
        toast('Upgrade succeeded — +' + res.level + '.');
        ev('upgrade_attempt', { level: res.level, success: true });
        sfx('draft_pick');
      }
      persist(); refresh();
      return true;
    }
    if (action === 'fusion-confirm') {
      var inputs = (st && st.fusionInputs) || [];
      var chosen = inputs.filter(Boolean).map(findInvItem).filter(Boolean);
      if (chosen.length !== 3) { toast('Fusion needs exactly 3 items.'); sfx('error'); return true; }
      if (!confirmFirst('fusion', 'Confirm fusion: 3 input items + farmed gold cost shown on the Fusion screen')) return true;
      var fres = E ? E.fuse(chosen, m.ledgers, { confirm: true }) : { ok: false, reason: 'Fusion unavailable.' };
      if (!fres.ok) { toast(fres.reason || 'Fusion failed.'); sfx('error'); return true; }
      chosen.forEach(function (ci) { removeInvItem(ci.id); });
      var first = chosen[0];
      var made = null;
      try {
        if (first.kind === 'weapon') made = G.rollWeapon(fres.resultTier, fres.resultRarity, first.type, first.tag);
        else if (first.kind === 'armor') made = G.rollArmor(fres.resultTier, fres.resultRarity, first.factionTag);
        else made = G.rollTrinket(fres.resultTier, fres.resultRarity, first.factionTag);
      } catch (e) {}
      if (made) m.inventory.push(made);
      ev('fusion', { tier: fres.resultTier });
      sfx('draft_pick');
      toast('Fusion complete — ' + displayName(made) + '.');
      persist(); refresh();
      return true;
    }
    if (action === 'vendor-buy' || action === 'vendor-sell') {
      if (action === 'vendor-buy') {
        if (!confirmFirst('vendor-buy', 'Confirm: buy 1 core for 25 farmed gold')) return true;
        var vb = E ? E.vendorBuyCores(m.ledgers, 1, { confirm: true }) : { ok: false, reason: 'Vendor unavailable.' };
        if (!vb.ok) { toast(vb.reason || 'Vendor buy failed.'); sfx('error'); return true; }
        m.materials.tech = (m.materials.tech || 0) + 1;
        ev('shop_buy', { tier: 0 }); sfx('shop_buy');
        toast('Bought 1 Tech Core.');
      } else {
        var vs = E ? E.vendorSellCores(m.materials, 1, m.ledgers, 'tech') : { ok: false, reason: 'Vendor unavailable.' };
        if (!vs.ok) { toast(vs.reason || 'Vendor sell failed.'); sfx('error'); return true; }
        ev('sell', { tier: 0 }); sfx('shop_buy');
        toast('Sold 1 Tech Core for 3 farmed gold.');
      }
      persist(); refresh();
      return true;
    }
    if (action === 'tournament-enter') {
      if (!confirmFirst('tournament', 'Entry: 250 gold. Operations cut: [disclosed at confirm]. Prizes: cosmetic + gold.')) return true;
      var te = E ? E.enterTournament(m.ledgers, { confirm: true }) : { ok: false, reason: 'Tournament unavailable.' };
      if (!te.ok) { toast(te.reason || 'Tournament entry failed.'); sfx('error'); return true; }
      if (!m.tournament) m.tournament = { entered: false, entries: 0 };
      m.tournament.entered = true; m.tournament.entries = (m.tournament.entries || 0) + 1;
      if (m.pass) m.pass.xp = (m.pass.xp || 0) + 280;
      ev('tournament_entry', {});
      sfx('shop_buy');
      toast('Tournament entered. ' + te.receipt);
      persist(); refresh();
      return true;
    }
    if (action === 'guild-create-yes') {
      var gs = E ? E.createGuildShell({}) : null;
      toast((gs && gs.foundingCopy) || 'Founding cost: shown before you confirm. Founding grants no power.');
      return true;
    }
    if (action === 'idle-collect') {
      var pend = m.idle && m.idle.pending;
      if (pend) {
        if (E && m.ledgers) E.addFarmed(m.ledgers, pend.gold);
        m.materials.tech = (m.materials.tech || 0) + (pend.cores || 0);
        ev('idle_collect', { gold: pend.gold });
        sfx('shop_buy');
        toast('Collected ' + pend.gold + ' gold + ' + (pend.cores || 0) + ' cores.');
        m.idle.pending = null;
        persist();
      }
      try { GCUI.setIdle(null); GCUI.show('hub'); } catch (e) {}
      return true;
    }
    if (action === 'save-settings') {
      var sset = (st && st.settings) || {};
      var patch = {};
      if (sset.musicVolume !== undefined) patch.volume = Math.min(1, Math.max(0, Number(sset.musicVolume) / 100));
      if (sset.quality !== undefined) {
        var q = String(sset.quality);
        patch.quality = (q === 'auto' || q === 'medium') ? 'med' : q;
      }
      if (sset.colorblind !== undefined) patch.colorblind = sset.colorblind;
      if (sset.textSize !== undefined) patch.textSize = sset.textSize;
      try { if (typeof Settings !== 'undefined') Settings.set(patch); } catch (e) {}
      try {
        if (typeof Save !== 'undefined' && Save.data && Save.data.settings) {
          ['sfxVolume', 'joystickSide', 'joystickSize', 'lockOn'].forEach(function (k) {
            if (sset[k] !== undefined) Save.data.settings[k] = sset[k];
          });
          Save.save();
        }
      } catch (e) {}
      toast('Settings saved.');
      try { if (typeof GCUI !== 'undefined') GCUI.show('settings'); } catch (e) {}
      return true;
    }
    return false; // not owned: let GCUI handle it
  }

  function handleItemClick(t) {
    var m = meta();
    if (t.hasAttribute('data-gcui-result') || t.hasAttribute('data-gcui-inv')) {
      var ctx = t.hasAttribute('data-gcui-result') ? 'results' : 'inventory';
      var kind = t.getAttribute(ctx === 'results' ? 'data-gcui-result' : 'data-gcui-inv');
      var id = t.getAttribute('data-gcui-item');
      var raw = null;
      if (ctx === 'results') {
        lastResultsRaw.forEach(function (x) { if (String(x.id) === String(id)) raw = x; });
      }
      if (!raw) raw = findInvItem(id);
      if (!raw) { toast('Item not found.'); return true; }
      if (kind === 'sell') {
        if (E) E.sellItem(raw, m.ledgers);
        removeInvItem(id);
        lastResultsRaw = lastResultsRaw.filter(function (x) { return String(x.id) !== String(id); });
        ev('sell', {});
        sfx('shop_buy');
        toast('Sold for ' + (E ? E.sellValue(raw) : 0) + ' farmed gold.');
        persist(); refresh();
        return true;
      }
      if (kind === 'salvage') {
        var y = null;
        if (E) { var sr = E.salvageItem(raw, m.materials); y = sr.yield; }
        removeInvItem(id);
        lastResultsRaw = lastResultsRaw.filter(function (x) { return String(x.id) !== String(id); });
        ev('salvage', {});
        sfx('shop_buy');
        toast('Salvaged for ' + (y ? (y.tech + ' Tech + ' + y.magic + ' Mana') : 'materials') + '.');
        persist(); refresh();
        return true;
      }
      if (kind === 'equip') {
        var st = null;
        try { st = GCUI.state(); } catch (e) {}
        var hero = (st && st.hero) || 'bastion';
        var eq = G ? G.equipItem(hero, raw, { inRun: false }) : { ok: false, reason: 'Equip unavailable.' };
        if (!eq.ok) { toast(eq.reason || 'Cannot equip.'); sfx('error'); return true; }
        if (!m.equipped) m.equipped = {};
        if (!m.equipped[hero]) m.equipped[hero] = {};
        m.equipped[hero][raw.slot] = raw.id;
        toast('Equipped ' + displayName(raw) + ' on ' + hero + '.');
        persist(); refresh();
        return true;
      }
      return true;
    }
    if (t.hasAttribute('data-gcui-quest-claim')) {
      var qid = t.getAttribute('data-gcui-quest-claim');
      var items = (m.quests && m.quests.items) || [];
      var q = null;
      items.forEach(function (x) { if (String(x.id) === String(qid)) q = x; });
      if (!q) { toast('Quest not found.'); return true; }
      if (q.claimed) { toast('Already claimed.'); return true; }
      var day = touchStreak();
      var cr = E ? E.claimQuest(q, day, m.ledgers) : { ok: false, reason: 'Quests unavailable.' };
      if (!cr.ok) { toast(cr.reason || 'Claim failed.'); sfx('error'); return true; }
      if (m.pass) m.pass.xp = (m.pass.xp || 0) + 100;
      ev('quest_claim', { gold: cr.gold });
      ev('streak_day', { day: day });
      sfx('shop_buy');
      toast('Claimed ' + cr.gold + ' farmed gold.');
      persist(); refresh();
      return true;
    }
    if (t.hasAttribute('data-gcui-pass-claim')) {
      var tier = parseInt(t.getAttribute('data-gcui-pass-claim'), 10);
      var pc = E ? E.passClaim({ claimedTiers: (m.pass && m.pass.claimedTiers) || [] }, tier, false) : { ok: false, reason: 'Pass unavailable.' };
      if (!pc.ok) { toast(pc.reason || 'Pass claim failed.'); sfx('error'); return true; }
      if (!m.pass) m.pass = { xp: 0, claimedTiers: [], premium: false };
      m.pass.claimedTiers.push(tier);
      try { var _st2 = GCUI.state(); if (_st2) { _st2.passClaims = _st2.passClaims || {}; _st2.passClaims[tier] = true; } } catch (e) {}
      if (pc.reward) {
        if (E && m.ledgers) E.addFarmed(m.ledgers, pc.reward.gold || 0);
        m.materials.tech = (m.materials.tech || 0) + (pc.reward.cores || 0);
      }
      toast('Pass tier ' + tier + ' claimed.');
      persist(); refresh();
      return true;
    }
    return false;
  }

  /* ---------- boot ---------- */
  function init() {
    try { if (typeof Settings !== 'undefined') Settings.apply(); } catch (e) {}
    try { if (typeof GameAudio !== 'undefined') GameAudio.init(); } catch (e) {}
    try { if (typeof Analytics !== 'undefined') Analytics.init(); } catch (e) {}
    try {
      if (typeof Settings !== 'undefined' && typeof Settings.subscribe === 'function') {
        Settings.subscribe(function (cur) {
          try {
            if (typeof GameAudio !== 'undefined' && GameAudio.isReady) {
              GameAudio.setVolume(cur.volume);
              GameAudio.setMuted(cur.muted);
            }
          } catch (e) {}
        });
      }
    } catch (e) {}
    syncAge();
    var idle = computeIdle();
    bindAll();
    if (idle && typeof GCUI !== 'undefined') GCUI.setIdle(idle);
    try { if (typeof GCUI !== 'undefined') GCUI.init(); } catch (e) {}
    // UI click/error fan-out (gesture-friendly: GameAudio unlocks on gesture).
    try {
      document.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if (btn) sfx('ui_click');
      });
    } catch (e) {}
    // Combat snapshot feed for GCUI.setCombat (keeps S.combat fresh).
    try {
      setInterval(function () {
        try {
          if (typeof Game !== 'undefined' && Game.getCombatSnapshot) {
            var snap = Game.getCombatSnapshot();
            if (snap && typeof GCUI !== 'undefined') GCUI.setCombat(snap);
          }
        } catch (e) {}
      }, 500);
    } catch (e) {}
    // Hub music once the player reaches the title/hub (gesture-gated by GameAudio).
    try {
      if (typeof GameAudio !== 'undefined') GameAudio.music('hub');
    } catch (e) {}
  }

  var api = {
    version: 'phase3-integration-1.0.0',
    ageConfirmed: ageConfirmed,
    onAgeVerified: onAgeVerified,
    onRunStart: onRunStart,
    onRunEnd: onRunEnd,
    onGameplayEvent: onGameplayEvent,
    handleAction: handleAction,
    handleItemClick: handleItemClick,
    checkpoint: checkpoint,
    dismissCheckpoint: dismissCheckpoint,
    bindAll: bindAll,
    mapItem: mapItem,
    _test: {
      meta: meta, touchStreak: touchStreak, refreshQuests: refreshQuests,
      computeIdle: computeIdle, dungeonList: dungeonList, passTiers: passTiers,
    },
  };
  if (typeof window !== 'undefined') window.GCIntegration = api;
  init();
})();
