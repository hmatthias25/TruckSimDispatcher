/* Dock work cannot be split by a ten-hour reset.
 *
 * Reported from play: 46 minutes left on the shift, a flatbed load off a facility board — so a live load
 * of about two hours — and the app authorised it and called it legal. The planner had loaded for
 * forty-six minutes, taken a ten on the customer's property, and finished in the morning. Nobody does
 * that and no receiver would allow it.
 *
 * The driver either has the window to do the whole job, or they go and rest before they start it.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5880}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const hhmm = (h) => (h == null ? '--' : `${Math.floor(h)}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`);
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;

/** Stand the driver at a receiver with a given shift clock. */
async function atReceiver(shift, drive = 8, cycle = 40) {
  S = un(await api('/status', 'POST', {
    locationCity: 'Wichita', locationState: 'KS', locationKind: 'Receiver', gameTime: iso(10, '16:00'),
    fuelPct: 70, atsOdometer: 90000, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 80000,
  }));
  await api('/hos', 'POST', {
    driveRemaining: drive, shiftRemaining: shift, breakRemaining: 8, cycleRemaining: cycle,
  });
  return S;
}

/** A flatbed load off the facility board — a live load, not a hook. */
async function offer(loadingHours) {
  await api('/board/clear', 'POST', {});
  return api('/board/add', 'POST', {
    cargo: 'Steel Coils', trailerType: 'Flatbed',
    originCity: 'Wichita', originState: 'KS', destCity: 'Topeka', destState: 'KS',
    loadedMiles: 140, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 30,
    weightLbs: 42000, atLocation: true, preLoaded: true,
  });
}

(async () => {
  const app = { driverName: 'D. Dock', preferredDivision: 'Flatbed', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Wichita', homeState: 'KS', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) }));

  head('1. A flatbed off a facility board is a live load, not a hook');
  await atReceiver(10);
  let ev = (await offer()).evaluations[0];
  const plan = ev.feasibility;
  ok('the plan books real dock time, not 25 minutes',
    plan.timeline.some((x) => /Hook \/ load/.test(x.label) && x.hours > 0.75),
    plan.timeline.filter((x) => /Hook \/ load/.test(x.label)).map((x) => hhmm(x.hours)).join(', ') || '(none)');

  head('2. THE REPORTED CASE: the board is refused outright, not planned');
  // 46 minutes of window against a live load. The point is not that the plan comes back bad — it is that
  // the driver is never asked to enter a board at all. Typing two pages of freight, or pasting
  // screenshots of it, to be told no afterwards costs their evening and their API budget.
  await atReceiver(46 / 60);
  const bd = await offer();
  const blockers = ((await api('/bootstrap')).views.dispatchBlockers || []).join(' | ');
  ok('the board is rejected', bd.rejectAll === true, `${bd.rejectAll}`);
  ok('and dispatch says do not pull the job list',
    /Do not bother pulling the job list/i.test(blockers), blockers.slice(0, 220) || '(none)');
  ok('it states the window against the dock time',
    /46 minutes|0:46/.test(blockers) || /of your 14/.test(blockers), blockers.slice(0, 150));
  ok('it says to take the ten and come back tomorrow',
    /take your 10/i.test(blockers) && /fresh clock/i.test(blockers), '');
  ok('and promises freight after', /I will have freight for you then/i.test(blockers), '');

  head('2b. Authorising anything is refused while that stands');
  let refused = null;
  try {
    await api('/dispatch/authorize', 'POST', { loadId: (bd.evaluations || [{}])[0]?.load?.id || 'x' });
  } catch (e) { refused = e.message; }
  ok('nothing can be booked', refused !== null, refused || '(ALLOWED!)');

  head('3. Where the customer will not have you, the ten is at a truck stop');
  // The planner is driven directly here: whether a facility lets a truck sit is seeded per facility, and
  // both answers need covering. This is the case where the driver DOES have enough window to be offered
  // the load, but not enough to work the dock without resting first.
  const planFor = (allows) => api('/hos/plan', 'POST', {
    deadheadMiles: 0, loadedMiles: 140, loadingHours: 2, unloadingHours: 1,
    deadlineHours: 30, extraStops: 0, receiverAllowsOvernight: allows, usableFuelRangeMiles: 9999,
  });

  await atReceiver(1.5);
  let p = await planFor(false);
  let notes = [...(p.warnings || []), ...(p.blockers || [])].join(' | ');
  ok('it says the window will not cover the job',
    /window and the (shipper|receiver) needs/i.test(notes), notes.slice(0, 190) || '(none)');
  ok('and that they cannot get off the lot either', /get off their lot/i.test(notes), '');
  ok('it sends them to a truck stop', /run to a truck stop/i.test(notes), '');
  ok('with the run out and back in the plan',
    (p.timeline || []).filter((x) => /truck stop|Back to the/i.test(x.label)).length >= 2,
    (p.timeline || []).filter((x) => /truck stop|Back to the/i.test(x.label)).map((x) => x.label).join(' | ') || '(none)');
  ok('and the reset before the dock work',
    (() => {
      const rest = (p.timeline || []).findIndex((x) => x.kind === 'Rest');
      const dock = (p.timeline || []).findIndex((x) => /Hook \/ load/.test(x.label));
      return rest >= 0 && dock >= 0 && rest < dock;
    })(), 'reset first');
  ok('the load is never split around it',
    !(p.timeline || []).some((x) => /Hook \/ load/.test(x.label) && /segment/i.test(x.label)),
    (p.timeline || []).filter((x) => /Hook \/ load/.test(x.label)).map((x) => x.label).join(' | '));

  head('4. Where they WILL have you, the ten is on their property');
  p = await planFor(true);
  notes = [...(p.warnings || []), ...(p.blockers || [])].join(' | ');
  ok('it says they will let you sit', /they will let you sit/i.test(notes), notes.slice(0, 170) || '(none)');
  ok('so no reposition is planned', !(p.timeline || []).some((x) => /truck stop/i.test(x.label)),
    (p.timeline || []).map((x) => x.label).join(' | ').slice(0, 130));
  ok('and the reset is still before the load',
    (() => {
      const rest = (p.timeline || []).findIndex((x) => x.kind === 'Rest');
      const dock = (p.timeline || []).findIndex((x) => /Hook \/ load/.test(x.label));
      return rest >= 0 && dock >= 0 && rest < dock;
    })(), 'reset first');

  head('5. Plenty of window is left alone');
  await atReceiver(11);
  const roomy = (await offer()).evaluations[0].feasibility;
  ok('no reposition is invented when the window covers it',
    !(roomy.timeline || []).some((x) => /truck stop/i.test(x.label)),
    (roomy.timeline || []).map((x) => x.label).join(' | ').slice(0, 130));
  ok('and no rest is forced in', !(roomy.timeline || []).some((x) => x.kind === 'Rest'), 'straight through');
  ok('it is feasible', roomy.verdict !== 'Infeasible', roomy.verdict);

  head('6. Out of cycle is still out of cycle, not a dock problem');
  await atReceiver(10, 8, 0.5);
  const noCycle = (await offer()).evaluations[0].feasibility;
  ok('a spent cycle is reported as a restart, not a truck-stop hop',
    noCycle.cycleRestartRequired === true || /cycle/i.test((noCycle.blockers || []).join(' ')),
    `restart=${noCycle.cycleRestartRequired} ${(noCycle.blockers || []).join(' ').slice(0, 90)}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
