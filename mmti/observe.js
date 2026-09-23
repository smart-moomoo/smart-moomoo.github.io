// MMTI observation layer: turns incidents into raw decision episodes, applies
// the interpretation rule, and computes P(response | condition). Raw episodes
// keep event and rule versions so they can be reclassified later.
window.MMTI = window.MMTI || {};
(() => {
  'use strict';
  const M = window.MMTI;
  const KEY = 'mmti-observe-v1';
  const RULE_VERSION = 'setback-switch-v1';
  const RELEASE = { minEpisodes: 8, minEventTypes: 2, threshold: 0.75 };
  const EVENT_VERSION = { heating: 'heating-colony-v1', caravan: 'caravan-colony-v1' };
  const DEADLINES = ['urgent', 'none'];
  const r2 = (x) => Math.round(x * 100) / 100;

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

  function fresh() { return { episodes: [], feedback: [], decisions: [], sceneSeed: Math.floor(Math.random() * 1e9) }; }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.episodes)) return { ...fresh(), ...s };
    } catch {}
    return fresh();
  }
  let store = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} }
  const find = (inc) => inc && store.episodes.find((e) => e.id === inc.episodeId);

  // setback-switch-v1: one response per episode, at the first order that commits
  // to a next approach. Before the report arrived -> "switch". After the report
  // arrived and was consulted -> "seek_info". After it arrived but unread -> unscored.
  function classify(ep) {
    if (ep.review || ep.status !== 'committed') return null;
    if (ep.reportReceivedAt == null || ep.commitAt < ep.reportReceivedAt) return 'switch';
    if (ep.consultedAt != null && ep.consultedAt <= ep.commitAt) return 'seek_info';
    return null;
  }
  function unscoredReason(ep) {
    if (ep.review) return 'review';
    if (ep.status === 'open') return 'in progress';
    if (ep.status === 'abandoned') return ep.abandonReason || 'no decision';
    return 'report arrived but was not read';
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
      b.enough = b.n >= RELEASE.minEpisodes && b.types.size >= RELEASE.minEventTypes;
      b.released = !b.enough ? null
        : b.p >= RELEASE.threshold ? 'switch'
          : 1 - b.p >= RELEASE.threshold ? 'seek_info' : null;
    }
    return m;
  }

  function seededScenes(seed) {
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
    const scenes = seededScenes(store.sceneSeed);
    const cards = [];
    let si = 0;
    for (const d of DEADLINES) {
      const b = m[d];
      if (!b.released) continue;
      const scene = scenes[si++ % scenes.length];
      cards.push({
        key: `${RULE_VERSION}|${d}|${b.released}|${scene.id}`,
        text: scene[d][b.released],
        source: `Written for you. It comes from ${b.n} decisions you made in the colony ${d === 'urgent' ? 'with a deadline closing in' : 'with no deadline'}, across ${b.types.size} kinds of trouble. Nothing in this setting was observed.`,
      });
    }
    if (m.urgent.released && m.none.released) {
      cards.push({
        key: `${RULE_VERSION}|contrast|${m.urgent.released}|${m.none.released}`,
        text: contrastText(m.urgent.released, m.none.released),
        source: `Compares both: ${m.urgent.n} decisions with a deadline and ${m.none.n} without one.`,
      });
    }
    return cards;
  }

  M.observe = {
    RULE_VERSION, RELEASE, DEADLINES,
    episodeStart(inc, _x, s) {
      const ep = {
        id: `ep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        incidentId: inc.id, eventType: inc.kind, eventVersion: EVENT_VERSION[inc.kind], review: !!inc.review,
        condition: { setback: true, infoPending: true, deadline: inc.deadlineKind },
        params: {
          reportIn: r2(inc.reportT - inc.startT),
          deadlineIn: inc.deadlineT != null ? r2(inc.deadlineT - inc.startT) : null,
          cause: inc.cause,
        },
        day: Math.floor(s.t / 24) + 1, startT: r2(s.t), startedAt: new Date().toISOString(), status: 'open',
      };
      store.episodes.push(ep);
      inc.episodeId = ep.id;
      save();
    },
    reportArrived(inc, _x, s) {
      const ep = find(inc);
      if (ep) { ep.reportReceivedAt = r2(s.t); save(); }
    },
    consulted(inc, via, s) {
      const ep = find(inc);
      if (ep && ep.consultedAt == null && ep.reportReceivedAt != null && ep.status === 'open') {
        ep.consultedAt = r2(s.t);
        ep.consultedVia = via;
        save();
      }
    },
    commit(inc, info, s) {
      const ep = find(inc);
      if (!ep || ep.status !== 'open') return;
      ep.status = 'committed';
      ep.commitAt = r2(s.t);
      ep.action = info.action;
      ep.alternatives = info.alternatives;
      ep.snapshot = info.snapshot;
      save();
    },
    episodeEnd(inc, outcome) {
      const ep = find(inc);
      if (!ep) return;
      ep.outcome = outcome;
      if (ep.status === 'open') { ep.status = 'abandoned'; ep.abandonReason = outcome.reason || 'no decision'; }
      save();
    },
    // Decisions not yet interpreted by any rule; kept raw so later rules can use them.
    logDecision(kind, data, s) {
      if (!store.decisions) store.decisions = [];
      store.decisions.push({ kind, t: r2(s.t), at: new Date().toISOString(), ...data });
      save();
    },
    classify, unscoredReason, computeModel, portraitCards,
    episodes: () => store.episodes,
    feedbackFor: (key) => [...store.feedback].reverse().find((f) => f.key === key) || null,
    addFeedback(rec) { store.feedback.push({ ...rec, at: new Date().toISOString(), ruleVersion: RULE_VERSION }); save(); },
    exportData: () => ({ exportedAt: new Date().toISOString(), ruleVersion: RULE_VERSION, ...store }),
    reset() { store = fresh(); save(); },
  };
})();
