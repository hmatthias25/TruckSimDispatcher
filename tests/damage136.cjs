/* Issues #135-#138 — what damage actually costs you.
 *
 * #135 The board was offered, screenshots taken and AI tokens spent before the driver was told no load
 *      could be authorized at all. Every blocker was already on the snapshot.
 * #136 10% is not catastrophic and our shop is cheaper, but every extra mile risks more — so it goes
 *      home whatever the distance, and freight is filtered as though home time fell due today. 15%
 *      keeps what 10% used to do. The damage clock never touches the home-time record.
 * #137 A truck on a hook is not running home at any damage level.
 * #138 A 10% repair inside a working day is not credible.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5860}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const H = require('./lib/helpers.cjs');
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const at = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + d * 86400000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;
const views = async () => (await api('/bootstrap')).views;

async function stand(city, state, dmg, day) {
  await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'Shipper', gameTime: at(day, '07:00'),
    fuelPct: 80, atsOdometer: 150000, truckDamagePct: dmg, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 90000,
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
  return (await views()).shopOrder || {};
}

async function offer(dc, ds, miles) {
  await api('/board/clear', 'POST', {});
  // Read the standing location fresh: a load whose origin is not where the truck is standing is a
  // different question entirely, and stand() moves the truck.
  const now = (await api('/bootstrap')).status;
  return api('/board/add', 'POST', {
    cargo: 'Palletised Goods', trailerType: S.trailers[0].type, atLocation: true,
    originCity: now.locationCity, originState: now.locationState,
    destCity: dc, destState: ds, loadedMiles: miles, deadheadMiles: 0,
    gameRevenue: miles * 3, deadlineHours: 60, weightLbs: 36000,
  });
}

(async () => {
  const app = { driverName: 'R. Calloway', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Phoenix', homeState: 'AZ', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);

  head('1. #138 A repair takes a shop day, not an afternoon');
  const q = async (d, own) => (await api(`/maintenance/quote?truck=${d}&trailer=0&companyShop=${own}`)).waitHours;
  const ten = await q(10, false);
  ok('10% is more than a day at a dealer', ten >= 24, `${ten.toFixed(1)} h`);
  ok('our own shop is quicker but still a day', (await q(10, true)) >= 16, `${(await q(10, true)).toFixed(1)} h`);
  ok('a scrape is not free either', (await q(5, false)) >= 18, `${(await q(5, false)).toFixed(1)} h`);
  ok('and heavy damage costs more than light', (await q(30, false)) > ten, `${(await q(30, false)).toFixed(1)} h`);
  ok('one intake, not one per unit',
    (await api('/maintenance/quote?truck=10&trailer=10&companyShop=false')).waitHours < ten + 20, 'shared');

  head('2. #136 At 10% it goes home, however far away home is');
  // Seattle to Phoenix is about 1,400 miles — nowhere near a day's drive. It still goes home, which is
  // the whole change: at this level there is no fixing it on the road at any distance.
  S = await api('/bootstrap');
  const far = await stand('Seattle', 'WA', 11, 5);
  ok('the order is to run it home', far.kind === 'RunHome', far.kind);
  ok('and it does not pretend home is close',
    /further than a day|you are going anyway/i.test((far.instructions || []).join(' ')),
    (far.instructions || []).find((x) => /further than a day/i.test(x))?.slice(0, 90) || '');
  ok('it says the record is not affected',
    /does not touch your home-time record/i.test((far.instructions || []).join(' ')), 'said');
  ok('freight is not blocked outright', far.blocksAllFreight === false, `${far.blocksAllFreight}`);

  head('3. #136 The damage clock squeezes the board like home time due today');
  // From Las Vegas, Phoenix is about 300 mi and Portland is about 1,300 — so Portland is unambiguously
  // FURTHER out, which is what the outbound rule is about. Run from Seattle this proved nothing:
  // Salt Lake City is nearer Phoenix than Seattle is, so the load was closing distance, not opening it.
  await stand('Las Vegas', 'NV', 11, 5);
  S = await api('/bootstrap');
  const away = await offer('Portland', 'OR', 980);
  ok('a load further from home is refused',
    away.rejectAll === true || (away.evaluations || []).every((e) => e.recommendation === 'Reject'),
    away.headline?.slice(0, 80));
  const why = JSON.stringify(away).toLowerCase();
  ok('and the reason names the truck, not home time',
    /damage line/.test(why) && /nothing to do with your home time/.test(why), 'damage named');

  head('4. #136 A load that heads home is still fine');
  S = await api('/bootstrap');
  const home = await offer('Phoenix', 'AZ', 300);
  ok('freight toward the yard is authorized', !!home.authorizedLoadId,
    home.headline?.slice(0, 80) || '(refused)');

  head('5. #136 The clock ticks, and is separate from the record');
  const d0 = (await views()).damageDaysOverdue;
  ok('the clock starts at zero on the day it happens', d0 != null && d0 < 1, `${d0}`);
  await stand('Barstow', 'CA', 11, 8);
  const d3 = (await views()).damageDaysOverdue;
  ok('and counts up from there', d3 >= 2.9, `${d3?.toFixed(1)} days`);
  const ht = (await views()).homeTime || {};
  ok('home time is untouched by it', ht.overdue !== true, `overdue=${ht.overdue}, late=${ht.daysLate ?? 0}`);

  head('6. #136 15% is the hard stop it used to be');
  // Far from home, so the run-home option is off the table and the nearest shop is the answer — which
  // is exactly what 10% used to do from here.
  const hard = await stand('Seattle', 'WA', 16, 9);
  ok('far from home it is the nearest shop', hard.kind === 'Shop', hard.kind);
  ok('and no freight moves until it is done', hard.blocksAllFreight === true, `${hard.blocksAllFreight}`);

  head('7. #135 You are told before the board, not after');
  // Still at 16% and far from home from the section above, so freight is stopped outright. The point is
  // that this is on the snapshot with no board pulled, no screenshots taken and no tokens spent.
  const blockers = (await views()).dispatchBlockers || [];
  ok('a blocker is on the snapshot with no board pulled', blockers.length > 0, blockers[0]?.slice(0, 90));
  ok('and it names the damage', blockers.some((b) => /%/.test(b)),
    blockers.find((b) => /%/.test(b))?.slice(0, 90) || '(no damage blocker)');

  // A run-home order is NOT a blocker and must not become one — the driver still takes a board, and a
  // load finishing at the yard beats deadheading the whole way.
  await stand('Seattle', 'WA', 11, 9);
  ok('but a run-home order does not stop the board',
    ((await views()).dispatchBlockers || []).length === 0,
    ((await views()).dispatchBlockers || [])[0]?.slice(0, 70) || 'board still offered');

  head('8. #137 A truck on a hook is not running home');
  await stand('Barstow', 'CA', 12, 10);
  const before = (await views()).shopOrder || {};
  ok('without a tow that damage would run home', before.kind === 'RunHome', before.kind);
  const towed = await api('/maintenance/tow', 'POST', {
    fromCity: 'Barstow', fromState: 'CA', toCity: 'Victorville', toState: 'CA',
    truckDamagePctAfter: 12, notes: 'rolled it',
  });
  ok('the recovery is billed by distance', Number(towed.tow.cost) > 0, `$${towed.tow.cost}`);
  ok('and it is no longer a run-home order', towed.order.kind !== 'RunHome', towed.order.kind);
  ok('the order says it went in on a hook',
    /on a hook/i.test((towed.order.instructions || []).concat(towed.order.headline || '').join(' ')),
    towed.order.headline?.slice(0, 80));
  const led = (await api('/ledger?take=40')).find((e) => /Recovery/i.test(e.memo || ''));
  ok('the company paid for the wrecker', !!led && led.amount < 0,
    led ? `${led.memo} ${led.amount}` : '(nothing posted)');

  head('9. #139 And there is somewhere to actually report it');
  // The whole tow mechanism shipped with no form on any tab, so it was unreachable from the app while
  // the manual said to use the Maintenance tab. An endpoint nobody can reach is not a feature.
  const js = await (await fetch(B.replace('/api', '') + '/app.js')).text();
  ok('the maintenance tab has a tow panel', /function towHtml\(\)/.test(js), 'towHtml present');
  ok('it is mounted, not just defined', /\$\{towHtml\(\)\}/.test(js), 'mounted');
  ok('it posts the recovery', /'\/maintenance\/tow', 'POST'/.test(js), 'wired');
  ok('and it asks for the damage after, which is what decides repair or write-off',
    /id="tow-dmg"/.test(js), 'damage field');

  // Once one is on file the panel reports it rather than offering to log a second.
  ok('the recovery shows on the snapshot', !!(await api('/bootstrap')).views.tow,
    `$${(await api('/bootstrap')).views.tow?.cost}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
