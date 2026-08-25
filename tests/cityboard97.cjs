/* Issue #97 — near home time, dispatch committed off a 3-load dock board without ever asking for the city.
 *
 * Reported from a real career: 0.2 days to home time, pulled in at a small receiver with three loads on
 * it — San Francisco, Sonora TX, Cody WY — and dispatch took Cody because it was the one that did not run
 * further out. But that was three loads at one dock. Other shippers in the same town may well have had
 * something toward Missouri, and nobody looked.
 *
 * The board screen has always promised "show me these first; if none of them work I will ask for the
 * whole city". It only ever asked down the rejection path, so a merely acceptable local load was
 * committed to and the city was never seen. Acceptable is not the same as gets you home.
 *
 * And Cody is a thin market — the worst kind of place to be needing a load out of when you are due home.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5967}/api`;
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
const iso = (day, hm = '07:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hm}`;
};

let S;
async function place(city, state, day, kind = 'Receiver') {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: kind, gameTime: iso(day),
    fuelPct: 90, atsOdometer: 20000 + day * 60, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
  return S;
}

/** The dock board: a handful of loads out of where the driver is standing. */
async function dockBoard(rows) {
  await api('/board/clear', 'POST', {});
  let last;
  for (const [city, state, miles, rev] of rows) {
    last = await api('/board/add', 'POST', {
      cargo: `To ${city}`, trailerType: S.trailers[0].type, atLocation: true,
      originCity: S.status.locationCity, originState: S.status.locationState,
      destCity: city, destState: state, loadedMiles: miles, deadheadMiles: 0,
      gameRevenue: rev, deadlineHours: 40, weightLbs: 30000,
    });
  }
  return last;
}

/** The same, but off the wider city board — a load you would deadhead to. */
async function cityBoard(rows) {
  await api('/board/clear', 'POST', {});
  let last;
  for (const [city, state, miles, rev] of rows) {
    last = await api('/board/add', 'POST', {
      cargo: `To ${city}`, trailerType: S.trailers[0].type, atLocation: false,
      originCity: S.status.locationCity, originState: S.status.locationState,
      destCity: city, destState: state, loadedMiles: miles, deadheadMiles: 12,
      gameRevenue: rev, deadlineHours: 40, weightLbs: 30000,
    });
  }
  return last;
}

