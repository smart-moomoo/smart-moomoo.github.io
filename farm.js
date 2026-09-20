// Cozy Farm: a no-fail, idle-friendly garden + pasture sim. Plants grow
// and animals produce on real elapsed time, so progress continues even
// when the tab is closed. Coins live in the shared arcade wallet
// (arcade.js), so a Jumping Bird score and a farm harvest both spend
// from the same balance.
//
// Rendering note: plot and pen elements are created once and then only
// mutated in place on each tick (never torn down and rebuilt), so CSS
// animations (the sway, the bob, the multi-second glide when an animal
// wanders to a new spot) keep running smoothly instead of restarting
// every render.
(() => {
  const coinsEl = document.getElementById('farm-coins');
  if (!coinsEl) return;
  const harvestCountEl = document.getElementById('farm-harvest-count');
  const gardenScene = document.getElementById('garden-scene');
  const pastureScene = document.getElementById('pasture-scene');
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

  // Fixed, loosely scattered garden-bed spots (percent of scene box).
  const GARDEN_POSITIONS = [
    { left: 12, top: 20 }, { left: 36, top: 14 }, { left: 60, top: 22 }, { left: 85, top: 16 },
    { left: 10, top: 55 }, { left: 34, top: 50 }, { left: 60, top: 58 }, { left: 85, top: 52 },
    { left: 48, top: 84 },
  ];
  // Fixed "gate" spots along the pasture's bottom edge for locked/empty pens.
  const PEN_GATE_POSITIONS = [
    { left: 10, top: 88 }, { left: 27, top: 91 }, { left: 44, top: 87 },
    { left: 61, top: 91 }, { left: 78, top: 87 }, { left: 92, top: 90 },
  ];
  // Once an animal is bought it roams this open area of the field.
  const WANDER_BOUNDS = { minLeft: 8, maxLeft: 92, minTop: 10, maxTop: 72 };

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

  // Coins live in the shared cross-game wallet, not in this page's own
  // save file. The first game ever opened on this site seeds the
  // wallet; if this browser already has old farm-only coins saved from
  // before that change, carry them over once instead of resetting.
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

  function openTray(kind, index) {
    pickerTarget = { kind, index };
    renderTray();
  }
  function closeTray() {
    pickerTarget = null;
    renderTray();
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
    wanderPos[index] = randomWanderTarget(); // walk straight out into the field
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

  // ---- wandering positions (ephemeral, not persisted) ----
  let wanderPos = {};
  function randomWanderTarget() {
    return {
      left: WANDER_BOUNDS.minLeft + Math.random() * (WANDER_BOUNDS.maxLeft - WANDER_BOUNDS.minLeft),
      top: WANDER_BOUNDS.minTop + Math.random() * (WANDER_BOUNDS.maxTop - WANDER_BOUNDS.minTop),
    };
  }
  function setPos(el, pos) {
    el.style.left = pos.left + '%';
    el.style.top = pos.top + '%';
  }
  function retargetWander() {
    let any = false;
    state.pens.forEach((pen, index) => {
      if (pen.unlocked && pen.animalId) {
        wanderPos[index] = randomWanderTarget();
        any = true;
      }
    });
    if (any) updatePasture();
  }

  // ---- persistent DOM: created once, mutated in place afterward ----
  let plotEls = [];
  let penEls = [];

  function initGardenDOM() {
    gardenScene.innerHTML = '';
    plotEls = GARDEN_POSITIONS.map((pos, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'plot';
      btn.style.left = pos.left + '%';
      btn.style.top = pos.top + '%';
      btn.style.setProperty('--i', index);
      btn.setAttribute('role', 'listitem');
      btn.innerHTML = '<span class="plot-emoji"></span><span class="plot-label"></span><span class="plot-bar"><span></span></span>';
      btn.addEventListener('click', () => {
        const plot = state.plots[index];
        if (!plot.unlocked) {
          unlockPlot(index, PLOT_UNLOCK_COSTS[index - PLOT_UNLOCKED_START] ?? null);
        } else if (!plot.plantId) {
          openTray('plot', index);
        } else {
          const plant = PLANTS[plot.plantId];
          if ((Date.now() - plot.plantedAt) / 1000 >= plant.grow) harvestPlot(index);
        }
      });
      gardenScene.appendChild(btn);
      return btn;
    });
  }

  function initPastureDOM() {
    pastureScene.innerHTML = '';
    penEls = PEN_GATE_POSITIONS.map((pos, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pen-slot';
      btn.style.left = pos.left + '%';
      btn.style.top = pos.top + '%';
      btn.setAttribute('role', 'listitem');
      btn.innerHTML = '<span class="pen-slot-emoji"></span><span class="pen-slot-label"></span><span class="pen-slot-bar"><span></span></span>';
      btn.addEventListener('click', () => {
        const pen = state.pens[index];
        if (!pen.unlocked) {
          unlockPen(index, PEN_UNLOCK_COSTS[index - PEN_UNLOCKED_START] ?? null);
        } else if (!pen.animalId) {
          openTray('pen', index);
        } else {
          const animal = ANIMALS[pen.animalId];
          if ((Date.now() - pen.lastCollectedAt) / 1000 >= animal.cycle) collectPen(index);
        }
      });
      pastureScene.appendChild(btn);
      return btn;
    });
  }

  function updateGarden() {
    state.plots.forEach((plot, index) => {
      const btn = plotEls[index];
      const emoji = btn.querySelector('.plot-emoji');
      const label = btn.querySelector('.plot-label');
      const bar = btn.querySelector('.plot-bar');
      const barFill = bar.querySelector('span');

      if (!plot.unlocked) {
        const cost = PLOT_UNLOCK_COSTS[index - PLOT_UNLOCKED_START] ?? null;
        btn.className = 'plot is-locked';
        btn.disabled = cost == null || coins() < cost;
        emoji.textContent = '🔒';
        label.textContent = `${cost} 🪙`;
        bar.style.visibility = 'hidden';
        btn.setAttribute('aria-label', `Locked plot. Unlock for ${cost} coins.`);
      } else if (!plot.plantId) {
        btn.className = 'plot is-empty';
        btn.disabled = false;
        emoji.textContent = '➕';
        label.textContent = 'Plant';
        bar.style.visibility = 'hidden';
        btn.setAttribute('aria-label', 'Empty plot. Tap to choose a seed to plant.');
      } else {
        const plant = PLANTS[plot.plantId];
        const elapsed = (Date.now() - plot.plantedAt) / 1000;
        const ready = elapsed >= plant.grow;
        emoji.textContent = plant.emoji;
        if (ready) {
          btn.className = 'plot is-ready';
          btn.disabled = false;
          label.textContent = `+${plant.sell} 🪙`;
          bar.style.visibility = 'hidden';
          btn.setAttribute('aria-label', `${plant.name} ready to harvest for ${plant.sell} coins.`);
        } else {
          btn.className = 'plot is-growing';
          btn.disabled = true;
          label.textContent = formatSeconds(plant.grow - elapsed);
          bar.style.visibility = 'visible';
          barFill.style.width = Math.min(100, (elapsed / plant.grow) * 100) + '%';
          btn.setAttribute('aria-label', `${plant.name} growing, ${formatSeconds(plant.grow - elapsed)} left.`);
        }
      }
    });
  }

  function updatePasture() {
    state.pens.forEach((pen, index) => {
      const btn = penEls[index];
      const emoji = btn.querySelector('.pen-slot-emoji');
      const label = btn.querySelector('.pen-slot-label');
      const bar = btn.querySelector('.pen-slot-bar');
      const barFill = bar.querySelector('span');

      if (!pen.unlocked) {
        const cost = PEN_UNLOCK_COSTS[index - PEN_UNLOCKED_START] ?? null;
        setPos(btn, PEN_GATE_POSITIONS[index]);
        btn.className = 'pen-slot is-locked';
        btn.disabled = cost == null || coins() < cost;
        emoji.textContent = '🔒';
        label.textContent = `${cost} 🪙`;
        bar.style.visibility = 'hidden';
        btn.setAttribute('aria-label', `Locked pen. Unlock for ${cost} coins.`);
      } else if (!pen.animalId) {
        setPos(btn, PEN_GATE_POSITIONS[index]);
        btn.className = 'pen-slot is-empty';
        btn.disabled = false;
        emoji.textContent = '➕';
        label.textContent = 'Animal';
        bar.style.visibility = 'hidden';
        btn.setAttribute('aria-label', 'Empty pen. Tap to bring home an animal.');
      } else {
        const animal = ANIMALS[pen.animalId];
        const pos = wanderPos[index] || (wanderPos[index] = randomWanderTarget());
        setPos(btn, pos);
        const elapsed = (Date.now() - pen.lastCollectedAt) / 1000;
        const ready = elapsed >= animal.cycle;
        emoji.textContent = animal.emoji;
        if (ready) {
          btn.className = 'pen-slot is-ready';
          btn.disabled = false;
          label.textContent = `${animal.product} +${animal.value} 🪙`;
          bar.style.visibility = 'hidden';
          btn.setAttribute('aria-label', `${animal.name} has ${animal.product} ready. Tap to collect ${animal.value} coins.`);
        } else {
          btn.className = 'pen-slot is-waiting';
          btn.disabled = true;
          label.textContent = formatSeconds(animal.cycle - elapsed);
          bar.style.visibility = 'visible';
          barFill.style.width = Math.min(100, (elapsed / animal.cycle) * 100) + '%';
          btn.setAttribute('aria-label', `${animal.name}, next ${animal.product} in ${formatSeconds(animal.cycle - elapsed)}.`);
        }
      }
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
    updateGarden();
    updatePasture();
    renderTray();
  }

  trayClose.addEventListener('click', closeTray);

  resetBtn.addEventListener('click', () => {
    if (!window.confirm('Reset your farm? This clears your plots, pens, and totals — your shared arcade coins are kept.')) return;
    state = defaultState();
    wanderPos = {};
    closeTray();
    save();
    render();
  });

  initGardenDOM();
  initPastureDOM();
  render();
  setInterval(render, 1000);
  setInterval(retargetWander, 4000);
})();
