/* A run length is a radius from your yard, not the length of the load in front of you.
 *
 * Reported from play: "for range (medium/long/otr) that distance should be from your terminal, not
 * like 'I drove 400 miles to Wichita and now will drive 400 more miles to California'" — and then,
 * putting it plainly: "so regional is truly 'only 300 miles from home' or whatever it is".
 *
 * It is. The term was scored on load.LoadedMiles, which measures the wrong thing: three consecutive
 * 300-mile loads are three perfectly regional runs that finish nine hundred miles from the yard. A
 * regional carrier is not promising short loads, it is promising you sleep at home — and the app was
 * happily walking a regional driver across the country one medium load at a time.
 *
 * Scored, not refused: a driver already out of position has to be able to take the load that brings
 * them back, and a hard gate on the radius would strand exactly the person it protects.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5993}/api`;
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
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hm}`;
};

let S;

/** The utilisation line off an evaluation — the one that prices where the load leaves you. */
const boxLine = (ev) => (ev.scoreDetail || []).find((x) => /box they run you in|no radius|geography table, so I cannot tell whether it stays/i.test(x));
const boxPts = (ev) => {
  const line = boxLine(ev);
  const m = line && line.match(/([+-]\d+\.\d+)\s*$/);
  return m ? parseFloat(m[1]) : null;
};

/** One load to a given city, scored from wherever the truck is standing. */
async function offer(city, state, miles) {
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add', 'POST', {
    cargo: 'Palletised Goods', trailerType: S.trailers[0].type, receiver: 'Consignee',
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity: city, destState: state,
    loadedMiles: miles, deadheadMiles: 0, gameRevenue: Math.round(miles * 2.4),
    deadlineHours: 60, weightLbs: 30000, atLocation: true, preLoaded: true,
  });
  return (r.evaluations || [])[0];
}

async function stand(city, state, day) {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'Terminal', gameTime: iso(day),
    fuelPct: 95, atsOdometer: 50000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 120000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
}

(async () => {
  const app = {
    driverName: 'R. Boxer', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: '', homeState: '', acceptsProbation: true,
    homeTimePreference: 'biweekly', preferredTripLength: 'medium',
  };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  // Prime's HQ is Springfield MO, which is central enough to have freight in every direction.
  await api('/career/trip-length', 'POST', { preference: 'medium' });
  S = un(await api('/bootstrap'));
  const yard = `${S.company.terminalCity}, ${S.company.terminalState}`;
  console.log(`  ..    based at ${yard}, running medium`);

  head('1. Sitting at the yard, a run inside the box beats one outside it');
  await stand(S.company.terminalCity, S.company.terminalState, 12);
  // Both are the same LENGTH of load. Only where they leave the truck differs, which is the whole
  // point: scored on load miles these two were indistinguishable.
  const near = await offer('Kansas City', 'MO', 165);
  const far = await offer('Denver', 'CO', 165);
  console.log(`  ..    Kansas City: ${boxLine(near) || '(no box line)'}`);
  console.log(`  ..    Denver:      ${boxLine(far) || '(no box line)'}`);
  ok('the near one is priced on where it leaves you', boxPts(near) !== null, `${boxPts(near)}`);
  ok('and so is the far one', boxPts(far) !== null, `${boxPts(far)}`);
  ok('two loads of identical length do not score identically',
    boxPts(near) !== boxPts(far), `${boxPts(near)} vs ${boxPts(far)}`);
  ok('the one that stays inside the box scores better',
    boxPts(near) > boxPts(far), `${boxPts(near)} vs ${boxPts(far)}`);
  ok('and the one that does not is scored against outright', boxPts(far) < 0, `${boxPts(far)}`);

  head('2. And it says so, rather than just quietly ranking it lower');
  const con = (far.cons || []).find((c) => /miles from your yard/i.test(c));
  console.log(`  ..    ${con ? con.slice(0, 150) : '(nothing said)'}`);
  ok('the card explains what taking it would do', !!con);
  ok('it names the distance', /\d+ miles from your yard/i.test(con || ''), 'quoted');
  ok('and names the arrangement it breaks', /medium/i.test(con || ''), 'named');

  head('3. The Wichita walk: each load is regional, the position is not');
  // The reported shape. Four hundred miles out is still inside nobody's idea of a medium seat once you
  // are already four hundred miles out — and that is exactly what load-length scoring could not see.
  await stand('Wichita', 'KS', 13);
  const onward = await offer('Amarillo', 'TX', 320);
  console.log(`  ..    from Wichita, a 320 mi load to Amarillo: ${boxLine(onward) || '(no box line)'}`);
  ok('a regional-length load that walks you further out is scored against',
    boxPts(onward) !== null && boxPts(onward) < 0, `${boxPts(onward)}`);
  // The load home is the same length and must not be punished, or the driver is trapped where they are.
  const back = await offer(S.company.terminalCity, S.company.terminalState, 320);
  console.log(`  ..    from Wichita, a 320 mi load home:        ${boxLine(back) || '(no box line)'}`);
  ok('while the one of the same length that brings you back is not',
    boxPts(back) > 0, `${boxPts(back)}`);
  ok('so a driver out of position can always get home',
    boxPts(back) > boxPts(onward), `${boxPts(back)} vs ${boxPts(onward)}`);

  head('4. Over-the-road has no box, and is judged on length again');
  await api('/career/trip-length', 'POST', { preference: 'otr' }).catch(() => {});
  S = un(await api('/bootstrap'));
  if (S.application.preferredTripLength === 'otr') {
    await stand(S.company.terminalCity, S.company.terminalState, 14);
    const longHaul = await offer('Los Angeles', 'CA', 1400);
    const hop = await offer('Kansas City', 'MO', 165);
    console.log(`  ..    OTR long haul: ${boxLine(longHaul) || '(none)'}`);
    console.log(`  ..    OTR short hop: ${boxLine(hop) || '(none)'}`);
    ok('distance from the yard stops being the question', /no radius/i.test(boxLine(longHaul) || ''),
      'no radius');
    ok('a thousand-mile run is what the seat is for', boxPts(longHaul) > 0, `${boxPts(longHaul)}`);
    ok('and a short hop is poor use of a driver who is out for weeks',
      boxPts(hop) < boxPts(longHaul), `${boxPts(hop)} vs ${boxPts(longHaul)}`);
  } else {
    ok('this carrier does not offer OTR, so nothing to check', true,
      `stayed ${S.application.preferredTripLength}`);
  }

  head('5. A city we have no coordinates for is not guessed at');
  // Absence of data is not evidence the load is fine, nor that it is wrong. It scores neutral and the
  // rate and the clocks decide, rather than the app inventing a distance to judge on.
  await api('/career/trip-length', 'POST', { preference: 'medium' }).catch(() => {});
  await stand(S.company.terminalCity, S.company.terminalState, 15);
  const unknown = await offer('Nowheresville', 'ZZ', 300);
  const line = boxLine(unknown);
  console.log(`  ..    ${line || '(no box line)'}`);
  ok('it says it cannot tell', /cannot tell/i.test(line || ''), 'said');
  ok('and scores it neutral rather than inventing a distance', boxPts(unknown) === 0, `${boxPts(unknown)}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
