// MMTI observation layer: turns incidents into raw decision episodes, applies
// the interpretation rule, and computes P(response | condition). Raw episodes
// keep event and rule versions so they can be reclassified later.
window.MMTI = window.MMTI || {};
(() => {
  'use strict';
  const M = window.MMTI;
  const KEY = 'mmti-observe-v1';
  const RULE_VERSION = 'setback-switch-v1';
  const COPY_VERSION = 'archivist-scenes-v2';
  const RELEASE = { minEpisodes: 8, minEventTypes: 2, threshold: 0.75 };
  const EVENT_VERSION = { heating: 'heating-colony-v1', caravan: 'caravan-colony-v1' };
  const DEADLINES = ['urgent', 'none'];
  const r2 = (x) => Math.round(x * 100) / 100;

  const SCENES = [
    { id: 'dinner',
      urgent: { switch: 'Guests arrive in twenty minutes and dinner has gone wrong. You’d switch to another dish before working out what happened.',
        seek_info: 'Guests arrive in twenty minutes and dinner has gone wrong. You’d want to know what happened before deciding what to cook instead.' },
      none: { switch: 'With a whole afternoon to cook, a failed cake would still send you to another recipe. Finding out why it sank could wait.',
        seek_info: 'With a whole afternoon to cook, you’d want to know why the cake sank before reaching for another recipe.' } },
    { id: 'station',
      urgent: { switch: 'Your train leaves in ten minutes and the station entrance is closed. You’d look for another way in before checking what happened.',
        seek_info: 'Your train leaves in ten minutes and the station entrance is closed. You’d stop to find out what happened before choosing another way in.' },
      none: { switch: 'Even with an hour before your train, a closed station entrance would send you looking for another way in before asking what happened.',
        seek_info: 'With an hour before your train, you’d ask why the station entrance is closed before setting off to find another way in.' } },
    { id: 'build',
      urgent: { switch: 'The printer stops just before you need the handouts. You’d try another printer before reading the error message.',
        seek_info: 'The printer stops just before you need the handouts. You’d read the error message before deciding whether to use another printer.' },
      none: { switch: 'The printer stops, and the handouts aren’t needed until next week. You’d still try another printer before reading the error message.',
        seek_info: 'The printer stops, and the handouts aren’t needed until next week. You’d read the error message before deciding whether to use another printer.' } },
    { id: 'slides',
      urgent: { switch: 'The room is filling up and your slides won’t open. You’d find another way to give the talk before investigating the file.',
        seek_info: 'The room is filling up and your slides won’t open. You’d try to find out why before settling on another way to give the talk.' },
      none: { switch: 'Your talk is tomorrow, but the slides won’t open. You’d start finding another way to present before investigating the file.',
        seek_info: 'Your talk is tomorrow, but the slides won’t open. You’d work out why before deciding whether to present another way.' } },
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
        ? 'If a recipe fails, you’d reach for another before investigating. That holds whether guests are at the door or you have the afternoon to yourself.'
        : 'If a recipe fails, you’d want to know why before choosing another. Even guests at the door wouldn’t usually change that order.';
    }
    return u === 'switch'
      ? 'If dinner goes wrong with guests at the door, you’d switch dishes. With the afternoon to yourself, you’d investigate the failed recipe first.'
      : 'If dinner goes wrong with guests at the door, you’d investigate first. With the afternoon to yourself, you’d be more inclined to try another recipe straight away.';
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
        key: `${RULE_VERSION}|${d}|${b.released}|${scene.id}|${COPY_VERSION}`,
        text: scene[d][b.released],
        source: `I’m picturing this from ${b.n} decisions ${d === 'urgent' ? 'with a deadline approaching' : 'with time to spare'}, across ${b.types.size} kinds of trouble in the colony.`,
      });
    }
    if (m.urgent.released && m.none.released) {
      cards.push({
        key: `${RULE_VERSION}|contrast|${m.urgent.released}|${m.none.released}|${COPY_VERSION}`,
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
      id: 'setback', title: 'When plans go wrong',
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
        'switch|seek_info': contrastText('switch', 'seek_info'),
        'seek_info|switch': contrastText('seek_info', 'switch'),
        'switch|switch': contrastText('switch', 'switch'),
        'seek_info|seek_info': contrastText('seek_info', 'seek_info'),
      },
    },
    {
      id: 'reserves', title: 'What you can spare',
      conditions: { comfortable: 'when you had plenty to spare', thin: 'when helping would leave little to spare' }, responses: ['give', 'keep'],
      sample: () => byKind('neighbor-request').filter((d) => !d.expired && d.affordable).map((d) => ({
        condition: d.daysLeftAfter >= 2 ? 'comfortable' : 'thin', response: d.accept ? 'give' : 'keep', source: d.intro ? 'first evening' : d.resource, t: d.t,
        why: `${when(d.t)}: Millbrook asked for ${d.amount} ${d.resource}. Giving would have left about ${Math.max(0, d.daysLeftAfter).toFixed(1)} days of reserves; you ${d.accept ? 'sent it' : 'kept it'}.`,
      })),
      scenes: {
        comfortable: { give: 'A friend needs help moving, and your weekend is free. You’d probably give them a Saturday.', keep: 'A free Saturday is something you’d keep for yourself, even if a friend could use help moving.' },
        thin: { give: 'Even in a packed week, you’d probably give up your one free evening to help a friend move.', keep: 'When a friend asks for help moving during a packed week, you’d be likely to keep your one free evening.' },
      },
      contrast: {
        'give|keep': 'You’d help a friend move on a free weekend. In a packed week, you’d keep your one evening off.',
        'keep|give': 'You’d be more likely to give a friend your only free evening than a Saturday from an empty weekend.',
        'give|give': 'You’d usually make time to help a friend move, whether your calendar is empty or you have just one evening free.',
        'keep|keep': 'You’d usually keep your free time when a friend asks for help moving. That holds for an empty weekend as well as your only evening off.',
      },
    },
    {
      id: 'reluctance', title: 'Who you ask',
      conditions: { comparable: 'when the person who preferred to stay had no clear advantage', capable: 'when the person who preferred to stay was better suited to the job' }, responses: ['spare', 'ask'],
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
        comparable: { spare: 'On a long drive, if two friends handle the car equally well, you’d hand the keys to the one who wants to drive.', ask: 'On a long drive, you’d ask the reluctant friend to take a turn, even when another equally good driver volunteers.' },
        capable: { spare: 'If your best cook wants the evening off, you’d leave dinner to someone less experienced who wants to cook.', ask: 'If your best cook wants the evening off, you’d still be inclined to ask them to handle dinner.' },
      },
      contrast: {
        'spare|ask': 'With two equally good cooks, you’d let the one who wants to cook take over. If the reluctant one is much better, you’d ask them.',
        'ask|spare': 'With two equally good cooks, you’d ask the reluctant one. When the reluctant friend is the better cook, you’d leave dinner to the volunteer.',
        'spare|spare': 'When friends are deciding who cooks, you’d usually give the kitchen to the person who wants it, even if someone else cooks better.',
        'ask|ask': 'You’re willing to ask a friend to cook when they’d rather sit it out, whether they’re the strongest cook or just as good as the others.',
      },
    },
    {
      id: 'preparing', title: 'What you prepare for',
      conditions: { calm: 'while things were calm', trouble: 'after recent trouble' }, responses: ['protective', 'growth'],
      sample: () => [
        // Older saves keep these choices, but lack the context to interpret them.
        ...byKind('research-choice').filter((d) => typeof d.calm === 'boolean' && typeof d.branch === 'string').map((d) => ({
          condition: d.calm ? 'calm' : 'trouble', response: PROTECTIVE_BRANCH.has(d.branch) ? 'protective' : 'growth', source: 'research', t: d.t,
          why: `${when(d.t)}: ${d.calm ? 'with things calm' : 'soon after trouble'}, you chose to research ${d.key} (${d.branch.toLowerCase()}).`,
        })),
        ...byKind('trade').filter((d) => d.calm != null).map((d) => ({
          condition: d.calm ? 'calm' : 'trouble', response: d.want === 'medicine' ? 'protective' : 'growth', source: 'trade', t: d.t,
          why: `${when(d.t)}: ${d.calm ? 'with things calm' : 'soon after trouble'}, you traded for ${d.want}.`,
        })),
      ],
      scenes: {
        calm: { protective: 'Before a long journey, you’d pack a backup charger even with a full battery.', growth: 'With a trip running smoothly, you’d put your spare time into planning another stop before assembling a backup kit.' },
        trouble: { protective: 'After a flat tire interrupts a bike ride, you’d sort out a repair kit before planning the next trip.', growth: 'After a flat tire interrupts a bike ride, you’d put your next bit of time or money into another trip before improving your repair kit.' },
      },
      contrast: {
        'protective|growth': 'You’d pack a repair kit before a bike trip. After a puncture, you’d be more inclined to plan another ride than add to the kit.',
        'growth|protective': 'With the bike running well, you’d plan the next trip before buying spares. After a puncture, the repair kit would move up your list.',
        'protective|protective': 'You’d make room for a repair kit before a bike trip. After a puncture, improving the kit would still come before planning a longer ride.',
        'growth|growth': 'With the bike running well, you’d plan the next trip before buying spares. Even after a puncture, the trip would usually come first.',
      },
    },
    {
      id: 'revising', title: 'When you change course',
      conditions: { info: 'after trouble interrupted a plan', noinfo: 'without any recorded trouble along the way' }, responses: ['switch', 'stay'],
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
        info: { switch: 'Halfway through planning a holiday, travel disruptions change your options. You’d be willing to set the itinerary aside and start another.', stay: 'If travel disruptions change your options halfway through planning a holiday, you’d still try to make your original itinerary work.' },
        noinfo: { switch: 'Halfway through planning a holiday, you’d be inclined to start a different itinerary even while the original one still works.', stay: 'Halfway through planning a holiday, if the options haven’t changed, you’d usually finish the itinerary you started.' },
      },
      contrast: {
        'switch|stay': 'You’d finish a holiday itinerary while the travel options stay the same. A disruption could send you back to a blank page.',
        'stay|switch': 'You might start a new holiday itinerary on an ordinary afternoon, yet keep working on the old one when a disruption changes the options.',
        'switch|switch': 'An unfinished holiday itinerary doesn’t tie you to that trip. You’d be willing to start another, with or without a change in the travel options.',
        'stay|stay': 'Once you’re partway through planning a holiday, you’d usually keep working on that itinerary, even if the travel options change.',
      },
    },
    {
      id: 'reciprocity', title: 'After receiving help',
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
        after: { give: 'After someone lends you a hand with a difficult week, you’d be likely to make time for a neighbor who needs help.', refuse: 'Even after someone has helped you out, you’d be willing to turn down a neighbor’s request for your free afternoon.' },
        before: { give: 'Even when you’ve been managing on your own, you’d be likely to give a neighbor a hand carrying boxes upstairs.', refuse: 'When you’ve been managing on your own, you’d be inclined to keep your free afternoon if a neighbor asks for help.' },
      },
      contrast: {
        'refuse|give': 'When you’ve been managing on your own, you’d keep your free afternoon. After receiving some help, you’d be more likely to spend it helping a neighbor.',
        'give|refuse': 'You’d make time to help a neighbor while you’re managing on your own, yet be more likely to keep that time after someone has helped you.',
        'give|give': 'Whether you’ve had help yourself or been managing alone, you’d usually make time when a neighbor asks for a hand.',
        'refuse|refuse': 'You’d usually keep your free afternoon when a neighbor asks for help, whether or not someone has recently helped you.',
      },
    },
  ];

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
          key: `${fam.id}|${cond}|${b.lean}|${b.stage}|${COPY_VERSION}`, family: fam.title, stage: b.stage,
          text: base,
          source: `I’m imagining this scene from ${b.n} choice${b.n === 1 ? '' : 's'} in the colony ${fam.conditions[cond]}. ${b.stage === 'first' ? 'It’s an early hunch; more choices may change it.' : 'The same preference has come up in more than one kind of situation.'}`,
          why: b.list.slice(-6).map((o) => o.why), last: b.list[b.list.length - 1].t,
        });
      }
      const [c1, c2] = conds;
      const b1 = branches[c1], b2 = branches[c2];
      if (b1.stage && b2.stage) {
        const stage = b1.stage === 'pattern' && b2.stage === 'pattern' ? 'pattern' : 'first';
        const text = fam.contrast[`${b1.lean}|${b2.lean}`];
        cards.push({
          key: `${fam.id}|contrast|${b1.lean}|${b2.lean}|${stage}|${COPY_VERSION}`, family: fam.title, stage,
          text,
          source: `I’m comparing ${b1.n} choice${b1.n === 1 ? '' : 's'} ${fam.conditions[c1]} with ${b2.n} ${fam.conditions[c2]}. ${stage === 'first' ? 'This is still an early impression.' : 'Both sides of this pattern have come up in different situations.'}`,
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
    exportData: () => ({ exportedAt: new Date().toISOString(), ruleVersion: RULE_VERSION, copyVersion: COPY_VERSION, ...store }),
    reset() { store = fresh(); save(); },
  };
})();
