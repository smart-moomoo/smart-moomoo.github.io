// Switches between the games on this page without navigating away, and
// exposes the visible one as window.PlayActiveView so each game can ignore
// input and pause its clock while hidden.
(() => {
  const tabs = ['game', 'farm', 'mmti']
    .map((id) => ({ id, btn: document.getElementById(`tab-${id}`), view: document.getElementById(`view-${id}`) }))
    .filter((t) => t.btn && t.view);
  if (!tabs.length) return;
  const ids = tabs.map((t) => t.id);

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

  let initial = new URLSearchParams(window.location.search).get('view');
  if (!ids.includes(initial)) {
    try { initial = localStorage.getItem('play-active-view'); } catch {}
  }
  activate(ids.includes(initial) ? initial : ids[0]);
})();
