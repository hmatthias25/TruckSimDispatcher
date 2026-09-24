/* Who gets a dedicated account, and how.
 *
 *   "I started a new career with Schneider International. When I go to the career tab I have something
 *    about dedicated on the career tab. I thought we set this up so only senior drivers could do this,
 *    and it has to be asked for even then and can be rejected."
 *
 * The rank rule existed the whole time. It guarded dedicated DROP AND HOOK — the premium seat at the top
 * of the ladder — and not the plain dedicated panel sitting directly above it, which checked only whether
 * the CARRIER ran a dedicated division. Schneider does, so a probationary driver an hour into a new
 * career saw the panel and could put themselves on an account with a button: no rank, no request, no
 * possibility of being told no.
 *
 * Three things now hold, and they are separable:
 *
 *   1. RANK. Plain dedicated opens at senior. Deliberately a rung below the drop-and-hook rule, which
 *      stays at the carrier's ceiling — steady freight for one customer at a slightly lower rate is not
 *      the same seat as the best job in the fleet with no dock work and pay over scale.
 *   2. ASKED FOR. Going on is operations' call and needs a request. Coming OFF never is.
 *   3. REFUSABLE, on the record. No roll: a dedicated customer rings the company when a load is late, so
 *      what decides it is service, the safety file and enough work here to know. A driver who has earned
 *      it gets it every time; one who has not is told which number is in the way.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5898}/api`;
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
const iso = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

const ded = async () => (await api('/bootstrap')).views.dedicated;
const refused = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

/** Sets rank and a delivered-load record without driving any of it. */
async function record({ rank, loads = 0, onTime = 100, faults = 0, day = 60 }) {
  const st = await api('/export');
  st.driver.rank = rank;
  st.driver.probation = { ...st.driver.probation, active: false };
  st.status.gameTime = iso(day);
  st.dedicatedAccountRequests = [];
  st.driver.onDedicated = false;
  st.driver.dedicatedAccount = '';
  const late = Math.round(loads * (100 - onTime) / 100);
  st.trips = [];
  for (let i = 0; i < loads; i++) {
    st.trips.push({
      id: 'tr' + i, number: 'PRI-L-' + i, kind: 'Freight', status: 'Delivered',
      cargo: 'Goods', trailerType: 'Dry Van',
      originCity: 'Green Bay', originState: 'WI', destCity: 'Chicago', destState: 'IL',
      dispatchedGameTime: iso(10), deliveredGameTime: iso(11),
      serviceResult: i < late ? 'Late' : 'OnTime', faultAttribution: i < late ? 'Driver' : 'None',
      dispatchedMiles: 200, actualMiles: 200, startOdometer: 0, endOdometer: 200, events: [],
    });
  }
  st.incidents = [];
  for (let i = 0; i < faults; i++) {
    st.incidents.push({
      number: 'PRI-SI-' + i, kind: 'Collision', severity: 'Serious', gameTime: iso(20),
      faultAttribution: 'Driver', preventable: true, description: 'fixture', forgivenGameTime: '',
    });
  }
  await api('/import', 'POST', st);
}

