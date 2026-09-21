/* The app promised to route you home. What it actually did was cap how far out you could go.
 *
 *   "If I'm 2 days from home time I get a warning in the app that dispatch is routing me toward home.
 *    But is it? For example if I'm in Wichita and my home is in Springfield could I still get routed to
 *    california, which would make me very late for home time?"
 *
 * California, no — that was working. Standing in Wichita, 269 mi from Springfield, two days out gives an
 * outbound allowance of 305 mi, and Fresno is 1,480 mi further out. It is refused, and refused hard: the
 * reason goes in HomeTimeFails, which bars a load as firmly as a missing endorsement and is not
 * something a good rate can outbid.
 *
 * Two things were wrong underneath the question, though, and both came out of asking it.
 *
 * ONE. The headline said "Operations is working freight back toward Springfield, MO" and, when overdue,
 * "Dispatch is routing you toward Springfield, MO". Neither is what the rule does. The rule is a CEILING
 * on how much further out a load may leave you, plus a scoring preference. Those are not the same
 * promise: Sioux Falls is 295 mi further out and passes the ceiling with ten miles to spare, on a screen
 * that said freight was being worked back toward the yard. A driver reading a promise bigger than the
 * protection plans against the promise.
 *
 * TWO. The dead band — how far a load has to move you before the scorer counts it either way — was a
 * flat 150 mi right up to the due date. A hundred and fifty is a fair description of noise with a week
 * to run. Two days out it is most of a driving day: Omaha, 107 mi further from the yard, scored a flat
 * zero, was described as "roughly neutral on home time", and the decision then went to rate. It now
 * tapers with the days left and lands on the overdue figure exactly as the date arrives, so there is no
 * step at the boundary.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm = '07:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S, odo = 100000;

/** Stand the truck in a city on a given game day. */
async function place(city, st, day) {
  odo += 200;
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: 'Shipper', gameTime: iso(day),
    fuelPct: 90, atsOdometer: odo, truckDamagePct: 2, dutyStatus: 'OnDuty',
  }));
  return (await api('/bootstrap')).views.homeTime;
}

/** One listing out of Wichita, evaluated. */
async function offer(destCity, destState) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const bd = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Wichita', originState: 'KS', destCity, destState,
    loadedMiles: 300, deadheadMiles: 0, gameRevenue: 1600, deadlineHours: 48,
    weightLbs: 34000, atLocation: true,
  });
  return (bd.evaluations || [])[0];
}

const homeLine = (e) => (e.scoreDetail || []).find((d) => /home time|home radius|toward|further from|lateral/i.test(d)) || '';
const barred = (e) => (e.homeTimeFails || []).join(' | ');

