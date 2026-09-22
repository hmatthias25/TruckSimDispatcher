/* More than one career, switched from inside the app.
 *
 *   "so can we make it easy to manage multiple careers in the app for the player?"
 *
 * Before this the answer was a folder per exe, or a TSD_DATA_DIR shortcut per career, and both work
 * until the day you rename the data folder and the resolver quietly opens a career you forgot was in
 * LocalAppData. That is a trap, and it is not one a player should have to know about.
 *
 * The shape, and the reason it is this shape:
 *
 *   - THE CAREER BEING PLAYED STAYS AT career.json. Not a slot, not behind a pointer file. The resolver
 *     finds it, an older build finds it, and copying the folder to another machine still brings the live
 *     career with it. Only the idle ones move into data/careers.
 *   - So there is nothing to keep in step. Whatever is in career.json IS the current career, and a slot
 *     file exists for a career precisely when it is not loaded.
 *   - Switching is live. The store already holds the state in a swappable field under a lock, so there
 *     is no restart and no "close the app first".
 *   - A new career inherits the settings, because HOS rules, fuel, economy, the regions you run and the
 *     API key describe the game install rather than the career that just ended. Retyping them per
 *     career is busywork with a wrong answer waiting at the end of it.
 *
 * The ordering inside a switch is the part worth guarding: the outgoing career is written to its slot
 * and confirmed BEFORE the incoming one is read, and the incoming slot is only deleted once career.json
 * holds it. A crash in the middle leaves both on disk. Worst case one shows up twice, which a player can
 * see and sort out; the thing that must never happen is neither showing up at all.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

const careers = async () => (await api('/careers')).careers;
const find = (list, label) => list.find((c) => c.label === label);
const current = (list) => list.find((c) => c.current);

/** Onboard whoever is in the chair now. */
async function hire(name, code, homeCity, day) {
  const app = { driverName: name, preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity, homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  return un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(day), code }));
}