(async () => {
  const app = { driverName: 'C. Board', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. Home time nowhere near: a dock board is committed to as before');
  await place('Oklahoma City', 'OK', 4);
  let hs = (await api('/bootstrap')).views.homeTime;
  ok('not due yet', hs.dueSoon === false, `due in ${hs.daysUntilDue?.toFixed?.(1)} days`);
  let bd = await dockBoard([['Denver', 'CO', 620, 1900], ['Amarillo', 'TX', 260, 850]]);
  ok('a load is authorized off the dock board', !!bd.authorizedLoadId, bd.authorizedLoadId || 'none');
  ok('nothing asks for the city', bd.wantCityBoard !== true, `wantCityBoard=${bd.wantCityBoard}`);

  head('2. Wind home time on until it is close');
  for (let d = 10; d <= 26; d += 4) await place('Oklahoma City', 'OK', d);
  hs = (await api('/bootstrap')).views.homeTime;
  ok('home time is due', hs.dueSoon === true, `due in ${hs.daysUntilDue?.toFixed?.(1)} days, overdue ${hs.overdue}`);

  head('3. The reported case — three loads at one dock, none of them going home');
  bd = await dockBoard([['San Francisco', 'CA', 1650, 4200],
                        ['Sonora', 'TX', 480, 1500],
                        ['Cody', 'WY', 980, 2900]]);
  ok('nothing is authorized', !bd.authorizedLoadId, bd.authorizedLoadId || 'held');
  ok('but the board is NOT rejected either', bd.rejectAll !== true, `rejectAll=${bd.rejectAll}`);
  ok('it asks for the city board', bd.wantCityBoard === true, `${bd.wantCityBoard}`);
  ok('and says so in the headline', /show me the city board/i.test(bd.headline || ''), bd.headline);
  ok('counting the loads it saw', /3 load/i.test(bd.rationale || ''), (bd.rationale || '').slice(0, 90));
  ok('naming the yard none of them reaches', /Springfield/i.test(bd.rationale || ''), 'named');
  ok('it names the one it would have taken, so the override is one click',
    !!bd.heldLoadId, bd.heldLoadId || 'none');
  ok('and that load is marked as the backup, not a reject',
    (bd.evaluations || []).find((e) => e.load.id === bd.heldLoadId)?.recommendation === 'Backup',
    (bd.evaluations || []).find((e) => e.load.id === bd.heldLoadId)?.recommendation || '?');

  head('4. The override: a dock really is all there is');
  const auth = await api('/dispatch/authorize', 'POST', { loadId: bd.heldLoadId });
  ok('authorizing the held load works', !!auth.trip?.number, auth.trip?.number || 'refused');
  await api(`/trips/${auth.trip.id}/cancel`, 'POST', { reason: 'fixture' });

  head('5. Pull the city board and it commits');
  bd = await cityBoard([['San Francisco', 'CA', 1650, 4200],
                        ['Sonora', 'TX', 480, 1500],
                        ['Cody', 'WY', 980, 2900]]);
  ok('a wider board is not held', bd.wantCityBoard !== true, `wantCityBoard=${bd.wantCityBoard}`);
  ok('and something is authorized', !!bd.authorizedLoadId, bd.authorizedLoadId || 'none');

  head('6. A dock board WITH a load going home is taken without any fuss');
  bd = await dockBoard([['San Francisco', 'CA', 1650, 4200],
                        ['Springfield', 'MO', 210, 700],
                        ['Cody', 'WY', 980, 2900]]);
  ok('no question raised', bd.wantCityBoard !== true, `wantCityBoard=${bd.wantCityBoard}`);
  const picked = (bd.evaluations || []).find((e) => e.load.id === bd.authorizedLoadId);
  ok('and the one going home is the one taken',
    /Springfield/i.test(picked?.load?.destCity || ''), picked?.load?.destCity || 'none');

  head('7. The thin market it wanted to send me to costs more now');
  // Cody is thin. Score it with home time close, then with home time reset, and compare.
  bd = await dockBoard([['Cody', 'WY', 980, 2900]]);
  const nearHome = (bd.evaluations || [])[0];
  const thinNear = (nearHome.scoreDetail || []).find((x) => /Cody/i.test(x)) || '';
  ok('the thin-market line says home time is why it hurts',
    /home time is close/i.test(thinNear), thinNear.slice(0, 120) || '(none)');
  ok('and it is spelled out on the card',
    (nearHome.cons || []).some((c) => /thin market and you are due home/i.test(c)),
    (nearHome.cons || []).find((c) => /thin market/i.test(c))?.slice(0, 110) || '(none)');
  const penaltyNear = parseFloat((thinNear.match(/(-?\d+\.\d\d)$/) || [])[1] || '0');

  // Home again resets the arrangement, so the same load should be judged more gently.
  await place('Springfield', 'MO', 27, 'Terminal');
  await api('/hometime/take', 'POST', {}).catch(() => {});
  await place('Oklahoma City', 'OK', 28);
  hs = (await api('/bootstrap')).views.homeTime;
  bd = await dockBoard([['Cody', 'WY', 980, 2900]]);
  const farHome = (bd.evaluations || [])[0];
  const thinFar = (farHome.scoreDetail || []).find((x) => /Cody/i.test(x)) || '';
  const penaltyFar = parseFloat((thinFar.match(/(-?\d+\.\d\d)$/) || [])[1] || '0');
  if (hs.dueSoon === false) {
    ok('with home time reset the thin-market penalty is lighter',
      penaltyNear < penaltyFar, `${penaltyNear} near home vs ${penaltyFar} not due`);
    ok('and the home-time reason is gone from the line',
      !/home time is close/i.test(thinFar), thinFar.slice(0, 110));
  } else {
    ok('(home time did not reset in this run; the near-home penalty still applied)',
      penaltyNear < 0, `${penaltyNear}`);
    ok('and it is still explained', /home time is close/i.test(thinFar), thinFar.slice(0, 90));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
