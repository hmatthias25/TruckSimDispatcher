/* A board lost to the driver's hours says rest here, not reposition (reported from play, v0.86): three hours of driving
 * left at Corpus Christi, every load on the board a few hours past its window, and the answer was "reposition and pull
 * a fresh board" — which spends the three hours and fixes nothing.
 *
 *   - a load that misses its window on the clocks left, and makes it on fresh ones: rest here, then a fresh board —
 *     said on the dock's board, and again when the city board has nothing either
 *   - a load that misses its window even on fresh clocks: no such note; moving really is the answer
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
const REST = /your hours that sank|Take your 10 here/;

(async () => {
  const app = { driverName: 'R. First', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'none' };
  await api('/onboarding/market', 'POST', app);
  const S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' }));
  const type = S.trailers[0].type;
  await api('/status', 'POST', { locationCity: 'Dallas', locationState: 'TX', locationKind: 'Receiver', gameTime: '2000-01-03T14:00',
    fuelPct: 80, atsOdometer: 1000, truckDamagePct: 0, trailerDamagePct: 0, dutyStatus: 'OnDuty', atsBankBalance: 40000 });
  const hos = (drive, shift) => api('/hos', 'POST', { driveRemaining: drive, shiftRemaining: shift, breakRemaining: Math.min(drive, 8), cycleRemaining: 60 });
  const load = (over) => ({ cargo: 'Paper', trailerType: type, shipper: 'S', receiver: 'R', atLocation: true,
    originCity: 'Dallas', originState: 'TX', destCity: 'Atlanta', destState: 'GA',
    loadedMiles: 780, deadheadMiles: 0, gameRevenue: 3200, weightLbs: 30000, deadlineHours: 100, ...over });
  const gate = async () => { await api('/board/clear', 'POST', {}); const d = await api('/board/add', 'POST', load({}));
    return 100 - d.evaluations[0].feasibility.slackHours; };

  await hos(11, 14); const fresh = await gate();
  await hos(3, 4); const tired = await gate();
  console.log(`     gate after ${fresh.toFixed(2)}h on fresh clocks, ${tired.toFixed(2)}h on 3:00 left`);

  head('1. Late on the hours left, on time on fresh ones');
  await api('/board/clear', 'POST', {});
  let d = await api('/board/add', 'POST', load({ deadlineHours: Math.round((fresh + 1.5) * 100) / 100 }));
  ok('the load misses its window as things stand', d.evaluations[0].feasibility.verdict === 'Infeasible', d.evaluations[0].feasibility.verdict);
  ok('the board is turned down', d.rejectAll === true, d.headline);
  const notes = (d.dispatchNotes || []).join(' | ');
  ok('and it says rest here, not reposition', REST.test(notes) && !/Reposition and pull a fresh board/.test(notes), notes.slice(-260));
  await api('/dispatch/reject-all', 'POST', { reason: 'dock', cityChecked: false });
  const c = await api('/dispatch/reject-all', 'POST', { reason: 'city empty', cityChecked: true });
  const cn = (c.next?.dispatchNotes || []).join(' | ');
  ok('nothing in the city either: still rest here', REST.test(cn) && !/Reposition and pull a fresh board/.test(cn), cn.slice(0, 200));

  head('2. Late even on fresh clocks');
  await hos(9, 12);
  await api('/board/clear', 'POST', {});
  d = await api('/board/add', 'POST', load({ deadlineHours: Math.round((fresh - 3) * 100) / 100 }));
  const n2 = (d.dispatchNotes || []).join(' | ');
  ok('rejected, with no rest-first note — the hours were not what sank it', d.rejectAll === true && !REST.test(n2), n2.slice(-200));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
