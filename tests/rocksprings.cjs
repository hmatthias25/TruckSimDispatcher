/* The reported scenario, end to end: does the board actually pick the load that goes toward home?
 *
 * Thursday day 38, 13:44, sitting at Rock Springs WY with a full clock and home time OVERDUE in
 * Springfield MO. A board with several loads on it, including the 1,004-mile Pumpjack to Tulsa OK that
 * closes most of the distance home — and a Montana load that runs the other way.
 *
 * Reported outcome: the Tulsa load came back INFEASIBLE and the Montana one was authorized, taking the
 * driver further from a home time he was already late for. Two bugs behind it, both fixed: the window
 * was read a day early because every weekday name contains the letters "day", and the plan spent the
 * pre-dock wait ON DUTY, exhausting the window it then needed to unload.
 *
 * This suite is the acceptance check rather than the unit test — it asks the question the player asked.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5970}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
// Day 0 is the epoch, a Monday. Day 38 is a Thursday, 39 a Friday, 40 a Saturday.
const gday = (day, hm) => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-`
    + `${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

async function at(city, state, day, hm = '13:44', kind = 'Shipper') {
  const s = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: kind, gameTime: gday(day, hm),
    fuelPct: 100, atsOdometer: 40000 + day * 60, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 120000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  return s;
}

(async () => {
  const app = { driverName: 'H. Bound', preferredDivision: 'Flatbed', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: gday(1, '07:00'), code: 'PRI' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('Setup: Rock Springs, Thursday 13:44, full clock, home time overdue');
  // Wind the clock out so home time is genuinely late, then stand at Rock Springs.
  for (let d = 8; d <= 32; d += 8) await at('Rock Springs', 'WY', d);
  await at('Rock Springs', 'WY', 38, '13:44');

  const hs = (await api('/bootstrap')).views.homeTime;
  ok('home time is overdue', hs.overdue === true,
    `${hs.daysOut?.toFixed?.(1)} days out on a ${hs.intervalDays}-day arrangement`);
  ok('and home is Springfield, MO', /Springfield/.test(hs.terminalLabel || ''), hs.terminalLabel);
  // Put him on a flatbed the way an equipment order would; the fixture is about the board, not the swap.
  const flat = (await api('/bootstrap')).trailers.find((x) => x.type === 'Flatbed');
  if (flat) await api('/equipment/swap', 'POST', { trailerUnit: flat.unit, force: true }).catch(() => {});
  const trailer = (await api('/bootstrap')).views.trailer;
  console.log(`     pulling: ${trailer.type}`);

  head('A board with somewhere useful on it and somewhere useless');
  await api('/board/clear', 'POST', {});
  // The reported load, off the real listing.
  await api('/board/add', 'POST', {
    cargo: 'Pumpjack', trailerType: 'Flatbed',
    originCity: 'Rock Springs', originState: 'WY', destCity: 'Tulsa', destState: 'OK',
    loadedMiles: 1004, deadheadMiles: 0, gameRevenue: 2199,
    windowText: 'Sat 2:04 AM - Sat 8:44 AM', weightLbs: 6600, shipper: 'Liebherr',
  });
  // And the sort of thing that was winning instead: good money, wrong direction.
  await api('/board/add', 'POST', {
    cargo: 'Excavator', trailerType: 'Flatbed',
    originCity: 'Rock Springs', originState: 'WY', destCity: 'Great Falls', destState: 'MT',
    loadedMiles: 600, deadheadMiles: 0, gameRevenue: 1900,
    windowText: 'Sat 6:00 AM - Sat 6:00 PM', weightLbs: 30000,
  });
  await api('/board/add', 'POST', {
    cargo: 'Steel pipe', trailerType: 'Flatbed',
    originCity: 'Rock Springs', originState: 'WY', destCity: 'Salt Lake City', destState: 'UT',
    loadedMiles: 180, deadheadMiles: 0, gameRevenue: 620,
    windowText: 'Fri 8:00 AM - Fri 4:00 PM', weightLbs: 25000,
  });
  const decision = await api('/board/evaluate');

  const byDest = {};
  for (const e of decision.evaluations || []) byDest[e.load.destCity] = e;
  for (const e of decision.evaluations || [])
    console.log(`     ${e.load.destCity.padEnd(16)} ${String(e.feasibility.verdict).padEnd(11)}`
      + ` score ${String(e.score).padStart(6)}  ${e.recommendation}`);

  const tf = byDest.Tulsa.feasibility;
  console.log(`     TULSA: verdict=${tf.verdict} slack=${tf.slackHours}h buffer=${tf.requiredBufferHours}h`);
  console.log(`            arrive=${tf.projectedArrivalGameTime} due=${tf.dueGameTime} opens=${tf.appointmentOpensGameTime}`);
  console.log(`            elapsed=${tf.elapsedHours}h rests=${tf.restsRequired} wait=${tf.waitForAppointmentHours}h`);
  console.log(`            timeline: ${(tf.timeline || []).map((x) => `${x.label} ${x.hours}h`).join(' | ')}`);
  console.log(`     SLC:   ${JSON.stringify((byDest['Salt Lake City'].scoreDetail || []).filter((x) => /home/i.test(x)))}`);
  console.log(`     GF:    ${JSON.stringify((byDest['Great Falls'].scoreDetail || []).filter((x) => /home/i.test(x)))}`);

  head('1. The Tulsa load is runnable');
  ok('it is not refused', byDest.Tulsa && byDest.Tulsa.feasibility.verdict !== 'Infeasible',
    byDest.Tulsa?.feasibility.verdict || 'missing');
  ok('and the window is the Saturday off the listing',
    Math.abs(byDest.Tulsa.load.deadlineHours - 43.0) < 1.5, `due in ${byDest.Tulsa.load.deadlineHours}h`);

  head('2. And it is the one dispatch picks');
  ok('a load was authorized', !!decision.authorizedLoadId, decision.headline?.slice(0, 80) || 'none');
  ok('it is the Tulsa load', decision.authorizedLoadId === byDest.Tulsa?.load.id,
    (decision.evaluations || []).find((e) => e.load.id === decision.authorizedLoadId)?.load.destCity || 'none');
  ok('and not the one running away from home',
    decision.authorizedLoadId !== byDest['Great Falls']?.load.id, 'not Great Falls');

  head('3. Because it works him toward home, and the board says so');
  ok('the Tulsa card says it works toward home',
    (byDest.Tulsa.pros || []).some((x) => /toward Springfield/i.test(x)),
    (byDest.Tulsa.pros || []).find((x) => /Springfield/i.test(x))?.slice(0, 70) || '(none)');
  // Overdue wording is blunter than the due-soon wording: it names the broken promise rather than the yard.
  ok('the Montana card is warned against',
    (byDest['Great Falls'].cons || []).some((x) => /further out and your home time is already/i.test(x)),
    (byDest['Great Falls'].cons || []).find((x) => /further out/i.test(x))?.slice(0, 95) || '(none)');
  ok('and so is Salt Lake City, 150 mi the wrong way',
    (byDest['Salt Lake City'].cons || []).some((x) => /further out and your home time is already/i.test(x)),
    (byDest['Salt Lake City'].cons || []).find((x) => /further out/i.test(x))?.slice(0, 95) || '(none)');
  ok('neither is called neutral any more',
    !(byDest['Salt Lake City'].scoreDetail || []).some((x) => /Roughly neutral on home/i.test(x)),
    'penalised');
  ok('home time scores higher for Tulsa than for Great Falls',
    byDest.Tulsa.score > byDest['Great Falls'].score,
    `Tulsa ${byDest.Tulsa.score} vs Great Falls ${byDest['Great Falls'].score}`);
  ok('and the board note leads with home time being overdue',
    (decision.dispatchNotes || []).some((x) => /Home time is overdue/i.test(x)),
    (decision.dispatchNotes || []).find((x) => /Home time/i.test(x))?.slice(0, 90) || '(none)');
  head('4. At Tulsa: a load that finishes at Springfield is the ride home');
  // The other half of what was expected — get to Tulsa, look for something going to Springfield, and be
  // told plainly that it is the run home. Tulsa is ~250 mi out, outside the 200 mi home radius, so it
  // closes the gap without arriving: the load from HERE is the one that finishes it.
  const open = (await api('/bootstrap')).views.activeTrip;
  if (open) await api(`/trips/${open.id}/cancel`, 'POST', { reason: 'fixture — jump to Tulsa' });
  await at('Tulsa', 'OK', 40, '09:00');

  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Steel', trailerType: 'Flatbed',
    originCity: 'Tulsa', originState: 'OK', destCity: 'Springfield', destState: 'MO',
    loadedMiles: 250, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 20, weightLbs: 30000,
  });
  await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: 'Flatbed',
    originCity: 'Tulsa', originState: 'OK', destCity: 'Houston', destState: 'TX',
    loadedMiles: 480, deadheadMiles: 0, gameRevenue: 1700, deadlineHours: 26, weightLbs: 35000,
  });
  const home = await api('/board/evaluate');
  const picked = (home.evaluations || []).find((e) => e.load.id === home.authorizedLoadId);
  ok('the Springfield load is the one taken', picked?.load.destCity === 'Springfield',
    picked?.load.destCity || 'none');
  ok('and it is dispatched AS the run home',
    (home.dispatchNotes || []).some((x) => /ride home|being run to get you home/i.test(x)),
    (home.dispatchNotes || []).find((x) => /home/i.test(x))?.slice(0, 110) || '(none)');
  ok('with what to do once empty',
    (home.dispatchNotes || []).some((x) => /park it at the yard|deadhead to the|report in/i.test(x)),
    (home.dispatchNotes || []).find((x) => /yard|deadhead/i.test(x))?.slice(0, 110) || '(none)');

  head('5. At Tulsa with nothing going home: told where to look, then offered the empty run');
  await api('/board/clear', 'POST', {});
  // Only freight running away from Springfield, and thin money at that.
  for (const [city, st, mi] of [['Amarillo', 'TX', 360], ['Albuquerque', 'NM', 650]]) {
    await api('/board/add', 'POST', {
      cargo: 'Machinery', trailerType: 'Flatbed',
      originCity: 'Tulsa', originState: 'OK', destCity: city, destState: st,
      loadedMiles: mi, deadheadMiles: 0, gameRevenue: 260, deadlineHours: 18, weightLbs: 30000,
    });
  }
  const nothing = await api('/board/evaluate');
  ok('the board is rejected', nothing.rejectAll === true, `${nothing.rejectAll}`);
  const advice = (nothing.dispatchNotes || []).join(' | ');
  ok('and it says where to go looking rather than "reposition"',
    /check what is loading out of|Look at the board in|run you home empty/i.test(advice),
    advice.slice(-190) || '(none)');
  ok('tied to home time being overdue',
    /home time is overdue/i.test(advice), 'said');

  const offers = (await api('/bootstrap')).views.repositionOffers || [];
  console.log(`     offers: ${offers.map((o) => `${o.city || o.label} ${o.miles}mi`).join(' | ') || '(none)'}`);
  ok('an empty run home is on the table',
    offers.some((o) => /Springfield/i.test(`${o.city} ${o.label} ${o.headline}`)),
    offers.map((o) => o.city || o.label).join(', ') || '(none)');
  ok('with the miles worked out rather than asked for',
    offers.every((o) => typeof o.miles === 'number' && o.miles > 0),
    offers.map((o) => `${o.miles}mi`).join(', ') || '(none)');


  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
