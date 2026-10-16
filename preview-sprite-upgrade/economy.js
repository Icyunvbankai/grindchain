/* GRINDCHAIN Phase 3 — Economy Systems (Wave 2).
   Pure-logic module: ledgers, session energy, upgrades/fusion/salvage/
   sell/vendor, run-gold shop, quests/streak/idle, seasons, battle pass,
   tournaments (closed-loop), guild shell.
   NO DOM, NO network, NO checkout, NO purchase UI, NO server, NO accounts.
   Bought gold stays 0: there is no purchase flow in this file, and every
   power-adjacent sink accepts farmed gold or materials only (strict gate).
   The operations cut is NEVER stated as a number in any string here, and
   no percentage for it is encoded as a default: the caller must supply a
   confirmed figure, or the pool reports the cut as undisclosed.
   Player-facing strings: see COPY in gameplay-systems.js for shared copy. */
'use strict';
(function (root) {
  var G = {};

  /* ---------- ledgers: gold_farmed + gold_bought (bought stays 0) ---------- */
  function createLedgers() { return { gold_farmed: 0, gold_bought: 0 }; }
  function totalGold(ledgers) { return (ledgers.gold_farmed || 0) + (ledgers.gold_bought || 0); }
  function addFarmed(ledgers, amount) {
    ledgers.gold_farmed = (ledgers.gold_farmed || 0) + amount;
    return ledgers;
  }
  /* Bought gold has no inlet: no purchase function exists in this file. */
  function spendFarmed(ledgers, amount, opts) {
    opts = opts || {};
    /* Phase 4 FIX-P4-02: reject non-positive / non-finite amounts. A negative
       amount previously passed the balance check and ADDED gold (ledger +=
       -amount). No legitimate caller spends <= 0 (fusion/vendor/tournament
       costs are fixed positives). */
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) return { ok:false, reason:'Invalid spend amount.' };
    if ((ledgers.gold_farmed || 0) < amount) return { ok:false, reason:'Need ' + amount + ' gold — you have ' + (ledgers.gold_farmed || 0) + ' farmed gold.' };
    if (opts.confirm !== true) return { ok:false, reason:'Confirm before spending gold.', needsConfirm:true };
    ledgers.gold_farmed -= amount;
    return { ok:true, spent:amount, ledger:'gold_farmed', remaining: ledgers.gold_farmed };
  }
  /* Power-adjacent gate: bought gold is refused for every power-adjacent sink. */
  function gateCheck(sink) {
    var powerSinks = ['upgrade','fusion','raid_entry','marketplace','tournament_entry','guild_founding','energy_refill','materials','checkpoint_shop'];
    if (powerSinks.indexOf(sink) >= 0) return { boughtAllowed:false, reason:'Bought gold buys cosmetics only until the gold/power ruling resolves.' };
    return { boughtAllowed: sink === 'cosmetics', reason:'' };
  }

  /* ---------- session energy (R-6) ---------- */
  var ENERGY = { cap:72, regenMinutes:20, costs:{ 1:6, 2:10, 3:14, 4:18 } };
  function energyState(current, updatedAt, now) {
    now = now || Date.now();
    /* Phase 4 FIX-P4-03: fail closed on non-finite stored values. A tampered
       string energy ('abc') previously made Math.min produce NaN, and
       NaN < cost is false, so enterDungeon APPROVED entry with NaN energy.
       Non-finite current -> 0 (entry refused); non-finite updatedAt -> now. */
    var cur = (typeof current === 'number' && isFinite(current)) ? current : 0;
    var upd = (typeof updatedAt === 'number' && isFinite(updatedAt)) ? updatedAt : now;
    var elapsedMin = Math.max(0, (now - upd) / 60000);
    var gained = Math.floor(elapsedMin / ENERGY.regenMinutes);
    var value = Math.min(ENERGY.cap, cur + gained);
    var toFullMin = (ENERGY.cap - value) * ENERGY.regenMinutes;
    return { value:value, updatedAt: upd, fullInMinutes: toFullMin, fullInText: toFullMin <= 0 ? 'Full' : 'Full in about ' + toFullMin + ' min' };
  }
  function enterDungeon(energy, tier, now) {
    var st = energyState(energy.value, energy.updatedAt, now);
    var cost = ENERGY.costs[tier] || 6;
    if (st.value < cost) return { ok:false, reason:'Need ' + cost + ' Energy — you have ' + st.value + '.', cost:cost, energy: st };
    /* Deducted at ENTER. Wipe / quit = energy stays spent. Retry = new run, full cost. */
    return { ok:true, cost:cost, energy:{ value: st.value - cost, updatedAt: now || Date.now() } };
  }
  /* No paid refill is designed, priced, or implemented. This is the only
     refill affordance: natural-regen timer + qualifier. */
  function refillInfo(energy, now) {
    var st = energyState(energy.value, energy.updatedAt, now);
    return { timer: st.fullInText, qualifier: "pending Adrian's B2-3 ruling", price: null, purchasable: false };
  }

  /* ---------- upgrades (R-1: MATERIALS ONLY) ---------- */
  var UPGRADE_TRACK = [
    { level:1, cost:1, gain:0.04, fail:0 }, { level:2, cost:1, gain:0.04, fail:0 },
    { level:3, cost:2, gain:0.04, fail:0 }, { level:4, cost:2, gain:0.04, fail:0 },
    { level:5, cost:3, gain:0.04, fail:0 }, { level:6, cost:4, gain:0.04, fail:0 },
    { level:7, cost:5, gain:0.04, fail:0 }, { level:8, cost:6, gain:0.04, fail:0 },
    { level:9, cost:8, gain:0.04, fail:0 }, { level:10, cost:10, gain:0.04, fail:0 },
    { level:11, cost:30, gain:0.02, fail:0.25 }, { level:12, cost:33, gain:0.02, fail:0.35 },
    { level:13, cost:36, gain:0.02, fail:0.45 }, { level:14, cost:39, gain:0.02, fail:0.55 },
    { level:15, cost:42, gain:0.02, fail:0.65 }
  ];
  function upgradeStep(level) { return UPGRADE_TRACK[level - 1] || null; }
  function upgradeGain(level) {
    var total = 0;
    for (var i = 0; i < level && i < UPGRADE_TRACK.length; i++) total += UPGRADE_TRACK[i].gain;
    return total;
  }
  function materialCostFor(item, level) {
    var step = upgradeStep(level); if (!step) return null;
    var tag = item.tag || item.factionTag || 'tech';
    if (tag === 'hybrid' || tag === 'purple') return { tech: step.cost, magic: step.cost }; /* Hybrid tax: BOTH materials, full count. */
    if (tag === 'magic' || tag === 'blue') return { tech:0, magic: step.cost };
    return { tech: step.cost, magic:0 };
  }
  function expectedMaterialsToMax() {
    var total = 0;
    UPGRADE_TRACK.forEach(function (s) { total += s.cost / (1 - s.fail); });
    return total; /* About 405 for a single-faction item. */
  }
  function attemptUpgrade(item, materials, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var next = (item.upgrade || 0) + 1;
    if (next > 15) return { ok:false, reason:'Item is already at its highest upgrade.' };
    var step = upgradeStep(next);
    var cost = materialCostFor(item, next);
    if ((materials.tech || 0) < cost.tech || (materials.magic || 0) < cost.magic) {
      return { ok:false, reason:'Not enough materials.', cost:cost, step:step };
    }
    if (next >= 11 && opts.confirm !== true) {
      return { ok:false, needsConfirm:true, cost:cost, step:step, reason:'Confirm upgrade: cost + failure chance shown before confirm.' };
    }
    materials.tech -= cost.tech; materials.magic -= cost.magic;
    var failed = rng() < step.fail;
    if (failed) {
      /* Failure consumes materials. Item is NEVER destroyed, NEVER downgrades. */
      return { ok:true, failed:true, level: item.upgrade || 0, cost:cost, materials:materials };
    }
    item.upgrade = next;
    var gain = upgradeGain(next);
    if (item.kind === 'weapon') item.attack = Math.round(item.baseAttack * (1 + gain));
    if (item.kind === 'armor') item.maxHp = Math.round(item.baseMaxHp * (1 + gain));
    if (item.kind === 'trinket') item.primaryValue = item.basePrimaryValue * (1 + gain);
    return { ok:true, failed:false, level:next, cost:cost, materials:materials, gain:gain };
  }

  /* ---------- fusion (R-2; SYS-4 still awaits confirm — implemented to spec, flagged) ---------- */
  var FUSION_COST = { 1:95, 2:195, 3:395, 4:795, 5:1495 };
  var RARITY_ORDER = ['common','uncommon','rare','epic','legendary','mythic'];
  function fuse(items, ledgers, opts) {
    opts = opts || {};
    if (!items || items.length !== 3) return { ok:false, reason:'Fusion needs exactly 3 items.' };
    var t0 = items[0].tier, r0 = items[0].rarity;
    var same = items.every(function (it) { return it.tier === t0 && it.rarity === r0; });
    if (!same) return { ok:false, reason:'Fusion needs 3 items of the same tier and same rarity.' };
    if (r0 === 'mythic') return { ok:false, reason:'Mythic is never obtainable via fusion.' };
    var cost = FUSION_COST[t0] || 95;
    if (opts.confirm !== true) return { ok:false, needsConfirm:true, cost:cost, reason:'Confirm fusion: 3 input items + farmed gold cost shown before confirm.' };
    var spent = spendFarmed(ledgers, cost, { confirm:true });
    if (!spent.ok) return spent;
    var nextRarity = RARITY_ORDER[RARITY_ORDER.indexOf(r0) + 1];
    return { ok:true, resultTier: t0, resultRarity: nextRarity, cost:cost, consumed: items.map(function (i) { return i.id; }), flag:'SYS-4: fusion awaits Adrian confirm — implemented to spec.' };
  }

  /* ---------- salvage (R-4) / sell (R-5) / vendor (R-3) ---------- */
  var SALVAGE = {
    1: { common:1, uncommon:2, rare:3, epic:5, legendary:8, mythic:12 },
    2: { common:2, uncommon:3, rare:5, epic:8, legendary:13, mythic:20 },
    3: { common:3, uncommon:5, rare:8, epic:13, legendary:21, mythic:32 },
    4: { common:5, uncommon:8, rare:13, epic:21, legendary:34, mythic:52 },
    5: { common:8, uncommon:13, rare:21, epic:34, legendary:55, mythic:85 }
  };
  var SELL_BASE = { 1:5, 2:15, 3:40, 4:100, 5:250 };
  var SELL_MULT = { common:1.0, uncommon:1.5, rare:2.5, epic:4.0, legendary:7.0, mythic:12.0 };
  function salvageYield(item) {
    var base = (SALVAGE[item.tier] || {})[item.rarity] || 0;
    var amount = item.kind === 'trinket' ? Math.max(1, Math.floor(base / 2)) : base;
    var tag = item.tag || item.factionTag || 'tech';
    if (tag === 'hybrid' || tag === 'purple') {
      /* 50/50 split; odd remainder goes to Tech Cores. */
      var tech = Math.ceil(amount / 2), magic = Math.floor(amount / 2);
      return { tech:tech, magic:magic, total:amount };
    }
    if (tag === 'magic' || tag === 'blue') return { tech:0, magic:amount, total:amount };
    return { tech:amount, magic:0, total:amount };
  }
  function salvageItem(item, materials) {
    var y = salvageYield(item);
    materials.tech = (materials.tech || 0) + y.tech;
    materials.magic = (materials.magic || 0) + y.magic;
    return { ok:true, yield:y, materials:materials, note:'Materials are account-bound.' };
  }
  function sellValue(item) {
    return Math.round((SELL_BASE[item.tier] || 0) * (SELL_MULT[item.rarity] || 0));
  }
  function sellItem(item, ledgers) {
    var v = sellValue(item);
    addFarmed(ledgers, v);
    return { ok:true, gold:v, ledger:'gold_farmed', note:'Sale proceeds credit as farmed gold.' };
  }
  var VENDOR = { buyPerCore:25, sellPerCore:3 };
  function vendorBuyCores(ledgers, count, opts) {
    opts = opts || {};
    /* Phase 4 FIX-P4-02: reject non-positive / non-finite counts (a negative
       count previously produced a negative cost, i.e. gold creation). */
    if (typeof count !== 'number' || !isFinite(count) || count <= 0) return { ok:false, reason:'Invalid core count.' };
    var cost = count * VENDOR.buyPerCore;
    if (opts.confirm !== true) return { ok:false, needsConfirm:true, cost:cost, reason:'Confirm before spending gold.' };
    var spent = spendFarmed(ledgers, cost, { confirm:true });
    if (!spent.ok) return spent;
    return { ok:true, cores:count, cost:cost, ledger:'gold_farmed' };
  }
  function vendorSellCores(materials, count, ledgers, kind) {
    kind = kind || 'tech';
    /* Phase 4 FIX-P4-02: reject non-positive / non-finite counts (a negative
       count previously ADDED cores to materials and moved gold backwards). */
    if (typeof count !== 'number' || !isFinite(count) || count <= 0) return { ok:false, reason:'Invalid core count.' };
    if ((materials[kind] || 0) < count) return { ok:false, reason:'Not enough cores.' };
    materials[kind] -= count;
    addFarmed(ledgers, count * VENDOR.sellPerCore);
    return { ok:true, gold: count * VENDOR.sellPerCore, ledger:'gold_farmed', materials:materials };
  }
  /* Item-preservation rules for trades (data model only — NO marketplace
     UI/settlement is built; marketplace is BLOCKED by B2-4 + compliance). */
  function tradePreservation(item) {
    return {
      keepsUpgradeLevel:true, keepsTraits:true, keepsSecondaries:true,
      keepsRarity:true, keepsTier:true, keepsTag:true,
      materialsTradeable:false, note:'Materials are account-bound. No settlement is implemented.'
    };
  }

  /* ---------- run gold + checkpoint shop (R-7) ---------- */
  /* Phase 4 rec-fix (BUG-P4-06): reroll REMOVED — it deducted 90 run gold
     and applied no effect. No reroll is sold; no reroll mechanic invented.
     Totem / healing / aegis prices unchanged. */
  var SHOP = {
    totem: { price:55, label:'Totem charge' },
    healingTotem: { price:70, label:'Healing Totem charge' },
    aegis: { price:65, label:'Aegis Shield pickup' }
  };
  function buyShopItem(run, key) {
    /* Phase 4 rec-fix (BUG-P4-06): explicit refusal so a stale 'reroll'
       call can never deduct gold (SHOP no longer lists it either). */
    if (key === 'reroll') return { ok:false, reason:'Loadout re-roll is no longer sold.' };
    var item = SHOP[key];
    if (!item) return { ok:false, reason:'Unknown shop item.' };
    if ((run.runGold || 0) < item.price) return { ok:false, reason:'Need ' + item.price + ' run gold — you have ' + (run.runGold || 0) + '.' };
    run.runGold -= item.price;
    return { ok:true, item:key, price:item.price, runGoldLeft: run.runGold, note:'Run-gold only. Run gold evaporates at run end.' };
  }
  var CLEAR_BONUS = { 1:55, 2:105, 3:185, 4:310 };

  /* ---------- quests + streak (R-8) ---------- */
  var QUEST_POOL = [
    { id:'clear3', label:'Clear 3 dungeons' },
    { id:'clear_t2', label:'Clear 1 dungeon of Tier 2+' },
    { id:'salvage5', label:'Salvage 5 items' },
    { id:'totems2', label:'Deploy 2 totems' },
    { id:'shrine1', label:'Channel a shrine' },
    { id:'draft3', label:'Draft 3 loadouts' },
    { id:'elite1', label:'Kill 1 Elite' },
    { id:'vault1', label:'Open 1 Treasure Vault' },
    { id:'clear_nowipe', label:'Clear a dungeon without wiping' },
    { id:'buffs3', label:'Pick up 3 jungle buffs' }
  ];
  function dailyQuests(daySeed) {
    /* 3/day, seeded per account per day. Base golds are 120 + 90 + 110 = 320
       (Economy 8), assigned to the three drawn quests in order. */
    var seed = 0;
    for (var i = 0; i < String(daySeed).length; i++) seed = (seed * 31 + String(daySeed).charCodeAt(i)) >>> 0;
    var idx = seed % QUEST_POOL.length;
    var golds = [120, 90, 110];
    var out = [];
    for (var k = 0; k < 3; k++) {
      var q = QUEST_POOL[(idx + k * 3) % QUEST_POOL.length];
      out.push({ id:q.id, label:q.label, baseGold: golds[k], claimed:false });
    }
    return out;
  }
  function streakMultiplier(streakDay) {
    var day = Math.max(1, streakDay || 1);
    return Math.min(1.30, 1.00 + 0.05 * (day - 1)); /* Cap Day 7. */
  }
  function streakFor(lastDateUTC, todayUTC, hadActivityYesterday) {
    /* UTC calendar day. Miss a day -> reset. */
    if (!lastDateUTC) return { day:1, reset:false };
    var last = new Date(lastDateUTC + 'T00:00:00Z');
    var today = new Date(todayUTC + 'T00:00:00Z');
    var diffDays = Math.round((today - last) / 86400000);
    if (diffDays === 0) return { day:null, reset:false, hold:true };
    if (diffDays === 1 && hadActivityYesterday) return { day:null, reset:false, increment:true };
    return { day:1, reset:true };
  }
  function claimQuest(quest, streakDay, ledgers) {
    if (quest.claimed) return { ok:false, reason:'Already claimed.' };
    var gold = Math.round(quest.baseGold * streakMultiplier(streakDay));
    quest.claimed = true;
    addFarmed(ledgers, gold);
    return { ok:true, gold:gold, ledger:'gold_farmed' };
  }

  /* ---------- idle earnings ---------- */
  var IDLE_RATES = { 1:12, 2:18, 3:26, 4:38 };
  function idleEarnings(highestTierCleared, idleHours, streakDay, crewMajorityFaction) {
    var hours = Math.min(12, Math.max(0, idleHours || 0)); /* 12h cap. */
    var rate = IDLE_RATES[highestTierCleared] || 12;
    var gold = Math.round(rate * hours * streakMultiplier(streakDay));
    var cores = Math.min(4, Math.floor(hours / 3)); /* +1 core per 3h, max 4. */
    return { gold:gold, cores:cores, coreFaction: crewMajorityFaction || 'red', hours: Math.round(hours * 10) / 10, capped: (idleHours || 0) > 12 };
  }

  /* ---------- seasons ---------- */
  function seasonReset(state) {
    /* Upgrades above +10 reset to +10 (ECON-L3 flagged, open). Everything
       else persists: gold, materials, collection, crew, guild membership. */
    var resetItems = [];
    (state.items || []).forEach(function (it) {
      if ((it.upgrade || 0) > 10) { resetItems.push({ id: it.id, from: it.upgrade, to:10 }); it.upgrade = 10; }
    });
    return { resetItems:resetItems, leaderboardsWiped:true, flag:'ECON-L3: season reset rule flagged open.' };
  }
  var PLACEMENT = [ { rank:1, gold:2000 }, { min:2, max:10, gold:1000 }, { min:11, max:100, gold:450 }, { min:101, max:1000, gold:200 } ];
  function placementReward(rank) {
    for (var i = 0; i < PLACEMENT.length; i++) {
      var p = PLACEMENT[i];
      if (p.rank === rank) return p.gold;
      if (p.min && rank >= p.min && rank <= p.max) return p.gold;
    }
    return 0;
  }

  /* ---------- battle pass ---------- */
  var PASS = { tiers:40, xpPerTier:450, xp:{ quest:100, clear:64, guildClear:94, tournamentEntry:280 } };
  function passFreeTrack() {
    var rewards = [];
    for (var t = 1; t <= 40; t++) {
      var r = { tier:t, gold: 15 + t, cores: 0, cosmetic: false };
      if (t % 5 === 0) r.cores = 2;
      if (t === 40) r.cosmetic = true;
      rewards.push(r);
    }
    return rewards;
  }
  function passFreeTotal() {
    var total = passFreeTrack().reduce(function (acc, r) { return { gold: acc.gold + r.gold, cores: acc.cores + r.cores }; }, { gold:0, cores:0 });
    return total; /* Gold total is 1420; cores total is 16. */
  }
  function passTierForXp(xp) { return Math.min(40, Math.floor((xp || 0) / PASS.xpPerTier)); }
  /* Premium track: rewards DATA ONLY (cosmetics + convenience). No gold, no
     materials, no power items, no XP boosts. Purchase flow is stubbed. */
  function passPremiumTrack() {
    var rewards = [];
    for (var t = 1; t <= 40; t++) {
      var r = { tier:t, cosmetic:null, convenience:null };
      if (t === 8 || t === 16 || t === 24 || t === 32 || t === 40) r.cosmetic = 'Exclusive skin (tier ' + t + ')';
      if (t % 10 === 0) r.cosmetic = (r.cosmetic ? r.cosmetic + ' + ' : '') + 'Emote / nameplate / profile frame';
      if (t === 20) r.convenience = 'Extra stash tab (storage)';
      rewards.push(r);
    }
    return rewards;
  }
  function passClaim(state, tier, premium) {
    /* PREMIUM track: UI + rewards data ONLY. Purchase flow is STUBBED and
       disabled, labeled pending Play account + server verification. NO checkout. */
    if (tier < 1 || tier > 40) return { ok:false, reason:'Unknown pass tier.' };
    if (state.claimedTiers && state.claimedTiers.indexOf(tier) >= 0) return { ok:false, reason:'Already claimed.' };
    var free = passFreeTrack()[tier - 1];
    if (!premium) {
      return { ok:true, track:'free', reward:free };
    }
    return { ok:false, track:'premium', reason:'Premium — buy to claim', purchaseStubbed:true, note:'Purchase flow stubbed/disabled, pending Play account + server verification. No checkout built.' };
  }

  /* ---------- tournaments (closed-loop, farmed gold only) ---------- */
  var TOURNAMENT = { entry:250, schedule:'Sunday 8pm ET' };
  function tournamentReceipt() {
    return 'Entry: 250 gold. Operations cut: [disclosed at confirm]. Prizes: cosmetic + gold.';
  }
  function enterTournament(ledgers, opts) {
    opts = opts || {};
    /* Confirm BEFORE deduction — never silent. */
    if (opts.confirm !== true) {
      return { ok:false, needsConfirm:true, receipt: tournamentReceipt(), reason:'Confirm entry before deduction.' };
    }
    var spent = spendFarmed(ledgers, TOURNAMENT.entry, { confirm:true });
    if (!spent.ok) return spent;
    return { ok:true, entry: TOURNAMENT.entry, ledger:'gold_farmed', receipt: tournamentReceipt(), flag:'Legal opinion (compliance 2.4) is a BLOCKER for shipping tournaments — mechanics implemented, compliance not claimed.' };
  }
  function tournamentScore(run) {
    /* Deterministic scoring: no dice, no chance-based outcomes. */
    var coverage = run.factionCount >= 3 ? 500 : run.factionCount === 2 ? 250 : 0;
    return (run.clears || 0) * 1000 + Math.floor((run.damage || 0) / 10) + (run.bosses || 0) * 500 - (run.wipes || 0) * 250 + coverage;
  }
  function tournamentPrizePool(entries, operationsCutFraction) {
    var gross = (entries || 0) * TOURNAMENT.entry;
    if (operationsCutFraction === undefined || operationsCutFraction === null) {
      /* Cut amount is NOT stated as a number anywhere player-facing, and no
         unconfirmed figure is encoded as a default. */
      return { gross:gross, cut:null, net:null, cutDisclosed:false, note:'Operations cut disclosed at confirm.' };
    }
    var cut = gross * operationsCutFraction;
    return { gross:gross, cut:cut, net: gross - cut, cutDisclosed:true };
  }
  function tournamentPrizes(poolNet, entrantCount) {
    /* Distribution shares of the prize pool (net of the operations cut). */
    if (!poolNet) return null;
    var shares = { first:0.35, second:0.22, third:0.13, places4to10:0.20, places11to25:0.10 };
    return {
      first: Math.round(poolNet * shares.first),
      second: Math.round(poolNet * shares.second),
      third: Math.round(poolNet * shares.third),
      places4to10Each: entrantCount >= 4 ? Math.round(poolNet * shares.places4to10 / Math.min(7, Math.max(0, entrantCount - 3))) : 0,
      places11to25Each: entrantCount >= 11 ? Math.round(poolNet * shares.places11to25 / Math.min(15, Math.max(0, entrantCount - 10))) : 0,
      cosmetics: 'Top 3 receive an exclusive season cosmetic (direct, non-random).'
    };
  }
  function tournamentTieBreak(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (a.wipes !== b.wipes) return a.wipes - b.wipes;
    return (a.lastClearAt || 0) - (b.lastClearAt || 0); /* Earlier final clear wins. */
  }

  /* ---------- guilds (local-only shell) ---------- */
  function createGuildShell(input) {
    /* Creation copy VERBATIM. No price, no currency, no real-money figure. */
    return {
      ok:false, stub:true,
      foundingCopy: 'Founding cost: shown before you confirm. Founding grants no power.',
      note:'Guild founding price/currency NOT decided (B3-GUILD open). No price is set here.',
      maxMembers:20, freeDungeonEntriesPerMemberPerDay:1
    };
  }
  function leaveGuild(guild, opts) {
    opts = opts || {};
    if (opts.confirm !== true) return { ok:false, needsConfirm:true, reason:'Leaving forfeits guild-dungeon progress. Confirm to leave.' };
    return { ok:true, forfeitsProgress:true, note:'Server features (chat/persistence/matchmaking) are NOT built.' };
  }
  function guildDungeonEntry(guild, memberId, entriesToday) {
    /* Guild dungeons: free entry, 1 per member per day. */
    if ((entriesToday || 0) >= 1) return { ok:false, reason:'Guild dungeon entry already used today.' };
    return { ok:true, energyCost:0, note:'Guild dungeon entry is free.' };
  }

  var OPEN_ITEMS = [
    'SYS-1 / ECON-L4: energy refill — NOT designed until B2-3 resolves.',
    'SYS-4: fusion awaits Adrian confirm — implemented to spec, flagged.',
    'ECON-L3: season reset (upgrades above +10 to +10) — flagged.',
    'B3-GUILD: guild founding price/currency — NOT decided; no price in copy.',
    'LV-L4: retry cost — retry = new run, full energy cost (flagged).',
    'LV-L5: MVP bonus shape — flagged.',
    'NAR-2/NAR-3: operations-cut / marketplace-fee figures unconfirmed — never in player-facing copy.',
    'Compliance 2.4 legal opinion is a BLOCKER for shipping tournaments.',
    'B2-1/B2-2: premium purchase flow stubbed — pending Play account + server verification.',
    'B2-3: bought gold buys cosmetics only — strict gate stands.',
    'B2-4: gold assumed account-bound closed-loop; no transfers built.'
  ];
  var BLOCKED = [
    'Marketplace UI/settlement (B2-4 + compliance 2.3c) — item-preservation rules in the data model only.',
    'Purchasable power; paid energy refill; Play Billing checkout.',
    'Server/co-op networking; accounts/cloud save; external sending.',
    'Gold transfers / gifting / cash-out; bought-gold entry to tournaments/guilds/raids/fusion/marketplace.'
  ];

  G = {
    version: 'phase3-economy-1.0.0',
    createLedgers: createLedgers, totalGold: totalGold, addFarmed: addFarmed,
    spendFarmed: spendFarmed, gateCheck: gateCheck,
    ENERGY: ENERGY, energyState: energyState, enterDungeon: enterDungeon, refillInfo: refillInfo,
    UPGRADE_TRACK: UPGRADE_TRACK, upgradeStep: upgradeStep, upgradeGain: upgradeGain,
    materialCostFor: materialCostFor, expectedMaterialsToMax: expectedMaterialsToMax,
    attemptUpgrade: attemptUpgrade,
    FUSION_COST: FUSION_COST, fuse: fuse,
    SALVAGE: SALVAGE, SELL_BASE: SELL_BASE, SELL_MULT: SELL_MULT,
    salvageYield: salvageYield, salvageItem: salvageItem, sellValue: sellValue, sellItem: sellItem,
    VENDOR: VENDOR, vendorBuyCores: vendorBuyCores, vendorSellCores: vendorSellCores,
    tradePreservation: tradePreservation,
    SHOP: SHOP, buyShopItem: buyShopItem, CLEAR_BONUS: CLEAR_BONUS,
    QUEST_POOL: QUEST_POOL, dailyQuests: dailyQuests, streakMultiplier: streakMultiplier,
    streakFor: streakFor, claimQuest: claimQuest,
    IDLE_RATES: IDLE_RATES, idleEarnings: idleEarnings,
    seasonReset: seasonReset, placementReward: placementReward,
    PASS: PASS, passFreeTrack: passFreeTrack, passFreeTotal: passFreeTotal,
    passPremiumTrack: passPremiumTrack,
    passTierForXp: passTierForXp, passClaim: passClaim,
    TOURNAMENT: TOURNAMENT, tournamentReceipt: tournamentReceipt,
    enterTournament: enterTournament, tournamentScore: tournamentScore,
    tournamentPrizePool: tournamentPrizePool, tournamentPrizes: tournamentPrizes,
    tournamentTieBreak: tournamentTieBreak,
    createGuildShell: createGuildShell, leaveGuild: leaveGuild, guildDungeonEntry: guildDungeonEntry,
    OPEN_ITEMS: OPEN_ITEMS, BLOCKED: BLOCKED
  };
  root.GrindchainEconomy = G;
  if (typeof module !== 'undefined' && module.exports) module.exports = G;
})(typeof window !== 'undefined' ? window : globalThis);
