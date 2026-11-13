/* Owner-Operator: more than one career, as the company-driver app keeps them.
 *
 *   - start another career: it is not started, and what describes the game comes with it (key, cost, limits)
 *   - a name given at creation survives the first screen
 *   - switch between them, each where it was left
 *   - rename one being played and one parked
 *   - the one being played cannot be deleted; a parked one needs DELETE typed, and a copy is kept
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5990}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const refused = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message || 'refused'; } };
const start = (driverName, homeCity, homeState) => api('/start', 'POST', { game: 'ATS', driverName, homeCity, homeState, day: 1, time: '08:00',
  level: 0, longDistance: 1, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 1000, preset: 'Normal' });

(async () => {
  head('1. One career, started');
  let S = await start('O. Operator', 'Kansas City', 'KS');
  ok('named off the driver', S.careerName === 'O. Operator', S.careerName);
  ok('one on file', S.careerCount === 1, `${S.careerCount}`);
  S = await api('/settings', 'POST', { costPerMile: 2.05, anthropicApiKey: 'sk-ant-test-key' });
  await api('/status', 'POST', { locationCity: 'Wichita', locationState: 'KS', day: 2, time: '10:00' });

  head('2. Start another');
  let r = await api('/careers/new', 'POST', { name: 'Second run' });
  S = r.snapshot;
  ok('it is not started — the first screen comes next', S.started === false);
  ok('under the name given', S.careerName === 'Second run', S.careerName);
  ok('two on file', S.careerCount === 2 && r.careers.length === 2, `${S.careerCount}`);
  ok('the cost per mile came with it', S.settings.costPerMile === 2.05, `${S.settings.costPerMile}`);
  ok('and the API key', S.settings.hasApiKey === true);
  S = await start('B. Driver', 'Dallas', 'TX');
  ok('started from Dallas', S.started && S.status.city === 'Dallas', S.status.city);
  ok('the name given at creation stands', S.careerName === 'Second run', S.careerName);
  ok('the key survived the first screen', S.settings.hasApiKey === true);

  head('3. Switch back, and it is where it was left');
  let list = (await api('/careers')).careers;
  const first = list.find((c) => !c.current);
  ok('the first is parked, started, in Wichita\'s day', first && first.started && first.label === 'O. Operator' && first.day === 2,
    JSON.stringify(first));
  r = await api('/careers/switch', 'POST', { slug: first.slug });
  S = r.snapshot;
  ok('playing the first again', S.profile.driverName === 'O. Operator' && S.status.city === 'Wichita', `${S.profile.driverName} in ${S.status.city}`);
  ok('still two on file, not three', r.careers.length === 2 && S.careerCount === 2, `${r.careers.length}`);
  ok('exactly one being played', r.careers.filter((c) => c.current).length === 1);
  ok('and it works: a status report goes through', (await api('/status', 'POST', { locationCity: 'Topeka', locationState: 'KS', day: 2, time: '14:00' })).status.city === 'Topeka');

  head('4. Renaming');
  r = await api('/careers/rename', 'POST', { slug: '', name: 'Kansas years' });
  ok('the one being played', r.snapshot.careerName === 'Kansas years', r.snapshot.careerName);
  const parked = r.careers.find((c) => !c.current);
  r = await api('/careers/rename', 'POST', { slug: parked.slug, name: 'Texas run' });
  ok('and one parked', r.careers.some((c) => !c.current && c.label === 'Texas run'), r.careers.map((c) => c.label).join(', '));
  ok('a career needs a name', /needs a name/.test(await refused(() => api('/careers/rename', 'POST', { slug: '', name: ' ' }))));

  head('5. Deleting');
  ok('not the one being played', /Switch to another one first/.test(await refused(() => api('/careers/delete', 'POST', { slug: '', confirm: 'DELETE' }))));
  ok('not without DELETE typed', /Type DELETE/.test(await refused(() => api('/careers/delete', 'POST', { slug: parked.slug, confirm: 'yes' }))));
  r = await api('/careers/delete', 'POST', { slug: parked.slug, confirm: 'DELETE' });
  ok('gone, with a copy kept', r.careers.length === 1 && /deleted-career-/.test(r.keptAt || ''), r.keptAt);
  ok('and the count says so', r.snapshot.careerCount === 1, `${r.snapshot.careerCount}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
