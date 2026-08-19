/* Issue #38: the delivery window is read as ATS shows it — a time range — and the app does the
   arithmetic, because it has the clock and the reader does not. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5680}/api`;
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

let S;
const hhmm = (h) => { const w = Math.floor(h + 1e-9); return `${w}:${String(Math.round((h - w) * 60)).padStart(2, '0')}`; };

(async () => {
  head('1. Hire and set the clock to 06:01, as reported');
  const app = { driverName: 'Window Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 5, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:01' }));
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: '2000-01-01T06:01',
    fuelPct: 90, atsOdometer: 1000, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 40000,
  }));
  ok('clock is 06:01', S.status.gameTime === '2000-01-01T06:01', S.status.gameTime);

  head('2. The reported case: 6:15 AM to 12:55 PM from 06:01');
  let r = await api('/window/read', 'POST', { text: '6:15 AM - 12:55 PM' });
  ok('it is read as a range', r.hadRange === true, JSON.stringify(r));
  ok('the receiver opens at 06:15', /T06:15$/.test(r.opensAt || ''), r.opensAt);
  ok('the load is due at 12:55, not 14:01', /T12:55$/.test(r.dueAt || ''), r.dueAt);
  ok('which is 6:54 from now, not 8:00', Math.abs(r.hoursUntilDue - 6.9) < 0.02,
    `${hhmm(r.hoursUntilDue)} (${r.hoursUntilDue})`);

  head('3. AM/PM is honoured');
  r = await api('/window/read', 'POST', { text: '2:55 PM' });
  ok('an afternoon time is afternoon', /T14:55$/.test(r.dueAt || ''), r.dueAt);
  r = await api('/window/read', 'POST', { text: '12:30 AM' });
  ok('midnight-hour AM wraps to the next day', /02T00:30$/.test(r.dueAt || ''), r.dueAt);

  head('4. 24-hour and day-qualified times still work');
  r = await api('/window/read', 'POST', { text: '14:00' });
  ok('a bare 24-hour time', /T14:00$/.test(r.dueAt || ''), r.dueAt);
  r = await api('/window/read', 'POST', { text: 'Day 3 09:30' });
  ok('a day-qualified time lands on that day', /03T09:30$/.test(r.dueAt || ''), r.dueAt);
  ok('and the hours span the days', r.hoursUntilDue > 40 && r.hoursUntilDue < 60, `${r.hoursUntilDue}`);

  head('5. A window already past today is tomorrow');
  r = await api('/window/read', 'POST', { text: '5:00 AM' });
  ok('05:00 from 06:01 is tomorrow', /02T05:00$/.test(r.dueAt || ''), r.dueAt);

  head('6. Unreadable stays unreadable — nothing is invented');
  for (const junk of ['', 'soon', 'ASAP', 'urgent']) {
    r = await api('/window/read', 'POST', { text: junk });
    ok(`"${junk || '(empty)'}" gives nothing back`, r.readable === false, JSON.stringify(r));
  }

  head('7. The plausibility check is a backstop, not the fix');
  const type = encodeURIComponent(S.trailers[0].type);

  // ATS is genuinely generous on short runs — the real window here was 6:54 against a ~2:40 run.
  // Flagging ordinary generosity would be noise, so it stays quiet.
  const normal = await api(`/window/check?deadlineHours=8&miles=19&trailerType=${type}`);
  ok('ordinary ATS generosity is NOT questioned', !normal.warning, normal.warning || '(quiet)');
  ok('but the app knows what the run needs', normal.needed > 2 && normal.needed < 4,
    `${hhmm(normal.needed)} for 19 mi`);

  const absurd = await api(`/window/check?deadlineHours=72&miles=19&trailerType=${type}`);
  ok('three days for 19 mi is questioned', !!absurd.warning, absurd.warning || '(none)');
  ok('and it says what the run actually needs', /needs about/.test(absurd.warning || ''), absurd.warning);

  const fine = await api(`/window/check?deadlineHours=24&miles=600&trailerType=${type}`);
  ok('a realistic long haul is not questioned', !fine.warning, fine.warning || '(quiet)');

  const short = await api(`/window/check?deadlineHours=1&miles=600&trailerType=${type}`);
  ok('an impossible window is called impossible', /cannot be run/.test(short.warning || ''), short.warning);
  ok('600 mi genuinely needs more than 12 hours',
    (await api(`/window/check?deadlineHours=12&miles=600&trailerType=${type}`)).needed > 12,
    'drive plus dock at both ends');

  head('8. A wrong window on a load in flight can be corrected');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Aurora', destState: 'CO', loadedMiles: 19, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 8, weightLbs: 20000,
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id });
  S = auth.snapshot;
  let trip = S.views.activeTrip;
  ok('the load went out with the wrong window', /T14:01$/.test(trip.dueGameTime || ''), trip.dueGameTime);

  const fixed_ = await api(`/trips/${trip.id}/window`, 'POST', {
    deadlineHours: 6.9, note: 'Read off the game: 6:15 AM to 12:55 PM.',
  });
  S = un(fixed_);
  trip = S.views.activeTrip;
  ok('the appointment moves to 12:55', /T12:55$/.test(trip.dueGameTime || ''), trip.dueGameTime);
  ok('the correction is on the trip log',
    (trip.events || []).some((x) => /window corrected/i.test(x.detail || '')),
    (trip.events || []).map((x) => x.detail).join(' | '));
  ok('and the warning is cleared', !trip.windowWarning, trip.windowWarning || '(clear)');

  head('9. A closed load cannot have its window rewritten');
  let refused = false, msg = '';
  try {
    await api(`/trips/${trip.id}/window`, 'POST', { deadlineHours: 0 });
  } catch (e) { refused = true; msg = e.message; }
  ok('a zero window is refused', refused, msg);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
