// Cozy Farm: a no-fail, idle-friendly garden + pen sim. Plants grow and
// animals produce on real elapsed time, so progress continues even when
// the tab is closed. State persists per-browser via localStorage, the
// same approach used for the jumping-bird game's best score.
(() => {
  const coinsEl = document.getElementById('farm-coins');
  if (!coinsEl) return;
  const harvestCountEl = document.getElementById('farm-harvest-count');
  const gardenGrid = document.getElementById('garden-grid');
  const penGrid = document.getElementById('pen-grid');
  const tray = document.getElementById('farm-tray');
  const trayTitle = document.getElementById('farm-tray-title');
  const trayOptions = document.getElementById('farm-tray-options');
  const trayClose = document.getElementById('farm-tray-close');
  const resetBtn = document.getElementById('farm-reset');

  const STORAGE_KEY = 'cozy-farm-state-v1';

  const PLANTS = {
    carrot: { name: 'Carrot', emoji: '🥕', cost: 5, grow: 20, sell: 10 },
    tomato: { name: 'Tomato', emoji: '🍅', cost: 15, grow: 50, sell: 35 },
    sunflower: { name: 'Sunflower', emoji: '🌻', cost: 35, grow: 120, sell: 95 },
    pumpkin: { name: 'Pumpkin', emoji: '🎃', cost: 70, grow: 240, sell: 220 },
  };
  const PLANT_ORDER = ['carrot', 'tomato', 'sunflower', 'pumpkin'];

  const ANIMALS = {
    chicken: { name: 'Chicken', emoji: '🐔', product: '🥚', cost: 40, cycle: 45, value: 9 },
    rabbit: { name: 'Rabbit', emoji: '🐇', product: '🍀', cost: 90, cycle: 90, value: 22 },
    sheep: { name: 'Sheep', emoji: '🐑', product: '🧶', cost: 200, cycle: 180, value: 55 },
    cow: { name: 'Cow', emoji: '🐄', product: '🥛', cost: 420, cycle: 320, value: 130 },
  };
  const ANIMAL_ORDER = ['chicken', 'rabbit', 'sheep', 'cow'];

  const PLOT_COUNT = 9;
  const PLOT_UNLOCKED_START = 4;
  const PLOT_UNLOCK_COSTS = [40, 70, 110, 160, 220]; // plots 5..9

  const PEN_COUNT = 6;
  const PEN_UNLOCKED_START = 2;
  const PEN_UNLOCK_COSTS = [60, 120, 220, 380]; // pens 3..6

  function defaultState() {
    return {
      totalHarvested: 0,
      totalCollected: 0,
      plots: Array.from({ length: PLOT_COUNT }, (_, i) => ({
        unlocked: i < PLOT_UNLOCKED_START,
        plantId: null,
        plantedAt: null,
      })),
      pens: Array.from({ length: PEN_COUNT }, (_, i) => ({
        unlocked: i < PEN_UNLOCKED_START,
        animalId: null,
        lastCollectedAt: null,
      })),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.plots) || !Array.isArray(parsed.pens)) return defaultState();
      if (parsed.plots.length !== PLOT_COUNT || parsed.pens.length !== PEN_COUNT) return defaultState();
      return parsed;
    } catch {
      return defaultState();
    }
  }

  let state = load();

  // Coins live in the shared cross-game wallet (arcade.js), not in this
  // page's own save file, so a Jumping Bird score and a farm harvest both
  // spend from the same balance. The first game ever opened on this site
  // seeds the wallet; if this browser already has old farm-only coins
  // saved from before that change, carry them over once instead of
  // resetting progress to the default starting amount.
  const STARTING_COINS = 20;
  if (window.ArcadeCoins && ArcadeCoins.get() === null) {
    let legacyRaw = null;
    try { legacyRaw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch {}
    const legacyCoins = legacyRaw && typeof legacyRaw.coins === 'number' ? legacyRaw.coins : null;
    ArcadeCoins.set(legacyCoins != null ? legacyCoins : STARTING_COINS);
  }
  function coins() { return window.ArcadeCoins ? (ArcadeCoins.get() ?? 0) : 0; }
  function spend(amount) { if (window.ArcadeCoins) ArcadeCoins.add(-amount); }
  function earn(amount) { if (window.ArcadeCoins) ArcadeCoins.add(amount); }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  function formatSeconds(s) {
    s = Math.max(0, Math.ceil(s));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), r = s % 60;
    return `${m}m ${r}s`;
  }

  let pickerTarget = null; // { kind: 'plot' | 'pen', index }

  function closeTray() {
    pickerTarget = null;
  }

  function openTray(kind, index) {
    pickerTarget = { kind, index };
    render();
  }

  function unlockPlot(index, cost) {
    if (cost == null || coins() < cost) return;
    spend(cost);
    state.plots[index].unlocked = true;
    save();
    render();
  }

  function unlockPen(index, cost) {
    if (cost == null || coins() < cost) return;
    spend(cost);
    state.pens[index].unlocked = true;
    save();
    render();
  }

  function plantSeed(index, plantId) {
    const plant = PLANTS[plantId];
    if (coins() < plant.cost) return;
    spend(plant.cost);
    state.plots[index].plantId = plantId;
    state.plots[index].plantedAt = Date.now();
    closeTray();
    save();
    render();
  }

  function harvestPlot(index) {
    const plot = state.plots[index];
    if (!plot.plantId) return;
    const plant = PLANTS[plot.plantId];
    const elapsed = (Date.now() - plot.plantedAt) / 1000;
    if (elapsed < plant.grow) return;
    earn(plant.sell);
    state.totalHarvested += 1;
    plot.plantId = null;
    plot.plantedAt = null;
    save();
    render();
  }

  function buyAnimal(index, animalId) {
    const animal = ANIMALS[animalId];
    if (coins() < animal.cost) return;
    spend(animal.cost);
    state.pens[index].animalId = animalId;
    state.pens[index].lastCollectedAt = Date.now();
    closeTray();
    save();
    render();
  }

  function collectPen(index) {
    const pen = state.pens[index];
    if (!pen.animalId) return;
    const animal = ANIMALS[pen.animalId];
    const elapsed = (Date.now() - pen.lastCollectedAt) / 1000;
    if (elapsed < animal.cycle) return;
    earn(animal.value);
    state.totalCollected += 1;
    pen.lastCollectedAt = Date.now();
    save();
    render();
  }

  function renderGarden() {
    gardenGrid.innerHTML = '';
    state.plots.forEach((plot, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'farm-cell';
      btn.setAttribute('role', 'listitem');

      if (!plot.unlocked) {
        const cost = PLOT_UNLOCK_COSTS[index - PLOT_UNLOCKED_START] ?? null;
        btn.classList.add('is-locked');
        btn.disabled = cost == null || coins() < cost;
        btn.innerHTML = `<span class="farm-cell-emoji">🔒</span><span class="farm-cell-label">Unlock · ${cost} 🪙</span>`;
        btn.setAttribute('aria-label', `Locked plot. Unlock for ${cost} coins.`);
        btn.addEventListener('click', () => unlockPlot(index, cost));
      } else if (!plot.plantId) {
        btn.classList.add('is-empty');
        btn.innerHTML = `<span class="farm-cell-emoji">➕</span><span class="farm-cell-label">Plant</span>`;
        btn.setAttribute('aria-label', 'Empty plot. Tap to choose a seed to plant.');
        btn.addEventListener('click', () => openTray('plot', index));
      } else {
        const plant = PLANTS[plot.plantId];
        const elapsed = (Date.now() - plot.plantedAt) / 1000;
        const ready = elapsed >= plant.grow;
        if (ready) {
          btn.classList.add('is-ready');
          btn.innerHTML = `<span class="farm-cell-emoji">${plant.emoji}</span><span class="farm-cell-label">Harvest +${plant.sell} 🪙</span>`;
          btn.setAttribute('aria-label', `${plant.name} ready to harvest for ${plant.sell} coins.`);
          btn.addEventListener('click', () => harvestPlot(index));
        } else {
          const pct = Math.min(100, (elapsed / plant.grow) * 100);
          btn.disabled = true;
          btn.innerHTML = `<span class="farm-cell-emoji" style="opacity:.55">${plant.emoji}</span><span class="farm-cell-label">${formatSeconds(plant.grow - elapsed)}</span><span class="farm-cell-bar"><span style="width:${pct}%"></span></span>`;
          btn.setAttribute('aria-label', `${plant.name} growing, ${formatSeconds(plant.grow - elapsed)} left.`);
        }
      }
      gardenGrid.appendChild(btn);
    });
  }

  function renderPen() {
    penGrid.innerHTML = '';
    state.pens.forEach((pen, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'farm-cell';
      btn.setAttribute('role', 'listitem');

      if (!pen.unlocked) {
        const cost = PEN_UNLOCK_COSTS[index - PEN_UNLOCKED_START] ?? null;
        btn.classList.add('is-locked');
        btn.disabled = cost == null || coins() < cost;
        btn.innerHTML = `<span class="farm-cell-emoji">🔒</span><span class="farm-cell-label">Unlock · ${cost} 🪙</span>`;
        btn.setAttribute('aria-label', `Locked pen. Unlock for ${cost} coins.`);
        btn.addEventListener('click', () => unlockPen(index, cost));
      } else if (!pen.animalId) {
        btn.classList.add('is-empty');
        btn.innerHTML = `<span class="farm-cell-emoji">➕</span><span class="farm-cell-label">Animal</span>`;
        btn.setAttribute('aria-label', 'Empty pen. Tap to bring home an animal.');
        btn.addEventListener('click', () => openTray('pen', index));
      } else {
        const animal = ANIMALS[pen.animalId];
        const elapsed = (Date.now() - pen.lastCollectedAt) / 1000;
        const ready = elapsed >= animal.cycle;
        if (ready) {
          btn.classList.add('is-ready');
          btn.innerHTML = `<span class="farm-cell-emoji">${animal.emoji}</span><span class="farm-cell-label">${animal.product} +${animal.value} 🪙</span>`;
          btn.setAttribute('aria-label', `${animal.name} has ${animal.product} ready. Tap to collect ${animal.value} coins.`);
          btn.addEventListener('click', () => collectPen(index));
        } else {
          const pct = Math.min(100, (elapsed / animal.cycle) * 100);
          btn.disabled = true;
          btn.innerHTML = `<span class="farm-cell-emoji">${animal.emoji}</span><span class="farm-cell-label">${formatSeconds(animal.cycle - elapsed)}</span><span class="farm-cell-bar"><span style="width:${pct}%"></span></span>`;
          btn.setAttribute('aria-label', `${animal.name}, next ${animal.product} in ${formatSeconds(animal.cycle - elapsed)}.`);
        }
      }
      penGrid.appendChild(btn);
    });
  }

  function renderTray() {
    if (!pickerTarget) {
      tray.hidden = true;
      return;
    }
    tray.hidden = false;
    trayOptions.innerHTML = '';

    if (pickerTarget.kind === 'plot') {
      trayTitle.textContent = 'Choose a seed';
      PLANT_ORDER.forEach((id) => {
        const plant = PLANTS[id];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'farm-tray-option';
        btn.disabled = coins() < plant.cost;
        btn.innerHTML = `<span class="farm-tray-option-emoji">${plant.emoji}</span><span class="farm-tray-option-info"><span class="farm-tray-option-name">${plant.name}</span><span class="farm-tray-option-meta">${plant.cost} 🪙 · grows in ${formatSeconds(plant.grow)} · sells for ${plant.sell} 🪙</span></span>`;
        btn.addEventListener('click', () => plantSeed(pickerTarget.index, id));
        trayOptions.appendChild(btn);
      });
    } else {
      trayTitle.textContent = 'Choose an animal';
      ANIMAL_ORDER.forEach((id) => {
        const animal = ANIMALS[id];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'farm-tray-option';
        btn.disabled = coins() < animal.cost;
        btn.innerHTML = `<span class="farm-tray-option-emoji">${animal.emoji}</span><span class="farm-tray-option-info"><span class="farm-tray-option-name">${animal.name}</span><span class="farm-tray-option-meta">${animal.cost} 🪙 · ${animal.product} every ${formatSeconds(animal.cycle)} · worth ${animal.value} 🪙</span></span>`;
        btn.addEventListener('click', () => buyAnimal(pickerTarget.index, id));
        trayOptions.appendChild(btn);
      });
    }
  }

  function render() {
    coinsEl.textContent = String(coins());
    harvestCountEl.textContent = String(state.totalHarvested + state.totalCollected);
    renderGarden();
    renderPen();
    renderTray();
  }

  trayClose.addEventListener('click', () => {
    closeTray();
    render();
  });

  resetBtn.addEventListener('click', () => {
    if (!window.confirm('Reset your farm? This clears your plots, pens, and totals — your shared arcade coins are kept.')) return;
    state = defaultState();
    closeTray();
    save();
    render();
  });

  render();
  setInterval(render, 1000);
})();
