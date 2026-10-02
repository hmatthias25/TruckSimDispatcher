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
  ok('the ten hours land on one day', Object.values(h.euDayDriving).length === 1 && near(Object.values(h.euDayDriving)[0], 10), JSON.stringify(h.euDayDriving));
  ok('and it is a 10-hour day used', h.euExtensionsUsed === 1, `${h.euExtensionsUsed}`);
  ok('one shift of driving is not a multi-day report', !h.euMultiDayReport, `${h.euMultiDayReport}`);

  head('4. A logged daily rest starts a fresh day, without a status-line report');
  // D is 0 and B 3:00 off the 03:30 report. Rest 03:30 to 12:30.
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'Rest', gameTime: iso(10, '03:30'), endGameTime: iso(10, '12:30') });
  h = (await api('/bootstrap')).hos;
  ok('D back to ten: a 10-hour day is still left this week', near(h.driveRemaining, 10) && h.euDailyLimit === 10, `${h.driveRemaining}, limit ${h.euDailyLimit}`);
  ok('B back to 4:30', near(h.breakRemaining, 4.5), `${h.breakRemaining}`);
  ok('the spread a fresh 13', near(h.shiftRemaining, 13), `${h.shiftRemaining}`);
  ok('W does not move: rest is not driving', near(h.euWeekDriven, 10), `${h.euWeekDriven}`);
  ok('and the panel is told the clocks are the rest\'s, not the status line\'s', h.euClocksFromRest === true && h.asOfGameTime === iso(10, '12:30'));

  head('5. A rest logged after a newer report does not undo the report');
  h = await line(iso(10, '16:30'), 1, 6, 42, 76);
  ok('the report clears the rest\'s flag', h.euClocksFromRest === false);
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'Break', gameTime: iso(10, '13:00'), endGameTime: iso(10, '13:45') });
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'Rest', gameTime: iso(9, '05:30'), endGameTime: iso(9, '05:40') });
  h = (await api('/bootstrap')).hos;
  ok('D and B stay as reported', near(h.driveRemaining, 6) && near(h.breakRemaining, 1), `${h.driveRemaining}, ${h.breakRemaining}`);

  head('6. One report covering more than a shift can hold');
  // Out of both 10-hour days' worth of reports: 22 hours of driving reported at once.
  h = await line(iso(12, '20:00'), 2, 1, 20, 54);
  ok('said: it spans driving days', near(h.euMultiDayReport, 22), `${h.euMultiDayReport}`);
  h = await line(iso(12, '21:00'), 2, 1, 20, 54);
  ok('and cleared by the next report', !h.euMultiDayReport, `${h.euMultiDayReport}`);

  head('7. Reported from play: 4:28 driven, a nine-hour rest NOT logged, the clocks typed on rolling again');
  // A fresh week (day 15 is a Monday). Out at 05:09 on a fresh clock; drove 4:28; rested 09:37 to 18:37 without
  // logging it; typed the status line at 18:37 — B and D full again, W down 4:28.
  await line(iso(15, '05:09'), 4.5, 10, 56, 90);
  h = await line(iso(15, '18:37'), 4.5, 10, 51.53, 85.53);
  ok('the full D and B are read as a new shift: the spread is a fresh 13', near(h.shiftRemaining, 13), `${h.shiftRemaining}`);
  ok('no 10-hour day spent on a 4:28 morning', h.euExtensionsUsed === 0, `${h.euExtensionsUsed} — ${JSON.stringify(h.euDayDriving)}`);
  ok('the 4:28 is on the morning\'s shift, not the evening\'s', Object.values(h.euDayDriving).some((v) => near(v, 4.47)), JSON.stringify(h.euDayDriving));
  ok('and D stays the ten typed', near(h.driveRemaining, 10) && h.euDailyLimit === 10, `${h.driveRemaining}`);
  h = await line(iso(15, '20:37'), 2.5, 8, 49.53, 83.53);
  ok('two hours into the evening shift, its spread runs from 18:37', near(h.shiftRemaining, 11), `${h.shiftRemaining}`);

  head('7b. The same day with the rest LOGGED first, then the clocks typed (as it was actually played)');
  // Day 16: out at 05:09 fresh; 4:28 driven; the 09:37-18:37 rest logged; the status line typed at 18:37.
  await line(iso(16, '05:09'), 4.5, 10, 49.53, 83.53);
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'Rest', gameTime: iso(16, '09:37'), endGameTime: iso(16, '18:37') });
  h = await line(iso(16, '18:37'), 4.5, 10, 45.06, 79.06);
  ok('the spread is a fresh 13, not spent', near(h.shiftRemaining, 13), `${h.shiftRemaining}`);
  ok('no 10-hour day spent', h.euExtensionsUsed === 0, `${h.euExtensionsUsed} — ${JSON.stringify(h.euDayDriving)}`);
  // And typed later instead, two hours into the evening: D says two of the 6:28 were after the rest.
  await line(iso(17, '05:09'), 4.5, 10, 45.06, 79.06);
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'Rest', gameTime: iso(17, '09:37'), endGameTime: iso(17, '18:37') });
  h = await line(iso(17, '20:37'), 2.5, 8, 38.59, 72.59);
  ok('split across the rest by D: 2 hours on the evening shift, so 11 of spread left', near(h.shiftRemaining, 11), `${h.shiftRemaining}`);
  ok('and 4:28 on the morning one', Object.values(h.euDayDriving).some((v) => near(v, 4.47)), JSON.stringify(h.euDayDriving));

  head('8. The migration: a career written before shifts, with a lumped day spending a 10-hour day');
  const st = await api('/export');
  st.schemaVersion = 32;
  st.hos.euDayDriving = { 15: 11.5, 16: 6 };
  st.hos.euExtensionsUsed = 1;
  st.hos.euShiftStart = '';
  st.hos.breakRemaining = 4.5; st.hos.driveRemaining = 10; st.hos.shiftRemaining = 0;
  await api('/import', 'POST', st);
  h = (await api('/bootstrap')).hos;
  ok('the lumped 11:30 no longer spends a 10-hour day', h.euExtensionsUsed === 0, `${h.euExtensionsUsed} — ${JSON.stringify(h.euDayDriving)}`);
  ok('the 6 hours are kept, on the new key', Object.values(h.euDayDriving).some((v) => near(v, 6)), JSON.stringify(h.euDayDriving));
  ok('and the last clocks, a fresh day\'s, start the shift: the spread is 13 again', near(h.shiftRemaining, 13), `${h.shiftRemaining}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
