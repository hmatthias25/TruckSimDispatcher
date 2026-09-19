/* The trailer position questions belong at the drop, and nowhere else.
 *
 *   "I got the trailer position form when I got BACK to the garage. Supposed to ONLY get this on the
 *    last load I drop before I deadhead home or take a load home. Was this a relic? We were to get rid
 *    of that when we GET to the garage so that planning can be made on our way back."
 *
 * A relic, and the player's memory of the decision is exact. 59d7f5c moved the whole conversation to
 * the drop that ends the tour, for the reason its own message gives: arriving at the yard and being
 * asked to record where the company's trailers were, then being shown a plan costed against a position
 * typed in seconds earlier, "read as nonsense because it was. Every piece of it arrived too late to act
 * on." TripService says the same thing where it does the asking — "doing the asking at the yard meant
 * the answers arrived after the only decision they could have changed had already been made."
 *
 * The arrival brief kept its own sweep anyway, and it was the worst version of the question: asked at
 * the yard, about boxes based at that yard, which the driver can see out of the windscreen, for a
 * decision made before they pulled in.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
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
const iso = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let S, yard;

(async () => {
  const app = { driverName: 'J. Farrow', preferredDivision: 'Dry Van', experienceYears: 6,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  yard = S.company.terminals[0];
  S = un(await api(`/terminals/${yard.id}/level`, 'POST', { level: 'Large' }));

  // Boxes based at the home yard with nothing recent on file — precisely what the old sweep picked up.
  for (const [unit, type] of [['T-100', 'Dry Van'], ['T-101', 'Reefer'], ['T-102', 'Dry Van']])
    await api('/fleet/trailer', 'POST', {
      unit, type, division: type, year: 2021, status: 'InService',
      inGameGarage: true, homeTerminalId: yard.id,
    });

  head('1. Arriving at the garage asks for no trailer positions');
  // Overdue home time and away first, so the arrival is a real one and the brief is built in full.
  let st = await api('/export');
  st.status.gameTime = iso(40);
  st.driver.lastHomeGameTime = iso(4);        // well past a fortnightly arrangement
  await api('/import', 'POST', st);

  await api('/status', 'POST', {
    locationCity: 'Amarillo', locationState: 'TX', locationKind: 'TruckStop', gameTime: iso(40),
    fuelPct: 60, atsOdometer: 9_000, truckDamagePct: 4, trailerDamagePct: 2, dutyStatus: 'OffDuty',
  });
  S = un(await api('/status', 'POST', {
    locationCity: yard.city, locationState: yard.state, locationKind: 'Terminal', gameTime: iso(41),
    fuelPct: 70, atsOdometer: 9_600, truckDamagePct: 4, trailerDamagePct: 2, dutyStatus: 'OffDuty',
  }));

  const brief = S.views.lastArrival || S.driver?.lastArrivalBrief || {};
  const asked = brief.askWhereabouts || [];
  console.log(`  ..    brief asked about ${asked.length} box(es)`);
  ok('the arrival brief asks about no boxes at all', asked.length === 0,
    asked.map((a) => a.unit).join(', ') || 'none asked');
  ok('and the driver is recorded as home', S.driver.atHomeYard === true, `atHomeYard=${S.driver.atHomeYard}`);

  head('2. The boxes are still on the books, unasked-about');
  // The point is not that the app stopped caring where they are — it is that the yard is the one place
  // the question buys nothing, because the answer is out of the windscreen.
  const boxes = (await api('/export')).trailers.filter((t) => t.unit.startsWith('T-10'));
  ok('all three are still there', boxes.length === 3, boxes.map((b) => b.unit).join(', '));
  ok('and none of them had a position invented for it',
    boxes.every((b) => !b.whereabouts), boxes.map((b) => b.whereabouts || '—').join(', '));

  head('3. Nothing-to-do is not held open by a question that is no longer asked');
  // The flag ANDed in askWhereabouts.Count == 0. With the sweep gone it can actually be reached.
  ok('the brief can settle', typeof brief.nothingToDo === 'boolean', `nothingToDo=${brief.nothingToDo}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
