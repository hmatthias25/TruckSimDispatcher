/* A day ending into a weekend truck ban (reported from play, v0.86): a Saturday-afternoon delivery in Frankfurt with
 * 0:55 of spread left was told to take the 11-hour daily rest — up at 02:30 Sunday with the German ban on until
 * 22:00. And a load planned from there took the eleven, loaded in the night, then a separate weekly rest on top.
 *
 *   - before any board is pulled, the driver is told it is the weekly rest, at the length dispatch sets
 *   - the screenshots are not read while nothing could be taken — no tokens spent on a board that is rejected
 *   - a load planned from there takes one weekly rest through the ban, not an eleven and then a weekly rest
 *   - midweek, the same clocks still get the ordinary daily rest
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

async function at(gameTime, spread) {
  await api('/status', 'POST', { locationCity: 'Frankfurt', locationState: 'DE', locationKind: 'Receiver', gameTime,
    fuelPct: 80, atsOdometer: 5000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OnDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { asOfGameTime: gameTime, driveRemaining: 3.6, shiftRemaining: spread, breakRemaining: 3.9,
    euWeekDriven: 30, euLastWeekDriven: 10, euHoursSinceWeeklyRest: 60, spreadEstimated: false });
}

(async () => {
  const app = { driverName: 'B. Verbot', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-30T06:00' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  // The fixture calendar: find a Saturday the way the app counts weeks — the day before the ban's Sunday.
  // 2000-02-03 is a Saturday on this calendar (the reported career: "Sat Day 34").
  head('1. Saturday 15:21 in Frankfurt, 0:55 of spread left');
  await at('2000-02-03T15:21', 0.92);
  const v = (await api('/bootstrap')).views;
  const stop = (v.dispatchBlockers || []).join(' | ');
  ok('not clear to run, before any board', (v.dispatchBlockers || []).length > 0, stop.slice(0, 160));
  ok('told it is the WEEKLY rest, not the eleven', /WEEKLY rest, not a daily one/.test(stop), stop.slice(0, 300));
  ok('and why: the ban', /bans heavy trucks/.test(stop) && /wake you inside the ban/.test(stop), stop.slice(0, 400));
  ok('the length is dispatch\'s — to Monday 00:00, reduced, with less owed', /Monday 00:00/.test(stop) && /owed rather than 21:00/.test(stop), stop.slice(-260));

  head('2. The screenshots are not read');
  const ex = await api('/board/extract', 'POST', { images: [{ mediaType: 'image/png', dataBase64: 'AAAA' }] });
  ok('refused without calling the reader', ex.ok === false && /^Not read/.test(ex.error || ''), (ex.error || '').slice(0, 120));

  head('3. A load planned from here takes one weekly rest through the ban');
  await api('/board/clear', 'POST', {});
  const d = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: 'Frankfurt', originState: 'DE', destCity: 'Cologne', destState: 'DE',
    loadedMiles: 120, deadheadMiles: 0, gameRevenue: 700, weightLbs: 30000, atLocation: true, deadlineHours: 40 });
  const tl = d.evaluations[0].feasibility.timeline || [];
  const rests = tl.filter((t) => t.kind === 'Rest' || t.kind === 'Restart');
  ok('no daily rest before it', !tl.some((t) => t.kind === 'Rest'), tl.map((t) => `${t.label} [${t.hours}]`).join(' | ').slice(0, 300));
  ok('one weekly rest, reduced, to Monday 00:00', rests.length === 1 && /reduced weekly rest/.test(rests[0].label)
     && rests[0].endGameTime >= '2000-02-05T00:00', rests.map((t) => `${t.label.slice(0, 50)} → ${t.endGameTime}`).join(' | '));
  ok('the board is refused all the same, and says it is the weekly rest', !d.authorizedLoadId && /weekly rest/i.test(d.headline || ''), d.headline);

  head('4. Midweek, the same clocks: the ordinary daily rest');
  await at('2000-01-31T15:21', 0.92);
  const mid = ((await api('/bootstrap')).views.dispatchBlockers || []).join(' | ');
  ok('the eleven, not the weekly rest', /11-hour daily rest/.test(mid) && !/WEEKLY/.test(mid), mid.slice(-160));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
