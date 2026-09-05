/* Reported from play, and not reproducible in cityboard97 because that suite's home-time clock has
 * drifted through sixty assertions by the time it gets there.
 *
 * Dropped a load at Oklahoma City. The dock board — "jobs at this location", confirmed, both rows
 * carrying the at-this-dock badge — offered Ottumwa IA and Kansas City MO. Home is Springfield MO,
 * home time due in 3.2 days, cycle 14:03. Kansas City finishes 180 mi from the yard, inside the 200 mi
 * radius; Ottumwa finishes 320 mi away, no nearer than Oklahoma City already was.
 *
 * Ottumwa was the one run. #190 explains half of that — Kansas City came out Tight on the safety buffer
 * and was dropped before ranking, with nothing said about it.
 *
 * The other half turned out NOT to be a fault. Reproduced faithfully here, the #97 hold fires exactly as
 * designed: nothing is authorized, the headline asks for the city board, and BOTH loads are offered as
 * backups. So the driver was shown the question and accepted Ottumwa, which is the documented override.
 *
 * Kept because it took four attempts to establish that. cityboard97 could not settle it — its home-time
 * clock has drifted through sixty assertions by the time it reaches this shape — and the first three
 * attempts here failed on fixture detail rather than on behaviour: a fresh career assumes 3:00 of dock
 * time each end where the reported one had learned 1:51 off forty flatbed loads, which is 2:18 a day and
 * enough to turn both loads infeasible. This pins the configuration so the next question about it takes
 * one run instead of four.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5872}/api`;
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

(async () => {
  const app = {
    driverName: 'H. Matthias', preferredDivision: 'Flatbed', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly',
  };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. Standing at the Oklahoma City receiver, home due in about three days');
  // A fortnight arrangement is DueSoon from DaysOut >= 14 * 0.75 = 10.5, so day 12 is 3-ish days out —
  // the reported state, reached on a clock nothing else has touched.
  S = un(await api('/status', 'POST', {
    locationCity: 'Oklahoma City', locationState: 'OK', locationKind: 'Receiver', gameTime: iso(12),
    fuelPct: 85, atsOdometer: 40000, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  }));
  // The report had 14:03 of cycle against a LEARNED dock time of 1:51 each end, measured off forty
  // flatbed loads. A fresh fixture has no history and assumes 3:00, which costs 2:18 more on the day —
  // so the cycle here is set to leave the same room, not the same number.
  await api('/hos', 'POST', {
    driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 16.4,
  });

  const hs = (await api('/bootstrap')).views.homeTime;
  ok('home time is due but not overdue', hs.dueSoon === true && hs.overdue === false,
    `due in ${hs.daysUntilDue?.toFixed?.(1)} days`);
  ok('and the yard is Springfield', /Springfield/i.test(hs.terminalLabel || ''), hs.terminalLabel);
  ok('with the 200 mi radius the report quoted', hs.homeRadius === 200, `${hs.homeRadius} mi`);

  head('2. The dock board as entered — both rows at this dock');
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, atLocation: true,
    originCity: 'Oklahoma City', originState: 'OK', destCity: 'Ottumwa', destState: 'IA',
    loadedMiles: 561, deadheadMiles: 0, gameRevenue: 2136, deadlineHours: 40, weightLbs: 30000,
  });
  const bd = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, atLocation: true,
    originCity: 'Oklahoma City', originState: 'OK', destCity: 'Kansas City', destState: 'MO',
    // Deliverable, but inside the safety buffer — Tight, which is what dropped it before ranking.
    loadedMiles: 343, deadheadMiles: 0, gameRevenue: 1237, deadlineHours: 14.5, weightLbs: 30000,
  });

  const kc = (bd.evaluations || []).find((e) => e.load.destCity === 'Kansas City');
  const ott = (bd.evaluations || []).find((e) => e.load.destCity === 'Ottumwa');
  console.log(`     wantCityBoard=${bd.wantCityBoard} rejectAll=${bd.rejectAll}`);
  console.log(`     headline: ${bd.headline}`);
  console.log(`     authorized: ${(bd.evaluations || []).find((e) => e.load.id === bd.authorizedLoadId)?.load.destCity || 'NONE'}`);
  for (const e of (bd.evaluations || []))
    console.log(`     ${e.load.destCity}: ${e.feasibility.verdict}, score ${e.score?.toFixed?.(2)}, ` +
                `rec ${e.recommendation}, homeTimeFails=${(e.homeTimeFails || []).length}, atLocation=${e.load.atLocation}`);

  ok('both loads are flagged as coming off this dock',
    kc?.load.atLocation === true && ott?.load.atLocation === true,
    `KC ${kc?.load.atLocation} / Ottumwa ${ott?.load.atLocation}`);
  ok('Kansas City is the one that reaches the yard',
    (kc?.scoreDetail || []).some((d) => /inside our 200 mi home radius/i.test(d)),
    (kc?.scoreDetail || []).find((d) => /home radius|home time/i.test(d)) || '(no home term)');
  ok('and Ottumwa is not', (ott?.scoreDetail || []).some((d) => /neutral on home time/i.test(d)),
    (ott?.scoreDetail || []).find((d) => /home time/i.test(d)) || '(no home term)');

  head('3. The hold fires: nothing runnable goes home, so the city board is asked for');
  ok('nothing is quietly committed to', !bd.authorizedLoadId,
    (bd.evaluations || []).find((e) => e.load.id === bd.authorizedLoadId)?.load.destCity || 'none');
  ok('the city board is asked for', bd.wantCityBoard === true, `${bd.wantCityBoard}`);
  ok('and the reason names the yard nothing reaches',
    /finishes near/i.test(bd.rationale || ''), (bd.rationale || '').slice(0, 190));
  ok('both are offered as backups, so accepting either is the driver call',
    kc?.recommendation === 'Backup' && ott?.recommendation === 'Backup',
    `KC ${kc?.recommendation} / Ottumwa ${ott?.recommendation}`);
  ok('and the better-scoring one is Kansas City, as the report said',
    (kc?.score ?? 0) > (ott?.score ?? 0),
    `KC ${kc?.score?.toFixed?.(2)} vs Ottumwa ${ott?.score?.toFixed?.(2)}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