(async () => {
  // Schneider runs a Dedicated division, which is what made the panel appear at all.
  const app = { driverName: 'R. Delacroix', preferredDivision: 'Dry Van', experienceYears: 4,
    homeCity: 'Green Bay', homeState: 'WI', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  const S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2), code: 'SNI' }));
  ok('hired somewhere that runs dedicated freight',
    (S.company.divisions || []).some((d) => /dedicated/i.test(d)), (S.company.divisions || []).join(', '));

  await api('/status', 'POST', {
    locationCity: 'Green Bay', locationState: 'WI', locationKind: 'Terminal', gameTime: iso(30),
    fuelPct: 90, atsOdometer: 1000, truckDamagePct: 2, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 100000,
  });

  head('1. Day one, on probation — the reported case');
  let d = await ded();
  ok('the panel still appears, because the carrier does run it', d.carrierRuns === true, String(d.carrierRuns));
  ok('but it is blocked', !!d.blocked, (d.blocked || '(not blocked)').slice(0, 90));
  ok('and it says probation is why', /probation/i.test(d.blocked || ''), '');
  ok('there is no ask to make yet', d.mayAsk === false, String(d.mayAsk));

  const selfServe = await refused(() =>
    api('/career/dedicated', 'POST', { onDedicated: true, account: 'Walmart' }));
  ok('and the button behind it refuses too, not just the screen', selfServe !== null,
    (selfServe || 'IT WAS ALLOWED').slice(0, 80));

  head('2. Company driver — cleared probation, still not senior');
  await record({ rank: 'company', loads: 60 });
  d = await ded();
  ok('still blocked', !!d.blocked, (d.blocked || '(not blocked)').slice(0, 90));
  ok('and it names the rank that opens it', /senior/i.test(d.blocked || ''), '');
  const early = await refused(() => api('/career/dedicated/request', 'POST', {}));
  ok('asking is refused outright rather than considered', early !== null,
    (early || 'IT WAS ALLOWED').slice(0, 80));

  head('3. Senior with a thin record — may ask, and is turned down');
  await record({ rank: 'senior', loads: 8, onTime: 100 });
  d = await ded();
  ok('no longer blocked on rank', !d.blocked, d.blocked || 'open');
  ok('and there is an ask to make', d.mayAsk === true, String(d.mayAsk));

  let r = await api('/career/dedicated/request', 'POST', {});
  ok('operations answers it', !!r.request?.status, r.request?.status);
  ok('and turns it down on the record', r.request.status === 'Refused', r.request.status);
  ok('naming what is in the way', /load\(s\) with us/i.test(r.request.answer || ''),
    (r.request.answer || '').slice(0, 110));
  ok('the driver is still not on an account', (await ded()).onDedicated === false, '');

  head('4. Late deliveries are their own refusal');
  await record({ rank: 'senior', loads: 40, onTime: 88 });
  r = await api('/career/dedicated/request', 'POST', {});
  ok('turned down for service', r.request.status === 'Refused', r.request.status);
  ok('and it quotes the on-time figure', /on time/i.test(r.request.answer || ''),
    (r.request.answer || '').slice(0, 110));

  head('5. A senior driver with the record gets it');
  await record({ rank: 'senior', loads: 40, onTime: 100 });
  r = await api('/career/dedicated/request', 'POST', {});
  ok('granted', r.request.status === 'Granted', r.request.status + ': ' + (r.request.answer || '').slice(0, 70));
  ok('and the answer says it is not a promotion', /not a promotion/i.test(r.request.answer || ''), '');

  d = await ded();
  ok('the approval is standing, but they are not on it yet',
    !!d.approved && d.onDedicated === false, `approved=${!!d.approved} on=${d.onDedicated}`);

  head('6. The approval is what the button spends');
  await api('/career/dedicated', 'POST', { onDedicated: true, account: 'Walmart' });
  d = await ded();
  ok('now on the account', d.onDedicated === true && /walmart/i.test(d.dedicatedAccount || ''),
    d.dedicatedAccount);
  ok('and the yes is spent, not reusable', !d.approved, `approved=${!!d.approved}`);

  head('7. Coming off is always the driver’s own call');
  const off = await api('/career/dedicated', 'POST', { onDedicated: false, account: '' });
  ok('no permission needed to go back on the open board', !off.error, off.message || 'off');
  ok('and they are off it', (await ded()).onDedicated === false, '');

  head('8. A refusal has a cooling-off, so it is not a button to spam');
  await record({ rank: 'senior', loads: 8 });
  await api('/career/dedicated/request', 'POST', {});
  const again = await refused(() => api('/career/dedicated/request', 'POST', {}));
  ok('asking straight back is refused', again !== null, (again || 'ALLOWED').slice(0, 90));
  ok('and it says how long to wait', /day/i.test(again || ''), '');

  head('9. Dedicated drop and hook is still the top of the ladder');
  // The rule that was always there, and the one this suite must not have loosened: senior opens plain
  // dedicated, not the premium seat.
  await record({ rank: 'senior', loads: 40, onTime: 100 });
  const dh = (await api('/bootstrap')).views.dropHook || {};
  ok('a senior driver is still held off dedicated drop and hook', !!dh.dedicatedBlocked,
    (dh.dedicatedBlocked || '(not blocked)').slice(0, 90));
  ok('and it is the ladder that is named', /top of the ladder|not there yet/i.test(dh.dedicatedBlocked || ''),
    '');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
