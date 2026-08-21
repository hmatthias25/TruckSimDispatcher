/* Issues #24, #25: every city reached is listed, and yards are only offered on the employer's network. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5620}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(j?.error || t.slice(0, 300));
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

let S, day = 1;

/** Report being in a city, which is how a city becomes discovered. */
async function visit(city, state) {
  const r = await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'Receiver',
    gameTime: `2000-01-${String(day++).padStart(2, '0')}T12:00`,
    fuelPct: 80, atsOdometer: 10000 + day * 100, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 60000,
  });
  S = un(r);
  return r;
}

const reached = () => S.views.reached || [];
const ops = () => S.views.garageOpportunities || [];
const find = (list, city) => list.find((c) => c.city === city);

(async () => {
  head('1. Hired at Prime: the network is stored, not guessed');
  const app = { driverName: 'Net Tester', preferredDivision: 'Reefer', transmissionPreference: 'either',
    experienceYears: 5, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T08:00', code: 'PRI' }));

  const net = S.company.networkCities || [];
  ok('Prime is the employer', /Prime/.test(S.company.name), S.company.name);
  ok('the network is on the career', net.length >= 4, net.join(' | '));
  for (const city of ['Springfield', 'Salt Lake City', 'Denver', 'Pittston']) {
    ok(`${city} is on the network`, net.some((n) => n.split(',')[0].trim() === city), net.join(' | '));
  }
  ok('the summary reads as a sentence', /Prime.*runs out of/.test(S.views.networkSummary || ''),
    S.views.networkSummary);

  head('2. Wichita is recorded but no yard is offered there');
  let r = await visit('Wichita', 'KS');
  ok('a notice fired', !!r.discovery, r.discovery?.headline || '(none)');
  ok('it does NOT offer a garage', r.discovery.garageAvailable === false, `${r.discovery.garageAvailable}`);
  ok('the headline just notes the city', /on our map now/.test(r.discovery.headline), r.discovery.headline);
  ok('and it names the actual network', /runs out of/.test((r.discovery.detail || []).join(' ')),
    (r.discovery.detail || [])[0] || '(none)');
  ok('Wichita is still on the reached list', !!find(reached(), 'Wichita'));
  ok('marked as off network', find(reached(), 'Wichita').status === 'Off network',
    find(reached(), 'Wichita').status);
  ok('and it is NOT an opportunity', !find(ops(), 'Wichita'), ops().map((o) => o.city).join(', ') || '(none)');

  head('3. Denver IS on the network, so it is offered');
  r = await visit('Denver', 'CO');
  ok('a notice fired', !!r.discovery);
  ok('this one offers a garage', r.discovery.garageAvailable === true, `${r.discovery.garageAvailable}`);
  ok('and says ATS will sell you one', /sell you a garage/.test(r.discovery.headline), r.discovery.headline);
  ok('Denver is an opportunity', !!find(ops(), 'Denver'), ops().map((o) => o.city).join(', '));
  ok('and shows as could-buy on the reached list', find(reached(), 'Denver').status === 'Could buy');

  head('4. Every city reached is listed, not a filtered handful');
  await visit('Amarillo', 'TX');
  await visit('Oklahoma City', 'OK');
  await visit('Salt Lake City', 'UT');
  await visit('Tulsa', 'OK');
  const cities = reached().map((c) => c.city);
  for (const c of ['Wichita', 'Denver', 'Amarillo', 'Oklahoma City', 'Salt Lake City', 'Tulsa', 'Springfield']) {
    ok(`${c} is on the reached list`, cities.includes(c), cities.join(', '));
  }
  ok('the reached list is bigger than the opportunity list', reached().length > ops().length,
    `${reached().length} reached vs ${ops().length} offered`);
  ok('off-network cities are the difference',
    reached().filter((c) => !c.onNetwork).length >= 3,
    reached().filter((c) => !c.onNetwork).map((c) => c.city).join(', '));

  head('5. The home terminal shows as a yard we have');
  ok('Springfield is ours', find(reached(), 'Springfield').status === 'Yard here',
    find(reached(), 'Springfield').status);
  ok('and is therefore not offered', !find(ops(), 'Springfield'));

  head('6. Dismissing a city keeps it on the reached list');
  S = un(await api('/discovery/decline', 'POST', { city: 'Denver', state: 'CO' }));
  ok('gone from the opportunities', !find(ops(), 'Denver'), ops().map((o) => o.city).join(', ') || '(none)');
  ok('but still a city you reached', !!find(reached(), 'Denver'));
  ok('shown as dismissed', find(reached(), 'Denver').status === 'Dismissed',
    find(reached(), 'Denver').status);

  head('7. Nothing is silently truncated');
  ok('more than six cities are returned', reached().length > 6, `${reached().length}`);

  head('8. A fictional carrier keeps the open behaviour');
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
  const app2 = { ...app, driverName: 'Fictional Tester' };
  await api('/onboarding/market', 'POST', app2);
  S = un(await api('/onboarding/hire', 'POST', { application: app2, force: true, gameTime: '2000-01-01T08:00' }));
  day = 1;
  const fictional = (S.company.networkCities || []).length === 0;
  console.log(`  employer: ${S.company.name} (${S.company.code}), network entries: ${(S.company.networkCities || []).length}`);
  r = await visit('Wichita', 'KS');
  if (fictional) {
    ok('with no known network, anywhere reached is fair game', r.discovery.garageAvailable === true,
      r.discovery.headline);
  } else {
    ok('a real carrier still respects its network',
      r.discovery.garageAvailable === (S.company.networkCities || []).some((n) => n.split(',')[0].trim() === 'Wichita'),
      `${r.discovery.garageAvailable} for ${S.company.name}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; });
