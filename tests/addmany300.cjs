/* Screenshot rows onto the board in one call (asked for from play, v0.86): "Add ticked rows to the board" sat with no
 * sign of life while each row was sent on its own and the whole board re-planned after every one.
 *
 *   - every row goes on in one call, and the board is planned once, with the decision handed back
 *   - a row under the expiry floor is refused on its own, named, and the rest still go on
 *   - the result is the same board /board/add one at a time would have built
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
const un = (r) => r.snapshot || r;

(async () => {
  const app = { driverName: 'Batch Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'none' };
  await api('/onboarding/market', 'POST', app);
  const S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' }));
  const type = S.trailers[0].type;
  await api('/status', 'POST', { locationCity: 'Denver', locationState: 'CO', locationKind: 'Receiver', gameTime: '2000-01-01T06:00',
    fuelPct: 90, atsOdometer: 0, truckDamagePct: 0, trailerDamagePct: 0, dutyStatus: 'OnDuty', atsBankBalance: 40000 });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  const load = (over) => ({ cargo: 'Machinery', trailerType: type, atLocation: false,
    originCity: 'Denver', originState: 'CO', destCity: 'Salt Lake City', destState: 'UT',
    loadedMiles: 520, deadheadMiles: 20, gameRevenue: 2300, deadlineHours: 48, weightLbs: 40000, ...over });

  head('1. Three rows, one of them about to expire');
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add-many', 'POST', [
    load({}), load({ destCity: 'Cheyenne', destState: 'WY', loadedMiles: 100, gameRevenue: 600 }),
    load({ cargo: 'Expiring', expiresInHours: 0.1 }),
  ]);
  ok('two added', r.added === 2, `${r.added}`);
  ok('the expiring one refused and named', r.refused.length === 1 && r.refused[0].cargo === 'Expiring' && /listing/i.test(r.refused[0].reason),
    JSON.stringify(r.refused).slice(0, 160));
  ok('the board planned once and the decision handed back', (r.decision?.evaluations || []).length === 2 && !!r.decision.headline,
    r.decision?.headline);

  head('2. The same board as one row at a time');
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', load({}));
  const one = await api('/board/add', 'POST', load({ destCity: 'Cheyenne', destState: 'WY', loadedMiles: 100, gameRevenue: 600 }));
  const recs = (d) => (d.evaluations || []).map((e) => `${e.load.destCity}:${e.recommendation}`).sort().join(',');
  ok('same loads, same recommendations', recs(one) === recs(r.decision), `${recs(one)} vs ${recs(r.decision)}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
