/* #270 - step 4 of Euro Truck Simulator 2 support (#266): the EU hours-of-service rules, in full.
 *
 * Regulation 561/2006 as amended: 9 hours' daily driving (10 twice a week), a 45-minute break after 4.5
 * hours, an 11-hour daily rest within 24 hours (9 hours three times between weekly rests), 56 hours'
 * driving a calendar week and 90 over two, a weekly rest within six days (45 hours, or 24 with the rest
 * paid back, never two reduced in a row).
 *
 * The plan is checked the way an enforcement officer reads a tachograph: walk the timeline and test every
 * rule against it, rather than trusting the planner's own counters. And the same load is planned for an
 * ATS career, which must come back on US rules exactly as before.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5978}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const hhmm = (h) => `${Math.floor(h)}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`;
const iso = (day, hm = '06:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const MONDAY = 7;               // iso(7) is game day 8, a Monday
const ms = (t) => Date.parse(t + ':00Z');
const dayOf = (t) => Math.floor((ms(t) - Date.UTC(2000, 0, 1)) / 86400000) + 1;
const weekOf = (t) => Math.floor((dayOf(t) - 1) / 7);
const E = 1e-6;

/** Reads a plan's timeline the way a tachograph is read, and reports every rule it breaks. */
function audit(plan) {
  const bad = [];
  const tl = plan.timeline || [];
  let sinceBreak = 0, dayDriving = 0, extended = {}, reduced = 0;
  let restEnd = ms(tl[0]?.startGameTime || '2000-01-01T00:00');
  const week = {};
  let lastWeekly = null;
  for (const st of tl) {
    const h = st.hours;
    if (st.kind === 'Drive') {
      sinceBreak += h; dayDriving += h;
      week[weekOf(st.startGameTime)] = (week[weekOf(st.startGameTime)] || 0) + h;
      if (sinceBreak > 4.5 + E) bad.push(`${hhmm(sinceBreak)} driven without a break by ${st.endGameTime}`);
      if (dayDriving > 10 + E) bad.push(`${hhmm(dayDriving)} driven in one day by ${st.endGameTime}`);
    } else if (h >= 0.75 - E && (st.kind === 'Break' || st.kind === 'Rest' || st.kind === 'Restart')) {
      sinceBreak = 0;
    }
    if ((st.kind === 'Rest' || st.kind === 'Restart') && h >= 9 - E) {
      const spread = (ms(st.startGameTime) - restEnd) / 3600000;
      const allowed = h >= 11 - E ? 13 : 15;
      if (spread > allowed + 0.02) bad.push(`a ${hhmm(spread)} spread before a ${hhmm(h)} rest at ${st.startGameTime}`);
      if (dayDriving > 9 + E) extended[weekOf(st.startGameTime)] = (extended[weekOf(st.startGameTime)] || 0) + 1;
      if (st.kind === 'Rest' && h < 11 - E) reduced++;
      if (st.kind === 'Restart') {
        if (lastWeekly && lastWeekly < 45 - E && h < 45 - E) bad.push('two reduced weekly rests in a row');
        lastWeekly = h; reduced = 0;
      }
      if (reduced > 3) bad.push('more than three reduced daily rests between weekly rests');
      dayDriving = 0;
      restEnd = ms(st.endGameTime);
    } else if (st.kind === 'Rest' && h < 9 - E && h > 0.01) {
      bad.push(`a ${hhmm(h)} rest is not a daily rest (${st.label})`);
    }
  }
  for (const [w, n] of Object.entries(extended)) if (n > 2) bad.push(`${n} ten-hour days in week ${w}`);
  for (const [w, d] of Object.entries(week)) if (d > 56 + E) bad.push(`${hhmm(d)} driven in week ${w}`);
  return bad;
}

