/* ETS2 wording (reported from play: "this comes off your 13 hour window"). Drives an ETS2 career through the
 * main flows — clocks in four states, the board, a plan, a trip with events and a close-out, a weekly rest —
 * and fails on any US hours term in what comes back: the 14-hour window, the 70, the 34, the 10-hour reset,
 * shift and cycle, the sleeper, the HOS display, a hazmat endorsement, pay by the mile. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
const api = async (p, m = 'GET', b) => {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); try { return JSON.parse(t); } catch { return t; }
};
const iso = (day, hm = '06:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const seen = new Map();
// US terms only. A "10-hour day" is Europe's extended day; "11-hour daily rest", "HOS app", a bunk in the cab and being back on duty are Europe's too.
const BAD = /\b(10|14|34|70)[- ]hour\b(?! days?\b)|\bthe (14|70|34|seventy|fourteen)\b|\bthe 10\b(?![- ]hour days?)|hour window|of window|window left|shift (clock|window|left)|\bshift\b|\bcycle\b|sleeper|in the bunk|off[- ]duty|on[- ]duty time|\brestart\b|recap|FMCSA|HOS display|HOS slack|HOS reported|\bCDL\b|hazmat endorsement|\bstates?\b|48-state|per loaded mile|\$\d/i;
function collect(where, x) {
  if (x == null) return;
  if (typeof x === 'string') {
    if (x.length < 12 || !/\s/.test(x)) return;
    const m = x.match(BAD);
    if (m) { const k = x.slice(0, 220); if (!seen.has(k)) seen.set(k, `${where} [${m[0]}]`); }
    return;
  }
  if (Array.isArray(x)) { x.forEach((v, i) => collect(where, v)); return; }
  if (typeof x === 'object') for (const [k, v] of Object.entries(x)) {
    if (/^(id|number|unit|.*GameTime|.*Utc|ruleset|kind|status|game)$/i.test(k)) continue;
    collect(`${where}.${k}`, v);
  }
}
const at = (day, hm, city = 'Lyon', cc = 'FR') => api('/status', 'POST', { locationCity: city, locationState: cc, locationKind: 'TruckStop', gameTime: iso(day, hm),
  fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
const line = (day, hm, b, d, w, w2) => api('/hos', 'POST', { breakRemaining: b, driveRemaining: d, shiftRemaining: 0, cycleRemaining: Math.min(w, w2),
  asOfGameTime: iso(day, hm), euWeekDriven: 56 - w, euLastWeekDriven: Math.max(0, 90 - w2 - (56 - w)), euDayDriven: null, spreadEstimated: true });
const add = (o) => api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', originCity: 'Lyon', originState: 'FR',
  destCity: 'Marseille', destState: 'FR', loadedMiles: 190, deadheadMiles: 0, gameRevenue: 2500, deadlineHours: 30, weightLbs: 30000, atLocation: true, ...o });

(async () => {
  const app = { driverName: 'S. Scan', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  collect('game', await api('/career/game', 'POST', { game: 'ETS2' }));
  collect('market', await api('/onboarding/market', 'POST', app));
  collect('hire', await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(8) }));
  const st = await api('/export'); st.settings.runnableStates = [];
  Object.assign(st.company.terminals[0], { city: 'Lyon', state: 'FR', isHeadquarters: true }); st.company.terminalState = 'FR';
  await api('/import', 'POST', st);
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  for (const [d, b, dd, w, w2] of [[9, 4.5, 10, 56, 90], [9, 0.5, 6, 40, 70], [9, 3, 0.4, 40, 70], [9, 4.5, 2, 1, 30]]) {
    await at(9, '08:00'); collect('hos', await line(d, '08:00', b, dd, w, w2));
    collect('boot', await api('/bootstrap'));
    await api('/board/clear', 'POST', {});
    collect('board-ok', await add({}));
    collect('board-tight', await add({ cargo: 'Steel', deadlineHours: 5, loadedMiles: 300 }));
    collect('board-far', await add({ cargo: 'Wood', destCity: 'Berlin', destState: 'DE', loadedMiles: 650, deadlineHours: 20 }));
    collect('eval', await api('/board/evaluate'));
    collect('plan', await api('/hos/plan', 'POST', { deadlineHours: 40, loadingHours: 1, unloadingHours: 1, trailerType: 'Dry Van',
      usableFuelRangeMiles: 99999, startGameTime: iso(9, '08:00'), loadedMiles: 500 }));
  }
  // a trip run through, with events and a close-out
  await at(10, '06:00'); await line(10, '06:00', 4.5, 10, 50, 84);
  await api('/board/clear', 'POST', {});
  await add({ deadlineHours: 40 });
  const ev = (await api('/board/evaluate')).evaluations[0];
  const auth = await api('/dispatch/authorize', 'POST', { loadId: ev.load.id, overrideTight: true }); collect('authorize', auth);
  const t = auth.trip;
  for (const e of [['BeginLoad', '06:30'], ['EndLoad', '07:30'], ['Break', '10:00', '10:45'], ['Fuel', '11:00'], ['Arrived', '12:30'], ['BeginUnload', '12:40'], ['EndUnload', '13:40']]) {
    collect('event-' + e[0], await api(`/trips/${t.id}/event`, 'POST', { kind: e[0], gameTime: iso(10, e[1]), endGameTime: e[2] ? iso(10, e[2]) : '' }));
  }
  collect('complete', await api(`/trips/${t.id}/complete`, 'POST', { deliveredGameTime: iso(10, '12:30'), endOdometer: 1300, actualMiles: 190,
    truckDamageAfter: 1, trailerDamageAfter: 1, unloadAlreadyRan: true, hosBreakRemaining: 4.5, hosDriveRemaining: 6, hosEuWeekLeft: 46, hosEuTwoWeeksLeft: 80 }));
  collect('boot2', await api('/bootstrap'));
  // weekly rest
  await at(14, '08:00'); await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 40, asOfGameTime: iso(14, '08:00'),
    euWeekDriven: 16, euLastWeekDriven: 30, euHoursSinceWeeklyRest: 125 });
  await api('/board/clear', 'POST', {});
  collect('weekly', await add({}));
  collect('boot3', await api('/bootstrap'));

  let n = 0;
  for (const [k, v] of seen) { n++; console.log(`  FAIL  US wording at ${v}: ${k}`); }
  if (!n) console.log('  PASS  no US hours terms in anything an ETS2 career is told');
  console.log(`\n${n ? 0 : 1} passed, ${n} failed`);
  process.exit(n ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
