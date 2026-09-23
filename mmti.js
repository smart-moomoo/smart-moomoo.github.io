// MMTI v1 — one conditional branch, end to end (see mmti-spec.html):
// colony events → canonical (condition, response) → P(response | condition)
// → authored scenes that express the pattern in a new setting.
// Raw episodes are stored with event and rule versions so they can be reclassified later.
(() => {
  'use strict';
  const root = document.getElementById('mmti-app');
  if (!root) return;

  const STORAGE_KEY = 'mmti-v1';
  const RULE_VERSION = 'setback-switch-v1';
  const RELEASE = { minEpisodes: 8, minEventTypes: 2, threshold: 0.75 };
  const MS_PER_HOUR = 1400;
  const RESOLVE_SPEED = 5;
  const ISSUES_URL = 'https://github.com/smart-moomoo/smart-moomoo.github.io/issues/new';
  const DEADLINES = ['urgent', 'none'];
  const DEADLINE_LABEL = { urgent: 'Urgent deadline', none: 'No urgent deadline' };
  const RESPONSE_LABEL = { switch: 'Changed plan before the report', seek_info: 'Waited for the report' };

  const COLONISTS = ['Mara', 'Tobin', 'Ines', 'Okafor', 'Wren', 'Lio', 'Petra', 'Sol'];
  const TRAVELERS = ['a trader named Dusk', 'a medic named Ansel', 'a surveyor named Kit', 'a young herder named Bo'];

  const rand = (a, b) => a + Math.random() * (b - a);
  const half = (x) => Math.round(x * 2) / 2;
  const round2 = (x) => Math.round(x * 100) / 100;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function pickWeighted(items) {
    let r = Math.random();
    for (const it of items) if ((r -= it.p) < 0) return it;
    return items[items.length - 1];
  }

  // Both strategies must stay viable: every urgent deadline leaves room for
  // "wait for the report, then do the slowest fix" with 1–2 hours to spare.
  const EVENTS = {
    heating: {
      version: 'heating-v1',
      name: 'Heating failure',
      build(deadlineKind) {
        const who = pick(COLONISTS);
        const reportAt = half(rand(2.5, 3.5));
        const backup = { id: 'backup', label: 'Install the backup stove', hours: 4, cost: 25 };
        const cause = pickWeighted([
          { id: 'flue', p: 0.6, finding: 'The flue is clogged with soot. Cleaning it will fix the heater.',
            fixes: [{ id: 'clean', label: 'Clean the flue', hours: 1.5, cost: 5 }] },
          { id: 'firebox', p: 0.4, finding: 'The firebox is cracked and needs a replacement part.',
            fixes: [{ id: 'replace', label: 'Replace the firebox', hours: 4, cost: 25 }] },
        ]);
        const deadline = deadlineKind === 'urgent' ? half(reportAt + 4 + rand(1, 2)) : null;
        return {
          title: 'The dormitory heater failed',
          setup: deadline != null
            ? `A cold snap is rolling in. The heater ${who} installed in the dormitory has stopped working, and the room will be dangerously cold in ${deadline} hours.`
            : `The weather is mild. The heater ${who} installed in the dormitory has stopped working. Nobody is at risk, though the room will get chilly.`,
          pending: `${who} is inspecting it now.`,
          reportAt, deadline, cause: cause.id, finding: cause.finding,
          switchOption: backup,
          afterReport: [...cause.fixes, backup],
          success: 'The dormitory is warm again.',
          failure: 'The dormitory got dangerously cold before the heat came back. Two colonists caught a chill.',
        };
      },
    },
    caravan: {
      version: 'caravan-v1',
      name: 'Blocked rescue route',
      build(deadlineKind) {
        const traveler = pick(TRAVELERS);
        const reportAt = half(rand(2, 3));
        const pass = { id: 'pass', label: 'Take the mountain pass', hours: 5, cost: 15 };
        const cause = pickWeighted([
          { id: 'tree', p: 0.55, finding: 'A fallen tree blocks the road. It can be cleared, and the road is short from there.',
            fixes: [{ id: 'clear', label: 'Clear the tree and continue', hours: 3.5, cost: 5 }] },
          { id: 'rockslide', p: 0.45, finding: 'A rockslide has buried the road. It cannot be cleared quickly.', fixes: [] },
        ]);
        const deadline = deadlineKind === 'urgent' ? half(reportAt + 5 + rand(1, 2)) : null;
        const name = traveler.split(' ').pop();
        return {
          title: 'The rescue route is blocked',
          setup: deadline != null
            ? `Your caravan is on its way to ${traveler}, stranded with water for about ${deadline} hours. The planned road ahead is blocked.`
            : `Your caravan is on its way to ${traveler}, who is waiting safely at a well-stocked camp. The planned road ahead is blocked.`,
          pending: 'A scout has gone ahead to look at the blockage.',
          reportAt, deadline, cause: cause.id, finding: cause.finding,
          switchOption: pass,
          afterReport: [...cause.fixes, pass],
          success: `The caravan reached ${name}.`,
          failure: `The caravan arrived late. ${name} is weak from thirst and will need days of care.`,
        };
      },
    },
  };

  // Result scenes: same condition and response, new setting. Authored, tagged, and rotated.
  const SCENES = [
    { id: 'dinner',
      urgent: { switch: 'When dinner is running late and a recipe fails, you tend to try another dish before finding out what went wrong.',
                seek_info: 'When dinner is running late and a recipe fails, you tend to look for the cause before deciding to try another dish.' },
      none: { switch: 'With an afternoon free to cook, a failed recipe tends to send you to another dish before you work out what went wrong.',
              seek_info: 'With an afternoon free to cook, you tend to work out why a recipe failed before moving to another dish.' } },
    { id: 'station',
      urgent: { switch: 'When your train is about to leave and the way to the platform is blocked, you tend to try another route before checking what caused the blockage.',
                seek_info: 'When your train is about to leave and the way to the platform is blocked, you tend to check what happened before choosing another route.' },
      none: { switch: 'With plenty of time before your train, a blocked path still tends to send you to another route before you check what happened.',
              seek_info: 'With plenty of time before your train, you tend to find out why a path is blocked before deciding to take another route.' } },
    { id: 'build',
      urgent: { switch: 'When a build breaks an hour before a release cut, you tend to revert or try another approach before understanding what broke.',
                seek_info: 'When a build breaks an hour before a release cut, you tend to find out what broke before choosing another approach.' },
      none: { switch: 'When a build breaks on a quiet afternoon, you still tend to try another approach before understanding what broke.',
              seek_info: 'When a build breaks on a quiet afternoon, you tend to find out what broke before choosing another approach.' } },
    { id: 'slides',
      urgent: { switch: 'Minutes before you present, if your slides won’t open on the room’s computer, you tend to find another way to present before working out why the file failed.',
                seek_info: 'Minutes before you present, if your slides won’t open on the room’s computer, you tend to work out why before settling on another way to present.' },
      none: { switch: 'The day before a talk, if your slides won’t open on the room’s computer, you tend to find another way to present before working out why.',
              seek_info: 'The day before a talk, if your slides won’t open on the room’s computer, you tend to work out why before deciding whether to present another way.' } },
  ];

  // ---------- storage ----------
  function defaultStore() {
    return { episodes: [], feedback: [], colony: { day: 0, supplies: 100, morale: 70 }, sceneSeed: Math.floor(Math.random() * 1e9) };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && Array.isArray(s.episodes)) return { ...defaultStore(), ...s };
    } catch {}
    return defaultStore();
  }
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch {} }

  let store = load();
  for (const ep of store.episodes) {
    if (ep.status === 'open') { ep.status = 'abandoned'; ep.abandonReason = 'left-page'; }
  }
  save();

  const review = (() => {
    const q = new URLSearchParams(location.search);
    const type = q.get('mmti-event');
    const deadline = q.get('mmti-deadline');
    return EVENTS[type] && DEADLINES.includes(deadline) ? { type, deadline } : null;
  })();

  // ---------- interpretation rule + model ----------
  // setback-switch-v1: one response per committed episode. Committing before the
  // report arrived = "switch"; committing after it arrived = "seek_info".
  // Abandoned and review-triggered episodes are never scored.
  function classify(ep) {
    if (ep.review || ep.status !== 'committed') return null;
    return ep.reportReceivedBeforeCommit ? 'seek_info' : 'switch';
  }

  function computeModel() {
    const m = {};
    for (const d of DEADLINES) m[d] = { n: 0, switches: 0, types: new Set() };
    for (const ep of store.episodes) {
      const r = classify(ep);
      const b = r && m[ep.condition.deadline];
      if (!b) continue;
      b.n++;
      if (r === 'switch') b.switches++;
      b.types.add(ep.eventType);
    }
    for (const b of Object.values(m)) {
      b.p = (b.switches + 1) / (b.n + 2);
      const enough = b.n >= RELEASE.minEpisodes && b.types.size >= RELEASE.minEventTypes;
      b.released = !enough ? null
        : b.p >= RELEASE.threshold ? 'switch'
        : 1 - b.p >= RELEASE.threshold ? 'seek_info'
        : null;
      b.enough = enough;
    }
    return m;
  }

  // ---------- runtime ----------
  let active = null;
  let paused = false;
  let speed = 1;
  let section = 'colony';
  let reflectIndex = 0;
  let ui = {};

  function nextCell() {
    if (review) return review;
    const counts = new Map();
    for (const type of Object.keys(EVENTS)) for (const d of DEADLINES) counts.set(`${type}|${d}`, 0);
    for (const ep of store.episodes) {
      const k = `${ep.eventType}|${ep.condition.deadline}`;
      if (!ep.review && counts.has(k)) counts.set(k, counts.get(k) + 1);
    }
    const min = Math.min(...counts.values());
    const last = store.episodes[store.episodes.length - 1];
    const lastKey = last && `${last.eventType}|${last.condition.deadline}`;
    let pool = [...counts].filter(([, c]) => c === min).map(([k]) => k);
    if (pool.length > 1) pool = pool.filter((k) => k !== lastKey);
    const [type, deadline] = pick(pool).split('|');
    return { type, deadline };
  }

  function startDay() {
    const cell = nextCell();
    const def = EVENTS[cell.type];
    const ev = def.build(cell.deadline);
    const c = store.colony;
    c.day += 1;
    if (c.day > 1) c.supplies = Math.min(150, c.supplies + 20);
    const ep = {
      id: `ep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      eventType: cell.type,
      eventVersion: def.version,
      review: !!review,
      condition: { setback: true, infoPending: true, deadline: cell.deadline },
      params: { reportAt: ev.reportAt, deadline: ev.deadline, cause: ev.cause },
      day: c.day,
      startedAt: new Date().toISOString(),
      status: 'open',
    };
    store.episodes.push(ep);
    save();
    active = { ep, ev, t: 0, phase: 'deciding', reportIn: false };
    paused = false;
    renderAll();
  }

  function commit(option) {
    if (!active || active.phase !== 'deciding') return;
    const { ep } = active;
    ep.status = 'committed';
    ep.commitAt = round2(active.t);
    ep.action = option.id;
    ep.reportReceivedBeforeCommit = active.reportIn;
    active.option = option;
    active.completeAt = active.t + option.hours;
    active.phase = 'resolving';
    save();
    renderAll();
  }

  function applyOutcome(late, cost) {
    const c = store.colony;
    c.supplies = Math.max(0, c.supplies - cost);
    c.morale = Math.max(0, Math.min(100, c.morale + (late ? -15 : 4)));
  }

  function finish() {
    const { ep, ev, option } = active;
    const late = ev.deadline != null && active.completeAt > ev.deadline;
    applyOutcome(late, option.cost);
    ep.outcome = { completeAt: round2(active.completeAt), late, cost: option.cost };
    active.phase = 'done';
    active.late = late;
    active.result = late ? ev.failure : ev.success;
    save();
    renderAll();
  }

  function abandonOnDeadline() {
    const { ep, ev } = active;
    ep.status = 'abandoned';
    ep.abandonReason = 'deadline-no-decision';
    ep.outcome = { late: true, cost: 0 };
    applyOutcome(true, 0);
    active.phase = 'done';
    active.late = true;
    active.result = `${ev.failure} No new plan was chosen in time.`;
    save();
    renderAll();
  }

  function running() {
    return active && active.phase !== 'done' && !paused && section === 'colony'
      && window.PlayActiveView === 'mmti' && !document.hidden;
  }

  let lastFrame = performance.now();
  function frame() {
    const now = performance.now();
    const dt = Math.min(250, now - lastFrame);
    lastFrame = now;
    if (running()) {
      active.t += (dt / MS_PER_HOUR) * (active.phase === 'resolving' ? RESOLVE_SPEED : speed);
      const { ev } = active;
      if (active.phase === 'deciding') {
        if (!active.reportIn && active.t >= ev.reportAt) {
          active.t = ev.reportAt;
          active.reportIn = true;
          renderAll();
        } else if (ev.deadline != null && active.t >= ev.deadline) {
          active.t = ev.deadline;
          abandonOnDeadline();
        }
      } else if (active.phase === 'resolving' && active.t >= active.completeAt) {
        active.t = active.completeAt;
        finish();
      }
      tick();
    }
  }

  // ---------- DOM helpers ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  }
  const hours = (x) => `${Number.isInteger(x) ? x : x.toFixed(1)}h`;

  // ---------- rendering ----------
  function renderAll() {
    ui = {};
    const body = section === 'colony' ? renderColony()
      : section === 'reflect' ? renderReflect()
      : section === 'evidence' ? renderEvidence()
      : renderPropose();
    root.replaceChildren(renderNav(), body);
    tick();
  }

  function renderNav() {
    const items = [['colony', 'Colony'], ['reflect', 'Reflection room'], ['evidence', 'Evidence'], ['propose', 'Propose']];
    return h('div', { class: 'mmti-subnav', role: 'tablist', 'aria-label': 'MMTI sections' },
      items.map(([id, label]) => h('button', {
        type: 'button', role: 'tab', class: `mmti-subtab${section === id ? ' is-active' : ''}`,
        'aria-selected': String(section === id),
        on: { click: () => { section = id; reflectIndex = 0; renderAll(); } },
      }, label)));
  }

  function renderColony() {
    const c = store.colony;
    const stat = (label, value) => h('span', { class: 'mmti-stat' }, label, h('strong', null, value));
    const status = h('div', { class: 'mmti-status' },
      stat('Day', c.day), stat('Supplies', c.supplies), stat('Morale', c.morale),
      active && active.phase === 'deciding' ? renderClock() : null);
    const board = h('div', { class: 'mmti-board' }, active ? renderEvent() : renderIdle());
    if (active && paused && active.phase === 'deciding') board.append(h('div', { class: 'mmti-paused' }, 'Paused'));
    return h('div', null, status, board);
  }

  function renderClock() {
    ui.clock = h('span', { class: 'mmti-clock' });
    return h('span', { class: 'mmti-clock-wrap' }, ui.clock,
      h('button', { type: 'button', class: 'mmti-btn mmti-btn-small', on: { click: () => { paused = !paused; renderAll(); } } }, paused ? 'Resume' : 'Pause'),
      h('button', { type: 'button', class: 'mmti-btn mmti-btn-small', 'aria-label': 'Game speed', on: { click: () => { speed = speed === 1 ? 2 : 1; renderAll(); } } }, `${speed}×`));
  }

  function renderIdle() {
    const first = store.colony.day === 0;
    const scored = store.episodes.filter(classify).length;
    return h('div', { class: 'mmti-card' },
      h('p', { class: 'mmti-kicker' }, first ? 'MMTI · Moomoo Type Indicator' : `End of day ${store.colony.day}`),
      h('h3', { class: 'mmti-title' }, first ? 'Look after a small colony.' : 'The colony settles for the night.'),
      first
        ? h('p', null, 'Each day, something goes wrong. Handle it however you like — there is no right answer. When it has seen enough, the Reflection room will describe you in a situation you have never been in here.')
        : h('p', null, `${scored} decision${scored === 1 ? '' : 's'} recorded so far.`),
      h('p', { class: 'mmti-hint' }, 'Time only passes while this panel is open, and you can pause whenever you like.'),
      review ? h('p', { class: 'mmti-review' }, `Review mode: next event is ${review.type} · ${review.deadline}. Not scored.`) : null,
      h('button', { type: 'button', class: 'mmti-btn mmti-btn-primary', on: { click: startDay } }, `Begin day ${store.colony.day + 1}`));
  }

  function renderEvent() {
    const { ev, ep, phase } = active;
    const card = h('div', { class: 'mmti-card' },
      h('p', { class: 'mmti-kicker' }, `Day ${ep.day}${ep.review ? ' · review, not scored' : ''}`),
      h('h3', { class: 'mmti-title' }, ev.title),
      h('p', null, ev.setup),
      renderTimeline());

    if (phase === 'deciding') {
      if (!active.reportIn) {
        ui.reportCountdown = h('span');
        card.append(h('p', { class: 'mmti-pending' }, `${ev.pending} Report in `, ui.reportCountdown, '.'));
        card.append(renderOptions([ev.switchOption]));
        card.append(h('p', { class: 'mmti-hint' }, 'Or wait for the report.'));
      } else {
        card.append(h('div', { class: 'mmti-report' }, h('strong', null, 'Report. '), ev.finding));
        card.append(renderOptions(ev.afterReport));
      }
    } else if (phase === 'resolving') {
      card.append(h('p', { class: 'mmti-pending' }, `Working on it: ${active.option.label.toLowerCase()}…`));
    } else {
      card.append(h('p', { class: `mmti-result${active.late ? ' is-bad' : ''}` }, active.result));
      card.append(h('button', { type: 'button', class: 'mmti-btn mmti-btn-primary', on: { click: () => { active = null; renderAll(); } } }, 'Back to the colony'));
    }
    return card;
  }

  function renderOptions(options) {
    return h('div', { class: 'mmti-options' }, options.map((o) => h('button', {
      type: 'button', class: 'mmti-btn mmti-option', on: { click: () => commit(o) },
    }, h('span', null, o.label), h('small', null, `${hours(o.hours)} · ${o.cost} supplies`))));
  }

  function renderTimeline() {
    const { ev } = active;
    const track = h('div', { class: 'mmti-track' });
    ui.track = track;
    ui.markers = [];
    const mark = (hour, cls) => {
      const el = h('span', { class: `mmti-mark ${cls}` });
      track.append(el);
      ui.markers.push({ el, hour });
    };
    mark(ev.reportAt, 'is-report');
    if (ev.deadline != null) mark(ev.deadline, 'is-deadline');
    if (active.completeAt != null) mark(active.completeAt, 'is-done');
    ui.now = h('span', { class: 'mmti-now' });
    track.append(ui.now);
    const key = (cls, text) => h('span', { class: 'mmti-key' }, h('i', { class: cls }), text);
    ui.deadlineCountdown = ev.deadline != null ? h('span', { class: 'mmti-countdown' }) : null;
    return h('div', { class: 'mmti-timeline' },
      track,
      h('div', { class: 'mmti-legend' },
        key('is-report', `Report · hour ${ev.reportAt}`),
        ev.deadline != null ? key('is-deadline', `Deadline · hour ${ev.deadline}`) : key('is-none', 'No deadline'),
        active.completeAt != null ? key('is-done', `Done · hour ${round2(active.completeAt)}`) : null,
        ui.deadlineCountdown));
  }

  function tick() {
    if (!active || section !== 'colony') return;
    const t = active.t;
    if (ui.clock) ui.clock.textContent = `Hour ${t.toFixed(1)}`;
    if (ui.reportCountdown) ui.reportCountdown.textContent = hours(Math.max(0, active.ev.reportAt - t));
    if (ui.deadlineCountdown) {
      ui.deadlineCountdown.textContent = active.phase === 'deciding'
        ? `${hours(Math.max(0, active.ev.deadline - t))} left` : '';
    }
    if (ui.track) {
      let horizon = active.ev.deadline != null ? active.ev.deadline : active.ev.reportAt + 6;
      if (active.completeAt != null) horizon = Math.max(horizon, active.completeAt);
      const pos = (hr) => `${Math.min(100, (hr / horizon) * 100)}%`;
      ui.now.style.left = pos(t);
      for (const m of ui.markers) m.el.style.left = pos(m.hour);
    }
  }

  // ---------- reflection room ----------
  function seededOrder(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const out = SCENES.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function contrastText(u, c) {
    if (u === c) {
      return u === 'switch'
        ? 'Deadline or not, after a setback you tend to change plans before learning what went wrong.'
        : 'Deadline or not, after a setback you tend to find out what went wrong before changing plans.';
    }
    return u === 'switch'
      ? 'Under a deadline, you tend to change plans before learning what went wrong. With time to spare, you tend to find out first.'
      : 'Under a deadline, you tend to find out what went wrong first. With time to spare, you tend to move to a new plan before learning why.';
  }

  function portraitCards(m) {
    const scenes = seededOrder(store.sceneSeed);
    const cards = [];
    let si = 0;
    for (const d of DEADLINES) {
      const b = m[d];
      if (!b.released) continue;
      const scene = scenes[si++ % scenes.length];
      cards.push({
        key: `${RULE_VERSION}|${d}|${b.released}|${scene.id}`,
        text: scene[d][b.released],
        source: `Written for your result. It comes from ${b.n} decisions you made ${d === 'urgent' ? 'under an urgent deadline' : 'without an urgent deadline'}, across ${b.types.size} kinds of colony trouble. Nothing in this setting was observed.`,
      });
    }
    if (m.urgent.released && m.none.released) {
      cards.push({
        key: `${RULE_VERSION}|contrast|${m.urgent.released}|${m.none.released}`,
        text: contrastText(m.urgent.released, m.none.released),
        source: `Compares both branches: ${m.urgent.n} decisions under a deadline and ${m.none.n} without one.`,
      });
    }
    return cards;
  }

  function keeperCanvas() {
    const PA = window.PixelArt;
    if (!PA) return h('div', { class: 'mmti-keeper-fallback' });
    const size = 5;
    const canvas = PA.createCanvas(size);
    canvas.setAttribute('aria-hidden', 'true');
    const draw = (name) => {
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, PA.GRID * size, PA.GRID * size);
      PA.draw(ctx, name, PA.PEOPLE_PALETTE, size);
    };
    draw('keeper_a');
    ui.keeperDraw = draw;
    return canvas;
  }

  function renderReflect() {
    const m = computeModel();
    const cards = portraitCards(m);
    const wrap = h('div', { class: 'mmti-room' });
    const speech = cards.length
      ? 'I’ve been watching how you handle setbacks in the colony. Here is how I think you’d act somewhere else. Tell me whether it fits.'
      : 'I don’t know you well enough yet. Keep looking after the colony and come back.';
    wrap.append(h('div', { class: 'mmti-keeper' }, keeperCanvas(), h('p', { class: 'mmti-speech' }, speech)));

    if (cards.length) {
      reflectIndex = Math.min(reflectIndex, cards.length - 1);
      const card = cards[reflectIndex];
      wrap.append(h('div', { class: 'mmti-portrait' },
        h('p', { class: 'mmti-kicker' }, `Your MMTI · inferred portrait ${reflectIndex + 1} of ${cards.length}`),
        h('blockquote', null, `“${card.text}”`),
        h('p', { class: 'mmti-source' }, card.source),
        renderFeedback(card, m),
        h('div', { class: 'mmti-pager' },
          h('button', { type: 'button', class: 'mmti-btn mmti-btn-small', disabled: reflectIndex === 0, on: { click: () => { reflectIndex--; renderAll(); } } }, '← Previous'),
          h('button', { type: 'button', class: 'mmti-btn mmti-btn-small', disabled: reflectIndex === cards.length - 1, on: { click: () => { reflectIndex++; renderAll(); } } }, 'Next →'))));
    }

    const forming = DEADLINES.filter((d) => !m[d].released);
    if (forming.length) {
      wrap.append(h('div', { class: 'mmti-forming' },
        h('p', { class: 'mmti-kicker' }, 'Still forming'),
        forming.map((d) => {
          const b = m[d];
          const note = b.enough
            ? 'No clear pattern yet, so no description. More decisions may reveal one.'
            : `${Math.min(b.n, RELEASE.minEpisodes)} of ${RELEASE.minEpisodes} decisions · ${b.types.size} of ${RELEASE.minEventTypes} kinds of trouble`;
          return h('div', { class: 'mmti-progress' },
            h('div', { class: 'mmti-progress-top' }, h('span', null, DEADLINE_LABEL[d]), h('span', null, note)),
            h('div', { class: 'mmti-bar' }, h('span', { style: `width:${Math.min(100, (b.n / RELEASE.minEpisodes) * 100)}%` })));
        })));
    }
    return wrap;
  }

  function renderFeedback(card, m) {
    const prev = [...store.feedback].reverse().find((f) => f.key === card.key);
    let verdict = prev ? prev.verdict : null;
    const note = h('textarea', { class: 'mmti-note', rows: '2', placeholder: 'Optional: what circumstance matters?', 'aria-label': 'Explanation' });
    if (prev && prev.note) note.value = prev.note;
    const status = h('span', { class: 'mmti-saved' }, prev ? 'Saved.' : '');
    const choices = [['fits', 'Fits'], ['doesnt_fit', 'Doesn’t fit'], ['depends', 'Depends']];
    const buttons = choices.map(([id, label]) => h('button', {
      type: 'button', class: `mmti-btn mmti-btn-small${verdict === id ? ' is-picked' : ''}`, 'aria-pressed': String(verdict === id),
      on: { click: () => {
        verdict = id;
        for (const b of buttons) {
          const on = b.dataset.v === id;
          b.classList.toggle('is-picked', on);
          b.setAttribute('aria-pressed', String(on));
        }
        record();
      } },
    }, label));
    buttons.forEach((b, i) => { b.dataset.v = choices[i][0]; });
    function record() {
      if (!verdict) return;
      store.feedback.push({
        key: card.key, verdict, note: note.value.trim(), at: new Date().toISOString(), ruleVersion: RULE_VERSION,
        counts: Object.fromEntries(DEADLINES.map((d) => [d, { n: m[d].n, switches: m[d].switches }])),
      });
      save();
      status.textContent = 'Saved.';
    }
    note.addEventListener('change', record);
    return h('div', { class: 'mmti-feedback' }, h('div', { class: 'mmti-feedback-row' }, buttons, status), note);
  }

  // ---------- evidence ----------
  function renderEvidence() {
    const m = computeModel();
    const pct = (x) => `${Math.round(x * 100)}%`;
    const branchRows = DEADLINES.map((d) => {
      const b = m[d];
      return h('tr', null,
        h('td', null, DEADLINE_LABEL[d]), h('td', null, b.n), h('td', null, b.switches), h('td', null, b.n - b.switches),
        h('td', null, pct(b.p)), h('td', null, b.released ? `Released: ${RESPONSE_LABEL[b.released].toLowerCase()}` : 'Collecting'));
    });
    const eps = store.episodes.slice().reverse();
    const epRows = eps.map((ep) => {
      const r = classify(ep);
      return h('tr', null,
        h('td', null, ep.day),
        h('td', null, EVENTS[ep.eventType] ? EVENTS[ep.eventType].name : ep.eventType),
        h('td', null, ep.condition.deadline === 'urgent' ? `Hour ${ep.params.deadline}` : 'None'),
        h('td', null, `Hour ${ep.params.reportAt}`),
        h('td', null, ep.commitAt != null ? `Hour ${ep.commitAt}` : '—'),
        h('td', null, r ? RESPONSE_LABEL[r] : ep.review ? 'Review, not scored' : `Not scored (${ep.abandonReason || ep.status})`));
    });
    return h('div', { class: 'mmti-evidence' },
      h('p', null, 'Every description is traceable to these counts. The rule ', h('code', null, RULE_VERSION),
        ' records one response per event: choosing a new plan before the report arrived, or after reading it. Estimates use (changes + 1) / (decisions + 2). A description is released after 8 decisions across both kinds of trouble with at least 75% one way.'),
      h('div', { class: 'mmti-table-wrap' }, h('table', { class: 'mmti-table' },
        h('thead', null, h('tr', null, ['Condition', 'Decisions', 'Changed plan first', 'Waited for report', 'P(change plan)', 'Status'].map((t) => h('th', null, t)))),
        h('tbody', null, branchRows))),
      h('h4', { class: 'mmti-subhead' }, `Episodes (${store.episodes.length})`),
      eps.length
        ? h('div', { class: 'mmti-table-wrap' }, h('table', { class: 'mmti-table' },
          h('thead', null, h('tr', null, ['Day', 'Event', 'Deadline', 'Report', 'Decided', `Response (${RULE_VERSION})`].map((t) => h('th', null, t)))),
          h('tbody', null, epRows)))
        : h('p', { class: 'mmti-hint' }, 'No episodes yet.'),
      h('div', { class: 'mmti-actions' },
        h('button', { type: 'button', class: 'mmti-btn mmti-btn-small', on: { click: exportData } }, 'Export data (JSON)'),
        h('button', { type: 'button', class: 'mmti-btn mmti-btn-small', on: { click: resetData } }, 'Reset MMTI')));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ruleVersion: RULE_VERSION, ...store }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'mmti-data.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function resetData() {
    if (!confirm('Erase all MMTI episodes and feedback in this browser?')) return;
    store = defaultStore();
    active = null;
    save();
    renderAll();
  }

  // ---------- proposals ----------
  function renderPropose() {
    const kinds = [
      ['mmti-event.yml', 'Event or mechanic', 'Propose something that happens in the colony: what the player can do, and why it would be enjoyable. Fun-only ideas are welcome; they may stay unscored.'],
      ['mmti-rule.yml', 'Interpretation rule', 'Propose what a behavior means, or a missing condition that explains inconsistent responses.'],
      ['mmti-scene.yml', 'Result scene', 'Propose an everyday situation and the conditional pattern it expresses.'],
    ];
    return h('div', { class: 'mmti-propose' },
      h('p', null, 'MMTI grows through community proposals, collected as GitHub Issues. Accepted ones are built into the next version.'),
      h('div', { class: 'mmti-propose-grid' }, kinds.map(([tpl, title, desc]) => h('a', {
        class: 'mmti-propose-card', href: `${ISSUES_URL}?template=${tpl}`, target: '_blank', rel: 'noopener',
      }, h('strong', null, title), h('span', null, desc), h('em', null, 'Open a proposal ↗')))));
  }

  // ---------- boot ----------
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion) {
    setInterval(() => {
      const draw = ui.keeperDraw;
      if (!draw || section !== 'reflect') return;
      draw('keeper_b');
      setTimeout(() => { if (ui.keeperDraw === draw) draw('keeper_a'); }, 160);
    }, 3400);
  }

  renderAll();
  setInterval(frame, 100);
})();
