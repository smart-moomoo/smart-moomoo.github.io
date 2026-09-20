// Switches between the two games living on this page without navigating
// away, and tells game.js which one is currently visible (so, e.g., the
// Space key doesn't flap the bird while the Farm tab is showing).
(() => {
  const tabs = [
    { btn: document.getElementById('tab-game'), view: document.getElementById('view-game'), id: 'game' },
    { btn: document.getElementById('tab-farm'), view: document.getElementById('view-farm'), id: 'farm' },
  ];
  if (!tabs[0].btn || !tabs[1].btn) return;

  function activate(id) {
    for (const t of tabs) {
      const active = t.id === id;
      t.view.hidden = !active;
      t.btn.setAttribute('aria-selected', String(active));
      t.btn.classList.toggle('is-active', active);
    }
    window.PlayActiveView = id;
    try { localStorage.setItem('play-active-view', id); } catch {}
  }

  tabs.forEach((t) => t.btn.addEventListener('click', () => activate(t.id)));

  const queryView = new URLSearchParams(window.location.search).get('view');
  let initial = queryView === 'game' || queryView === 'farm' ? queryView : null;
  if (!initial) {
    try { initial = localStorage.getItem('play-active-view'); } catch {}
  }
  activate(initial === 'game' || initial === 'farm' ? initial : 'game');
})();
