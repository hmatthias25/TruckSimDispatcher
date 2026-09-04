/* Issue #77: years of experience come from time, not from running loads.
 *
 * Thirty loads used to credit a driver with a full year, so a greenhorn was told they could apply to a
 * fleet wanting five years after a hundred and fifty loads — about a fortnight of game time. That made
 * the experience gate meaningless and made every specialised carrier reachable almost immediately.
 *
 * A year is 365 days. Loads still satisfy a carrier's minimum-loads requirement on their own, because
 * that is a separate gate about verifiable history — but they never buy years.
 */
const H = require('./lib/helpers.cjs');
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5990}/api`;
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
  const dt = new Date(Date.UTC(2000, 0, 1) + d * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S, day = 1;
const greenhorn = { driverName: 'N. Ewbie', preferredDivision: 'Dry Van', transmissionPreference: 'either',
  experienceYears: 0, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
  homeTimePreference: 'biweekly' };

async function report(d) {
  S = un(await api('/status', 'POST', {
    locationCity: 'Amarillo', locationState: 'TX', locationKind: 'TruckStop', gameTime: at(d),
    fuelPct: 85, atsOdometer: 5000 + d * 300, truckDamagePct: 2, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  }));
  return S;
}

async function runLoad(destCity, destState) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const add = () => api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity, destState, loadedMiles: 400, deadheadMiles: 0,
    gameRevenue: 1700, deadlineHours: 240, weightLbs: 40000,
  });
  const auth = await H.authorize(api, add, (d) => { day += d; return at(day); });
  day += 1;
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: at(day), actualMiles: 400, endOdometer: 0, actualRevenue: 1700,
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

(async () => {
  head('1. A greenhorn is not told a fortnight of loads is a career');
  const m = await api('/onboarding/market', 'POST', greenhorn);
  const list = m.market || [];
  const gated = list.filter((c) => c.minExperienceYears >= 1 && c.daysToQualify > 0);
  ok('carriers with a years bar exist', gated.length > 0,
    gated.map((c) => `${c.code}:${c.minExperienceYears}yr`).join(' '));
  ok('the shortfall is quoted in DAYS, not loads',
    gated.every((c) => c.daysToQualify > 0), `${gated[0]?.code}: ${gated[0]?.daysToQualify} days`);
  ok('and a year of it is 365 days',
    gated.every((c) => Math.abs(c.daysToQualify - c.minExperienceYears * 365) < 2),
    gated.map((c) => `${c.code} ${c.daysToQualify}/${c.minExperienceYears * 365}`).join(' '));
  ok('nobody can buy five years with 150 loads',
    gated.every((c) => c.daysToQualify >= 365), `min ${Math.min(...gated.map((c) => c.daysToQualify))} days`);

  head('2. The card asks for what the screening actually applies');
  ok('the two agree on every carrier',
    list.every((c) => c.daysToQualify === 0
      || Math.abs(c.daysToQualify / 365 - (c.minExperienceYears - c.creditedExperienceYears)) < 0.02),
    list.filter((c) => c.daysToQualify > 0
      && Math.abs(c.daysToQualify / 365 - (c.minExperienceYears - c.creditedExperienceYears)) >= 0.02)
      .map((c) => c.code).join(', ') || 'all agree');
  const moved = list.filter((c) => c.minExperienceYears !== c.postedMinExperienceYears);
  ok('a bar moved by trading conditions says so',
    moved.every((c) => c.postedMinExperienceYears >= 0),
    moved.map((c) => `${c.code} ${c.postedMinExperienceYears}->${c.minExperienceYears}`).join(' ') || 'none moved');

  head('3. Loads do not add years');
  S = un(await api('/onboarding/hire', 'POST', { application: greenhorn, force: true, gameTime: at(1), code: 'PRI' }));
  day = 2;
  await report(day);
  const startCredit = S.views.career.creditedExperienceYears ?? 0;
  for (let i = 0; i < 8; i++) await runLoad(i % 2 ? 'Amarillo' : 'Oklahoma City', i % 2 ? 'TX' : 'OK');
  S = un(await api('/bootstrap'));
  const stats = S.views.career.stats;
  const credited = S.views.career.creditedExperienceYears ?? 0;
  const expected = stats.daysEmployed / 365;
  console.log(`     ${stats.loadsDelivered} loads over ${stats.daysEmployed} days employed`);
  ok('eight loads did not buy months of experience', credited < 0.2,
    `credited ${credited} yr`);
  ok('credited experience is exactly declared + time served',
    Math.abs(credited - expected) < 0.02, `${credited} against ${expected.toFixed(3)} from days alone`);

  head('4. Time does add years');
  const beforeDays = stats.daysEmployed;
  await report(beforeDays + 400);
  S = un(await api('/bootstrap'));
  const later = S.views.career.creditedExperienceYears ?? 0;
  ok('a year of service is worth a year', later >= 1,
    `${S.views.career.stats.daysEmployed} days -> ${later} yr`);
  ok('and it is time doing it, not the load count',
    Math.abs(later - S.views.career.stats.daysEmployed / 365) < 0.02,
    `${later} against ${(S.views.career.stats.daysEmployed / 365).toFixed(3)}`);

  head('5. Being turned down explains it in time');
  const m2 = await api('/onboarding/market', 'POST', greenhorn);
  const reasons = (m2.market || []).flatMap((c) => c.screening?.reasons || []).join(' | ');
  // Located on "behind the wheel" rather than "years on", which is what the refusal used to say. It
  // claimed a division check nobody made — "two years on flatbed" answered with days served anywhere
  // on anything (#172) — and now names the thing it actually counts. "Years on <division>" is still a
  // phrase the app uses, but it belongs to DivisionExperience crediting time, not to a refusal, and
  // matching on it here picked up the credit and asserted refusal wording against it.
  const yearsReason = reasons.split(' | ').find((r) => /years behind the wheel/i.test(r)) || '';
  ok('a years refusal names time', !yearsReason || /day\(s\)|year\(s\) on the job/i.test(yearsReason),
    yearsReason.slice(0, 150) || '(nobody refused on years)');
  ok('and says loads will not shorten it',
    !yearsReason || /loads do not shorten it/i.test(yearsReason), yearsReason.slice(-90));

  head('6. The loads gate is still answered in loads');
  const byLoads = (m2.market || []).filter((c) => c.loadsToQualify > 0);
  ok('carriers wanting verifiable history still count loads', byLoads.length >= 0,
    byLoads.map((c) => `${c.code}:${c.loadsToQualify}`).join(' ') || 'none outstanding');
  ok('and that target is separate from the time one',
    byLoads.every((c) => c.loadsToQualify <= c.minLoads),
    byLoads.map((c) => `${c.loadsToQualify}/${c.minLoads}`).join(' ') || 'n/a');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
