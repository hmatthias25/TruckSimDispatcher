/* Taking a rest the driver chose, and a jump in the clock that may have been one (reported from play, v0.87).
 *
 * The truck needed repairing, so the driver sat their 45 while it was in the shop and typed the new time in sixty
 * hours on. Nothing said it was a rest, and the app told them to take another. And the weekly rest's button read
 * "The 34 is done".
 *
 *   - the driver can say they are taking a rest, and which: ATS, the 10 or the 34; ETS2, daily, reduced or full weekly
 *   - that opens the parked-up step, then the done step, both checked as a rest dispatch orders is
 *   - a daily rest gives the day's clocks back; a weekly one starts the six days again
 *   - a jump in the clock a rest long, with the odometer still, is asked about; driving across it is not
 *   - answering it with the weekly rest stands in for one dispatch had ordered
 *   - a rest taken during a load goes on its trip log, once
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
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
const refuses = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const near = (a, b, e = 0.05) => Math.abs(a - b) < e;
/** Day 1 is a Monday on the game's calendar. */
const iso = (day, hm = '06:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const status = (city, state, gameTime, odo) => api('/status', 'POST', { locationCity: city, locationState: state, locationKind: 'TruckStop',
  gameTime, fuelPct: 80, atsOdometer: odo, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 }).then(un);
const line = (at, b, d, w, w2) => api('/hos', 'POST', {
  breakRemaining: b, driveRemaining: d, shiftRemaining: 0, cycleRemaining: Math.min(w, w2), asOfGameTime: at,
  euWeekDriven: Math.max(0, 56 - w), euLastWeekDriven: Math.max(0, 90 - w2 - Math.max(0, 56 - w)),
  euDayDriven: null, spreadEstimated: true,
}).then((s) => s.hos);
const boot = () => api('/bootstrap');
async function board(city, state, dest, destState) {
  await api('/board/clear', 'POST', {});
  return api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: city, originState: state,
    destCity: dest, destState, loadedMiles: 120, deadheadMiles: 0, gameRevenue: 1500, deadlineHours: 200, weightLbs: 30000, atLocation: true });
}

