/* Issue #4: dispatch should look at what is offered at the dock before asking for the whole city. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5399}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(j?.error || t.slice(0, 250));
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

(async () => {
  const app = { driverName: 'Local Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'monthly' };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' }));
  const type = S.trailers[0].type;

  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Receiver',
    gameTime: '2000-01-01T06:00', fuelPct: 90, atsOdometer: 0,
    truckDamagePct: 0, trailerDamagePct: 0, dutyStatus: 'OnDuty', atsBankBalance: 40000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });

  head('Only bad jobs at the dock');
  await api('/board/clear', 'POST', {});
  let dec = await api('/board/add', 'POST', {
    cargo: 'Scrap', trailerType: type, atLocation: true,
    originCity: 'Denver', originState: 'CO', destCity: 'Pueblo', destState: 'CO',
    loadedMiles: 110, deadheadMiles: 0, gameRevenue: 90, deadlineHours: 20, weightLbs: 20000,
  });
  dec = await api('/board/add', 'POST', {
    cargo: 'Pallets', trailerType: type, atLocation: true,
    originCity: 'Denver', originState: 'CO', destCity: 'Greeley', destState: 'CO',
    loadedMiles: 60, deadheadMiles: 0, gameRevenue: 55, deadlineHours: 12, weightLbs: 12000,
  });
  ok('board rejected', dec.rejectAll === true, dec.headline);
  ok('flagged as local-only', dec.localOnly === true);
  ok('headline names the dock, not the city', /at this dock/.test(dec.headline), dec.headline);
  ok('asks for the wider board', dec.dispatchNotes.some((n) => /full\s+freight board/i.test(n)),
    dec.dispatchNotes.find((n) => /freight board/i.test(n)) || '(none)');
  ok('does NOT tell us to reposition yet', !dec.dispatchNotes.some((n) => /Reposition and pull a fresh board/.test(n)),
    dec.dispatchNotes.join(' | ').slice(0, 120));

  head('A good job at the dock is taken without asking for the city');
  await api('/board/clear', 'POST', {});
  dec = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: type, atLocation: true,
    originCity: 'Denver', originState: 'CO', destCity: 'Salt Lake City', destState: 'UT',
    loadedMiles: 520, deadheadMiles: 0, gameRevenue: 2300, deadlineHours: 48, weightLbs: 40000,
  });
  ok('authorized straight off the dock', !!dec.authorizedLoadId, dec.headline);
  ok('not flagged local-only', !dec.localOnly);

  head('City board rejection still says reposition');
  await api('/board/clear', 'POST', {});
  dec = await api('/board/add', 'POST', {
    cargo: 'Scrap', trailerType: type, atLocation: false,
    originCity: 'Denver', originState: 'CO', destCity: 'Pueblo', destState: 'CO',
    loadedMiles: 110, deadheadMiles: 40, gameRevenue: 90, deadlineHours: 20, weightLbs: 20000,
  });
  ok('rejected', dec.rejectAll === true, dec.headline);
  ok('NOT local-only', dec.localOnly === false);
  ok('and now it does talk about repositioning', dec.dispatchNotes.some((n) => /Reposition|reset/i.test(n)),
    dec.dispatchNotes.find((n) => /Reposition|reset/i.test(n)) || '(none)');

  head('A mixed board is judged as a city board');
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Scrap', trailerType: type, atLocation: true,
    originCity: 'Denver', originState: 'CO', destCity: 'Pueblo', destState: 'CO',
    loadedMiles: 110, deadheadMiles: 0, gameRevenue: 90, deadlineHours: 20, weightLbs: 20000,
  });
  dec = await api('/board/add', 'POST', {
    cargo: 'Sand', trailerType: type, atLocation: false,
    originCity: 'Denver', originState: 'CO', destCity: 'Greeley', destState: 'CO',
    loadedMiles: 60, deadheadMiles: 30, gameRevenue: 45, deadlineHours: 10, weightLbs: 12000,
  });
  ok('not local-only once a city job is on it', dec.localOnly === false, `localOnly=${dec.localOnly}`);

  head('The flag survives onto the trip record');
  await api('/board/clear', 'POST', {});
  dec = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: type, atLocation: true,
    originCity: 'Denver', originState: 'CO', destCity: 'Salt Lake City', destState: 'UT',
    loadedMiles: 520, deadheadMiles: 0, gameRevenue: 2300, deadlineHours: 48, weightLbs: 40000,
  });
  const board = (await api('/bootstrap')).board;
  ok('load stored with atLocation', board[0].atLocation === true, `${board[0].atLocation}`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERR:', e.message); process.exitCode = 2; });
