/* A booked appointment was charged twice, so loads with no appointment floated to the top.
 *
 * Reported from play: "I feel like the dispatcher is weighting runs with no appointment lots of times
 * because there is no wait time... feels a bit like a cheat." The board it came off was mixed, and the
 * top three were all no-appointment deliveries.
 *
 * There was never an explicit bonus for it. The advantage was structural and it arrived twice:
 *
 *   1. SlackHours is the deadline minus the projected FINISH. A load that sits six hours on a gate
 *      finishes six hours later, so it already scored lower for the wait.
 *   2. The idle penalty was then applied on top, on the reasoning that a load holding the truck has
 *      MORE slack — which is not what slack measures.
 *
 * Together that is about -1.1 on a six-hour wait, against an all-in RPM term whose whole realistic
 * spread is 1.0. A booked appointment cost a load more than a bad rate did.
 *
 * The wait is real and should cost something. It should cost it once.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5898}/api`;
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
const iso = (day, hm = '07:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;

/** Pull one scored term out of the reasoning the card shows. */
const term = (ev, re) => {
  const line = (ev.scoreDetail || []).find((x) => re.test(x));
  if (!line) return null;
  const m = line.match(/([+-]\d+\.\d+)\s*$/);
  return m ? parseFloat(m[1]) : null;
};

(async () => {
  const app = { driverName: 'M. Ilic', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 8, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  // No receiver takes it early, so the appointment load definitely sits. The knob is the fixture.
  const cur = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...cur, receiverTakesEarlyPct: 0 });

  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: iso(10),
    fuelPct: 90, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 120000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });

  head('1. A mixed board: the same load twice, one of them booked in');
  // Identical in every way that scores — same lane, same miles, same money, same trailer — so anything
  // separating them is the appointment and nothing else.
  await api('/board/clear', 'POST', {});
  const common = {
    trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    loadedMiles: 120, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 22, weightLbs: 24000,
  };
  // Same destination on both. Two different towns is two different market tiers and two different
  // positioning scores, which is a gap of its own and would drown the one being measured.
  await api('/board/add', 'POST', { ...common, cargo: 'Paper Reels', destCity: 'Pueblo', destState: 'CO' });
  const r = await api('/board/add', 'POST', {
    ...common, cargo: 'Paper Reels, booked', destCity: 'Pueblo', destState: 'CO',
    appointmentOpensHours: 7,
  });

  const evs = r.evaluations || [];
  const free = evs.find((x) => !x.appointmentGameTime && !(x.feasibility?.idleHours > 0.25));
  const booked = evs.find((x) => x.feasibility?.idleHours > 0.25);

  ok('one load waits on a gate and one does not', !!free && !!booked,
    `free idle=${free?.feasibility?.idleHours} booked idle=${booked?.feasibility?.idleHours}`);

  if (free && booked) {
    head('2. The wait is priced once, by the term written to price it');
    const freeSlack = term(free, /HOS slack/);
    const bookedSlack = term(booked, /HOS slack/);
    const idlePts = term(booked, /tied up waiting on the appointment/);

    ok('the booked load really does finish later — slack is genuinely lower',
      booked.feasibility.slackHours < free.feasibility.slackHours - 0.5,
      `${free.feasibility.slackHours} vs ${booked.feasibility.slackHours}`);
    ok('but both score the SAME on slack, because the wait is set aside there',
      freeSlack != null && bookedSlack != null && Math.abs(freeSlack - bookedSlack) < 0.02,
      `${freeSlack} vs ${bookedSlack}`);
    ok('and the card says so rather than quietly adjusting the number',
      (booked.scoreDetail || []).some((x) => /charged below, not twice/i.test(x)),
      (booked.scoreDetail || []).find((x) => /HOS slack/.test(x)) || '(no slack line)');
    ok('the wait is charged, once', idlePts != null && idlePts < 0, `${idlePts}`);

    head('3. So the whole gap between them IS the wait, and nothing else');
    const gap = free.score - booked.score;
    ok('the no-appointment load still wins — sitting on a gate is not free',
      gap > 0, `${free.score.toFixed(2)} vs ${booked.score.toFixed(2)}`);
    ok('by exactly what the wait costs, not by that plus a slack difference',
      Math.abs(gap - Math.abs(idlePts)) < 0.05,
      `gap ${gap.toFixed(2)} vs idle ${Math.abs(idlePts).toFixed(2)}`);

    head('4. And that cost no longer outweighs the rate');
    // The point of the complaint: an appointment used to cost more than the difference between a good
    // load and a poor one, so the board sorted itself by paperwork instead of by money.
    ok('the wait costs less than the all-in RPM term can swing',
      Math.abs(gap) < 1.0, `wait ${gap.toFixed(2)} vs RPM spread 1.00`);
  }

  head('5. A quiet receiver is still worth something, and says why');
  await api('/settings', 'POST', { ...cur, receiverTakesEarlyPct: 100 });
  await api('/board/clear', 'POST', {});
  const early = (await api('/board/add', 'POST', {
    ...common, cargo: 'Paper Reels', destCity: 'Pueblo', destState: 'CO', appointmentOpensHours: 7,
  })).evaluations[0];
  ok('a receiver that takes it whenever spends none of the window sitting',
    !(early.feasibility?.idleHours > 0.25), `idle=${early.feasibility?.idleHours}`);
  ok('and it is said as a pro, not smuggled in through the arithmetic',
    (early.pros || []).some((x) => /take it whenever you arrive/i.test(x)),
    (early.pros || []).join(' | ').slice(0, 140) || '(silent)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