(async () => {
  // ------------------------------------------------------------------ ATS
  const usApp = { driverName: 'R. Ortiz', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true };
  await api('/onboarding/market', 'POST', usApp);
  await api('/onboarding/hire', 'POST', { application: usApp, force: true, gameTime: iso(1) });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  let S = await status('Amarillo', 'TX', iso(1, '08:00'), 100000);
  await api('/hos', 'POST', { driveRemaining: 1, shiftRemaining: 2, breakRemaining: 1, cycleRemaining: 50, asOfGameTime: iso(1, '08:00') });

  head('1. ATS: the 10-hour rest and the 34 on offer');
  S = await boot();
  const usKeys = (S.views.rest?.choices || []).map((c) => c.key).join(',');
  ok('daily and weekly', usKeys === 'daily,weekly', usKeys);
  ok('called the 10-hour rest and the 34-hour restart', /10-hour rest/.test(S.views.rest.choices[0].label) && /34-hour restart/.test(S.views.rest.choices[1].label),
    S.views.rest.choices.map((c) => c.label).join(' / '));

  head('2. ATS: a 10-hour rest, parked up and done');
  let r = await api('/rest/take', 'POST', { kind: 'daily' });
  ok('taken: on order, the driver\'s own', r.order.kind === 'Daily' && r.order.trigger === 'Chosen' && r.order.status === 'Ordered', JSON.stringify(r.order).slice(0, 160));
  ok('nothing more to choose while it is open', (un(r).views.rest.choices || []).length === 0);
  ok('and it is not a restart order', !un(r).views.restart);
  await api('/restart/arrived', 'POST', { gameTime: iso(1, '09:00'), city: 'Amarillo', state: 'TX' });
  const held = await board('Amarillo', 'TX', 'Lubbock', 'TX');
  ok('parked on it, the board waits', held.rejectAll === true && /10-hour rest/.test((held.evaluations[0].hardFails || []).join(' ')),
    (held.evaluations[0].hardFails || []).join(' | ').slice(0, 200));
  r = await api('/restart/complete', 'POST', { gameTime: iso(1, '17:00') });
  ok('eight hours is refused', r.accepted === false && /short/.test(r.message), r.message);
  r = await api('/restart/complete', 'POST', { gameTime: iso(1, '19:00') });
  S = un(r);
  ok('ten hours is done', r.accepted === true, r.message);
  ok('the drive and shift clocks are back', near(S.hos.driveRemaining, 11) && near(S.hos.shiftRemaining, 14), `${S.hos.driveRemaining} / ${S.hos.shiftRemaining}`);
  ok('the cycle is not', near(S.hos.cycleRemaining, 50), `${S.hos.cycleRemaining}`);
  ok('and the game clock is at its end', S.status.gameTime === iso(1, '19:00'), S.status.gameTime);

  head('3. ATS: a gap the length of a rest, odometer still, is asked about');
  S = await status('Amarillo', 'TX', iso(2, '09:00'), 100000);
  ok('fourteen hours with no miles: were you resting?', S.views.rest.gap && near(S.views.rest.gap.hours, 14), JSON.stringify(S.views.rest.gap));
  S = un(await api('/rest/gap/dismiss', 'POST', {}));
  ok('"no, I was working" drops it', !S.views.rest.gap);
  S = await status('Tucumcari', 'NM', iso(2, '21:00'), 100600);
  ok('twelve hours with 600 miles on the odometer: not asked', !S.views.rest.gap, JSON.stringify(S.views.rest.gap));

  head('4. ATS: a 34 logged off a gap needs the cycle back on the display first');
  S = await status('Tucumcari', 'NM', iso(4, '09:00'), 100600);
  ok('36 hours still: asked', S.views.rest.gap && near(S.views.rest.gap.hours, 36), JSON.stringify(S.views.rest.gap));
  let why = await refuses(() => api('/rest/gap', 'POST', { kind: 'weekly', from: iso(2, '21:00'), to: iso(4, '09:00') }));
  ok('refused with the cycle at 50', /cycle/i.test(why || ''), why);
  ok('and nothing is left behind', !(await boot()).restartOrders.some((o) => o.status === 'Arrived' || (o.trigger === 'Chosen' && o.status === 'Ordered')));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70, asOfGameTime: iso(4, '09:00') });
  r = await api('/rest/gap', 'POST', { kind: 'weekly', from: iso(2, '21:00'), to: iso(4, '09:00') });
  S = un(r);
  ok('with it back, the 34 is logged', /complete/.test(r.message) && r.order.kind === 'Weekly', r.message);
  ok('and the question is answered', !S.views.rest.gap);

  // ------------------------------------------------------------------ ETS2
  await api('/reset', 'POST', { confirm: 'RESET', resetSettings: true });
  const euApp = { driverName: 'L. Jensen', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', euApp);
  await api('/onboarding/hire', 'POST', { application: euApp, force: true, gameTime: iso(1) });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await status('Frankfurt', 'DE', iso(1, '06:00'), 1000);
  await line(iso(1, '06:00'), 4.5, 10, 56, 90);
  await status('Frankfurt', 'DE', iso(1, '18:00'), 1500);
  await line(iso(1, '18:00'), 0.5, 1, 47, 81);

  head('5. ETS2: daily, a reduced 24, and the full 45 on offer');
  S = await boot();
  const euKeys = (S.views.rest?.choices || []).map((c) => c.key).join(',');
  ok('daily, reduced, weekly', euKeys === 'daily,reduced,weekly', euKeys);
  ok('the daily rest can be a reduced nine', near(S.views.rest.choices[0].hours, 9), `${S.views.rest.choices[0].hours}`);

  head('6. ETS2: a daily rest, done, is a fresh day');
  await api('/rest/take', 'POST', { kind: 'daily' });
  await api('/restart/arrived', 'POST', { gameTime: iso(1, '19:00'), city: 'Frankfurt', state: 'DE' });
  r = await api('/restart/complete', 'POST', { gameTime: iso(2, '03:00') });
  ok('eight hours is short of even a reduced one', r.accepted === false, r.message);
  r = await api('/restart/complete', 'POST', { gameTime: iso(2, '06:00') });
  S = un(r);
  ok('eleven is a regular daily rest', r.accepted === true && /regular daily rest/.test(r.message), r.message);
  ok('B 4:30 and D the day\'s limit again', near(S.hos.breakRemaining, 4.5) && S.hos.driveRemaining >= 9 - 0.01, `B ${S.hos.breakRemaining} D ${S.hos.driveRemaining}`);
  ok('the week is not given back', near(S.hos.euWeekDriven, 9), `${S.hos.euWeekDriven}`);

  head('7. ETS2: the full 45, chosen — parked up and done, with the right words');
  await line(iso(3, '18:00'), 1, 1, 30, 64);
  await status('Frankfurt', 'DE', iso(3, '18:00'), 2400);
  r = await api('/rest/take', 'POST', { kind: 'weekly' });
  S = un(r);
  ok('on order at 45 hours', r.order.trigger === 'Chosen' && near(r.order.requiredHours, 45), `${r.order.requiredHours}`);
  ok('it is the restart panel\'s order, so the board waits', S.views.restart?.order?.number === r.order.number);
  ok('the instructions call it a weekly rest, not a 34', /weekly rest/.test(S.views.restart.instructions.join(' ')) && !/34/.test(S.views.restart.instructions.join(' ')),
    S.views.restart.instructions.join(' '));
  await api('/restart/arrived', 'POST', { gameTime: iso(3, '19:00'), city: 'Frankfurt', state: 'DE' });
  r = await api('/restart/complete', 'POST', { gameTime: iso(5, '12:00') });
  ok('41 hours is short of the 45 chosen', r.accepted === false, r.message);
  r = await api('/restart/complete', 'POST', { gameTime: iso(5, '16:00') });
  S = un(r);
  ok('45 is a weekly rest', r.accepted === true && /weekly rest/.test(r.message) && !/reduced/.test(r.message), r.message);
  ok('a regular one, nothing owed', S.hos.euLastWeeklyRestReduced === false && near(S.hos.euCompensationOwed, 0));
  ok('the six days start again', near(S.hos.euHoursSinceWeeklyRest ?? -1, 0), `${S.hos.euHoursSinceWeeklyRest}`);

  head('8. Reported from play: a 45 sat in the shop, typed in sixty hours on, after dispatch had ordered the weekly rest');
  // Day 10 18:00 is 122 hours after the last one: due within the day, and the day is spent.
  await status('Frankfurt', 'DE', iso(10, '18:00'), 3000);
  await line(iso(10, '18:00'), 0, 0.5, 12, 50);
  const due = await board('Frankfurt', 'DE', 'Mainz', 'DE');
  S = await boot();
  const ordered = S.views.restart?.order;
  ok('dispatch has ordered the weekly rest', ordered && ordered.trigger !== 'Chosen' && /weekly rest is due/i.test([due.headline, ...(due.dispatchNotes || [])].join(' ')),
    ordered ? ordered.number : '(none)');
  S = await status('Frankfurt', 'DE', iso(13, '06:00'), 3000);
  ok('sixty hours later, no miles: asked', S.views.rest.gap && near(S.views.rest.gap.hours, 60), JSON.stringify(S.views.rest.gap));
  ok('with the weekly rest among the answers', (S.views.rest.choices || []).some((c) => c.key === 'weekly'));
  why = await refuses(() => api('/rest/gap', 'POST', { kind: 'weekly', from: iso(12, '18:00'), to: iso(13, '06:00') }));
  ok('twelve hours of it is not a 45', /short of/.test(why || ''), why);
  r = await api('/rest/gap', 'POST', { kind: 'weekly', from: iso(10, '18:00'), to: iso(13, '06:00') });
  S = un(r);
  ok('logged as the weekly rest', /weekly rest/.test(r.message), r.message);
  ok('dispatch\'s order stood down for it', S.restartOrders.find((o) => o.number === ordered.number)?.status === 'Cancelled');
  ok('no weekly rest needed now', !S.views.restart, JSON.stringify(S.views.restart)?.slice(0, 160));
  ok('the question is answered', !S.views.rest.gap);
  ok('and the six days start from the end of it', near(S.hos.euHoursSinceWeeklyRest ?? -1, 0), `${S.hos.euHoursSinceWeeklyRest}`);

  head('9. A rest taken during a load goes on its trip log, once');
  await line(iso(13, '06:00'), 4.5, 10, 56, 90);
  const ev = (await board('Frankfurt', 'DE', 'Mainz', 'DE')).evaluations[0];
  const trip = (await api('/dispatch/authorize', 'POST', { loadId: ev.load.id, overrideTight: true })).trip;
  await api('/rest/take', 'POST', { kind: 'daily' });
  await api('/restart/arrived', 'POST', { gameTime: iso(13, '20:00'), city: 'Frankfurt', state: 'DE' });
  await api('/restart/complete', 'POST', { gameTime: iso(14, '07:00') });
  S = await boot();
  const t = S.trips.find((x) => x.id === trip.id);
  const rests = (t?.events || []).filter((e) => e.kind === 'Rest');
  ok('one Rest on the log, start and end', rests.length === 1 && rests[0].gameTime === iso(13, '20:00') && rests[0].endGameTime === iso(14, '07:00'),
    JSON.stringify(rests));
  ok('counted as a regular daily rest, not as two', S.hos.euReducedRestsUsed === 0, `${S.hos.euReducedRestsUsed} reduced`);

  head('10. Called off');
  await api('/rest/take', 'POST', { kind: 'daily' });
  r = await api('/rest/cancel', 'POST', {});
  ok('a rest the driver chose can be called off', r.order.status === 'Cancelled' && (un(r).views.rest.choices || []).length > 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
