/* Intermodal means a container chassis, and the app did not have one.
 *
 * Asked from play, looking at an intermodal carrier's setup checklist telling the driver to go and buy a
 * dry van: "huh? wouldn't we want to get an intermodal trailer for this one?" — and then, on being asked
 * whether ATS actually sells one: "it exists in the game so lets use it".
 *
 * It does. The trailer dealer sells a 53' container chassis, and it is a chassis, not a box: you buy the
 * frame and the container rides on it. So Intermodal mapped to "Dry Van" was not a rounding error, it
 * was sending a drayage driver to buy the wrong trailer and then telling them the yard they were pulling
 * out of was a warehouse.
 *
 * Which is the second half of this. A container comes off a rail ramp or a port, and both of those are
 * gates: hours, a queue, and nobody to see at four in the morning. A dry van's dock is none of those
 * things. Getting the type right and leaving the facility wrong would have fixed the shopping list and
 * left the clock lying.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5991}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hm}`;
};

async function place(city, state, day, hm = '07:00') {
  await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'Terminal', gameTime: iso(day, hm),
    fuelPct: 95, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 120000,
  });
  return api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
}

(async () => {
  // Schneider runs intermodal drayage and takes rookies, so this is a career a player can actually have.
  const app = {
    driverName: 'C. Box', preferredDivision: 'Intermodal', transmissionPreference: 'either',
    experienceYears: 6, homeCity: '', homeState: '', acceptsProbation: true,
    homeTimePreference: 'biweekly', preferredTripLength: 'medium',
  };
  await api('/onboarding/market', 'POST', app);
  const hire = await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'SNI' });
  let S = un(hire);
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. An intermodal driver is put on a chassis, not a dry van');
  const trailer = (S.trailers || [])[0];
  console.log(`  ..    ${trailer?.unit}: ${trailer?.length} ${trailer?.type} — ${trailer?.make}`);
  ok('the division produced a Container', trailer?.type === 'Container', `${trailer?.type}`);
  ok('and not the dry van it used to default to', trailer?.type !== 'Dry Van', `${trailer?.type}`);
  ok('at the length ATS sells it in', /53/.test(trailer?.length || ''), `${trailer?.length}`);
  ok('and the make says chassis, because that is what is bought',
    /chassis/i.test(trailer?.make || ''), `${trailer?.make}`);

  head('2. The checklist sends them to the right thing at the dealer');
  const setup = hire.setup || [];
  const step = setup.find((x) => /you are on/i.test(x.title || '')) || {};
  console.log(`  ..    ${step.title || '(no trailer step)'}`);
  ok('the trailer step names the container chassis', /chassis/i.test(`${step.title} ${step.detail}`),
    (step.detail || '').slice(0, 90));
  // The distinction that matters at the dealer: the chassis is a frame and the box is freight. Somebody
  // looking for a "53 foot container" on the trailer screen will not find one.
  ok('and says it is a frame, not a box', /not a box/i.test(step.detail || ''),
    (step.detail || '').match(/[^.]*not a box[^.]*/)?.[0] || '(not said)');
  ok('the California rule rides along, the same as every other trailer',
    /California/i.test(step.detail || ''), 'warned');
  ok('the length is assigned, not offered as a choice',
    !/(also sold|is sold as well|are also|rather have something shorter)/i.test(step.detail || ''),
    'no alternatives');
  ok('and the chassis named is the one on the unit',
    (step.detail || '').includes(trailer.length), `${trailer.length}`);
  ok('no doubles here either', /no doubles/i.test(step.detail || ''), 'said');
  ok('nothing in it reaches the player as markup',
    !/<\/?(b|i|em|strong|p|br|div|span|ul|li|a)\b[^>]*>/i.test(JSON.stringify(setup)), 'clean');

  head('3. Dispatch knows a Container load is intermodal freight');
  await place(S.company.terminalCity, S.company.terminalState, 12);
  await api('/board/clear', 'POST', {});
  const added = un(await api('/board/add', 'POST', {
    cargo: 'Containerized Freight', trailerType: 'Container', receiver: 'Harbor Rail Ramp',
    originCity: S.company.terminalCity, originState: S.company.terminalState,
    destCity: 'Chicago', destState: 'IL',
    loadedMiles: 180, deadheadMiles: 0, gameRevenue: 2400, deadlineHours: 40,
    weightLbs: 38000, atLocation: true, preLoaded: true,
  }));
  const board = added.board || [];
  const dec = await api('/board/evaluate');
  const ev = (dec.evaluations || [])[0];
  console.log(`  ..    ${ev?.recommendation}: ${(ev?.headline || '').slice(0, 90)}`);
  // The point is not that it authorizes — the board scores on a dozen things — but that it is not
  // refused for being freight the carrier does not haul or a trailer the driver is not on.
  ok('a container load is not refused as off-division',
    !/division|do not haul|not authori[sz]ed to haul/i.test(`${ev?.headline} ${(ev?.reasons || []).join(' ')}`),
    ev?.recommendation || '(no evaluation)');
  ok('and it is not refused for the wrong trailer being on the back',
    !/wrong trailer|you are on a/i.test(`${ev?.headline} ${(ev?.reasons || []).join(' ')}`),
    ev?.recommendation || '');

  head('4. A rail ramp is a gate, not a twenty-four hour dock');
  const auth = await api('/dispatch/authorize', 'POST', { loadId: ev?.load?.id || board[0]?.id });
  const trip = auth.trip || (un(auth).trips || [])[0];
  ok('the load was authorized', !!trip, trip?.number || '(none)');
  ok('the trip records what the freight is', trip?.freightTrailerType === 'Container' || trip?.trailerType === 'Container',
    `${trip?.trailerType} / ${trip?.freightTrailerType}`);

  const call = await api(`/trips/${trip.id}/arrived`, 'POST', { gameTime: iso(13, '04:00') });
  const c = call.call || call;
  console.log(`  ..    04:00 -> ${c.kind}: ${(c.headline || '').slice(0, 100)}`);
  // Four in the morning at a ramp is a closed gate or a line, and either way it is not "back into 14".
  // Asserted on the KIND, not on the prose: a loose keyword match over the headline passed this while
  // the app was answering "StraightIn — straight onto a door", because the word "open" turned up in the
  // instruction underneath it.
  ok('turning up before it opens is not waved straight onto a door',
    c.kind !== 'StraightIn', `${c.kind}`);
  ok('it is handled as a gate with hours', /site|gate|queue|closed|hours/i.test(`${c.kind}`),
    `${c.kind}`);

  head('5. The type exists everywhere a trailer type is offered');
  // A type the server understands and the browser cannot name is a type nobody can pick.
  // The pickers build their options from a literal array of type names rather than writing out the
  // <option> tags, so this looks for the lists: any line that names Dry Van and Reefer together is one
  // of them, and Container has to be on it.
  const ui = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
  const lists = (ui + js).split('\n').filter((l) => /'Dry Van'/.test(l) && /'Reefer'/.test(l));
  const without = lists.filter((l) => !/'Container'/.test(l));
  console.log(`  ..    ${lists.length} trailer-type list(s) in the browser, ${without.length} missing Container`);
  ok('the browser has trailer-type lists to check', lists.length >= 2, `${lists.length}`);
  ok('and every one of them offers Container', without.length === 0,
    without.map((l) => l.trim().slice(0, 50)).join(' | ') || 'all list it');

  head('6. And the dock estimate starts where a ramp actually sits');
  // Seeded rather than left on the generic default. A drayage turn is a box lifted on or a chassis
  // dropped — quick — and the waiting at a ramp is the gate queue, which is counted separately. A
  // driver planned against a two-hour live-unload for that is being given a number nobody measured.
  const times = (await api('/bootstrap')).views.facilityTimes || [];
  const cont = times.find((f) => (f.trailerType || '').toLowerCase() === 'container');
  const van = times.find((f) => (f.trailerType || '').toLowerCase() === 'dry van');
  console.log(`  ..    Container ${cont?.loadingHours}/${cont?.unloadingHours}h vs Dry Van ${van?.loadingHours}/${van?.unloadingHours}h`);
  ok('the container has its own starting estimate', !!cont, cont ? 'seeded' : '(missing)');
  ok('it is quicker than a live dry-van load, because nothing is handled',
    !van || cont.unloadingHours < van.unloadingHours,
    `${cont?.unloadingHours} < ${van?.unloadingHours}`);
  ok('and it is still an estimate, not a measurement', (cont?.samples || 0) === 0, `${cont?.samples} samples`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
