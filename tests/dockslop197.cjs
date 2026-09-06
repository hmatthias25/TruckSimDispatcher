/* #197 — the dock that runs long, on a lot you are not allowed to sleep on.
 *
 * Reported from play: "I got a load where I had only 1 hour of shift time before unload. Dispatch told me
 * I could not take a 10 on dock. However since load took 2 hours I had to." Asked which way it went, the
 * answer was that the plan said nothing and the dock overran.
 *
 * The plan fit, so it stayed quiet. That is the bug. The unload figure is an AVERAGE — half of all docks
 * run longer than it by definition — so a window that covers the estimate exactly covers nothing at all,
 * and the driver finds out while standing on a receiver's property with no legal way to move the truck.
 *
 * Two things have to be true for the warning to be worth anything:
 *   1. it is measured at the DOCK, before the unload, not once the trailer is empty. By then the overrun
 *      has already happened and the advice is a post-mortem.
 *   2. the margin is sized to how much the figure is worth. A seed-table guess and ten measured
 *      deliveries are not the same number and must not be trusted to the same slack.
 *
 * And wherever it fires, it has to say where the driver actually sleeps. Telling somebody to take their
 * ten on the property of a receiver that turns trucks out is the advice that caused this.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5897}/api`;
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
const hhmm = (h) => (h == null ? '--' : `${Math.floor(h)}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`);
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;

/** Stand the driver at a shipper with a given window. */
async function withWindow(shift, drive = 10, cycle = 50) {
  S = un(await api('/status', 'POST', {
    locationCity: 'Wichita', locationState: 'KS', locationKind: 'Shipper', gameTime: iso(10, '08:00'),
    fuelPct: 90, atsOdometer: 90000, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 80000,
  }));
  await api('/hos', 'POST', {
    driveRemaining: drive, shiftRemaining: shift, breakRemaining: 8, cycleRemaining: cycle,
  });
}

/** A pre-loaded flatbed to a named town: a hook at this end, a live unload at the other. */
async function offer(city, state, miles) {
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add', 'POST', {
    cargo: 'Steel Coils', trailerType: 'Flatbed', receiver: 'Midwest Steel',
    originCity: 'Wichita', originState: 'KS', destCity: city, destState: state,
    loadedMiles: miles, deadheadMiles: 0, gameRevenue: 1400, deadlineHours: 40,
    weightLbs: 42000, atLocation: true, preLoaded: true,
  });
  const board = un(r).board || [];
  return (board[0] || {});
}

const warnings = (ev) => (ev?.feasibility?.warnings || []).join(' || ');
const evaluate = async () => ((await api('/board/evaluate')) || {}).evaluations?.[0]
  || (await api('/board')).evaluations?.[0];

