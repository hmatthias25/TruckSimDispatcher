/* #275 - step 9 of Euro Truck Simulator 2 support (#266): the game, chosen for a career.
 *
 *   - the application picks the game before the first hire, and the career starts on that game's defaults
 *   - fixed once hired; a new career may be the other game, on its own defaults, keeping only the API key
 *   - starting over stays in the same game
 *   - the screenshot reader asks ETS2 for kilometres, euros, kilograms, country codes, ADR and 24-hour times,
 *     and the app converts them
 *   - ETS2's 24-hour delivery windows read as they should
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j ?? t;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm = '06:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const app = { driverName: 'A. Rossi', preferredDivision: 'Dry Van', transmissionPreference: 'either',
  experienceYears: 6, acceptsProbation: true };

(async () => {
  head('1. A new career is ATS until the application says otherwise');
  let S = await api('/bootstrap');
  ok('ATS by default, and the choice is open', S.game.id === 'ATS' && S.game.canChoose === true, S.game.id);
  ok('the snapshot names the folders for the help text', S.game.steamAppId === '270880' && /American Truck Simulator/.test(S.game.folder), S.game.folder);
  const atsFuel = S.settings.fuelPricePerGal;
  await api('/settings', 'POST', { ...S.settings, anthropicApiKey: 'sk-test-key', governedMph: 68 });

  head('2. Choosing ETS2 on the application');
  S = await api('/career/game', 'POST', { game: 'ETS2' });
  ok('the career is ETS2', S.game.id === 'ETS2' && /Euro Truck Simulator 2/.test(S.game.name), S.game.name);
  ok('with Europe\'s folders and Steam id', S.game.steamAppId === '227300' && /Euro Truck Simulator 2/.test(S.game.folder), S.game.folder);
  ok('diesel at the European price, not ATS\'s', S.settings.fuelPricePerGal !== atsFuel && Math.abs(S.settings.fuelPricePerGal - 8.33) < 0.01,
    `${S.settings.fuelPricePerGal}`);
  ok('the EU\'s 90 km/h limiter, not the 68 set for ATS', S.settings.governedMph === 56, `${S.settings.governedMph}`);
  ok('every country to run, not US states', S.settings.runnableStates.includes('PL') && !S.settings.runnableStates.includes('TX'),
    `${S.settings.runnableStates.length} regions`);
  ok('no US medical premium', S.settings.healthPremiumPerPeriod === 0);
  ok('ADR classes on the application', S.views.endorsements.all.every((c) => /ADR/.test(c.label)), S.views.endorsements.all[0]?.label);
  ok('kilometres and euros', S.units.distance === 'km' || /km/.test(JSON.stringify(S.units)), JSON.stringify(S.units).slice(0, 80));
  let threw = null;
  try { await api('/career/game', 'POST', { game: 'Minecraft' }); } catch (e) { threw = e.message; }
  ok('a game the app does not know is refused', /ATS or ETS2/.test(threw || ''), threw);
  S = await api('/career/game', 'POST', { game: 'Euro Truck Simulator 2' });
  ok('choosing the same game again changes nothing', S.game.id === 'ETS2' && S.settings.governedMph === 56);

  head('3. The market is Europe, and the hire fixes the game');
  const market = await api('/onboarding/market', 'POST', app);
  const carriers = market.market || [];
  ok('the job market is European carriers', carriers.length > 0 && carriers.every((c) => c.hqState.length === 2 && c.hqState !== 'TX')
    && carriers.some((c) => /Girteka|DSV|Dachser|Schenker|Waberer/.test(c.name)), carriers.slice(0, 3).map((c) => c.name).join(', '));
  const hired = await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(8) });
  S = await api('/bootstrap');
  ok('hired, on ETS2', S.onboarded && S.game.id === 'ETS2' && S.game.canChoose === false);
  // The snapshot and the hire's setup checklist, which is where the trailer-buying advice is.
  const raw = JSON.stringify(S) + JSON.stringify(hired);
  ok('trailers are European: 13.6 m, not 53 feet', (S.trailers || []).length > 0 && S.trailers.every((t) => /13\.6 m|chassis|low loader|—/.test(t.length)),
    (S.trailers || []).map((t) => t.length).join(', '));
  ok('nothing tells a European driver about California', !/California/.test(raw), (raw.match(/.{60}California.{60}/) || [''])[0]);
  ok('the trailer advice is Europe\'s', /13\.6 m semi-trailer/.test(raw));
  threw = null;
  try { await api('/career/game', 'POST', { game: 'ATS' }); } catch (e) { threw = e.message; }
  ok('the game is fixed once hired', /fixed once you are hired/.test(threw || ''), threw);

  head('4. The screenshot reader, in Europe');
  const prompt = await api('/ai/extract-prompt');
  ok('it is told the game', /Euro Truck\s+Simulator 2/.test(prompt) && !/American Truck/.test(prompt), (prompt.match(/.{80}American Truck.{40}/s) || ['clean'])[0]);
  ok('country codes, not US states', /country code/.test(prompt) && !/US state code/.test(prompt));
  ok('kilometres, euros, kilograms', /IN KILOMETRES/.test(prompt) && /payout in euros/.test(prompt) && /IN KILOGRAMS/.test(prompt));
  ok('ADR classes and the EU trailer names', /ADR class/.test(prompt) && /curtainsider/.test(prompt));
  ok('and 24-hour windows, days kept', /Mon 23:14 - Tue 05:54/.test(prompt) && !/11:14 pm/.test(prompt),
    (prompt.match(/.{60}11:14 pm.{60}/s) || [''])[0]);
  await api('/status', 'POST', { locationCity: 'Frankfurt am Main', locationState: 'DE', locationKind: 'TruckStop', gameTime: iso(8, '06:00'),
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  const row = { cargo: 'Paper', originCity: 'Frankfurt am Main', originState: 'de', destCity: 'Köln', destState: 'de',
    shipper: '', receiver: '', loadedMiles: 190, gameRevenue: 2400, deadlineHours: 0, expiresInHours: 0,
    weightLbs: 18000, hazmatClass: '', deliverByText: 'Mon 14:00 - Mon 22:30', trailerType: 'Dry Van', unreadable: [], confidence: 'high' };
  const [l] = (await api('/board/interpret', 'POST', [row])).loads;
  ok('190 km is 118 miles to the app', Math.abs(l.loadedMiles - 118.1) < 0.2, `${l.loadedMiles}`);
  ok('18 t is 39,683 lb', Math.abs(l.weightLbs - 39683) < 2, `${l.weightLbs}`);
  ok('country codes upper-cased', l.originState === 'DE' && l.destState === 'DE');
  ok('a 24-hour window reads: opens in 8 hours, due in 16.5', Math.abs(l.appointmentOpensHours - 8) < 0.01 && Math.abs(l.deadlineHours - 16.5) < 0.01,
    `${l.appointmentOpensHours} / ${l.deadlineHours}`);
  const [again] = (await api('/board/interpret', 'POST', [l])).loads;
  ok('and interpreting it again does not shrink it twice', Math.abs(again.loadedMiles - l.loadedMiles) < 0.01 && again.weightLbs === l.weightLbs);
  const [late] = (await api('/board/interpret', 'POST', [{ ...row, deliverByText: 'Mon 22:00 - Tue 06:15' }])).loads;
  ok('an overnight 24-hour window crosses midnight', Math.abs(late.deadlineHours - 24.25) < 0.01, `${late.deadlineHours}`);

  head('4b. Saving settings on a kilometre career');
  const cur5 = (await api('/bootstrap')).settings;
  let saved = await api('/settings', 'POST', { ...cur5, governedMph: 56 }).catch((e) => e);
  ok('a whole-mph limiter saves', !(saved instanceof Error), saved.message || '');
  saved = await api('/settings', 'POST', { ...cur5, governedMph: 55.92340730136005 }).catch((e) => e);
  ok('a value that will not bind says which field, not a bare 400', saved instanceof Error && /governedMph/i.test(saved.message), saved.message);

  head('5. Another career, and starting over');
  let r = await api('/careers/new', 'POST', { name: 'Back in the States', game: 'ATS', inheritSettings: true });
  S = r.snapshot;
  ok('a new career in the other game is that game', S.game.id === 'ATS' && !S.onboarded);
  ok('on its own defaults, not Europe\'s', S.settings.governedMph === 65 && S.settings.runnableStates.includes('CA')
    && !S.settings.runnableStates.includes('PL') && S.settings.healthPremiumPerPeriod === 60,
    `${S.settings.governedMph} mph, ${S.settings.runnableStates.slice(0, 5)}, ${S.settings.healthPremiumPerPeriod}`);
  r = await api('/careers/new', 'POST', { name: 'Same again', inheritSettings: true });
  ok('with no game given, a new career is the game being played', r.snapshot.game.id === 'ATS');
  r = await api('/careers/new', 'POST', { name: 'Europe again', game: 'ETS2', inheritSettings: true });
  ok('and back to Europe, on Europe\'s defaults', r.snapshot.game.id === 'ETS2' && r.snapshot.settings.governedMph === 56);
  await api('/reset', 'POST', { confirm: 'RESET' });
  S = await api('/bootstrap');
  ok('starting over stays in the same game', S.game.id === 'ETS2' && !S.onboarded, S.game.id);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
