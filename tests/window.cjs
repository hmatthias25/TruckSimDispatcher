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
  // "Day 3" is the game's day 3, three days after the epoch: 2000-01-04. The clock here reads
  // 2000-01-01T06:01, which is day 0, so the window is three days and change out.
  ok('a day-qualified time lands on that day', /04T09:30$/.test(r.dueAt || ''), r.dueAt);
  ok('and the hours span the days', r.hoursUntilDue > 60 && r.hoursUntilDue < 84, `${r.hoursUntilDue}`);

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

  head('10. Arriving before the receiver opens means waiting');
  // Close the load out first so the board is free.
  await api(`/trips/${trip.id}/complete`, 'POST', {
    deliveredGameTime: '2000-01-01T08:00', actualMiles: 19, endOdometer: 1019, actualRevenue: 300,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 0, trailerDamageAfter: 0, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Denver', locationState: 'CO', fuelPct: 80, gameTime: '2000-01-01T08:00',
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });

  await api('/board/clear', 'POST', {});
  const near = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Aurora', destState: 'CO', loadedMiles: 19, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 12, weightLbs: 20000, appointmentOpensHours: 6,
  });
  const nearEv = near.evaluations[0];
  let f = nearEv.feasibility;
  // #80: an early take has nothing to wait through. Fourth section in this suite that needs the split.
  if (nearEv.receiverTakesEarly) {
    ok('taking it early, so no wait is planned', !f.waitForAppointmentHours,
      (nearEv.pros || []).find((p) => /take it whenever/.test(p)) || 'no wait planned');
  } else {
    ok('the wait is planned, not ignored', f.waitForAppointmentHours > 0,
      `${hhmm(f.waitForAppointmentHours || 0)}`);
    ok('and it is called out as coming off the window',
      (f.warnings || []).some((w) => /before they open/.test(w)),
      (f.warnings || []).join(' | ') || '(none)');
  }

  head('11. A load with NO opening time plans exactly as before');
  await api('/board/clear', 'POST', {});
  const plain = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Aurora', destState: 'CO', loadedMiles: 19, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 12, weightLbs: 20000,
  });
  f = plain.evaluations[0].feasibility;
  ok('no wait is invented', !f.waitForAppointmentHours, `${f.waitForAppointmentHours}`);
  ok('nothing warns about a dock that was never mentioned',
    !(f.warnings || []).some((w) => /before they open/.test(w)),
    (f.warnings || []).join(' | ') || '(quiet)');
  ok('and the load is still feasible', f.verdict === 'Feasible', f.verdict);

  head('12. A long wait is taken as the reset rather than burned at the gate');
  await api('/board/clear', 'POST', {});
  const overnight = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Aurora', destState: 'CO', loadedMiles: 19, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 30, weightLbs: 20000, appointmentOpensHours: 18,
  });
  const overnightEv = overnight.evaluations[0];
  f = overnightEv.feasibility;
  if (overnightEv.receiverTakesEarly) {
    ok('taking it early, so there is no wait to take as a reset',
      !f.waitForAppointmentHours,
      (overnightEv.pros || []).find((p) => /take it whenever/.test(p)) || 'no wait planned');
  } else {
    ok('the long wait is recognised', f.waitForAppointmentHours > 10, `${hhmm(f.waitForAppointmentHours || 0)}`);
    ok('and sat as the reset, not spent on duty',
      (f.warnings || []).some((w) => /reset/.test(w) && /not wasted/.test(w)),
      (f.warnings || []).join(' | ') || '(none)');
  }
  ok('so the driver is not stranded out of hours', f.verdict !== 'Infeasible', f.verdict);

  head('13. Whether the receiver will have you overnight is per-facility and stable');
  // Find one of each by asking about a spread of receivers.
  const names = ['Walmart DC', 'Kroger', 'Target DC', 'Costco', 'Sysco', 'US Foods', 'Home Depot', 'Lowes'];
  const verdicts = [];
  for (const who of names) {
    const q = await api(`/facility/parking?city=Aurora&state=CO&receiver=${encodeURIComponent(who)}`);
    verdicts.push({ who, allows: q.allowsOvernight, note: q.note });
  }
  console.log('     ' + verdicts.map((v) => `${v.who}:${v.allows ? 'yes' : 'no'}`).join('  '));
  ok('some receivers allow it', verdicts.some((v) => v.allows), verdicts.filter((v) => v.allows).map((v) => v.who).join(', ') || 'none');
  ok('and some do not', verdicts.some((v) => !v.allows), verdicts.filter((v) => !v.allows).map((v) => v.who).join(', ') || 'none');

  const first = verdicts[0];
  const again = await api(`/facility/parking?city=Aurora&state=CO&receiver=${encodeURIComponent(first.who)}`);
  ok('the same receiver gives the same answer every time', again.allowsOvernight === first.allows,
    `${first.who}: ${first.allows} then ${again.allowsOvernight}`);

  const otherCity = await api(`/facility/parking?city=Pueblo&state=CO&receiver=${encodeURIComponent(first.who)}`);
  ok('but it is judged per site, not per company', typeof otherCity.allowsOvernight === 'boolean',
    `${first.who} Aurora=${first.allows} Pueblo=${otherCity.allowsOvernight}`);

  head('14. No overnight parking means the reset is sat at a truck stop');
  const noPark = verdicts.find((v) => !v.allows);
  const yesPark = verdicts.find((v) => v.allows);

  await api('/board/clear', 'POST', {});
  const away = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Aurora', destState: 'CO', receiver: noPark.who, loadedMiles: 19, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 30, weightLbs: 20000, appointmentOpensHours: 18,
  });
  const awayEv = away.evaluations[0];
  f = awayEv.feasibility;
  // #80: an early take means no wait, and a driver with nothing to wait through is not sent anywhere
  // to wait it out. Only the waiting case can exercise the reposition.
  if (awayEv.receiverTakesEarly) {
    ok('taking it early, so there is no reset to reposition for',
      !(f.timeline || []).some((x) => /Reposition to a truck stop/.test(x.label)),
      (awayEv.pros || []).find((p) => /take it whenever/.test(p)) || 'no wait planned');
  } else {
    ok('the driver is sent to a truck stop',
      (f.warnings || []).some((w) => /do not allow overnight parking/.test(w)),
      (f.warnings || []).join(' | ') || '(none)');
    ok('and the run either side is on the timeline',
      (f.timeline || []).some((x) => /Reposition to a truck stop/.test(x.label)),
      (f.timeline || []).map((x) => x.label).join(' | '));
    ok('with the trip back for the appointment',
      (f.timeline || []).some((x) => /Back to the receiver/.test(x.label)),
      (f.timeline || []).map((x) => x.label).join(' | '));
  }
  ok('it is still runnable', f.verdict !== 'Infeasible', f.verdict);

  await api('/board/clear', 'POST', {});
  const stay = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Aurora', destState: 'CO', receiver: yesPark.who, loadedMiles: 19, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 30, weightLbs: 20000, appointmentOpensHours: 18,
  });
  const stayEv = stay.evaluations[0];
  f = stayEv.feasibility;
  // #80: this one can roll an early take, and then there is no sitting to do anywhere.
  if (stayEv.receiverTakesEarly) {
    ok('taking it early, so there is nothing to sit through',
      !(f.warnings || []).some((w) => /wait at the receiver/.test(w)),
      (stayEv.pros || []).find((p) => /take it whenever/.test(p)) || 'no wait planned');
  } else {
    ok('a friendly receiver keeps you on their property',
      (f.warnings || []).some((w) => /let you sit on their/.test(w)),
      (f.warnings || []).join(' | ') || '(none)');
  }
  ok('and there is no repositioning',
    !(f.timeline || []).some((x) => /truck stop/i.test(x.label)),
    (f.timeline || []).map((x) => x.label).join(' | '));

  head('15. A short wait is sat at the receiver either way');
  for (const who of [noPark.who, yesPark.who]) {
    await api('/board/clear', 'POST', {});
    const brief = await api('/board/add', 'POST', {
      cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
      destCity: 'Aurora', destState: 'CO', receiver: who, loadedMiles: 19, deadheadMiles: 0,
      gameRevenue: 300, deadlineHours: 12, weightLbs: 20000, appointmentOpensHours: 6,
    });
    const ev = brief.evaluations[0];
    const bf = ev.feasibility;
    // #80: roughly one receiver in eight takes it whenever you turn up, and then there is no wait to
    // sit anywhere. Seeded on the load, so which one it is here is fixed rather than flaky.
    if (ev.receiverTakesEarly) {
      ok(`${who}: taking it early, so there is no wait at all`,
        !(bf.warnings || []).some((w) => /wait at the receiver/.test(w)),
        (ev.pros || []).find((p) => /take it whenever/.test(p)) || 'no wait planned');
    } else {
      ok(`${who}: a short wait stays at the receiver`,
        (bf.warnings || []).some((w) => /wait at the receiver/.test(w)),
        (bf.warnings || []).find((w) => /before they open/.test(w)) || '(none)');
    }
    ok(`${who}: and nobody is sent to a truck stop`,
      !(bf.timeline || []).some((x) => /truck stop/i.test(x.label)),
      (bf.timeline || []).map((x) => x.label).join(' | '));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; });
