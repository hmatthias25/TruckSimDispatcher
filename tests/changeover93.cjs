/* Issue #93 — changing carrier leaves the game holding the last company's equipment.
 *
 * The app's books turn over cleanly: new fleet, new headquarters, new ledger. ATS does not turn over at
 * all. Whatever the player actually bought is still parked in their garage under the old colours, and
 * nothing said what to do about it.
 *
 * The awkward part is garages. ATS will not sell one in a city nobody has driven to, and a yard in an
 * undiscovered city would never see freight even if it would — so a new employer headquartered somewhere
 * the player has never been starts with a drive that is not company work at all.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5963}/api`;
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
const day = (n, hm = '08:00') => `2000-01-${String(n).padStart(2, '0')}T${hm}`;

const chg = async () => (await api('/bootstrap')).views.changeover;
const step = (c, id) => (c.steps || []).find((x) => x.id === id);
const kinds = (c, k) => (c.steps || []).filter((x) => x.kind === k);

(async () => {
  const app = { driverName: 'M. Over', preferredDivision: 'Dry Van', transmissionPreference: 'automatic',
    experienceYears: 7, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'monthly' };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: day(2), code: 'PRI' }));

  head('0. Set up somebody who actually owns things in ATS');
  ok('hired at Prime, headquartered in Springfield', S.company.code === 'PRI',
    `${S.company.name} — ${S.company.terminalCity}`);
  ok('nothing to square on a first hire', !(await chg()), 'no instruction');

  // A second garage in a city Werner runs, and a third in one they do not.
  await api('/discovery/note', 'POST', { city: 'Phoenix', state: 'AZ' });
  await api('/terminals', 'POST', { city: 'Phoenix', state: 'AZ', level: 'Small', truckCapacity: 1, trailerCapacity: 3 });
  await api('/discovery/note', 'POST', { city: 'Denver', state: 'CO' });
  await api('/terminals', 'POST', { city: 'Denver', state: 'CO', level: 'Small', truckCapacity: 1, trailerCapacity: 3 });

  // The tractor and trailer they really bought, as opposed to the company backdrop.
  S = (await api('/bootstrap'));
  const truck = S.trucks[0]; truck.inGameGarage = true; truck.gameId = 'PRI-101';
  await api('/fleet/truck', 'POST', truck);
  const trailer = S.trailers[0]; trailer.inGameGarage = true;
  await api('/fleet/trailer', 'POST', trailer);
  S = await api('/bootstrap');
  ok('three yards on the books', S.company.terminals.length === 3,
    S.company.terminals.map((t) => t.city).join(', '));
  ok('one tractor really owned in game', S.trucks.filter((t) => t.inGameGarage).length === 1, 'PRI-101');
  ok('Omaha has never been driven to',
    !(S.views.reached || []).some((r) => /Omaha/i.test(r.city || '')), 'undiscovered');
  ok('and the driver is standing in Springfield', /Springfield/i.test(S.status.locationCity), S.status.locationCity);

  head('1. Resign to Werner — Omaha, and a garage nobody owns there');
  // Applying out of an unfinished probation is a one-in-ten shot by design (#157). This suite is
  // about what the changeover DOES, so the probation is finished first.
  await api('/career/clear-probation', 'POST', { force: true, note: 'test setup' });
  const moved = await api('/market/apply', 'POST', { code: 'WER', reason: 'better lanes' });
  ok('hired', moved.hired === true, moved.decision?.decision || '');
  ok('the instruction comes back with the offer', !!moved.changeover, moved.changeover?.number || 'none');
  let c = await chg();
  ok('and it stands rather than being a one-off reply', !!c, c ? c.number : 'gone');
  ok('resigning did not teleport the driver to a city they have never seen',
    !/Omaha/i.test(un(moved).status.locationCity || ''), un(moved).status.locationCity);
  ok('it names both employers',
    /Prime/i.test(c.fromCarrier) && /Werner/i.test(c.toCarrier), `${c.fromCarrier} → ${c.toCarrier}`);

  head('2. The drive that is not company work');
  const reach = step(c, 'reach-hq');
  ok('there is a step for getting to Omaha', !!reach, reach ? reach.title : 'missing');
  ok('it names the city', /Omaha/i.test(reach.title || ''), reach.title);
  ok('it says the leg is outside company scope',
    /outside\s+company\s+scope/i.test(reach.detail || ''), 'wording');
  ok('and says why it has to happen first — no cargo in an undiscovered city',
    /no cargo|generates no cargo|only exists in cities/i.test(reach.detail + reach.why), 'wording');
  ok('driving or fast travel, the player picks',
    /fast travel/i.test(reach.detail || ''), 'wording');
  ok('the instruction reports itself as blocked on it', c.blocked === true, `blocked=${c.blocked}`);

  head('3. Sell what belonged to the old company');
  const sells = kinds(c, 'Sell');
  ok('the Springfield yard is to be sold — Werner does not run there',
    sells.some((x) => /Springfield/i.test(x.title)), sells.map((x) => x.title).join(' | ').slice(0, 100));
  ok('so is Denver', sells.some((x) => /Denver/i.test(x.title)), 'Denver');
  ok('the tractor is named by unit', /PRI-101/.test(step(c, 'sell-tractors')?.detail || ''),
    (step(c, 'sell-tractors')?.detail || '').slice(0, 60));
  ok('and the trailer too', !!step(c, 'sell-trailers'), 'listed');
  ok('it warns a garage will not sell with equipment in it',
    /will not let a garage go/i.test(sells.find((x) => /Denver/i.test(x.title))?.detail || ''), 'wording');

  head('4. Keep what carries over');
  const keeps = kinds(c, 'Keep');
  ok('Phoenix stays — Werner runs a yard there',
    keeps.some((x) => /Phoenix/i.test(x.title)), keeps.map((x) => x.title).join(' | '));
  ok('and it is already ticked, because there is nothing to do',
    keeps.every((x) => x.done), 'done');
  ok('Phoenix is not also on the sell list',
    !sells.some((x) => /Phoenix/i.test(x.title)), 'not sold');

  head('5. Buy what the new company runs');
  const buys = kinds(c, 'Buy');
  ok('a garage in Omaha', !!step(c, 'buy-hq'), step(c, 'buy-hq')?.title || 'missing');
  ok('it admits the home yard is an assumption until it is bought',
    /assumption rather than a fact/i.test(step(c, 'buy-hq')?.detail || ''), 'wording');
  ok('a tractor, with the spec to aim for', !!step(c, 'buy-tractor'),
    step(c, 'buy-tractor')?.title || 'missing');
  ok('a trailer', !!step(c, 'buy-trailer'), step(c, 'buy-trailer')?.title || 'missing');
  ok('and a reminder that the money moved',
    /true-up|Square the books/i.test(step(c, 'true-up')?.title || ''), step(c, 'true-up')?.title);

  head('6. Selling a yard takes it off our books, because it is really gone');
  const denver = sells.find((x) => /Denver/i.test(x.title));
  const before = (await api('/bootstrap')).company.terminals.length;
  let r = await api('/changeover/confirm', 'POST', { stepId: denver.id });
  ok('it says the yard is off the books', /Denver/i.test(r.message || ''), r.message);
  ok('and the terminal really went',
    un(r).company.terminals.length === before - 1, `${before} → ${un(r).company.terminals.length}`);
  ok('with no Denver left on the list',
    !un(r).company.terminals.some((t) => /Denver/i.test(t.city)), 'gone');
  ok('the step shows as done', step(await chg(), denver.id).done === true, 'done');
  let again = null;
  try { await api('/changeover/confirm', 'POST', { stepId: denver.id }); } catch (e) { again = e.message; }
  ok('ticking it twice is refused', again !== null, (again || '(allowed!)').slice(0, 60));

  head('7. Headquarters is not one to sell');
  const springfield = (await chg()).steps.find((x) => x.kind === 'Sell' && /Springfield/i.test(x.title));
  ok('Springfield is on the sell list while it is not HQ', !!springfield, springfield?.title || 'missing');

  head('8. Reaching the city puts it on the map');
  ok('Omaha still undiscovered before the drive',
    !((await api('/bootstrap')).views.reached || []).some((x) => /Omaha/i.test(x.city || '')), 'not yet');
  r = await api('/changeover/confirm', 'POST', { stepId: 'reach-hq' });
  ok('it says the city is on the map now', /on your map/i.test(r.message || ''), r.message.slice(0, 70));
  ok('and that is where the driver now is',
    /Omaha/i.test(un(r).status.locationCity || ''), un(r).status.locationCity);
  ok('and it is', ((await api('/bootstrap')).views.reached || []).some((x) => /Omaha/i.test(x.city || '')),
    'discovered');
  ok('nothing is blocked any more', (await chg()).blocked === false, 'clear');

  head('9. Working the rest of it off closes the instruction');
  for (const st of (await chg()).steps.filter((x) => !x.done))
    await api('/changeover/confirm', 'POST', { stepId: st.id });
  ok('the instruction is finished and gone from the view', !(await chg()), 'closed');
  ok('and the career log says so',
    (await api('/bootstrap')).events.some((e) => /changeover done|CHG-/i.test(e.message || '')), 'logged');

  head('10. A move to a carrier you already have a garage for asks for no drive');
  await api('/career/clear-probation', 'POST', { force: true, note: 'test setup' });   // see #157
  await api('/market/apply', 'POST', { code: 'ROE', reason: 'flatbed' });   // Marshfield, WI — never been
  c = await chg();
  ok('a fresh instruction for the next move', !!c, c ? c.number : 'none');
  ok('Marshfield needs reaching too', !!step(c, 'reach-hq'), step(c, 'reach-hq')?.title || 'missing');
  await api('/changeover/close', 'POST', {});
  ok('and it can be put away by somebody who did it all already', !(await chg()), 'closed');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
