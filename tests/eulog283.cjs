/* EU time off by its length, and the driving day as a shift (reported from play, v0.80).
 *
 *   - a reduced nine logged as a Break is a reduced daily rest: the law has no break-or-rest kind, nine hours off
 *     is a daily rest. It was not counted, because only spans logged as Rest were
 *   - and it is counted when it is logged, not at the next status-line report; the log says what it was
 *   - the driving day runs between daily rests, not midnight to midnight: a shift across midnight is one day,
 *     so ten hours driven either side of it is a 10-hour day
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
const line = (at, b, d, w, w2) => api('/hos', 'POST', {
  breakRemaining: b, driveRemaining: d, shiftRemaining: 0, cycleRemaining: Math.min(w, w2), asOfGameTime: at,
  euWeekDriven: Math.max(0, 56 - w), euLastWeekDriven: Math.max(0, 90 - w2 - Math.max(0, 56 - w)),
  euDayDriven: null, spreadEstimated: true,
}).then((s) => s.hos);

(async () => {
  const app = { driverName: 'K. Novak', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(8) });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/status', 'POST', { locationCity: 'Hamburg', locationState: 'DE', locationKind: 'TruckStop', gameTime: iso(8, '06:00'),
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await line(iso(8, '06:00'), 4.5, 10, 56, 90);
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Hamburg', originState: 'DE',
    destCity: 'Bremen', destState: 'DE', loadedMiles: 80, deadheadMiles: 0, gameRevenue: 1500, deadlineHours: 200, weightLbs: 30000, atLocation: true });
  const ev = (await api('/board/evaluate')).evaluations[0];
  const trip = (await api('/dispatch/authorize', 'POST', { loadId: ev.load.id, overrideTight: true })).trip;

  head('1. A reduced nine, logged as a Break');
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'Break', gameTime: iso(8, '20:00'), endGameTime: iso(9, '05:00') });
  let h = (await api('/bootstrap')).hos;
  ok('counted as a reduced daily rest, before any status-line report', h.euReducedRestsUsed === 1, `${h.euReducedRestsUsed}`);
  const logged = ((await api('/bootstrap')).trips || []).flatMap((t) => t.events || []).find((e) => e.kind === 'Break' && e.endGameTime === iso(9, '05:00'))
    || ((await api(`/trips/${trip.id}`)).events || []).find((e) => e.kind === 'Break');
  ok('the log says what it counted as', logged && /reduced daily rest/.test(logged.detail || ''), logged && logged.detail);
  ok('and the spread runs from its end', near(h.shiftRemaining, 13), `${h.shiftRemaining}`);

  head('2. A short Break is still a break');
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'Break', gameTime: iso(9, '10:00'), endGameTime: iso(9, '10:45') });
  h = (await api('/bootstrap')).hos;
  ok('45 minutes is not a rest', h.euReducedRestsUsed === 1, `${h.euReducedRestsUsed}`);

  head('3. A shift across midnight is one driving day');
  // Out of the 9-hour rest at 05:00 on day 9. Six hours driven by 23:00, four more by 03:30 on day 10.
  await line(iso(9, '05:00'), 4.5, 10, 56, 90);
  await line(iso(9, '23:00'), 3, 4, 50, 84);
  h = await line(iso(10, '03:30'), 3, 0, 46, 80);
  ok('the ten hours land on one day', near(h.euDayDriving[9], 10) && h.euDayDriving[10] == null, JSON.stringify(h.euDayDriving));
  ok('and it is a 10-hour day used', h.euExtensionsUsed === 1, `${h.euExtensionsUsed}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