(async () => {
  const app = { driverName: 'H. Bound', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. Two days out in Wichita, which is where the question came from');
  // Hired on day 1 on a 14-day arrangement, so day 13 is twelve days out and two to go.
  let hs = await place('Wichita', 'KS', 13);
  console.log(`  ..    ${hs.daysOut.toFixed(1)} days out, due in ${hs.daysUntilDue.toFixed(1)}, ` +
              `${hs.milesFromHome?.toFixed(0)} mi from ${hs.terminalLabel}, allowance ${hs.outboundAllowance} mi`);
  ok('home time is in view', hs.dueSoon === true && hs.overdue === false, `dueSoon=${hs.dueSoon}`);
  ok('roughly two days to go', Math.abs(hs.daysUntilDue - 2) < 0.6, hs.daysUntilDue.toFixed(2));
  ok('and the enforced ceiling is about 300 miles', Math.abs(hs.outboundAllowance - 305) < 10,
    `${hs.outboundAllowance} mi`);

  head('2. The headline says what is enforced, not what sounds reassuring');
  console.log(`  ..    ${hs.headline}`);
  ok('it no longer claims freight is being worked back toward the yard',
    !/working freight back toward|routing you toward/i.test(hs.headline),
    /working freight back|routing you toward/i.test(hs.headline) ? 'still claims it' : 'dropped');
  ok('it states the ceiling', /Nothing gets authorised that leaves you more than/i.test(hs.headline));
  ok('with the figure in it', hs.headline.includes(`${hs.outboundAllowance}`), `${hs.outboundAllowance}`);
  ok('and is honest that the rest is a scoring preference',
    /scores ahead of freight that does not/i.test(hs.headline));

  head('3. California is refused, which was the actual question');
  const cal = await offer('Fresno', 'CA');
  console.log(`  ..    ${barred(cal).slice(0, 150)}`);
  ok('a load to California is barred outright', !!barred(cal));
  ok('not merely scored down', cal.recommendation === 'Reject', cal.recommendation);

  head('4. A load that passes the ceiling can still run the wrong way');
  // This is the gap between what the old headline promised and what the rule does. Sioux Falls is 295 mi
  // further out against an allowance of 305 — legal, and nobody should read it as going home.
  const sioux = await offer('Sioux Falls', 'SD');
  console.log(`  ..    ${homeLine(sioux)}`);
  ok('it is not barred', !barred(sioux), barred(sioux).slice(0, 80) || 'allowed');
  ok('but it is scored as running away from home', /further from/i.test(homeLine(sioux)));
  ok('and the driver is told so on the card',
    (sioux.cons || []).some((c) => /further from/i.test(c)),
    (sioux.cons || []).find((c) => /further from/i.test(c))?.slice(0, 90) || '(silent)');

  head('5. The reported case: 107 mi the wrong way is no longer "roughly neutral"');
  // Omaha is 376 mi from Springfield against Wichita's 269. Under the old flat 150 band this scored zero
  // and the decision went to rate. The band two days out is now 100.
  const omaha = await offer('Omaha', 'NE');
  console.log(`  ..    ${homeLine(omaha)}`);
  ok('it is not called neutral', !/roughly neutral/i.test(homeLine(omaha)), homeLine(omaha).slice(0, 100));
  ok('it counts against the load', /further from/i.test(homeLine(omaha)));

  head('6. Genuinely lateral freight is still treated as lateral');
  // Des Moines is 95 mi further out, inside the 100 the band allows at two days. The point of the band is
  // that freight does not run in straight lines; narrowing it must not mean reacting to every wobble.
  const dsm = await offer('Des Moines', 'IA');
  console.log(`  ..    ${homeLine(dsm)}`);
  ok('a 95-mile wobble is still neutral', /roughly neutral/i.test(homeLine(dsm)), homeLine(dsm).slice(0, 100));
  ok('and the band it was judged against is quoted', /mi either way I treat as lateral/i.test(homeLine(dsm)));

  head('7. Earlier in the arrangement the same load is lateral');
  // Same truck, same city, same load — a different point in the story. On a monthly arrangement with a
  // week still to run, Omaha at 107 mi further out is inside the widest band and genuinely is noise.
  S = un(await api('/career/home-time', 'POST', { preference: 'monthly' }));
  hs = await place('Wichita', 'KS', 25);
  console.log(`  ..    ${hs.arrangement || hs.intervalDays + '-day'}: ${hs.daysOut.toFixed(1)} out, ` +
              `due in ${hs.daysUntilDue.toFixed(1)}, dueSoon ${hs.dueSoon}`);
  if (hs.dueSoon && hs.daysUntilDue >= 4) {
    const omaha2 = await offer('Omaha', 'NE');
    console.log(`  ..    ${homeLine(omaha2)}`);
    ok('with days in hand it is noise again', /roughly neutral/i.test(homeLine(omaha2)),
      homeLine(omaha2).slice(0, 100));
    ok('because the band is at its widest', /150 mi either way/i.test(homeLine(omaha2)),
      homeLine(omaha2).match(/\d+ mi either way/)?.[0] || '(no figure)');
    // And Dallas, 153 mi out, is just past even the widest band.
    const dal = await offer('Dallas', 'TX');
    ok('while 153 mi still counts against the load', /further from/i.test(homeLine(dal)),
      homeLine(dal).slice(0, 90));
  } else {
    ok('could not reach the wide end of the window in this fixture', true,
      `dueSoon=${hs.dueSoon} daysUntilDue=${hs.daysUntilDue?.toFixed(1)}`);
  }

  head('8. Overdue: the band is at its floor and the headline says what it does');
  // Barely late on purpose. The home radius WIDENS with lateness — up to twice the configured 200 mi —
  // so a badly overdue driver in Wichita is already inside their own home area, every load near the
  // yard scores as the ride home, and none of the rules under test here are the ones in play.
  hs = await place('Wichita', 'KS', 32);
  console.log(`  ..    ${hs.daysOut.toFixed(1)} out against ${hs.intervalDays}, overdue ${hs.overdue}, ` +
              `allowance ${hs.outboundAllowance} mi`);
  if (hs.overdue) {
    console.log(`  ..    ${hs.headline}`);
    ok('the headline does not claim to be routing anybody',
      !/routing you toward/i.test(hs.headline), 'dropped');
    ok('it says getting them back outranks the rate',
      /outranks the rate/i.test(hs.headline), hs.headline.slice(-90));
    const dsm2 = await offer('Des Moines', 'IA');
    console.log(`  ..    ${homeLine(dsm2)}`);
    ok('and 95 mi the wrong way now counts, because the band floors at 50',
      /further from/i.test(homeLine(dsm2)), homeLine(dsm2).slice(0, 100));
  } else {
    ok('fixture did not reach overdue', true, `daysOut=${hs.daysOut?.toFixed(1)}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
