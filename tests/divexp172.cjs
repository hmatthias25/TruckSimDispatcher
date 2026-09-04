/* #172, #173, #174 — what a carrier's freight is worth, and saying so before it costs anything.
 *
 * #172: the screen wrote its refusals as "they want two years on flatbed" and answered them with days
 *       served anywhere on anything. A driver who had never thrown a strap cleared an open-deck bar on
 *       van time. Division time is now measured, and spends as a CREDIT on close calls — never a bar,
 *       because needing flatbed time to get a flatbed job is a career that cannot be started.
 * #173: "specialised freight — expect a longer orientation" was printed by carriers whose probation
 *       planner had never heard of the flag.
 * #174: "that is not a division this company operates" fired only after the driver had read a board,
 *       picked a job and typed it in.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5871}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const at = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + d * 86400000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}T${hm}`;
};

// Three declared years, all of it reefer. Enough that a two-year carrier is clear and a five-year
// specialist is not, which puts both halves of #172 in one application.
const app = {
  driverName: 'J. Ferrand', preferredDivision: 'Reefer', transmissionPreference: 'either',
  experienceYears: 3, freightExperience: ['Reefer'],
  homeCity: 'Kansas City', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly',
};

const H = require('./lib/helpers.cjs');

let day = 300;
let S;

/** One load. On drop and hook the LISTING carries the trailer, so pass what should be hooked. */
async function runLoad(destCity, destState, trailerType) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const add = () => api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType,
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity, destState, loadedMiles: 400, deadheadMiles: 0,
    gameRevenue: 1800, deadlineHours: 240, weightLbs: 40000,
  });
  const auth = await H.authorize(api, add, (d) => { day += d; return at(day); });
  day += 1;
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: at(day), actualMiles: 400, endOdometer: 0, actualRevenue: 1800,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: destCity, locationState: destState, fuelPct: 60, gameTime: at(day),
  });
  S = done.snapshot;
  return done;
}

const find = (m, code) => m.find((c) => c.code === code);
const market = async () => (await api('/market')).market;

async function report(day) {
  return api('/status', 'POST', {
    locationCity: 'Kansas City', locationState: 'MO', locationKind: 'TruckStop', gameTime: at(day),
    fuelPct: 80, atsOdometer: 50000, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 80000,
  });
}

