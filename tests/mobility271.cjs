/* #271 - step 5 of Euro Truck Simulator 2 support (#266): the EU Mobility Package.
 *
 *   - home at least every four weeks: a legal ceiling on the arrangement, not a preference. A driver who
 *     asked for six weeks, or for no arrangement, is still brought home inside four
 *   - no regular weekly rest in the cab: away from home it is a hotel, and the company pays. A reduced one
 *     may be taken in the cab
 *
 * And none of it on an ATS career.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5979}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm = '06:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const MONDAY = 7;

/** Re-open the career with its game and home-time arrangement set, and the clock where we want it. */
async function career(game, intervalDays, { lastHomeDay = MONDAY, nowDay = MONDAY } = {}) {
  const st = await api('/export');
  st.game = game;
  st.driver.homeTimeIntervalDays = intervalDays;
  st.driver.lastHomeGameTime = iso(lastHomeDay);
  st.status.gameTime = iso(nowDay);
  st.restartOrders = [];
  await api('/import', 'POST', st);
  return (await api('/bootstrap')).views.homeTime;
}

(async () => {
  const app = { driverName: 'S. Novak', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'sixweeks' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(MONDAY) });

  head('0. ATS: the arrangement is the arrangement');
  let ht = await career('ATS', 42);
  ok('six weeks stays six weeks', ht.intervalDays === 42, `${ht.intervalDays} days`);
  ok('with no legal ceiling', !ht.legalCeiling);

  head('1. ETS2: home at least every four weeks, whatever was asked for');
  ht = await career('ETS2', 42);
  ok('six weeks is held to four', ht.intervalDays === 28, `${ht.intervalDays} days`);
  // v0.82: an EU contract is written in tours of two to four weeks, so six weeks is put on the four-week tour.
  ok('as the four-week tour, the longest a European contract writes', /four weeks/.test(ht.arrangement), ht.arrangement);
  ht = await career('ETS2', 0);
  ok('no arrangement still means home inside four weeks', ht.intervalDays === 28 && ht.tracked, `${ht.intervalDays} days, tracked ${ht.tracked}`);
  ht = await career('ETS2', 14);
  ok('two weeks stays two weeks — inside the law, the arrangement stands', ht.intervalDays === 14 && !ht.legalCeiling, `${ht.intervalDays}`);

  head('2. Past four weeks it is a breach of the law, and it reads as one');
  ht = await career('ETS2', 42, { lastHomeDay: MONDAY, nowDay: MONDAY + 23 });
  ok('due soon from three weeks', ht.dueSoon && !ht.overdue, `${ht.daysOut} days out`);
  ht = await career('ETS2', 42, { lastHomeDay: MONDAY, nowDay: MONDAY + 30 });
  ok('overdue past four', ht.overdue, `${ht.daysOut} days out`);
  ok('against the four-week tour', /28-day arrangement/.test(ht.headline), ht.headline.slice(0, 110));

  head('3. A regular weekly rest away from home is a hotel; a reduced one may be in the cab');
  await career('ETS2', 14);
  const plan = (c) => api('/hos/plan', 'POST', { loadedMiles: 56 * 20, deadlineHours: 400, loadingHours: 1, unloadingHours: 1,
    trailerType: 'Dry Van', usableFuelRangeMiles: 99999, startGameTime: iso(MONDAY), ...c });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 56, asOfGameTime: iso(MONDAY),
    euWeekDriven: 0, euLastWeekDriven: 0, euHoursSinceWeeklyRest: 130, euLastWeeklyRestReduced: true });
  let p = await plan({});
  const regular = p.timeline.find((t) => t.kind === 'Restart');
  ok('the regular weekly rest is not in the cab', /Not in the cab — a hotel/.test(regular?.label || ''), regular?.label);
  ok('and costs the company', p.hotelNights >= 2 && p.hotelCost > 0, `${p.hotelNights} night(s), ${p.hotelCost}`);
  ok('which the plan says', p.warnings.some((w) => /hotel/.test(w)));
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 56, asOfGameTime: iso(MONDAY),
    euWeekDriven: 0, euLastWeekDriven: 0, euHoursSinceWeeklyRest: 130, euLastWeeklyRestReduced: false });
  p = await plan({});
  const reduced = p.timeline.find((t) => t.kind === 'Restart');
  ok('a reduced one may be taken in the cab', /cab is allowed/.test(reduced?.label || '') && p.hotelNights === 0, reduced?.label);

  head('4. A regular weekly rest order away from home books the hotel');
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 56, asOfGameTime: iso(MONDAY),
    euWeekDriven: 0, euLastWeekDriven: 0, euHoursSinceWeeklyRest: 125, euLastWeeklyRestReduced: true });
  await api('/status', 'POST', { locationCity: 'Lyon', locationState: 'FR', locationKind: 'TruckStop', gameTime: iso(MONDAY),
    fuelPct: 90, atsOdometer: 90000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  const blockers = ((await api('/bootstrap')).views.dispatchBlockers || []).join(' || ');
  ok('the order is a full weekly rest', /45 hours/.test(blockers), blockers.slice(0, 100));
  const order = (await api('/export')).restartOrders?.[0];
  if (order?.atHomeTerminal) {
    ok('(the order is at the home yard, so no hotel is owed — nothing to book)', !/hotel/.test(blockers));
  } else {
    ok('and says it is a hotel, on the company', /hotel; the company pays/.test(blockers), (blockers.match(/A full weekly rest away[^|]*/) || [''])[0].slice(0, 120));
    const before = ((await api('/export')).ledger || []).filter((e) => e.category === 'Accommodation').length;
    await api('/restart/arrived', 'POST', { gameTime: iso(MONDAY, '08:00'), city: 'Lyon', state: 'FR' });
    const done = await api('/restart/complete', 'POST', { gameTime: iso(MONDAY + 2, '05:00') });
    ok('45 hours later it is accepted', done.accepted, (done.message || '').slice(0, 120));
    const hotel = ((await api('/export')).ledger || []).filter((e) => e.category === 'Accommodation');
    ok('and the hotel is on the company\'s books', hotel.length === before + 1 && hotel[hotel.length - 1].amount < 0,
      hotel.length ? `${hotel[hotel.length - 1].amount} — ${hotel[hotel.length - 1].memo.slice(0, 60)}` : 'nothing booked');
    ok('as two nights', /2 hotel night/.test(hotel[hotel.length - 1]?.memo || ''));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
