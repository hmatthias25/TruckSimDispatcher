const B = `http://127.0.0.1:${process.env.TSD_PORT || 5233}/api`;
let fails = 0, passes = 0;

async function api(path, method = 'GET', body) {
  const r = await fetch(B + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 400)}`);
  return json;
}

function check(label, cond, detail = '') {
  if (cond) { passes++; console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`); }
  else { fails++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function head(t) { console.log(`\n=== ${t} ===`); }

(async () => {
  // ---------------------------------------------------------------- onboarding
  head('1. Hire: one yard, one truck, one trailer, home city discovered');
  const app = {
    driverName: 'Test Driver', preferredDivision: 'Dry Van', transmissionPreference: 'manual',
    experienceYears: 3, freightExperience: ['Dry Van'], preferredTripLength: 'medium',
    homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
  };
  await api('/onboarding/market', 'POST', app);
  const hired = await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: null, code: null });
  let S = hired.snapshot || hired;

  check('exactly 1 terminal', S.company.terminals.length === 1,
    `${S.company.terminals.length} — ${S.company.terminals.map((t) => t.city + '/' + t.level).join(', ')}`);
  check('HQ is Small tier (1 truck)', S.company.terminals[0].level === 'Small' && S.company.terminals[0].truckCapacity === 1,
    `${S.company.terminals[0].level} cap ${S.company.terminals[0].truckCapacity}`);
  check('exactly 1 truck', S.trucks.length === 1, `${S.trucks.length}: ${S.trucks.map((t) => t.unit).join(',')}`);
  check('exactly 1 trailer', S.trailers.length === 1, `${S.trailers.length}: ${S.trailers.map((t) => t.unit).join(',')}`);
  check('truck matches manual preference', S.trucks[0].transmissionType === 'manual', S.trucks[0].transmission);
  check('assigned truck is in-game', S.trucks[0].inGameGarage === true);
  check('home city discovered', (S.discovered || []).some((d) => d.city === S.company.terminalCity),
    (S.discovered || []).map((d) => d.city).join(', '));
  check('home city marked as owned', (S.discovered || []).find((d) => d.city === S.company.terminalCity)?.garageOwned === true);
  check('no garage opportunities at home', (S.views.garageOpportunities || []).length === 0,
    `${(S.views.garageOpportunities || []).length} listed`);
  check('nothing flagged as backdrop', S.views.backdrop.any === false, JSON.stringify(S.views.backdrop));

  // ---------------------------------------------------------------- settings that reset must survive
  head('2. Settings survive a career reset');
  const st = JSON.parse(JSON.stringify(S.settings));
  st.anthropicApiKey = 'sk-ant-TESTKEY-do-not-use';
  st.hos.requireBreak = false;
  st.fuelPricePerGal = 4.44;
  st.overheadPerLoad = 33;
  st.mods = ['Realistic HOS', 'Coast to Coast'];
  S = await api('/settings', 'POST', st);
  check('key stored (masked back)', S.settings.anthropicApiKey === '********');
  check('requireBreak off', S.settings.hos.requireBreak === false);

  // ---------------------------------------------------------------- a load
  head('3. Fuel: log a stop mid-trip, add more at close-out');
  const yard = S.company.terminals[0];
  S = await api('/status', 'POST', {
    locationCity: yard.city, locationState: yard.state, locationKind: 'Terminal',
    gameTime: '2000-01-01T06:00', fuelPct: 100, atsOdometer: 0, atsBankBalance: 25000,
    truckDamagePct: 0, trailerDamagePct: 0, dutyStatus: 'OnDuty',
  });
  S = S.snapshot || S;
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });

  const board = await api('/board/add', 'POST', {
    cargo: 'Palletised Goods', trailerType: S.trailers[0].type,
    originCity: yard.city, originState: yard.state,
    destCity: 'Oklahoma City', destState: 'OK',
    loadedMiles: 500, deadheadMiles: 0, gameRevenue: 2400, deadlineHours: 24, weightLbs: 40000,
  });
  const loadId = board.evaluations[0].load.id;
  const auth = await api('/dispatch/authorize', 'POST', { loadId, rationale: null, overrideTight: true });
  const tripId = auth.trip.id;
  console.log(`  (trip ${auth.trip.number})`);

  // Fuel stop logged while running
  let ev = await api(`/trips/${tripId}/event`, 'POST', {
    gameTime: '2000-01-01T10:00', kind: 'Fuel', detail: 'topped off',
    city: 'Joplin', state: 'MO', gallons: 120, pricePerGal: 3.9, cost: 0,
  });
  S = ev.snapshot || ev;
  let trip = S.views.activeTrip;
  check('logged fuel event became a fuel stop', (trip.fuelStops || []).length === 1,
    JSON.stringify(trip.fuelStops));
  check('stop cost derived from gal x price', Math.abs(trip.fuelStops[0].cost - 468) < 0.01,
    `$${trip.fuelStops[0].cost}`);
  check('trip fuel total rolled up', Math.abs(trip.fuelGallons - 120) < 0.01 && Math.abs(trip.fuelCost - 468) < 0.01,
    `${trip.fuelGallons} gal / $${trip.fuelCost}`);
  check('Joplin discovered from the fuel stop', (S.discovered || []).some((d) => d.city === 'Joplin'));

  // ---------------------------------------------------------------- close out
  head('4. Close-out: 3 stops, blended price, clocks carried forward, new city');
  const done = await api(`/trips/${tripId}/complete`, 'POST', {
    deliveredGameTime: '2000-01-01T17:30',
    actualMiles: 512, endOdometer: 512, actualRevenue: 2400,
    fuelStops: [
      { gallons: 120, pricePerGal: 3.9, city: 'Joplin', state: 'MO' },
      { gallons: 95, pricePerGal: 4.35, city: 'Tulsa', state: 'OK' },
      { gallons: 60, pricePerGal: 3.71, city: 'Oklahoma City', state: 'OK' },
    ],
    tolls: 12, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2.5, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Oklahoma City', locationState: 'OK', locationKind: 'Receiver',
    fuelPct: 68, gameTime: '2000-01-01T17:30',
    hosDriveRemaining: 3.5, hosShiftRemaining: 5.25, hosBreakRemaining: 0.5, hosCycleRemaining: 62.5,
  });
  S = done.snapshot;
  const a = done.audit;
  const t2 = a.trip;

  check('3 fuel stops recorded', (t2.fuelStops || []).length === 3);
  check('gallons summed', Math.abs(t2.fuelGallons - 275) < 0.01, `${t2.fuelGallons} gal`);
  const expectCost = 120 * 3.9 + 95 * 4.35 + 60 * 3.71;
  check('cost summed across stops', Math.abs(t2.fuelCost - expectCost) < 0.05,
    `$${t2.fuelCost} vs expected $${expectCost.toFixed(2)}`);
  const blended = t2.fuelCost / t2.fuelGallons;
  check('audit reports the blend', a.moneyFindings.some((m) => m.includes('3 fuel stops')),
    a.moneyFindings.find((m) => m.includes('fuel stop')) || '(none)');
  check('audit reports the price spread', a.moneyFindings.some((m) => m.includes('Spread of')),
    a.moneyFindings.find((m) => m.includes('Spread')) || '(none)');
  console.log(`  (blended $${blended.toFixed(3)}/gal, ${(t2.actualMiles / t2.fuelGallons).toFixed(2)} mpg)`);

  check('clocks accepted at delivery', a.clocksReported === true);
  check('drive clock stored', Math.abs(S.hos.driveRemaining - 3.5) < 0.001, `${S.hos.driveRemaining}`);
  check('cycle clock stored', Math.abs(S.hos.cycleRemaining - 62.5) < 0.001, `${S.hos.cycleRemaining}`);
  check('HOS marked confirmed (fresh read)', S.hos.confirmed === true);
  check('HOS tagged with the trip', S.hos.carriedForwardFrom === t2.number, S.hos.carriedForwardFrom);

  check('status marked carried-forward', S.status.carriedForwardFrom === t2.number, S.status.carriedForwardFrom);
  check('status awaiting confirmation', S.status.confirmed === false);
  check('carried-forward list populated', (a.carriedForward || []).length >= 4,
    `${(a.carriedForward || []).length} items`);
  (a.carriedForward || []).forEach((c) => console.log(`     · ${c}`));
  check('position carried', S.status.locationCity === 'Oklahoma City');
  check('fuel % carried', Math.abs(S.status.fuelPct - 68) < 0.01, `${S.status.fuelPct}%`);
  check('damage carried', Math.abs(S.status.truckDamagePct - 2.5) < 0.01, `${S.status.truckDamagePct}%`);
  check('odometer carried', Math.abs(S.status.atsOdometer - 512) < 0.01, `${S.status.atsOdometer}`);

  check('delivery discovered Oklahoma City', a.discovery !== null && a.discovery.city === 'Oklahoma City',
    a.discovery ? a.discovery.headline : '(no notice)');
  check('OKC offered as a garage', a.discovery && a.discovery.garageAvailable === true);
  check('directives do NOT re-ask for clocks',
    !a.directives.some((x) => x.includes('Re-read your HOS display')),
    a.directives.find((x) => x.includes('Clocks logged')) || '(no clocks directive)');

  head('5. Confirming carried-forward status clears the flag');
  let conf = await api('/status', 'POST', {
    locationCity: S.status.locationCity, locationState: S.status.locationState,
    locationKind: S.status.locationKind, gameTime: S.status.gameTime, fuelPct: S.status.fuelPct,
    truckDamagePct: S.status.truckDamagePct, trailerDamagePct: S.status.trailerDamagePct,
    atsOdometer: S.status.atsOdometer, dutyStatus: S.status.dutyStatus,
    atsBankBalance: S.status.atsBankBalance,
  });
  S = conf.snapshot;
  check('carried-forward flag cleared', S.status.carriedForwardFrom === '');
  check('status confirmed', S.status.confirmed === true);
  check('re-confirming same city fires no new notice', conf.discovery === null);

  head('6. Reaching a genuinely new city fires a notice');
  let mv = await api('/status', 'POST', {
    locationCity: 'Amarillo', locationState: 'TX', locationKind: 'TruckStop',
    gameTime: '2000-01-02T09:00', fuelPct: 40, atsOdometer: 900,
    truckDamagePct: 3, trailerDamagePct: 1, dutyStatus: 'Driving', atsBankBalance: 27000,
  });
  S = mv.snapshot;
  check('Amarillo notice raised', mv.discovery && mv.discovery.city === 'Amarillo',
    mv.discovery ? mv.discovery.headline : '(none)');
  check('notice carries advice', mv.discovery && mv.discovery.detail.length >= 2,
    mv.discovery ? `${mv.discovery.detail.length} lines` : '');
  check('appears in garage opportunities', (S.views.garageOpportunities || []).some((c) => c.city === 'Amarillo'),
    (S.views.garageOpportunities || []).map((c) => `${c.city}(t${c.tier})`).join(', '));

  head('7. Declining a garage stops the suggestion');
  S = await api('/discovery/decline', 'POST', { city: 'Amarillo', state: 'TX' });
  check('Amarillo dropped from opportunities', !(S.views.garageOpportunities || []).some((c) => c.city === 'Amarillo'),
    (S.views.garageOpportunities || []).map((c) => c.city).join(', ') || '(empty)');

  head('8. Opening a yard in an undiscovered city warns but is allowed');
  const warnRes = await api('/terminals', 'POST', {
    city: 'Bakersfield', state: 'CA', level: 'Small', truckCapacity: 1,
    hasFuel: true, hasParking: true, hasTrailerDrop: true,
  });
  S = warnRes.snapshot;
  check('warning returned', !!warnRes.warning, warnRes.warning || '(none)');
  check('yard still created', S.company.terminals.some((t) => t.city === 'Bakersfield'));
  check('opening it counts as discovering it', (S.discovered || []).some((d) => d.city === 'Bakersfield'));
  check('backdrop now flags the yard', S.views.backdrop.yards === 0,
    `yards flagged: ${S.views.backdrop.yards} (0 expected — buying it marks it discovered)`);

  head('9. Reset keeps settings by default');
  S = await api('/reset', 'POST', { confirm: 'RESET', resetSettings: false });
  check('career wiped', S.onboarded === false && S.trips.length === 0);
  check('API KEY KEPT', S.settings.anthropicApiKey === '********', S.settings.anthropicApiKey || '(empty)');
  check('requireBreak=false KEPT', S.settings.hos.requireBreak === false);
  check('fuel price kept', Math.abs(S.settings.fuelPricePerGal - 4.44) < 0.001, `${S.settings.fuelPricePerGal}`);
  check('overhead kept', Math.abs(S.settings.overheadPerLoad - 33) < 0.001, `${S.settings.overheadPerLoad}`);
  check('mods kept', (S.settings.mods || []).length === 2, (S.settings.mods || []).join(', '));
  check('trip prefix cleared for the new career', !S.settings.freightPrefix, `"${S.settings.freightPrefix}"`);

  head('10. Explicit factory reset does wipe settings');
  S = await api('/reset', 'POST', { confirm: 'RESET', resetSettings: true });
  check('API key gone', S.settings.anthropicApiKey === '');
  check('requireBreak back to default true', S.settings.hos.requireBreak === true);

  console.log(`\n${'='.repeat(52)}\n  ${passes} passed, ${fails} failed\n${'='.repeat(52)}`);
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error('\nTEST HARNESS ERROR:', e.message); process.exitCode = 2; });
