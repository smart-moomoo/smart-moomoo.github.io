// A tiny shared coin wallet used by every mini-game on this site, so
// progress in one (e.g. a Jumping Bird score) contributes spending power
// in another (e.g. Cozy Farm). Stored once, under its own localStorage
// key, independent of any single game's own save data.
window.ArcadeCoins = (() => {
  const KEY = 'arcade-coins-v1';

  function get() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw == null) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed.coins === 'number' && isFinite(parsed.coins) ? parsed.coins : null;
    } catch {
      return null;
    }
  }

  function set(value) {
    try { localStorage.setItem(KEY, JSON.stringify({ coins: Math.max(0, Math.floor(value)) })); } catch {}
  }

  function add(delta) {
    const next = (get() ?? 0) + delta;
    set(next);
    return next;
  }

  // Seeds the wallet only if it has never been created (in any game).
  function ensureInitialized(startingAmount) {
    if (get() === null) set(startingAmount);
  }

  return { get, set, add, ensureInitialized };
})();