(async () => {
  head('1. Declared freight experience lands on the division it was declared for');
  const m0 = (await api('/onboarding/market', 'POST', app)).market;

  const cre = find(m0, 'CRE');           // C.R. England — reefer first
  const mel = find(m0, 'MEL');           // Melton — flatbed first
  ok('a reefer carrier sees reefer time', cre.divisionYears >= 1.5, `${cre.divisionYears} yr`);
  ok('and it is capped, not taken on the word entire',
    cre.divisionYears <= 2.01, `${cre.divisionYears} credited of 3 declared`);
  ok('a flatbed carrier sees none of it', mel.divisionYears === 0, `${mel.divisionYears} yr`);

  head('1b. And having none of it is never presented as a bar');
  ok('the flatbed carrier says so without refusing over it',
    /not a bar/i.test(mel.divisionNote || ''), (mel.divisionNote || '(none)').slice(0, 140));
  ok('while still saying what it costs on a close call',
    /front of you/i.test(mel.divisionNote || ''), (mel.divisionNote || '').slice(-90));
  ok('the reefer carrier says it is what they want',
    /their freight|done the work/i.test(cre.divisionNote || ''), (cre.divisionNote || '(none)').slice(0, 140));

  head('2. A refusal on years stops claiming a division it never checked');
  // By whoever is actually short-of-years this game month rather than by name: carrier conditions are
  // seeded on the month, and a carrier under a hiring freeze never reaches its experience bar at all.
  const allReasons = m0.map((c) => (c.screening?.reasons || []).join(' | '));
  const shortOfYears = allReasons.filter((r) => /more day\(s\) on the job|more year\(s\) on the job/i.test(r));
  ok('somebody turns three years down', shortOfYears.length > 0,
    `${shortOfYears.length} of ${m0.length} carriers`);
  ok('and asks for years behind the wheel, not years on their trailer',
    shortOfYears.every((r) => /behind the wheel/i.test(r)), shortOfYears[0]?.slice(0, 170) || '');
  ok('nothing anywhere on the board demands years on a division it never counts',
    !allReasons.some((r) => /want [0-9.]+ years on /i.test(r)),
    allReasons.find((r) => /want [0-9.]+ years on /i.test(r))?.slice(0, 200)
      || `clean across all ${m0.length} carriers`);

  head('3. Time in the seat accrues to the freight that seat pulls');
  // Read off ANOTHER reefer carrier, because the market does not list the employer you are already at
  // — and reefer time earned at C.R. England is reefer time wherever it is being weighed.
  await api('/onboarding/hire', 'POST', { application: app, force: true, code: 'CRE', gameTime: at(1) });
  await report(1);
  const early = find(await market(), 'MRT').divisionYears;
  await report(200);
  const later = find(await market(), 'MRT').divisionYears;
  ok('two hundred days pulling reefer is reefer experience', later > early,
    `${early} -> ${later} yr`);
  ok('and none of it leaked onto somebody else freight',
    find(await market(), 'MEL').divisionYears === 0,
    `${find(await market(), 'MEL').divisionYears} yr on flatbed`);

  head('4. On the Cargo Market the brief says nothing, because the game already filtered');
  // Reported from play: "the cargo jobs ONLY shows cargos I can run with the trailer assigned to me".
  // The company settled the division the day it hooked you to a reefer, so every listing resolves to
  // that one division and this check cannot fail. Saying it anyway is noise about a choice the driver
  // does not have.
  await api('/board/clear', 'POST', {});
  const cargoEmpty = (await api('/board/evaluate')).dispatchNotes || [];
  ok('nothing about divisions on an empty Cargo Market board',
    !cargoEmpty.some((x) => /runs Reefer|off-division|Freight Market will show/i.test(x)),
    cargoEmpty.find((x) => /division/i.test(x))?.slice(0, 120) || `${cargoEmpty.length} note(s), none of them this`);

  await api('/board/add', 'POST', {
    cargo: 'Steel Coils', trailerType: 'Flatbed',
    originCity: 'Kansas City', originState: 'MO', destCity: 'Topeka', destState: 'KS',
    loadedMiles: 140, deadheadMiles: 10, gameRevenue: 900, deadlineHours: 30, weightLbs: 42000,
  });
  const cargoMixed = (await api('/board/evaluate')).dispatchNotes || [];
  ok('nor when a load is typed in that the trailer could not pull',
    !cargoMixed.some((x) => /off-division|none of this board/i.test(x)),
    cargoMixed.find((x) => /off-division/i.test(x))?.slice(0, 120) || 'silent, as it should be');

  head('5. On the Freight Market it is the real gate');
  // Drop and hook: no trailer of your own, so ATS offers every trailer on the lot and the driver can
  // genuinely hook something the company does not run. This is the only place the brief is worth
  // anything. Reached the way drophook99 reaches it — the arrangement comes through an equipment order.
  await api('/board/clear', 'POST', {});
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  for (const [city, st, day] of [['Denver', 'CO', 205], ['Phoenix', 'AZ', 208],
    ['Las Vegas', 'NV', 211], ['Salt Lake City', 'UT', 214], ['Kansas City', 'MO', 217]]) {
    await api('/status', 'POST', {
      locationCity: city, locationState: st, locationKind: 'TruckStop', gameTime: at(day),
      fuelPct: 80, atsOdometer: 50000, truckDamagePct: 3, trailerDamagePct: 2,
      dutyStatus: 'OffDuty', atsBankBalance: 80000,
    });
  }
  const ceiling = (await api('/bootstrap')).views.career.ceilingRank;
  await api('/career/promote', 'POST', { rank: ceiling, force: true, note: 'fixture' });

  const offers = await api('/career/dedicated/offers');
  ok('there is an account to put the driver on', (offers.offers || []).length > 0,
    offers.blocked || `${(offers.offers || []).length} on offer`);
  const assigned = await api('/career/dedicated/assign', 'POST', { company: offers.offers[0].name });
  await api('/status', 'POST', {
    locationCity: 'Kansas City', locationState: 'MO', locationKind: 'Terminal', gameTime: at(220),
    fuelPct: 80, atsOdometer: 50000, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 80000,
  });
  await api(`/equipment/orders/${assigned.order.number}/complete`, 'POST', {});
  ok('the driver is on drop and hook',
    (await api('/bootstrap')).views.dropHook?.on === true, 'freight market');

  const brief = ((await api('/board/evaluate')).dispatchNotes || [])
    .find((x) => /Freight Market will show/i.test(x));
  ok('now the brief appears', !!brief, brief?.slice(0, 190) || '(silent)');
  ok('it warns that every trailer on the lot is on offer', /every trailer on the lot/i.test(brief || ''),
    brief?.slice(0, 120) || '');
  ok('it names what we run', /reefer/i.test(brief || ''), brief?.slice(0, 160) || '');
  ok('and says to hook one of those', /hook one of those/i.test(brief || ''),
    brief?.slice(-110) || '');

  head('5b. And a trailer the company does not run is called out up front');
  await api('/board/add', 'POST', {
    cargo: 'Steel Coils', trailerType: 'Flatbed',
    originCity: 'Kansas City', originState: 'MO', destCity: 'Topeka', destState: 'KS',
    loadedMiles: 140, deadheadMiles: 10, gameRevenue: 900, deadlineHours: 30, weightLbs: 42000,
  });
  const notes = (await api('/board/evaluate')).dispatchNotes || [];
  const offDivision = notes.find((x) => /none of this board|off-division/i.test(x));
  ok('a flatbed on a reefer carrier board is refused before it is read', !!offDivision,
    offDivision?.slice(0, 200) || `no such note among ${notes.length}`);
  ok('and it names what we do run instead', /reefer/i.test(offDivision || ''),
    offDivision?.slice(-110) || '');

  head('5c. THE REPORTED CASE: credit follows what you HAULED, not who employed you');
  // "I looked at Melton and it said nothing on your record for flatbed, but I have been running almost
  // exclusively flatbed for 70 days." Served days went to the EMPLOYER's first-listed division, so
  // freight pulled at a carrier known for something else vanished.
  //
  // Drop and hook is where the two come apart cleanly: the listing carries the trailer, so a dry van
  // hauled at C.R. England — Reefer first — is a day of dry van and not a day of reefer. Under the old
  // arithmetic every one of these days landed on reefer and dry van stayed at nought forever.
  const vanBefore = find(await market(), 'WER').divisionYears;   // Werner — Dry Van first
  day = 221;
  S = un(await api('/bootstrap'));
  for (const [c, st] of [['Tulsa', 'OK'], ['Kansas City', 'MO'], ['Tulsa', 'OK'], ['Kansas City', 'MO']]) {
    await runLoad(c, st, 'Dry Van');
  }
  const vanAfter = find(await market(), 'WER').divisionYears;

  ok('hauling dry van puts dry van on the record', vanAfter > vanBefore,
    `${vanBefore} -> ${vanAfter} yr on dry van`);
  ok('and the carrier stops being told there is nothing there',
    !/Nothing on your record is dry van/i.test(find(await market(), 'WER').divisionNote || ''),
    (find(await market(), 'WER').divisionNote || '(none)').slice(0, 130));
  ok('the days are days, not a load count',
    vanAfter - vanBefore > 0.005, `${((vanAfter - vanBefore) * 365).toFixed(1)} day(s) credited`);

  head('6. Specialised freight buys a real orientation, not a sentence about one');
  ok('Bennett is flagged specialised', find(m0, 'BEN').specialized === true);
  const offer = un(await api('/onboarding/hire', 'POST',
    { application: app, force: true, code: 'BEN', gameTime: at(210) }));
  const plan = (await api('/bootstrap')).driver.probation;
  // A floor, so a rookie's ninety days clear it on their own — what this guards is the OTHER path,
  // where a strong record shortens a period to thirty or forty-five days. Reaching that state from a
  // test costs forty delivered loads, so this pins the floor rather than demonstrating the shortening
  // being blocked: shorten a specialised probation past sixty days and this goes red.
  ok('and its probation is at or above the specialised floor', plan.durationDays >= 60,
    `${plan.durationDays} days`);
  ok('the period is explained rather than just applied',
    (plan.notes || '').length > 0, (plan.notes || '(silent)').slice(0, 120));
  ok('and the hire went through as specialised freight',
    /Bennett/i.test(JSON.stringify(offer)), 'hired at Bennett');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
