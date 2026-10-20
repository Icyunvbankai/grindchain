/* GRINDCHAIN — Phase 3 analytics (GAP-32). LOCAL ONLY.
   Events live in localStorage under their own key, capped at 500 entries
   (oldest dropped). Nothing is ever sent anywhere: this file performs no
   network activity of any kind. export() returns JSON for the user to
   inspect manually — that is the only way data leaves the store, and only
   when the user asks for it.

   Privacy: NEVER logged — names, wallet addresses, device IDs, IP,
   location, or any identifier. No wall-clock timestamps (which could be
   joined to identity); each event carries only session-scoped counters:
   seq (monotonic per stored log) and t (ms since this page session
   started). Props are allowlist-sanitized: denylisted keys dropped,
   values coerced to short primitives, wallet/email-shaped strings scrubbed.

   Crash capture: window.onerror + unhandledrejection log an 'error' event
   (message + truncated stack, scrubbed). Installs once via init(). */
'use strict';
const Analytics = (() => {
  const KEY = 'grindchain.analytics.v1';
  const MAX = 500;
  const VERSION = 'phase3-analytics-1.0.0';
  const sessionStart = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : 0;
  let mem = []; // in-memory mirror; used when storage is denied
  let seq = 0;
  let installed = false;

  const ALLOWED = new Set([
    'session_start', 'run_start', 'run_end', 'boss_phase', 'shield_break',
    'draft_pick', 'shop_buy', 'draft_reroll', 'upgrade_attempt', 'fusion', 'salvage', 'sell',
    'quest_claim', 'streak_day', 'idle_collect', 'tournament_entry',
    'tournament_result', 'settings_change', 'error',
    'tutorial_start', 'tutorial_step', 'tutorial_complete',
  ]);
  // Keys that must never enter the log (identifiers / PII surface).
  const DENIED_KEY = /(name|wallet|address|device|ip|location|email|phone|user|account|token|secret|password|seed|mnemonic|private|gps|lat|lon|coord|fingerprint|serial|imei|mac|id$|_id$)/i;
  const SCRUB_VALUE = /(0x[a-fA-F0-9]{4,})|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

  function now() {
    // Relative ms since session start — never a wall-clock timestamp.
    try {
      if (typeof performance !== 'undefined' && performance.now) {
        return Math.max(0, Math.round(performance.now() - sessionStart));
      }
    } catch (e) {}
    return 0;
  }
  function readStore() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return mem;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) { mem = parsed; return mem; }
      return mem;
    } catch (e) { return mem; }
  }
  function writeStore(list) {
    mem = list;
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* denied -> memory only */ }
  }
  function sanitizeProps(props) {
    if (!props || typeof props !== 'object') return {};
    const out = {};
    for (const k of Object.keys(props)) {
      if (typeof k !== 'string' || k.length > 40 || DENIED_KEY.test(k)) continue;
      let v = props[k];
      if (typeof v === 'number') {
        if (isFinite(v)) out[k] = Math.round(v * 1000) / 1000;
      } else if (typeof v === 'boolean') {
        out[k] = v;
      } else if (typeof v === 'string') {
        v = v.replace(SCRUB_VALUE, '[redacted]').slice(0, 200);
        out[k] = v;
      } else if (v === null || v === undefined) {
        out[k] = null;
      } else {
        try { out[k] = String(v).replace(SCRUB_VALUE, '[redacted]').slice(0, 200); }
        catch (e) { out[k] = '[unserializable]'; }
      }
    }
    // Hard cap on serialized props so one event can never bloat the store.
    try {
      const s = JSON.stringify(out);
      if (s.length > 500) {
        const trimmed = {};
        for (const k of Object.keys(out)) { trimmed[k] = out[k]; if (JSON.stringify(trimmed).length > 500) { delete trimmed[k]; break; } }
        return trimmed;
      }
    } catch (e) { return {}; }
    return out;
  }
  function event(name, props) {
    try {
      if (typeof name !== 'string' || !name) return false;
      const clean = name.slice(0, 40);
      const finalName = ALLOWED.has(clean) ? clean : 'custom';
      const finalProps = sanitizeProps(props);
      if (finalName === 'custom') finalProps.original = clean;
      const list = readStore();
      seq = Math.max(seq, list.length ? (list[list.length - 1].seq || 0) : 0) + 1;
      list.push({ seq, t: now(), n: finalName, p: finalProps });
      while (list.length > MAX) list.shift(); // oldest dropped
      writeStore(list);
      return true;
    } catch (e) { return false; }
  }
  function errors() {
    try { return readStore().filter((e) => e && e.n === 'error').map((e) => ({ ...e, p: { ...e.p } })); }
    catch (e) { return []; }
  }
  function exportLog() {
    const list = readStore();
    return JSON.stringify({ version: 1, count: list.length, events: list });
  }
  function funnel() {
    const list = readStore();
    const has = (n, pred) => list.some((e) => e.n === n && (!pred || pred(e)));
    const firstRun = list.filter((e) => e.n === 'run_start').length;
    const firstBoss = list.filter((e) => e.n === 'boss_phase').length;
    const firstClear = list.filter((e) => e.n === 'run_end' && e.p && e.p.won === true).length;
    const tutStarted = has('tutorial_start') ? 1 : 0;
    const tutDone = has('tutorial_complete') ? 1 : 0;
    const rate = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);
    return {
      tutorial_started: tutStarted,
      tutorial_completed: tutDone,
      tutorial_completion_rate: rate(tutDone, tutStarted),
      first_run: firstRun,
      first_boss: firstBoss,
      first_clear: firstClear,
      run_to_boss_rate: rate(firstBoss > 0 ? 1 : 0, firstRun > 0 ? 1 : 0),
      run_to_clear_rate: rate(firstClear > 0 ? 1 : 0, firstRun > 0 ? 1 : 0),
    };
  }
  function onErrorHandler(message, source, line, col, errObj) {
    event('error', {
      message: String(message || 'unknown error').slice(0, 200),
      source: String(source || '').slice(0, 200),
      line: typeof line === 'number' ? line : null,
      col: typeof col === 'number' ? col : null,
      stack: (errObj && errObj.stack ? String(errObj.stack) : '').replace(SCRUB_VALUE, '[redacted]').slice(0, 1000),
    });
    return false; // do not swallow: let the default handler run too
  }
  function onRejectionHandler(ev) {
    const r = ev && ev.reason;
    const msg = r instanceof Error ? r.message : String(r == null ? 'unhandled rejection' : r);
    event('error', {
      message: String(msg).slice(0, 200),
      source: 'unhandledrejection',
      stack: (r instanceof Error && r.stack ? String(r.stack) : '').replace(SCRUB_VALUE, '[redacted]').slice(0, 1000),
    });
  }
  function init() {
    if (installed) return true;
    installed = true;
    try {
      if (typeof window !== 'undefined') {
        window.addEventListener('error', (e) => {
          onErrorHandler(e.message, e.filename, e.lineno, e.colno, e.error);
        });
        window.addEventListener('unhandledrejection', onRejectionHandler);
      }
    } catch (e) { /* crash capture is best-effort */ }
    event('session_start', { version: 1 });
    return true;
  }
  function clear() { writeStore([]); seq = 0; return true; }
  function count() { return readStore().length; }

  return { event, errors, export: exportLog, funnel, init, clear, count,
    KEY, MAX, VERSION, _test: { sanitizeProps, onErrorHandler, onRejectionHandler } };
})();
if (typeof window !== 'undefined') window.Analytics = Analytics;
