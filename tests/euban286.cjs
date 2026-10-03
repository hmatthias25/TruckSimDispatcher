/* Weekend truck bans in the trip plan (asked for from play, v0.81, after the weekly rest learned them).
 *
 *   - a drive that would start inside a ban waits it out, and a wait long enough is the daily rest
 *   - a drive into a country whose ban is on stops at the border and waits
 *   - a country with no ban, and a weekday, plan as before
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
const steps = (f) => (f.timeline || []).map((t) => `${(t.startGameTime || '').slice(5)} ${t.label} [${t.kind} ${(+t.hours).toFixed(2)}]`).join(' | ');

async function plan(gameTime, city, cc, destCity, destCc, miles) {
  await api('/status', 'POST', { locationCity: city, locationState: cc, locationKind: 'Shipper', gameTime,
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  // Fresh clocks, typed as a full reading (not the status line), with the weekly rest well in hand.
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 50, asOfGameTime: gameTime,
    euWeekDriven: 6, euLastWeekDriven: 20, euHoursSinceWeeklyRest: 20, spreadEstimated: false });
  await api('/board/clear', 'POST', {});
  const d = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: city, originState: cc,
    destCity, destState: destCc, loadedMiles: miles, deadheadMiles: 0, gameRevenue: 3000, weightLbs: 30000, atLocation: true, deadlineHours: 72 });
  return d.evaluations[0].feasibility;
}

(async () => {
  const app = { driverName: 'C. Smith', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. Milan to Turin, Sunday 10:00: Italy\'s ban, 09:00-22:00');
  let f = await plan('2000-01-07T10:00', 'Milan', 'IT', 'Turin', 'IT', 90);
  const wait = (f.timeline || []).find((t) => /Waiting out Italy's truck ban/.test(t.label));
  ok('the plan waits out the ban', !!wait, steps(f));
  ok('until 22:00, before any driving', wait && (f.timeline || []).filter((t) => t.kind === 'Drive').every((t) => t.startGameTime >= '2000-01-07T22:00'), steps(f));
  ok('and says why', (f.warnings || []).some((w) => /Italy bans heavy trucks Sunday 09:00–22:00/.test(w)), (f.warnings || []).join(' | ').slice(0, 300));

  head('2. Milan to Munich, Saturday 21:00: into Germany as its Sunday ban starts');
  f = await plan('2000-01-06T21:00', 'Milan', 'IT', 'Munich', 'DE', 300);
  const de = (f.timeline || []).find((t) => /Waiting out Germany's truck ban/.test(t.label));
  ok('it stops at the German border and waits for 22:00 on Sunday', !!de, steps(f));
  ok('no driving in Germany between 00:00 and 22:00 on Sunday',
    !(f.timeline || []).some((t) => t.kind === 'Drive' && t.endGameTime > '2000-01-07T00:00' && t.startGameTime < '2000-01-07T22:00'
      && (f.timeline || []).indexOf(t) > (f.timeline || []).indexOf(de)), steps(f));

  head('3. Rotterdam to Groningen, Sunday 10:00: no ban in the Netherlands');
  f = await plan('2000-01-07T10:00', 'Rotterdam', 'NL', 'Groningen', 'NL', 150);
  ok('no ban wait', !(f.timeline || []).some((t) => /truck ban/.test(t.label)), steps(f));

  head('4. Milan to Turin on a Wednesday: as before');
  f = await plan('2000-01-03T10:00', 'Milan', 'IT', 'Turin', 'IT', 90);
  ok('no ban wait', !(f.timeline || []).some((t) => /truck ban/.test(t.label)), steps(f));

  head('5. What is owed from a reduced weekly rest: said only where the load changes it');
  // 9:41 already owed; a short weekday run with no weekly rest in it: nothing to say.
  await api('/status', 'POST', { locationCity: 'Rotterdam', locationState: 'NL', locationKind: 'Shipper', gameTime: '2000-01-03T10:00',
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 50, asOfGameTime: '2000-01-03T10:00',
    euWeekDriven: 6, euLastWeekDriven: 20, euHoursSinceWeeklyRest: 20, euCompensationOwed: 9.68, spreadEstimated: false });
  await api('/board/clear', 'POST', {});
  let d = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', originCity: 'Rotterdam', originState: 'NL', destCity: 'Groningen',
    destState: 'NL', loadedMiles: 150, gameRevenue: 1500, weightLbs: 30000, atLocation: true, deadlineHours: 30 });
  let w = (d.evaluations[0].feasibility.warnings || []).join(' | ');
  ok('no owed-rest line on a load that does not change it', !/owed/.test(w), w.slice(0, 300));
  ok('and the old rule recital is gone', !/third week/.test(w));
  // Nothing owed, and the six days run out on the way: the plan takes a reduced weekly rest and says what it means.
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 50, asOfGameTime: '2000-01-03T10:00',
    euWeekDriven: 6, euLastWeekDriven: 20, euHoursSinceWeeklyRest: 136, euCompensationOwed: 0, spreadEstimated: false });
  await api('/board/clear', 'POST', {});
  d = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', originCity: 'Rotterdam', originState: 'NL', destCity: 'Groningen',
    destState: 'NL', loadedMiles: 600, gameRevenue: 1500, weightLbs: 30000, atLocation: true, deadlineHours: 90 });
  w = (d.evaluations[0].feasibility.warnings || []).join(' | ');
  ok('a reduced weekly rest in the plan: owed, and that dispatch adds it to the next one', /owed back\. Nothing to do about it now: dispatch adds it/.test(w), w.slice(0, 400));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
