/* The application asks for HazMat CLASSES, not a yes/no box.
 *
 * ATS gates dangerous freight on six classes unlocked individually, and the app has tracked them that
 * way on the driver file for a while. The application form still asked "Hazmat (H)" — a vaguer version
 * of a question the app can ask exactly — and then had to nag the driver to go and pick the classes it
 * actually meant. Two controls, one fact, and the flag was already being overwritten from the classes
 * the moment anything changed.
 *
 * Raised from play: "What the hell is HAZMAT, we don't have that, we have the separate endorsements
 * and skills which we can get from the career panel. I am just assuming we always start with a new
 * profile on first hire so none of these would be populated anyways."
 *
 * Mostly right, with one wrinkle: a first hire is not always a fresh ATS profile. Somebody bringing a
 * career that already has ADR needs to say so, and a new profile ticks nothing — which is correct,
 * because ATS starts you with none.
 *
 * What this suite holds:
 *   1. ticking nothing means holding nothing — no premium, no qualification, no freight opened
 *   2. classes declared at hire land on the driver file and gate freight for real
 *   3. a class the game does not have is dropped rather than kept as a credential nothing matches
 *   4. the offer letter names the classes instead of saying "hazmat"
 *   5. an old career with the bare flag and no classes is still honoured, and still asked
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5917}/api`;
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
const iso = (d, hm = '06:00') => `2000-01-${String(d).padStart(2, '0')}T${hm}`;

const baseApp = (over) => ({
  driverName: 'K. Arvidsson', preferredDivision: 'Tanker', transmissionPreference: 'either',
  experienceYears: 9, freightExperience: ['Tanker'], homeCity: 'Houston', homeState: 'TX',
  acceptsProbation: true, homeTimePreference: 'biweekly', ...over,
});

async function hire(over) {
  const app = baseApp(over);
  await api('/reset', 'POST', { confirm: 'RESET', resetSettings: false });
  await api('/onboarding/market', 'POST', app);
  const r = await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) });
  return { S: un(r), decision: r.decision || r.hireDecision || null, raw: r };
}

const held = (S) => (S.driver?.endorsements || []).slice().sort();

(async () => {
  head('1. A fresh ATS profile ticks nothing and holds nothing');
  let { S } = await hire({ hazmatClasses: [] });
  console.log(`  ..    endorsements ${JSON.stringify(held(S))}`);
  ok('no classes on the driver file', held(S).length === 0, JSON.stringify(held(S)));
  ok('no hazmat qualification claimed',
    !(S.driver?.qualifications || []).includes('Hazmat'),
    (S.driver?.qualifications || []).join(', '));
  // NOT asserted as zero: a carrier that hauls nothing but placarded freight sets its own hazmat floor
  // on the pay plan whatever the driver holds, which is deliberate and predates this. What must be true
  // is that declaring classes is worth MORE than declaring none — compared in section 2.
  const noneCpm = S.driver?.pay?.hazmatCpm ?? 0;
  console.log(`  ..    employer's hazmat floor $${noneCpm}/mi`);

  head('2. Classes declared at hire land on the file');
  ({ S } = await hire({ hazmatClasses: ['3', '8'] }));
  console.log(`  ..    endorsements ${JSON.stringify(held(S))}`);
  ok('both classes are on the driver file',
    held(S).join(',') === '3,8', JSON.stringify(held(S)));
  ok('the qualification follows from them',
    (S.driver?.qualifications || []).includes('Hazmat'),
    (S.driver?.qualifications || []).join(', '));
  ok('and holding classes is worth more than holding none',
    (S.driver?.pay?.hazmatCpm ?? 0) > noneCpm,
    `$${S.driver?.pay?.hazmatCpm}/mi vs $${noneCpm}/mi with none`);

  head('3. A class the game does not have is dropped, not kept');
  // ATS has 1, 2, 3, 4, 6 and 8. There is no class 5, 7 or 9, and no tanker endorsement. Keeping one
  // would leave a credential on the file that no load can ever match.
  ({ S } = await hire({ hazmatClasses: ['3', '5', '9', 'tanker', ''] }));
  console.log(`  ..    endorsements ${JSON.stringify(held(S))}`);
  ok('only the real class survives', held(S).join(',') === '3', JSON.stringify(held(S)));

  head('4. A subclass collapses to the class you actually unlock');
  ({ S } = await hire({ hazmatClasses: ['2.1', 'Class 8'] }));
  console.log(`  ..    endorsements ${JSON.stringify(held(S))}`);
  ok('2.1 is recorded as class 2 and "Class 8" as 8',
    held(S).join(',') === '2,8', JSON.stringify(held(S)));

  head('5. The offer letter names the classes rather than saying "hazmat"');
  // Off decision.reasons specifically, not the whole payload — "Class 3" appears in the market data
  // too, so searching the lot would pass without the letter saying anything.
  const res = await hire({ hazmatClasses: ['3'] });
  const reasons = (res.raw?.decision?.reasons || []).join(' | ');
  const line = (res.raw?.decision?.reasons || []).find((x) => /class/i.test(x)) || '';
  console.log(`  ..    ${line || '(no hazmat line in the offer)'}`);
  ok('the offer names class 3 rather than just "hazmat"',
    /Class 3/i.test(line), line.slice(0, 130) || reasons.slice(0, 130));

  head('6. Classes gate freight for real, not just decorate the file');
  // A class 3 holder can take flammable liquids; nothing should let a driver with no classes take them.
  for (const [label, classes, expectAllowed] of [
    ['holds class 3', ['3'], true],
    ['holds nothing', [], false],
  ]) {
    ({ S } = await hire({ hazmatClasses: classes }));
    await api('/status', 'POST', {
      locationCity: 'Houston', locationState: 'TX', locationKind: 'Shipper', gameTime: iso(10),
      fuelPct: 95, atsOdometer: 5000, truckDamagePct: 2, trailerDamagePct: 1,
      dutyStatus: 'OnDuty', atsBankBalance: 90000,
    });
    await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
    await api('/board/clear', 'POST', {});
    const added = await api('/board/add', 'POST', {
      cargo: 'Gasoline', trailerType: 'Tanker', atLocation: true,
      originCity: 'Houston', originState: 'TX', destCity: 'Dallas', destState: 'TX',
      loadedMiles: 240, deadheadMiles: 0, gameRevenue: 1400, deadlineHours: 30,
      weightLbs: 42000, isHazmat: true, hazmatClass: '3',
    });
    const ev = (added.evaluations || [])[0];
    const gated = (ev?.hardFails || []).some((f) => /class 3|hazmat/i.test(f));
    console.log(`  ..    ${label}: ${gated ? 'blocked' : 'clear'} — ${(ev?.hardFails || []).join(' | ').slice(0, 90) || 'no hard fails'}`);
    ok(`${label}: placarded freight is ${expectAllowed ? 'allowed' : 'refused'}`,
      gated !== expectAllowed, `${(ev?.hardFails || []).length} hard fail(s)`);
  }

  head('7. An old career with the bare flag is honoured, and still asked which classes');
  ({ S } = await hire({ hasHazmat: true }));       // no hazmatClasses at all, as an old form would send
  console.log(`  ..    endorsements ${JSON.stringify(held(S))} · qualifications ${(S.driver?.qualifications || []).join(', ')}`);
  ok('the claim is not thrown away',
    (S.driver?.qualifications || []).includes('Hazmat'),
    (S.driver?.qualifications || []).join(', '));
  ok('the premium is still granted', S.driver?.pay?.hazmatCpm > 0, `$${S.driver?.pay?.hazmatCpm}/mi`);
  ok('but no class is invented on their behalf', held(S).length === 0, JSON.stringify(held(S)));
  const ends = (await api('/bootstrap')).views?.endorsements;
  ok('and the app asks which classes they meant',
    ends?.needsChoosing === true, `needsChoosing=${ends?.needsChoosing}`);
  ok('while a career that declared its classes is never asked',
    (await hire({ hazmatClasses: ['3'] })) &&
      (await api('/bootstrap')).views?.endorsements?.needsChoosing === false,
    'no prompt for a complete answer');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
