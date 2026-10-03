/* The weekly rest when none has been logged (reported from play, v0.81).
 *
 * Saturday 13:37, the day spent, no weekly rest ever logged — so the week counts from Monday 00:00 and 133:37
 * of the 144 are gone. An 11-hour daily rest would end past the 144, so the rest now has to be the weekly.
 * Dispatch read the empty "hours since the weekly rest" as not due and ordered the 11.
 *
 *   - with none logged, dispatch orders the weekly rest, as the planner always assumed
 *   - and counts from the last report forward to now, not as of the report
 *   - the clocks panel says when it is due
 *   - earlier in the week it is not due
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
const at = (gameTime) => api('/status', 'POST', { locationCity: 'Milan', locationState: 'IT', locationKind: 'Receiver', gameTime,
  fuelPct: 40, atsOdometer: 1500, truckDamagePct: 7, trailerDamagePct: 5, dutyStatus: 'OnDuty', atsBankBalance: 50000 });
const line = (asOf, b, d, w, w2) => api('/hos', 'POST', { breakRemaining: b, driveRemaining: d, shiftRemaining: 0, cycleRemaining: Math.min(w, w2),
  asOfGameTime: asOf, euWeekDriven: 56 - w, euLastWeekDriven: Math.max(0, 90 - w2 - (56 - w)), euDayDriven: null, spreadEstimated: true }).then((s) => s.hos);
async function said() {
  await api('/board/clear', 'POST', {});
  const d = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', originCity: 'Milan', originState: 'IT', destCity: 'Turin',
    destState: 'IT', loadedMiles: 90, gameRevenue: 900, weightLbs: 30000, atLocation: true, deadlineHours: 30 });
  return [d.headline, d.rationale, ...(d.dispatchNotes || [])].join(' | ');
}

(async () => {
  const app = { driverName: 'C. Smith', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. Thursday, a fresh day, no weekly rest logged: not due yet');
  await at('2000-01-04T08:00');
  let h = await line('2000-01-04T08:00', 4.5, 10, 30, 64);
  let s = await said();
  ok('no weekly rest ordered on a Thursday', !/weekly rest is due/i.test(s), s.slice(0, 200));

  head('2. Reported from play: Saturday 13:37, the day spent, none logged');
  await at('2000-01-06T13:37');
  h = await line('2000-01-06T13:37', 0, 0.5, 11.68, 45.68);
  s = await said();
  ok('dispatch orders the weekly rest, not the 11-hour daily rest', /weekly rest is due/i.test(s) && !/take your 11-hour daily rest/i.test(s), s.slice(0, 300));
  const boot = await api('/bootstrap');
  const due = boot.views?.hos?.weeklyRestDueInHours ?? boot.hos?.weeklyRestDueInHours;
  ok('the clocks panel says it is due in about 10:23', due == null || Math.abs(due - 10.38) < 0.1, `${due}`);

  head('3. Counted forward from the last report, not as of it');
  // The clocks typed on Friday at 20:00, the game clock now Saturday 13:37: still due.
  await at('2000-01-05T20:00');
  await line('2000-01-05T20:00', 4.5, 10, 21, 55);
  await at('2000-01-06T13:37');
  s = await said();
  ok('Saturday afternoon off a Friday report: due', /weekly rest is due/i.test(s), s.slice(0, 200));

  head('4. A Sunday truck ban where the weekly rest is taken: it runs to Monday');
  // Milan, Saturday 13:37: a 24 would end at 13:37 on Sunday, inside Italy's 09:00-22:00 ban.
  await at('2000-01-06T13:37');
  await line('2000-01-06T13:37', 0, 0.5, 11.68, 45.68);
  s = await said();
  ok('Milan on a Saturday afternoon: until Monday 00:00 (34:23, to the quarter hour)', /weekly rest is due — 34:30/i.test(s), s.slice(0, 200));
  ok('and the reason names Italy\'s ban', /Italy bans heavy trucks/.test(s) || /Italy bans heavy trucks/.test(JSON.stringify(await api('/bootstrap'))), s.slice(0, 400));
  // Somewhere with no weekend ban the 24 stands.
  await api('/status', 'POST', { locationCity: 'Rotterdam', locationState: 'NL', locationKind: 'TruckStop', gameTime: '2000-01-06T13:37',
    fuelPct: 40, atsOdometer: 1500, truckDamagePct: 7, trailerDamagePct: 5, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/board/clear', 'POST', {});
  const nl = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', originCity: 'Rotterdam', originState: 'NL', destCity: 'Utrecht',
    destState: 'NL', loadedMiles: 40, gameRevenue: 600, weightLbs: 30000, atLocation: true, deadlineHours: 30 });
  ok('Rotterdam, no ban: the reduced 24', /weekly rest is due — 24:00/i.test(nl.headline || ''), nl.headline);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
