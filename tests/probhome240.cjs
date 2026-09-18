/* Probation stopped overriding the home-time arrangement, because it stopped having a reason to.
 *
 *   "It said that since I was on probation it would be ignored and I had to come back every 2 weeks.
 *    With the 90 day change this is not true. A probation driver can stay out as long as they want,
 *    but their probation won't clear until after the 90 days."
 *
 * Right, and it was not only the wording. Probation.EffectiveIntervalDays returned a flat fourteen days
 * for anybody probationary, whatever they had agreed and including "no arrangement" — so a driver on a
 * monthly agreement was routed home twice as often as they had asked, and a driver who had asked for
 * nothing was routed home at all.
 *
 * That rule belonged to the version where three consecutive passing reviews cleared probation: the
 * fortnightly cadence WAS the mechanism, and suspending the arrangement was how it got run. Probation
 * has been a fixed period for a long time now. PassesFor returns zero, nothing counts a run of passes,
 * and staying out longer cannot shorten the period — so there was nothing left for the override to
 * protect, and six trips to the yard bought reviews that decided nothing.
 *
 * The rebuke that went with it outlived it too. Every review checked how long the driver took to report
 * in against the fourteen, so somebody keeping precisely to the three-week agreement they had signed
 * collected "took 21 days against a 14-day requirement" on their record every single time.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
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
const iso = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

const views = async () => (await api('/bootstrap')).views;
const setPref = (p) => api('/career/home-time', 'POST', { preference: p });

let S;

(async () => {
  const app = { driverName: 'K. Lindqvist', preferredDivision: 'Dry Van', experienceYears: 2,
    homeCity: 'Dallas', homeState: 'TX', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));

  let v = await views();
  ok('the driver is on probation', v.probation?.on === true, v.probation?.standing?.slice(0, 60) || '');

  head('1. A probationary driver keeps the arrangement they set');
  for (const [pref, days] of [['threeweeks', 21], ['monthly', 30], ['biweekly', 14]]) {
    S = un(await setPref(pref));
    v = await views();
    ok(`${pref} is honoured at ${days} days`, v.homeTime?.intervalDays === days,
      `${v.homeTime?.intervalDays} day(s)`);
  }

  head('2. Including no arrangement at all, which used to be the one you could not have');
  // "Not an option for somebody still being assessed" was the old comment. It is an option.
  S = un(await setPref('none'));
  v = await views();
  ok('no arrangement stays no arrangement', !(v.homeTime?.intervalDays > 0),
    `intervalDays=${v.homeTime?.intervalDays}`);
  ok('and dispatch is not tracking a run home', v.homeTime?.tracked !== true,
    `tracked=${v.homeTime?.tracked}`);
  ok('the probation view reports what is actually in force',
    !(v.probation?.intervalDays > 0), `probation.intervalDays=${v.probation?.intervalDays}`);

  head('3. Staying out does not shorten the period, and is not held against them');
  // The whole point. Three weeks out on a three-week agreement is keeping to the agreement.
  S = un(await setPref('threeweeks'));
  let st = await api('/export');
  st.status.gameTime = iso(22);
  st.driver.lastHomeGameTime = iso(1);       // 21 days out, precisely the arrangement they signed
  await api('/import', 'POST', st);

  v = await views();
  ok('they are still on probation after three weeks out', v.probation?.on === true,
    `${v.probation?.daysLeft?.toFixed?.(0)} day(s) left`);
  ok('the period has not moved', (v.probation?.daysLeft ?? 0) > 0,
    `${v.probation?.daysLeft?.toFixed?.(0)} day(s) left of ${v.probation?.durationDays}`);
  ok('and the review is not due yet', v.probation?.reviewDue === false,
    `reviewDue=${v.probation?.reviewDue}`);

  head('4. The review does not tell them off for keeping to their own agreement');
  // Reported: "took 21 days to report in against a 14-day requirement", to a driver on 21 days.
  // Reporting in AT the home yard is what files one, and only ARRIVING counts — sitting there reporting
  // clocks each morning is one home time, not four. So: away first, then in.
  const yard = (await api('/export')).company.terminals
    .find((t) => t.id === (S.driver?.homeTerminalId || '')) ?? S.company.terminals[0];
  await api('/status', 'POST', {
    locationCity: 'Amarillo', locationState: 'TX', locationKind: 'TruckStop', gameTime: iso(16),
    fuelPct: 60, atsOdometer: 6_000, truckDamagePct: 3, trailerDamagePct: 1, dutyStatus: 'OffDuty',
  });
  await api('/status', 'POST', {
    locationCity: yard.city, locationState: yard.state, locationKind: 'Terminal', gameTime: iso(22),
    fuelPct: 70, atsOdometer: 8_000, truckDamagePct: 3, trailerDamagePct: 1, dutyStatus: 'OffDuty',
  });
  v = await views();
  const latest = (v.probation?.reviews || [])[0];
  const said = JSON.stringify(latest || {});
  console.log(`  ..    review: ${latest?.number || '(none filed)'} — ${(latest?.concerns || []).join(' / ') || 'no concerns'}`);
  ok('a review was filed on the arrival', !!latest, latest?.number || '(none)');
  ok('no rebuke quoting a fourteen-day requirement',
    !/14-day requirement/.test(said), (said.match(/[^"]*requirement[^"]*/) || ['nothing said'])[0].slice(0, 90));
  ok('and nothing at all is held against them for the three weeks',
    !(latest?.concerns || []).some((c) => /days to report in/i.test(c)),
    (latest?.concerns || []).find((c) => /report in/i.test(c)) || 'nothing about reporting in');
  ok('and nothing says the arrangement is overridden',
    !/overrid|suspend/i.test(JSON.stringify(v.homeTime || {})), 'not claimed');

  head('5. Overrunning your OWN arrangement is still worth saying');
  // The check is not deleted, it is pointed at the right number. Two weeks past a fortnightly agreement
  // is a driver who has not come in, and a review cannot cover work nobody has seen.
  S = un(await setPref('biweekly'));
  st = await api('/export');
  st.status.gameTime = iso(60);
  st.driver.lastHomeGameTime = iso(20);      // 40 days out, on a 14-day arrangement
  await api('/import', 'POST', st);
  v = await views();
  ok('the arrangement is the fortnight they asked for', v.homeTime?.intervalDays === 14,
    `${v.homeTime?.intervalDays}`);
  ok('and they are well past it', (v.homeTime?.daysOut ?? 0) > 14 + 3,
    `${v.homeTime?.daysOut?.toFixed?.(0)} days out`);

  await api('/status', 'POST', {
    locationCity: 'Amarillo', locationState: 'TX', locationKind: 'TruckStop', gameTime: iso(59),
    fuelPct: 60, atsOdometer: 12_000, truckDamagePct: 3, trailerDamagePct: 1, dutyStatus: 'OffDuty',
  });
  await api('/status', 'POST', {
    locationCity: yard.city, locationState: yard.state, locationKind: 'Terminal', gameTime: iso(60),
    fuelPct: 70, atsOdometer: 13_000, truckDamagePct: 3, trailerDamagePct: 1, dutyStatus: 'OffDuty',
  });
  const late = (await views()).probation?.reviews?.[0];
  const overrun = (late?.concerns || []).find((c) => /days to report in/i.test(c));
  console.log(`  ..    ${overrun || '(nothing said)'}`);
  ok('the review says so, against the fourteen they agreed to', !!overrun && /14-day arrangement/.test(overrun),
    overrun?.slice(0, 95) || '(nothing said)');

  head('6. Probation still ends on days served, not on trips to the yard');
  st = await api('/export');
  st.status.gameTime = iso(2 + (st.driver.probation.durationDays || 90) + 1);
  await api('/import', 'POST', st);
  v = await views();
  ok('once the days are served the review is due', v.probation?.reviewDue === true,
    `daysLeft=${v.probation?.daysLeft?.toFixed?.(0)}`);
  ok('but they are not cleared until somebody takes it', v.probation?.on === true,
    `still probationary`);
  ok('and the arrangement is STILL their own, not a fortnight imposed',
    v.homeTime?.intervalDays === 14 && v.probation?.intervalDays === 14,
    `home ${v.homeTime?.intervalDays}, probation ${v.probation?.intervalDays}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