(async () => {
  const app = { driverName: 'K. Ruiz', preferredDivision: 'Flatbed', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Wichita', homeState: 'KS', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) }));

  head('1. Find a receiver that will not have you, and one that will');
  // Seeded per career, so it is looked up rather than assumed. Both cases have to be reachable or half
  // this suite is testing nothing.
  const towns = [['Topeka', 'KS'], ['Salina', 'KS'], ['Emporia', 'KS'], ['Hays', 'KS'], ['Newton', 'KS'],
                 ['Hutchinson', 'KS'], ['Dodge City', 'KS'], ['Liberal', 'KS'], ['Pratt', 'KS'],
                 ['Great Bend', 'KS'], ['Ottawa', 'KS'], ['Iola', 'KS']];
  let hostile = null, friendly = null;
  for (const [c, st] of towns) {
    const p = await api(`/facility/parking?city=${encodeURIComponent(c)}&state=${st}&receiver=Midwest%20Steel`);
    const allows = p.allowsOvernight ?? p.allowed ?? p.allows;
    if (allows === false && !hostile) hostile = [c, st];
    if (allows === true && !friendly) friendly = [c, st];
  }
  ok('a receiver that turns trucks out', !!hostile, hostile ? hostile.join(', ') : '(none found)');
  ok('and one that will have you', !!friendly, friendly ? friendly.join(', ') : '(none found)');

  head('2. The reported case: the window covers the estimate and nothing more');
  // A flatbed unload seeds at 1:30 and has never been measured here, so the margin held back is wide.
  // Land the driver at the dock a little ABOVE that estimate — the plan fits, which is exactly why the
  // old code said nothing — and below estimate plus margin, which is where the risk actually lives.
  let thin = null;
  const sweep = [];
  for (let w = 3.0; w <= 8.0001; w += 0.2) sweep.push(Math.round(w * 10) / 10);
  for (const w of sweep) {
    await withWindow(w);
    await offer(hostile[0], hostile[1], 100);
    const ev = await evaluate();
    const atDock = ev?.feasibility?.shiftRemainingAtDock;
    // Below the band the planner rests BEFORE the dock and the window reads a fresh 13:30 — that rule
    // already works and is not what this suite is about. The interesting shift is the first one where
    // the plan fits without resting, which is where the old code went quiet.
    if (atDock != null && atDock >= 1.5 && atDock < 2.4) {
      console.log(`  ..    ${w}h shift is the first that does not rest first: ${hhmm(atDock)} at the dock`);
      thin = { w, ev, atDock };
      break;
    }
  }

  ok('the plan reaches the dock with the window barely covering it', !!thin,
    thin ? `${hhmm(thin.atDock)} of window on a ${thin.w}h shift` : '(could not land in the band)');

  if (thin) {
    const w = warnings(thin.ev);
    ok('the window at the DOCK is measured, not just what is left once empty',
      thin.ev.feasibility.shiftRemainingAtDock > 0, hhmm(thin.atDock));
    ok('and the plan is not refused over it — it is legal, it is just thin',
      thin.ev.feasibility.verdict !== 'Infeasible', thin.ev.feasibility.verdict);
    ok('dispatch says it now, before the load is taken',
      /window against a dock we have down for/i.test(w), w.slice(0, 200) || '(silent)');
    ok('it quotes the window and the dock figure',
      w.includes(hhmm(thin.atDock)) && /1:30/.test(w), w.slice(0, 200));
    ok('it admits the figure has never been measured here',
      /starting estimate, not something we have measured/i.test(w), w.slice(0, 240));
    ok('and it says there is nowhere on that lot to sleep',
      /do NOT allow overnight parking/i.test(w), w.slice(0, 300));
    ok('spelling out that once the window is gone the truck cannot legally move',
      /cannot legally move/i.test(w), w.slice(0, 300));
  }

  head('3. Same thin window, a receiver that will have you');
  if (thin && friendly) {
    await withWindow(thin.w);
    await offer(friendly[0], friendly[1], 100);
    const ev = await evaluate();
    const w = warnings(ev);
    ok('still flagged — a dock running long is a dock running long',
      /window against a dock we have down for/i.test(w), w.slice(0, 160) || '(silent)');
    ok('but the advice is to sleep where you stand',
      /plan on the 10 at their gate|at their gate/i.test(w), w.slice(0, 260));
    ok('and it does not tell them the lot is closed to them',
      !/do NOT allow overnight parking/i.test(w), w.slice(0, 200));
  }

  head('4. A full window says nothing about it');
  // The warning has to stay rare or it is wallpaper. A driver with most of a day in hand is not at risk
  // from a dock running half an hour long.
  await withWindow(11);
  await offer(hostile[0], hostile[1], 100);
  const roomy = await evaluate();
  ok('plenty of window, and dispatch keeps quiet about the dock',
    !/window against a dock we have down for/i.test(warnings(roomy)),
    warnings(roomy).slice(0, 160) || '(silent)');
  ok('the dock window is still measured, though',
    (roomy?.feasibility?.shiftRemainingAtDock ?? -1) > 2.4,
    hhmm(roomy?.feasibility?.shiftRemainingAtDock));

  head('5. No unload to overrun, nothing to warn about');
  // Drop and hook is the case that must never pick this up: you pull the pin and leave. There is no dock
  // time to run long and nothing to be stranded by.
  await withWindow(3.4);
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Palletised Goods', trailerType: 'Drop & Hook', receiver: 'Midwest Steel',
    originCity: 'Wichita', originState: 'KS', destCity: hostile[0], destState: hostile[1],
    loadedMiles: 100, deadheadMiles: 0, gameRevenue: 1400, deadlineHours: 40,
    weightLbs: 42000, atLocation: true, preLoaded: true,
  });
  const dh = await evaluate();
  ok('a hook is not warned about like a live unload',
    !/starting estimate, not something we have measured/i.test(warnings(dh)),
    warnings(dh).slice(0, 200) || '(silent)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