(async () => {
  let S = await hire('A. First', 'PRI', 'Springfield', 1);
  await api('/status', 'POST', {
    locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal', gameTime: iso(9),
    fuelPct: 80, atsOdometer: 120000, truckDamagePct: 2, dutyStatus: 'OnDuty',
  });

  head('1. One career, and nothing to switch between');
  let list = await careers();
  console.log(`  ..    ${list.length}: ${list.map((c) => `${c.label}${c.current ? ' (playing)' : ''}`).join(', ')}`);
  ok('the career being played is listed', list.length === 1 && list[0].current === true, `${list.length}`);
  ok('with no slug, because it is the one in career.json', list[0].slug === '', `"${list[0].slug}"`);
  ok('labelled off the carrier, since nobody named it', !!list[0].label && list[0].label !== 'Unnamed career',
    list[0].label);
  ok('and it knows where it is up to', list[0].onboarded === true && list[0].day > 0,
    `day ${list[0].day}`);

  head('2. Start another, and the first one is parked rather than lost');
  // Settings first, so there is something identifiable to check gets carried over.
  const before = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...before, governedMph: 61, runnableStates: ['CO', 'KS', 'MO'] });

  let r = await api('/careers/new', 'POST', { name: 'Second run', inheritSettings: true });
  S = un(r);
  list = r.careers;
  console.log(`  ..    ${list.map((c) => `${c.label}${c.current ? ' (playing)' : ''}`).join(' | ')}`);
  ok('there are two careers now', list.length === 2, `${list.length}`);
  ok('the new one is the one being played', current(list).label === 'Second run', current(list).label);
  ok('and it is empty', S.onboarded === false, `onboarded=${S.onboarded}`);
  ok('the first is still on file', list.some((c) => !c.current && c.company === 'Prime Inc.'),
    list.filter((c) => !c.current).map((c) => c.label).join(', '));

  head('3. The new career inherits the settings, which describe the game not the career');
  const carried = (await api('/bootstrap')).settings;
  console.log(`  ..    governed ${carried.governedMph} mph, ${carried.runnableStates.length} regions`);
  ok('the speed setting came across', carried.governedMph === 61, `${carried.governedMph}`);
  ok('and so did the map you run', carried.runnableStates.join(',') === 'CO,KS,MO',
    carried.runnableStates.join(','));

  head('4. Switch back, and the career picks up exactly where it was');
  const parked = list.find((c) => !c.current);
  r = await api('/careers/switch', 'POST', { slug: parked.slug });
  S = un(r);
  list = r.careers;
  console.log(`  ..    now playing ${current(list).label}, day ${current(list).day}`);
  ok('the first career is back', S.onboarded === true && S.driver.name === 'A. First', S.driver.name);
  ok('on the day it was parked on', S.status.gameTime.startsWith(iso(9).slice(0, 10)), S.status.gameTime);
  ok('still two careers, not three', list.length === 2, `${list.length}`);
  ok('and the one we left is the idle one now', find(list, 'Second run')?.current === false,
    `${find(list, 'Second run')?.current}`);

  head('5. Nothing is ever in two places at once');
  // The invariant the whole layout rests on: career.json is the live career, a slot file exists exactly
  // when a career is not loaded. Two currents, or a career with both, would mean a switch half-applied.
  ok('exactly one career says it is being played',
    list.filter((c) => c.current).length === 1, `${list.filter((c) => c.current).length}`);
  ok('and only the idle ones have slugs',
    list.every((c) => (c.current ? c.slug === '' : c.slug.length > 0)),
    list.map((c) => `${c.label}:"${c.slug}"`).join(' '));

  head('6. Renaming');
  await api('/careers/rename', 'POST', { slug: '', name: 'Prime years' });
  list = await careers();
  ok('the live career takes the new name', current(list).label === 'Prime years', current(list).label);
  const idle = list.find((c) => !c.current);
  await api('/careers/rename', 'POST', { slug: idle.slug, name: 'Werner run' });
  list = await careers();
  ok('and so does one sitting idle', !!find(list, 'Werner run'),
    list.map((c) => c.label).join(', '));
  let threw = '';
  try { await api('/careers/rename', 'POST', { slug: '', name: '   ' }); } catch (e) { threw = e.message; }
  ok('a career cannot be renamed to nothing', /needs a name/i.test(threw), threw || 'allowed');

  head('7. Deleting takes a typed confirmation and keeps a copy');
  const doomed = (await careers()).find((c) => !c.current);
  threw = '';
  try { await api('/careers/delete', 'POST', { slug: doomed.slug, confirm: 'yes' }); }
  catch (e) { threw = e.message; }
  ok('a loose confirmation is refused', /type DELETE/i.test(threw), threw.slice(0, 60));
  ok('and it is still there', (await careers()).length === 2, `${(await careers()).length}`);

  const del = await api('/careers/delete', 'POST', { slug: doomed.slug, confirm: 'DELETE' });
  console.log(`  ..    kept a copy at ${String(del.keptAt).split(/[\\/]/).pop()}`);
  ok('with DELETE it goes', del.careers.length === 1, `${del.careers.length}`);
  ok('and a copy is kept in backups', /deleted-career-/.test(del.keptAt || ''), del.keptAt || '(none)');

  head('8. The career you are playing cannot be deleted out from under you');
  // Start over is that, and it says so. Deleting the live one would leave the app holding state with no
  // file behind it, which is a worse answer than refusing.
  threw = '';
  try { await api('/careers/delete', 'POST', { slug: '', confirm: 'DELETE' }); }
  catch (e) { threw = e.message; }
  ok('it is refused, and says what to do instead',
    /switch to another one first|start over/i.test(threw), threw.slice(0, 90) || 'allowed');
  ok('the career survived', (await careers()).length === 1 && current(await careers()).onboarded === true,
    'still playing');

  head('9. Switching to something that is not there');
  threw = '';
  try { await api('/careers/switch', 'POST', { slug: 'no-such-career' }); } catch (e) { threw = e.message; }
  ok('is refused rather than swapping in a blank', !!threw, threw.slice(0, 70));
  ok('and the live career is untouched',
    (await api('/bootstrap')).driver.name === 'A. First', 'A. First');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
