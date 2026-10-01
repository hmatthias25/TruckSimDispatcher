/* EU clocks as an HOS companion shows them (reported from play, v0.80).
 *
 * The companion's EC 561 page shows Daily Drive Used, This Week Used, Previous Week and Two Weeks Left, with
 * B | D | W | 2W on its status line — and no spread at all. The form takes those as shown, and the spread is
 * estimated when it is left blank: today's driving with the breaks it required, or the time since the last
 * daily rest in the trip log, whichever is more.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
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
  const d = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const near = (a, b) => Math.abs(a - b) < 0.02;
const clocks = (at, extra) => api('/hos', 'POST', { driveRemaining: 6, shiftRemaining: 0, breakRemaining: 1.5, cycleRemaining: 40,
  asOfGameTime: at, euWeekDriven: 20, euLastWeekDriven: 30, euHoursSinceWeeklyRest: 50, ...extra }).then((s) => s.hos);

(async () => {
  const app = { driverName: 'L. Jensen', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(8) });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/status', 'POST', { locationCity: 'Hamburg', locationState: 'DE', locationKind: 'TruckStop', gameTime: iso(8, '14:00'),
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });

  head('1. No spread on the display: it is estimated from the driving');
  let h = await clocks(iso(8, '14:00'), { euDayDriven: 3, spreadEstimated: true });
  ok('3 hours driven, no break owed yet: 10 of the 13 left', h.spreadEstimated && near(h.shiftRemaining, 10), `${h.shiftRemaining}`);
  ok('today\'s driving is kept as reported', near(h.euDayDriven, 3));
  h = await clocks(iso(8, '14:00'), { euDayDriven: 5, spreadEstimated: true });
  ok('5 hours driven means a 45-minute break was taken: 7:15 left', near(h.shiftRemaining, 7.25), `${h.shiftRemaining}`);

  head('2. A rest in the trip log bounds it better');
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Hamburg', originState: 'DE',
    destCity: 'Bremen', destState: 'DE', loadedMiles: 80, deadheadMiles: 0, gameRevenue: 1500, deadlineHours: 40, weightLbs: 30000, atLocation: true });
  const ev = (await api('/board/evaluate')).evaluations[0];
  const trip = (await api('/dispatch/authorize', 'POST', { loadId: ev.load.id, overrideTight: true })).trip;
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'Rest', gameTime: iso(8, '20:00'), endGameTime: iso(9, '07:00') });
  h = await clocks(iso(9, '15:00'), { euDayDriven: 3, spreadEstimated: true });
  ok('rested until 07:00, now 15:00: eight hours of the spread gone, not three', near(h.shiftRemaining, 5), `${h.shiftRemaining}`);
  h = await clocks(iso(10, '15:00'), { euDayDriven: 3, spreadEstimated: true });
  ok('a rest more than a day old does not count: back to the driving', near(h.shiftRemaining, 10), `${h.shiftRemaining}`);

  head('3. A spread typed in is a spread');
  h = await clocks(iso(10, '15:00'), { euDayDriven: 3, shiftRemaining: 6.5, spreadEstimated: false });
  ok('kept as typed, and not marked estimated', !h.spreadEstimated && near(h.shiftRemaining, 6.5), `${h.shiftRemaining}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
