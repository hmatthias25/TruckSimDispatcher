/* Every good rate scored the same, so slack picked the load.
 *
 * Reported from play: "the All in RPM is always 2 no matter what if it is over the break even. So a load
 * that scores $4.23 is 2 and a load that scores $3 is a 2... dispatch chose a load that was 3.23 over a
 * load that was 4.25. Only difference was a better HOS slack score."
 *
 * Exactly right. The term was clamp(AllInRpm / target, 0, 2.0), and target is break-even times
 * MarginGoal — about $1.50 on a $1.20 break-even. So everything from roughly $3.00/mi up scored an
 * identical 2.00, the rate difference cancelled to nothing, and whatever came next decided the board.
 *
 * A dollar a mile is not a rounding difference. Above twice target it now climbs on a log: always worth
 * more, never so much that one spectacular listing outvotes home time and the reset.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5899}/api`;
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
const iso = (day, hm = '07:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;
const term = (ev, re) => {
  const line = (ev.scoreDetail || []).find((x) => re.test(x));
  if (!line) return null;
  const m = line.match(/([+-]\d+\.\d+)\s*$/);
  return m ? parseFloat(m[1]) : null;
};

/** One load on an empty board, priced by the gross we want against fixed miles. */
async function priced(cargo, revenue, miles = 300) {
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add', 'POST', {
    cargo, trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Pueblo', destState: 'CO', loadedMiles: miles, deadheadMiles: 0,
    gameRevenue: revenue, deadlineHours: 30, weightLbs: 24000,
  });
  return r.evaluations[0];
}

(async () => {
  const app = { driverName: 'J. Peralta', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 8, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: iso(10),
    fuelPct: 90, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 120000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });

  head('1. Where the old ceiling was');
  const base = await priced('Machinery', 900);
  const target = base.targetRpmUsed;
  ok('a target is being computed', target > 0, `$${target}/mi`);
  // Twice target is where it used to stop reading. Everything above scored an identical 2.00.
  const ceiling = target * 2;
  console.log(`  ..    target $${target.toFixed(2)}/mi, old ceiling $${ceiling.toFixed(2)}/mi`);

  head('2. Two loads well past it, both of which used to score 2.00');
  const lo = await priced('Steel', Math.round(ceiling * 1.08 * 300));
  const hi = await priced('Copper', Math.round(ceiling * 1.42 * 300));

  ok('both are above the old ceiling', lo.allInRpm > ceiling && hi.allInRpm > ceiling,
    `$${lo.allInRpm?.toFixed(2)} and $${hi.allInRpm?.toFixed(2)} vs $${ceiling.toFixed(2)}`);

  const loPts = term(lo, /All-in RPM/);
  const hiPts = term(hi, /All-in RPM/);
  ok('the better rate now scores higher instead of tying',
    loPts != null && hiPts != null && hiPts > loPts + 0.05, `${loPts} vs ${hiPts}`);
  ok('and the card says it is still counting past target',
    (hi.scoreDetail || []).some((x) => /x target, still counting/.test(x)),
    (hi.scoreDetail || []).find((x) => /All-in RPM/.test(x)) || '(no rpm line)');

  head('3. It is a dollar a mile that separates them, not a rounding difference');
  // The reported pair, near enough: about $3.23 against about $4.25 on the same lane.
  const cheap = await priced('Paper', Math.round(3.23 * 300));
  const dear = await priced('Alloy', Math.round(4.25 * 300));
  const gap = term(dear, /All-in RPM/) - term(cheap, /All-in RPM/);
  ok('the rate term separates them at all', gap > 0.05,
    `$${cheap.allInRpm?.toFixed(2)} -> ${term(cheap, /All-in RPM/)}, ` +
    `$${dear.allInRpm?.toFixed(2)} -> ${term(dear, /All-in RPM/)}`);
  ok('by enough that HOS slack cannot quietly outvote it', gap > 0.3, `${gap.toFixed(2)}`);

  head('4. Below target nothing changed');
  // The curve is only bent ABOVE twice target. A poor load has to keep scoring poorly.
  const poor = await priced('Sand', Math.round(target * 0.6 * 300));
  const fair = await priced('Grain', Math.round(target * 1.0 * 300));
  const poorPts = term(poor, /All-in RPM/);
  const fairPts = term(fair, /All-in RPM/);
  ok('a load at target still scores about 1.00', Math.abs(fairPts - 1.0) < 0.12, `${fairPts}`);
  ok('and one well under it scores well under', poorPts < fairPts - 0.25, `${poorPts} vs ${fairPts}`);

  head('5. It still stops somewhere');
  // Unbounded, one absurd listing would outvote home time, the reset and everything else at once.
  const silly = await priced('Unobtainium', Math.round(target * 20 * 300));
  const sillyPts = term(silly, /All-in RPM/);
  ok('an absurd rate is capped', sillyPts <= 3.01, `${sillyPts}`);
  ok('but still beats a merely excellent one', sillyPts > hiPts, `${sillyPts} vs ${hiPts}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
