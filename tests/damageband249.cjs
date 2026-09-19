/* Five percent is a job for the next time you are stopped, not a trip to a shop.
 *
 *   "I got a Maintenance attention, unit 150 at 5% report to shop after delivery message. 5% isn't the
 *    threshold here, it is the threshold to get it looked at either on my 34 or at the shop. Why am I
 *    getting this?"
 *
 * Because the two thresholds shipped on the same number:
 *
 *     /// <summary>Below this: monitor only.</summary>
 *     public double MonitorPct { get; set; } = 5;
 *     /// <summary>At or above this: report to shop after delivery.</summary>
 *     public double ReportPct  { get; set; } = 5;
 *
 * So the band between them had no width, five went straight into "report to the shop after this
 * delivery", and MonitorPct — the field that existed to describe exactly the tier the player is
 * describing — was read by nothing at all.
 *
 * The middle is real now: at five, worth getting looked at next time the truck is standing still anyway.
 * The shop line moves to ten, where dispatch stops issuing loads — being sent to a shop and handed
 * freight going the other way in the same breath is what made two separate numbers wrong to begin with.
 *
 * Settings are stored per career, so the default alone fixes nobody already playing. Schema 24 moves it,
 * and only where it is still sitting on the old default: a player who set their own figure has said what
 * they want, and a migration that overwrites a deliberate setting is worse than the bug.
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

let S;
/** Set the reported damage and read back what the company says about it. */
async function at(pct) {
  await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'TruckStop', gameTime: iso(6),
    fuelPct: 80, atsOdometer: 30000 + pct, truckDamagePct: pct, dutyStatus: 'OnDuty',
  });
  const v = (await api('/bootstrap')).views;
  return v.maintenance || v.shop || v;
}

(async () => {
  const app = { driverName: 'N. Haddad', preferredDivision: 'Dry Van', experienceYears: 8,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. The two lines are no longer the same number');
  const m = S.settings.maintenance;
  console.log(`  ..    monitor=${m.monitorPct}  report=${m.reportPct}  stopDispatch=${m.stopDispatchPct}`);
  ok('a fresh career has air between them', m.reportPct > m.monitorPct,
    `${m.monitorPct} then ${m.reportPct}`);
  ok('and the shop line is where dispatch stops anyway', m.reportPct === m.stopDispatchPct,
    `report ${m.reportPct} vs stop ${m.stopDispatchPct}`);

  head('2. Five percent is a look, not a trip');
  // The reported message, and what it should have said.
  const five = await at(5);
  const said = JSON.stringify(five);
  console.log(`  ..    ${(five.directive || five.headline || said).slice(0, 130)}`);
  ok('it is no longer "report to the shop after this delivery"',
    !/report to the shop after this delivery/i.test(said), 'not said');
  ok('it says to get it looked at while you are stopped anyway',
    /stopped anyway|on your 34|at the yard/i.test(said),
    (said.match(/[^"]*stopped anyway[^"]*/i) || ['(not said)'])[0].slice(0, 110));
  ok('and says plainly it is not a trip on its own',
    /not a trip on its own/i.test(said), 'said');

  head('3. Below the line, nothing is said at all');
  // Not "monitor only" written on a screen — nothing. Below the watch line there is no job, and a line
  // of text about a two percent scuff is the noise the tiers exist to keep out.
  const two = JSON.stringify(await at(2));
  ok('two percent raises no shop directive',
    !/report to the shop|stopped anyway|mandatory maintenance review/i.test(two), 'silent');
  ok('and nothing nags about the unit at all',
    !/at 2% —/.test(two), (two.match(/[^"]*at 2%[^"]*/) || ['nothing said'])[0].slice(0, 80));

  head('4. Ten percent is the shop, as it always should have been');
  const ten = await at(10);
  ok('now it says report to the shop',
    /report to the shop after this delivery/i.test(JSON.stringify(ten)),
    (JSON.stringify(ten).match(/[^"]*report to the shop[^"]*/i) || ['(not said)'])[0].slice(0, 100));

  head('5. The heavier lines are untouched');
  const fifteen = await at(15);
  ok('fifteen is still a mandatory review',
    /mandatory maintenance review/i.test(JSON.stringify(fifteen)), 'review');
  const thirty = await at(30);
  ok('thirty is still out of service',
    /out of service/i.test(JSON.stringify(thirty)), 'out of service');

  head('6. A career stored on the old figure is moved, and told');
  let st = await api('/export');
  st.schemaVersion = 23;
  st.settings.maintenance.monitorPct = 5;
  st.settings.maintenance.reportPct = 5;      // the old default, as shipped
  S = un(await api('/import', 'POST', st));
  const after = S.settings.maintenance;
  console.log(`  ..    migrated: monitor=${after.monitorPct} report=${after.reportPct}`);
  ok('the schema moved on', S.schemaVersion >= 24, `${S.schemaVersion}`);
  ok('the shop line is separated from the watch line', after.reportPct > after.monitorPct,
    `${after.monitorPct} then ${after.reportPct}`);
  const ev = (await api('/events?take=40')).find((e) => /thresholds separated/i.test(e.message || ''));
  ok('and the player is told what moved and why', !!ev, ev?.message?.slice(0, 130) || '(silent)');
  ok('naming both figures', /5(\.\d)?%.*10(\.\d)?%/s.test(ev?.message || ''),
    ev?.message?.slice(0, 90) || '');

  head('7. A figure the player set by hand is left alone');
  // The line the migration must not cross. Someone who chose 7 has said what they want.
  st = await api('/export');
  st.schemaVersion = 23;
  st.settings.maintenance.monitorPct = 5;
  st.settings.maintenance.reportPct = 7;
  S = un(await api('/import', 'POST', st));
  ok('a deliberate setting survives the migration', S.settings.maintenance.reportPct === 7,
    `${S.settings.maintenance.reportPct}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