async function plan(req) {
  return api('/hos/plan', 'POST', { deadlineHours: 400, loadingHours: 1, unloadingHours: 1, trailerType: 'Dry Van',
    usableFuelRangeMiles: 99999, startGameTime: iso(MONDAY), ...req });
}
async function clocks(c) {
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 56,
    asOfGameTime: iso(MONDAY), euWeekDriven: 0, euLastWeekDriven: 0, euHoursSinceWeeklyRest: 0, ...c });
}

(async () => {
  const app = { driverName: 'M. Laurent', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(MONDAY) });
  await api('/status', 'POST', { locationCity: 'Dallas', locationState: 'TX', locationKind: 'TruckStop', gameTime: iso(MONDAY),
    fuelPct: 100, atsOdometer: 90000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });

  head('0. The same load on an ATS career is US rules, as before');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70, asOfGameTime: iso(MONDAY) });
  const probe = await plan({ loadedMiles: 100 });
  const mph = probe.effectiveMph;
  console.log(`  ..    planning speed ${mph.toFixed(1)} mph`);
  const atsPlan = await plan({ loadedMiles: mph * 20 });
  const atsLabels = atsPlan.timeline.map((t) => t.label).join(' | ');
  ok('US breaks are thirty minutes', /30-minute break/.test(atsLabels));
  ok('and US resets ten hours', /10-hour off-duty reset/.test(atsLabels));
  ok('with nothing of the EU in it', !/daily rest|weekly rest|ten-hour day/i.test(atsLabels + JSON.stringify(atsPlan.warnings)));

  // Open the career as ETS2.
  const state = await api('/export');
  state.game = 'ETS2';
  await api('/import', 'POST', state);
  ok('the career is now ETS2', (await api('/bootstrap')).game?.id === 'ETS2');

  head('1. A short day: one 45-minute break after 4.5 hours, and no rest');
  await clocks({});
  let p = await plan({ loadedMiles: mph * 6 });
  let labels = p.timeline.map((t) => t.label);
  ok('a 45-minute break', labels.some((l) => /45-minute break/.test(l)), labels.join(' | '));
  ok('after four and a half hours of driving', p.timeline.find((t) => t.kind === 'Drive')?.hours <= 4.5 + E);
  ok('and no daily rest', !p.timeline.some((t) => t.kind === 'Rest'));
  ok('which breaks no rule', audit(p).length === 0, audit(p).join('; '));

  head('2. Three days of driving: every EU rule holds on every step');
  p = await plan({ loadedMiles: mph * 26 });
  let faults = audit(p);
  ok('the plan breaks no rule', faults.length === 0, faults.join('; ') || `${p.restsRequired} rests, ${p.breaksRequired} breaks`);
  ok('daily rests are taken', p.restsRequired >= 2, `${p.restsRequired}`);
  ok('it uses the ten-hour days the week allows', p.extendedDays >= 1 && p.extendedDays <= 2, `${p.extendedDays}`);
  ok('and says so', p.warnings.some((w) => /ten-hour day/.test(w)));
  ok('daily rests are 11 hours, or 9 where it stretched the spread', p.timeline.filter((t) => t.kind === 'Rest')
    .every((t) => Math.abs(t.hours - 11) < 0.02 || Math.abs(t.hours - 9) < 0.02), p.timeline.filter((t) => t.kind === 'Rest').map((t) => hhmm(t.hours)).join(' '));
  const restLabels = p.timeline.filter((t) => t.kind === 'Rest').map((t) => t.label).join(' | ');
  ok('called daily rests, not resets', /daily rest/.test(restLabels) && !/off-duty reset/.test(restLabels), restLabels);

  head('3. Ten-hour days: no more than two a week');
  p = await plan({ loadedMiles: mph * 45 });
  faults = audit(p);
  ok('a long run breaks no rule', faults.length === 0, faults.join('; '));
  ok('and stops at two ten-hour days', p.extendedDays <= 2, `${p.extendedDays}`);
  await clocks({ euExtensionsUsed: 2 });
  p = await plan({ loadedMiles: mph * 20 });
  ok('with both used already, there are none', p.extendedDays === 0, `${p.extendedDays}`);
  ok('and no day over nine hours', audit(p).length === 0 && !p.timeline.some((t, i, a) => false), audit(p).join('; '));

  head('4. Reduced daily rests: three between weekly rests');
  await clocks({ euReducedRestsUsed: 3 });
  p = await plan({ loadedMiles: mph * 26 });
  ok('with three used, every daily rest is eleven hours', p.timeline.filter((t) => t.kind === 'Rest').every((t) => t.hours >= 11 - E),
    p.timeline.filter((t) => t.kind === 'Rest').map((t) => hhmm(t.hours)).join(' '));
  ok('and the spread never passes thirteen', audit(p).length === 0, audit(p).join('; '));

  head('5. 56 hours a week: once it is spent, nothing moves until Monday');
  await clocks({ euWeekDriven: 50, cycleRemaining: 6 });
  p = await plan({ loadedMiles: mph * 12 });
  const waits = p.timeline.filter((t) => /weekly driving is used up/.test(t.label));
  ok('the plan stops for the new week', waits.length === 1, waits.map((w) => w.label).join(' | ') || 'no wait');
  const after = p.timeline.slice(p.timeline.indexOf(waits[0]) + 1).find((t) => t.kind === 'Drive');
  ok('and drives again only in the new week', after && weekOf(after.startGameTime) > weekOf(iso(MONDAY)),
    `${after?.startGameTime} (game day ${after ? dayOf(after.startGameTime) : '?'})`);
  ok('no more than 56 hours in the week', audit(p).length === 0, audit(p).join('; '));
  ok('that wait is long enough to be the weekly rest, and is taken as one', waits[0]?.kind === 'Restart', waits[0]?.kind);

  head('6. 90 hours over two weeks');
  await clocks({ euWeekDriven: 0, euLastWeekDriven: 50, cycleRemaining: 40 });
  p = await plan({ loadedMiles: mph * 45 });
  const firstWeek = p.timeline.filter((t) => t.kind === 'Drive' && weekOf(t.startGameTime) === weekOf(iso(MONDAY)))
    .reduce((a, t) => a + t.hours, 0);
  ok('with 50 driven last week, this week stops at 40', firstWeek <= 40 + 0.02, hhmm(firstWeek));
  ok('then waits for Monday', p.timeline.some((t) => /weekly driving is used up/.test(t.label)));

  head('7. A weekly rest within six days, reduced and owed back');
  await clocks({ euHoursSinceWeeklyRest: 130 });
  p = await plan({ loadedMiles: mph * 20 });
  const weekly = p.timeline.filter((t) => t.kind === 'Restart');
  ok('a weekly rest is taken before six days are up', weekly.length >= 1, weekly.map((w) => w.label).join(' | '));
  ok('reduced to 24 hours, the last one having been regular', weekly[0] && Math.abs(weekly[0].hours - 24) < 0.02, hhmm(weekly[0]?.hours || 0));
  ok('with 21 hours owed back', Math.abs(p.compensationOwedAfter - 21) < 0.02, `${p.compensationOwedAfter}`);
  ok('and the driver told so', p.warnings.some((w) => /owed/.test(w)));
  await clocks({ euHoursSinceWeeklyRest: 130, euLastWeeklyRestReduced: true, euCompensationOwed: 21 });
  p = await plan({ loadedMiles: mph * 20 });
  const regular = p.timeline.find((t) => t.kind === 'Restart');
  ok('after a reduced one the next must be regular, with the 21 paid back', regular && Math.abs(regular.hours - 66) < 0.02,
    `${hhmm(regular?.hours || 0)} — ${regular?.label}`);
  ok('and nothing is owed afterwards', p.compensationOwedAfter === 0, `${p.compensationOwedAfter}`);
  ok('neither plan breaks a rule', audit(p).length === 0, audit(p).join('; '));

  head('8. Dock work is not driving');
  await clocks({ euWeekDriven: 10, cycleRemaining: 46 });
  p = await plan({ loadedMiles: mph * 3, loadingHours: 3, unloadingHours: 3 });
  ok('weekly driving goes down by the driving alone', Math.abs(p.cycleRemainingAfter - (46 - p.driveHours)) < 0.05,
    `${hhmm(p.cycleRemainingAfter)} left after ${hhmm(p.driveHours)} driving and 6:00 at docks`);
  ok('and the dock advice says so', /none of your driving limits/.test(p.dockAdvice || ''), (p.dockAdvice || '').slice(0, 80));
  // Reported from play: dock time behind a van is the warehouse's work, and 45 minutes of it is the break.
  ok('behind a van, the dock time counts as the 45-minute break', (p.timeline || []).some((t) => /counts as your 45-minute break/.test(t.label))
    && !(p.timeline || []).some((t) => t.kind === 'Break'), (p.timeline || []).map((t) => t.label).join(' | ').slice(0, 200));
  const fb = await plan({ loadedMiles: mph * 3, loadingHours: 3, unloadingHours: 3, trailerType: 'Flatbed' });
  ok('on a flatbed you work the dock, so it is not a break', !(fb.timeline || []).some((t) => /counts as your/.test(t.label))
    && /not a break/.test(fb.dockAdvice || ''), (fb.dockAdvice || '').slice(0, 120));

  head('9. What dispatch says and orders, on EU rules');
  await clocks({ driveRemaining: 6, shiftRemaining: 9, breakRemaining: 2, euWeekDriven: 20, cycleRemaining: 36, euHoursSinceWeeklyRest: 40 });
  let v = (await api('/bootstrap')).views;
  ok('the clocks are read as EU', v.hos.ruleset === 'EU561', v.hos.ruleset);
  ok('weekly driving left is the week\'s 56 less what was driven', Math.abs(v.hos.cycleRemaining - 36) < 0.01, hhmm(v.hos.cycleRemaining));
  ok('and the weekly rest is due in the remaining six days', Math.abs(v.hos.weeklyRestDueInHours - 104) < 0.01, hhmm(v.hos.weeklyRestDueInHours));
  ok('the next action is put in EU terms', /45-minute break|daily driving|spread/.test(v.hos.nextRequiredAction), v.hos.nextRequiredAction);
  ok('nothing about a 34 or a 70', !/34|70-hour|14-hour/.test(JSON.stringify(v.hos)));

  await clocks({ euHoursSinceWeeklyRest: 125 });
  v = (await api('/bootstrap')).views;
  const blockers = (v.dispatchBlockers || []).join(' || ');
  ok('with the weekly rest nearly due, dispatch orders one', /weekly rest is due/.test(blockers), blockers.slice(0, 140));
  ok('reduced to 24 hours, the last having been full', /24 hours/.test(blockers));
  ok('and not a 34-hour restart', !/34|cycle restart/.test(blockers));
  await api('/restart/arrived', 'POST', { gameTime: iso(MONDAY, '08:00'), city: 'Dallas', state: 'TX' });
  let done = await api('/restart/complete', 'POST', { gameTime: iso(MONDAY, '20:00') }).catch((e) => ({ error: e.message }));
  ok('finishing short of 24 hours is refused', !done.accepted, (done.message || done.error || '').slice(0, 100));
  done = await api('/restart/complete', 'POST', { gameTime: iso(MONDAY + 1, '08:00') });
  ok('24 hours later it is accepted', done.accepted === true, (done.message || '').slice(0, 120));
  const after2 = (await api('/bootstrap')).views.hos;
  ok('the six days start again', after2.weeklyRestDueInHours === 144, hhmm(after2.weeklyRestDueInHours));
  ok('and the 21 short is owed', Math.abs(after2.compensationOwed - 21) < 0.01, hhmm(after2.compensationOwed));

  await clocks({ euWeekDriven: 56, cycleRemaining: 0 });
  const wk = ((await api('/bootstrap')).views.dispatchBlockers || []).join(' || ');
  ok('a spent week waits for Monday', /until Monday/.test(wk) && !/70-hour/.test(wk), wk.slice(0, 120));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
