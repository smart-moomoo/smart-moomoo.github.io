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

  // ---------- impressions: several families of conditional behavior ----------
  const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
  function when(t) {
    const d = Math.floor(t / 24) % 20;
    return `${SEASONS[Math.floor(d / 5)]} ${(d % 5) + 1}, ${String(Math.floor(t % 24)).padStart(2, '0')}:00`;
  }
  const byKind = (k) => (store.decisions || []).filter((d) => d.kind === k);
  const PROTECTIVE_BRANCH = new Set(['Defense', 'Medicine', 'Preservation']);

  const FAMILIES = [
    {
      id: 'setback', title: 'Changing plans after a setback',
      conditions: { urgent: 'with a deadline', none: 'with time to spare' }, responses: ['switch', 'seek_info'],
      firstMin: 2, patternMin: 8,
      sample: () => store.episodes.map((ep) => {
        const r = classify(ep);
        if (!r) return null;
        return {
          condition: ep.condition.deadline, response: r, source: ep.eventType, t: ep.startT,
          why: `${when(ep.startT)}: ${ep.eventType === 'heating' ? 'the heater broke' : 'the rescue road was blocked'}${ep.condition.deadline === 'urgent' ? ' with a deadline' : ''}; you ${r === 'switch' ? 'changed plans before the report came in' : 'waited for the report, then acted'}.`,
        };
      }).filter(Boolean),
      scene: (cond, resp) => {
        const sc = seededScenes(store.sceneSeed)[cond === 'urgent' ? 0 : 1];
        return sc[cond][resp];
      },
      contrast: {
        'switch|seek_info': 'Under a deadline, you tend to change plans before learning what went wrong. With time to spare, you tend to find out first.',
        'seek_info|switch': 'Under a deadline, you tend to find out what went wrong first. With time to spare, you tend to move to a new plan before learning why.',
        'switch|switch': 'Deadline or not, after a setback you tend to change plans before learning what went wrong.',
        'seek_info|seek_info': 'Deadline or not, after a setback you tend to find out what went wrong before changing plans.',
      },
    },
    {
      id: 'reserves', title: 'Helping while protecting reserves',
      conditions: { comfortable: 'when you had plenty to spare', thin: 'when helping left little margin' }, responses: ['give', 'keep'],
      sample: () => byKind('neighbor-request').filter((d) => !d.expired && d.affordable).map((d) => ({
        condition: d.daysLeftAfter >= 2 ? 'comfortable' : 'thin', response: d.accept ? 'give' : 'keep', source: d.intro ? 'first evening' : d.resource, t: d.t,
        why: `${when(d.t)}: Millbrook asked for ${d.amount} ${d.resource}. Giving would have left about ${Math.max(0, d.daysLeftAfter).toFixed(1)} days of reserves; you ${d.accept ? 'sent it' : 'kept it'}.`,
      })),
      scenes: {
        comfortable: { give: 'When a friend asks for help moving on a weekend you have free, you tend to say yes without much thought.', keep: 'Even with a free weekend, you tend to keep it for yourself rather than spend it on someone else’s move.' },
        thin: { give: 'You’ll give up your only evening off to help a friend move.', keep: 'When helping a friend would eat your only evening off, you tend to protect it.' },
      },
      contrast: {
        'give|keep': 'You’re generous when you have room to spare, and protective when you don’t.',
        'keep|give': 'Oddly, you hold back when you have plenty and give when you have little.',
        'give|give': 'Whether or not you can spare it, you tend to say yes when someone asks.',
        'keep|keep': 'Whether or not you can spare it, you tend to keep your reserves for your own people.',
      },
    },
    {
      id: 'reluctance', title: 'Respecting someone’s reluctance',
      conditions: { comparable: 'when the willing and the reluctant were equally able', capable: 'when the reluctant one was clearly better suited' }, responses: ['spare', 'ask'],
      sample: () => ['errand', 'caravan-members', 'trade'].flatMap((k) => byKind(k)).map((d) => {
        const cands = d.candidates || [];
        const chosen = d.chosen || d.members || [];
        const willing = cands.filter((c) => c.willing && !c.reluctant);
        const reluctant = cands.filter((c) => c.reluctant && !c.willing);
        if (!willing.length || !reluctant.length) return null;
        const pw = willing.some((c) => chosen.includes(c.name)), pr = reluctant.some((c) => chosen.includes(c.name));
        if (pw === pr) return null;
        const w = d.kind === 'errand' ? willing.slice().sort((a, b) => a.hours - b.hours)[0] : willing.slice().sort((a, b) => b.fit - a.fit)[0];
        const r = d.kind === 'errand' ? reluctant.slice().sort((a, b) => a.hours - b.hours)[0] : reluctant.slice().sort((a, b) => b.fit - a.fit)[0];
        const better = d.kind === 'errand' ? r.hours < w.hours * 0.8 : r.fit > w.fit * 1.2;
        const what = d.kind === 'errand' ? 'an errand' : d.kind === 'trade' ? 'a trade trip' : 'a rescue caravan';
        return {
          condition: better ? 'capable' : 'comparable', response: pw ? 'spare' : 'ask', source: d.kind, t: d.t,
          why: `${when(d.t)}: choosing who went on ${what}, ${w.name} wanted to go and ${r.name} would rather have stayed${better ? `, though ${r.name} was clearly better suited` : ''}; you sent ${pw ? w.name : r.name}.`,
        };
      }).filter(Boolean),
      scenes: {
        comparable: { spare: 'When organizing a trip, you tend to spare the reluctant driver if someone equally capable wants the wheel.', ask: 'When two people could do a chore equally well, you don’t let reluctance decide who does it.' },
        capable: { spare: 'Even when the reluctant one would get it done faster, you tend to let the willing one go.', ask: 'When the reluctant person is clearly the better fit, you tend to ask them anyway.' },
      },
      contrast: {
        'spare|ask': 'You spare people who’d rather not, until they’re clearly the best person for the job.',
        'ask|spare': 'Reluctance doesn’t sway you in general, yet you let the willing one go when they’re much less suited.',
        'spare|spare': 'Whoever is better suited, you tend to send the person who wants to go.',
        'ask|ask': 'You tend to send whoever is best for the job, whether or not they want to go.',
      },
    },
    {
      id: 'preparing', title: 'Preparing before trouble arrives',
      conditions: { calm: 'while things were calm', trouble: 'right after something went wrong' }, responses: ['protective', 'growth'],
      sample: () => [
        ...byKind('research-choice').map((d) => ({
          condition: d.calm ? 'calm' : 'trouble', response: PROTECTIVE_BRANCH.has(d.branch) ? 'protective' : 'growth', source: 'research', t: d.t,
          why: `${when(d.t)}: ${d.calm ? 'with things calm' : 'soon after trouble'}, you chose to research ${d.key} (${d.branch.toLowerCase()}).`,
        })),
        ...byKind('trade').filter((d) => d.calm != null).map((d) => ({
          condition: d.calm ? 'calm' : 'trouble', response: d.want === 'medicine' ? 'protective' : 'growth', source: 'trade', t: d.t,
          why: `${when(d.t)}: ${d.calm ? 'with things calm' : 'soon after trouble'}, you traded for ${d.want}.`,
        })),
      ],
      scenes: {
        calm: { protective: 'Before a long journey, you’re inclined to pack a backup charger even when your phone is fully charged.', growth: 'When things are going well, you tend to put your effort into what’s next rather than into backups.' },
        trouble: { protective: 'After something goes wrong, you tend to shore things up before moving on.', growth: 'Even right after a scare, you tend to keep building forward instead of bracing for the next one.' },
      },
      contrast: {
        'protective|growth': 'You prepare while things are quiet, so a scare doesn’t knock you off course.',
        'growth|protective': 'You invest in what’s next while things are calm, and only brace after something goes wrong.',
        'protective|protective': 'Calm or not, you tend to build in a margin for things going wrong.',
        'growth|growth': 'Calm or not, you’d rather move forward than stockpile for what might go wrong.',
      },
    },
    {
      id: 'revising', title: 'Revising an invested plan',
      conditions: { info: 'after something changed', noinfo: 'when nothing had changed' }, responses: ['switch', 'stay'],
      sample: () => [
        ...byKind('research-choice').filter((d) => d.previous && d.investedShare >= 0.2 && d.previous !== d.key).map((d) => ({
          condition: d.troubleSincePrevious ? 'info' : 'noinfo', response: 'switch', source: 'research', t: d.t,
          why: `${when(d.t)}: ${Math.round(d.investedShare * 100)}% into ${d.previous}, you switched research to ${d.key}${d.troubleSincePrevious ? ' after trouble had struck' : ''}.`,
        })),
        ...byKind('research-done').map((d) => ({
          condition: d.trouble ? 'info' : 'noinfo', response: 'stay', source: 'research', t: d.t,
          why: `${when(d.t)}: you saw ${d.key} through to the end${d.trouble ? ', even though trouble struck along the way' : ''}.`,
        })),
        ...byKind('plan-cancel').filter((d) => d.investedShare >= 0.25).map((d) => ({
          condition: d.trouble ? 'info' : 'noinfo', response: 'switch', source: 'building', t: d.t,
          why: `${when(d.t)}: you cancelled a ${d.build} plan that already had ${d.invested} wood in it${d.trouble ? ', after trouble struck' : ''}.`,
        })),
      ],
      scenes: {
        info: { switch: 'Halfway through preparing dinner, a change in your guests’ needs can still persuade you to change the menu.', stay: 'Once you’ve started cooking, you tend to finish the menu you planned, even when your guests’ needs change.' },
        noinfo: { switch: 'Halfway through a project, a fresh idea can pull you onto another one even when nothing has changed.', stay: 'When nothing has changed, you see a started project through.' },
      },
      contrast: {
        'switch|stay': 'You finish what you start unless something changes, and then you’re willing to change course.',
        'stay|switch': 'New ideas pull you away from started work, yet real changes in circumstance rarely do.',
        'switch|switch': 'With or without a reason, you’re quick to drop a half-finished plan for a better-looking one.',
        'stay|stay': 'Once you’ve put work into a plan, you tend to see it through, whatever changes.',
      },
    },
    {
      id: 'reciprocity', title: 'Responding to past help',
      firstMin: 2,
      conditions: { before: 'before Millbrook had helped you', after: 'after Millbrook had helped you' }, responses: ['give', 'refuse'],
      sample: () => [
        ...byKind('neighbor-request').filter((d) => !d.expired && d.affordable && !d.intro).map((d) => ({
          condition: d.giftsReceived > 0 ? 'after' : 'before', response: d.accept ? 'give' : 'refuse', source: 'request', t: d.t,
          why: `${when(d.t)}: ${d.giftsReceived > 0 ? `Millbrook had helped you ${d.giftsReceived} time${d.giftsReceived > 1 ? 's' : ''}` : 'Millbrook had not helped you yet'}; you ${d.accept ? 'helped' : 'said no'} when they asked for ${d.resource}.`,
        })),
        ...byKind('rescue-request').filter((d) => !d.expired && d.home >= 3).map((d) => ({
          condition: d.giftsReceived > 0 ? 'after' : 'before', response: d.accept ? 'give' : 'refuse', source: 'rescue', t: d.t,
          why: `${when(d.t)}: ${d.traveler} asked for help ${d.giftsReceived > 0 ? 'after Millbrook had helped you' : 'before Millbrook had ever helped you'}; you ${d.accept ? 'sent a caravan' : 'declined'}.`,
        })),
      ],
      scenes: {
        after: { give: 'You’re quicker to rearrange your weekend for someone who has previously shown up for you.', refuse: 'Past favors don’t sway you much; you weigh each request on its own.' },
        before: { give: 'You’ll help people before they’ve ever done anything for you.', refuse: 'You tend to wait until someone has shown up for you before you go out of your way for them.' },
      },
      contrast: {
        'refuse|give': 'You hold back with people who haven’t helped you yet, and show up for those who have.',
        'give|refuse': 'You’re generous with newcomers, but a past favor doesn’t earn someone more from you.',
        'give|give': 'Whether or not someone has helped you before, you tend to help when asked.',
        'refuse|refuse': 'Whether or not someone has helped you before, you tend to keep to your own.',
      },
    },
  ];

  const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  function impressions() {
    const out = [];
    for (const fam of FAMILIES) {
      const obs = fam.sample();
      const conds = Object.keys(fam.conditions);
      const branches = {};
      for (const cond of conds) {
        const list = obs.filter((o) => o.condition === cond).sort((a, b) => a.t - b.t);
        const n = list.length;
        const a = list.filter((o) => o.response === fam.responses[0]).length;
        const p = (a + 1) / (n + 2);
        const contexts = new Set(list.map((o) => o.source)).size;
        const lean = p >= 0.5 ? fam.responses[0] : fam.responses[1];
        const strength = Math.max(p, 1 - p);
        let stage = null;
        if (n >= (fam.patternMin || 4) && contexts >= 2 && strength >= 0.75) stage = 'pattern';
        else if (n >= (fam.firstMin || 1) && strength >= 0.6) stage = 'first';
        branches[cond] = { cond, n, a, p, contexts, lean: stage ? lean : null, stage, list };
      }
      out.push({ fam, branches, total: obs.length });
    }
    return out;
  }
  function familyCards() {
    const cards = [];
    for (const { fam, branches } of impressions()) {
      const conds = Object.keys(fam.conditions);
      for (const cond of conds) {
        const b = branches[cond];
        if (!b.stage) continue;
        const base = fam.scene ? fam.scene(cond, b.lean) : fam.scenes[cond][b.lean];
        cards.push({
          key: `${fam.id}|${cond}|${b.lean}|${b.stage}`, family: fam.title, stage: b.stage,
          text: b.stage === 'first' ? `It’s early, but ${lower(base)}` : base,
          source: `${b.stage === 'first' ? 'A first impression' : 'A recurring pattern'} from ${b.n} choice${b.n === 1 ? '' : 's'} ${fam.conditions[cond]}. The situation is new; nothing in it was observed.`,
          why: b.list.slice(-6).map((o) => o.why), last: b.list[b.list.length - 1].t,
        });
      }
      const [c1, c2] = conds;
      const b1 = branches[c1], b2 = branches[c2];
      if (b1.stage && b2.stage) {
        const stage = b1.stage === 'pattern' && b2.stage === 'pattern' ? 'pattern' : 'first';
        const text = fam.contrast[`${b1.lean}|${b2.lean}`];
        cards.push({
          key: `${fam.id}|contrast|${b1.lean}|${b2.lean}|${stage}`, family: fam.title, stage,
          text: stage === 'first' ? `It’s early, but ${lower(text)}` : text,
          source: `Compares ${b1.n} choice${b1.n === 1 ? '' : 's'} ${fam.conditions[c1]} with ${b2.n} ${fam.conditions[c2]}.`,
          why: [...b1.list.slice(-3), ...b2.list.slice(-3)].map((o) => o.why), last: Math.max(b1.list[b1.list.length - 1].t, b2.list[b2.list.length - 1].t), contrast: true,
        });
      }
    }
    return cards.sort((a, b) => (a.stage === b.stage ? (b.contrast ? 1 : 0) - (a.contrast ? 1 : 0) || b.last - a.last : a.stage === 'pattern' ? -1 : 1));
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
      store.decisions.push({ ...data, kind, t: r2(s.t), at: new Date().toISOString() });
      save();
    },
    classify, unscoredReason, computeModel, portraitCards, impressions, familyCards, FAMILIES,
    episodes: () => store.episodes,
    feedbackFor: (key) => [...store.feedback].reverse().find((f) => f.key === key) || null,
    addFeedback(rec) { store.feedback.push({ ...rec, at: new Date().toISOString(), ruleVersion: RULE_VERSION }); save(); },
    exportData: () => ({ exportedAt: new Date().toISOString(), ruleVersion: RULE_VERSION, ...store }),
    reset() { store = fresh(); save(); },
  };
})();
