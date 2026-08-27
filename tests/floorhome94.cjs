/* Issue #94 — below-break-even freight that gets an overdue driver home.
 *
 * Freight under the floor is a hard reject with two escapes: it buys us out of a dead market, or it
 * parks the truck where the cycle can restart. Both say the same thing — cheap, but it buys something
 * the rate does not measure.
 *
 * Getting home was not on that list, so a cheap load finishing at the driver's own yard while the
 * company was already past the arrangement it promised was rejected on rate. And because hard fails are
 * checked before scoring, the 1.4 home-time weight never got to argue for it.
 *
 * The comparison was wrong. "It loses money" is only true against a better load, and that is not the
 * choice: once home time is overdue the app already offers to run the driver in EMPTY over the same
 * miles for nothing. Any revenue at all beats that.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5964}/api`;
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
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;
async function place(city, state, day, hm = '07:00', odo = 30000) {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'TruckStop', gameTime: iso(day, hm),
    fuelPct: 85, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  }));
  await api('/hos', 'POST', { driveRemaining: 10, shiftRemaining: 13, breakRemaining: 8, cycleRemaining: 55 });
  return S;
}

// One load, priced under the break-even floor on purpose.
async function only(destCity, destState, miles, revenue, extra = {}) {
  await api('/board/clear', 'POST', {});
  return api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity, destState, loadedMiles: miles, deadheadMiles: 0,
    gameRevenue: revenue, deadlineHours: 30, weightLbs: 30000,
    ...extra,
  });
}

const evalOf = (bd) => (bd.evaluations || [])[0] || {};
const fails = (bd) => (evalOf(bd).hardFails || []).join(' ');
const pros = (bd) => (evalOf(bd).pros || []).join(' ');

(async () => {
  const app = { driverName: 'F. Loor', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const floor = (await api('/bootstrap')).views.breakEven;
  console.log(`     home yard: Springfield, MO · break-even about $${(floor?.breakEvenRpm ?? 0).toFixed(2)}/mi`);

  head('1. Not yet due: the floor still holds, wherever the load goes');
  await place('Kansas City', 'MO', 4);
  let hs = (await api('/bootstrap')).views.homeTime;
  ok('home time is nowhere near due', hs.overdue === false, `due in ${hs.daysUntilDue?.toFixed?.(1)} days`);
  let bd = await only('Springfield', 'MO', 165, 120);   // ~$0.73/mi, well under break-even
  ok('a cheap load home is rejected', bd.rejectAll === true, `rejectAll=${bd.rejectAll}`);
  ok('on the break-even floor', /break-even/i.test(fails(bd)), fails(bd).slice(0, 90));

  head('2. Wind it past the arrangement');
  for (let d = 10; d <= 34; d += 6) await place('Kansas City', 'MO', d, '07:00', 30000 + d * 40);
  hs = (await api('/bootstrap')).views.homeTime;
  ok('home time is now overdue', hs.overdue === true, `${hs.daysOut?.toFixed?.(1)} days out on ${hs.intervalDays}`);

  head('3. The same cheap load, now that the company is late');
  bd = await only('Springfield', 'MO', 165, 120);
  ok('it is no longer a hard fail', !/break-even/i.test(fails(bd)), fails(bd) || '(none)');
  ok('and it is authorized', bd.rejectAll !== true && !!bd.authorizedLoadId, `${bd.authorizedLoadId || 'none'}`);
  ok('the reason given is getting home, not the money',
    /gets you home/i.test(pros(bd)), pros(bd).slice(-150));
  ok('it says plainly what the alternative was',
    /running you in empty|empty over the same miles/i.test(pros(bd)), 'wording');
  ok('the rate is still called out as a con — nothing is hidden',
    /under our \$[\d.]+ break-even/i.test((evalOf(bd).cons || []).join(' ')),
    (evalOf(bd).cons || []).find((x) => /break-even/i.test(x))?.slice(0, 80) || '(none)');
  ok('and it is dispatched as the ride home',
    /ride home|being run to get you home/i.test((bd.dispatchNotes || []).join(' ')), 'noted');

  head('4. Only when it actually gets them home');
  // Overdue, but this one finishes 500-odd miles out. Closing distance is not arriving.
  bd = await only('Denver', 'CO', 600, 430);
  ok('a cheap load that merely points homeward is still rejected',
    bd.rejectAll === true, `rejectAll=${bd.rejectAll}`);
  ok('on the floor, as before', /break-even/i.test(fails(bd)), fails(bd).slice(0, 90));

  head('5. It is the home radius that decides, not the yard itself');
  // Tulsa is 208 mi from Springfield, so it lands on either side of the configured 200 — which makes it
  // the honest way to prove the radius is what is being read.
  //
  // Changed by #101: the radius WIDENS as the company runs late, so by this point in the fixture the
  // driver is far enough past due that Tulsa is already inside it. The setting is still what is being
  // read; it is simply no longer the whole answer. Proved here by narrowing it until Tulsa falls back
  // outside, which is the same demonstration from the other end.
  const dist = (await api('/geo/distance?cityA=Tulsa&stateA=OK&cityB=Springfield&stateB=MO'))?.miles;
  let st = (await api('/bootstrap')).settings;
  let hsNow = (await api('/bootstrap')).views.homeTime;
  ok('Tulsa is outside the CONFIGURED 200 mi radius', dist > st.scoring.homeRadiusMiles,
    `${Math.round(dist)} mi vs ${st.scoring.homeRadiusMiles}`);
  ok('but the effective radius has widened with the lateness',
    hsNow.homeRadius > st.scoring.homeRadiusMiles,
    `${Math.round(hsNow.homeRadius)} mi at ${hsNow.daysLate?.toFixed?.(1)} days late`);
  bd = await only('Tulsa', 'OK', 180, 130);
  ok('so a cheap load there gets through as the ride home',
    bd.rejectAll !== true, `rejectAll=${bd.rejectAll}`);
  ok('for that reason and no other', /gets you home/i.test(pros(bd)), 'ride home');

  st.scoring.homeRadiusMiles = 90;   // widened it is still only 2x, so 180 keeps Tulsa outside
  await api('/settings', 'POST', st);
  bd = await only('Tulsa', 'OK', 180, 130);
  ok('narrow it until Tulsa is outside again and the same load is rejected',
    bd.rejectAll === true, `rejectAll=${bd.rejectAll}`);
  ok('on the break-even floor, as it was before', /break-even/i.test(fails(bd)), fails(bd).slice(0, 90));
  st = (await api('/bootstrap')).settings;
  st.scoring.homeRadiusMiles = 200;
  await api('/settings', 'POST', st);

  head('6. Freight that pays is unaffected either way');
  bd = await only('Springfield', 'MO', 165, 900);
  ok('a properly-paying load home is authorized', !!bd.authorizedLoadId, bd.authorizedLoadId || 'none');
  ok('with no cheap-but excuse attached',
    !/gets you home and we are already late/i.test(pros(bd)), 'clean');

  head('7. It is an escape from the floor, not from anything else');
  // Overdue and finishing at home, and placarded freight this driver is not licensed for. The rate is
  // no longer the objection; the licence is, and getting home does not buy past that.
  bd = await only('Springfield', 'MO', 165, 120, { isHazmat: true, hazmatClass: '3' });
  ok('a load the driver is not qualified for is still rejected',
    bd.rejectAll === true, `rejectAll=${bd.rejectAll}`);
  ok('and the reason is the licence, not the rate',
    /not cleared for it|endorsement|Class \d/i.test(fails(bd)) && !/break-even/i.test(fails(bd)),
    fails(bd).slice(0, 100));

  // Same again on the clock: no room to take the 10 and still make the appointment.
  await api('/hos', 'POST', { driveRemaining: 0.5, shiftRemaining: 0.5, breakRemaining: 0.5, cycleRemaining: 40 });
  bd = await only('Springfield', 'MO', 165, 120, { deadlineHours: 3 });
  ok('nor does it buy past a window that cannot be made',
    bd.rejectAll === true, `rejectAll=${bd.rejectAll}`);
  ok('the objection is the clock',
    bd.outOfHours === true || /hours|window|legally|slack/i.test(
      (bd.headline || '') + ' ' + ((evalOf(bd).feasibility?.blockers) || []).join(' ')),
    (bd.headline || '').slice(0, 90));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
