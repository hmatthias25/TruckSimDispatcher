/* A trailer in daily use, reported as one nobody has touched — and the button that could never work.
 *
 *   "How are you determining if a trailer ran last fleet report? Food-grade tanker is currently running."
 *
 * Two faults, compounding.
 *
 * The first is an ordering one. The report's trailer section asks for a utilisation reading off the ATS
 * Trailer Manager and three lifetime totals, per box. Those were written onto the trailers AFTER the
 * assessment that decides whether a box is worth keeping had already run. So the verdict on every
 * trailer was reached on the previous period's figures while this period's sat unread in the request:
 * the player typed 82% against a tanker and was told in the same breath that nothing had been on it.
 *
 * The second is worse, because it invents a fact. "Nobody has been on it" came from
 * HiredDriver.AssignedTrailerUnit — but the report deliberately stopped asking which trailer a hired
 * driver is on, on the grounds that "who is nominally holding it is bookkeeping the app was maintaining
 * for its own sake". A retirement recommendation was then built on that abandoned bookkeeping. Every
 * box with no driver nominally attached counted an idle period whether or not it had run, and at three
 * the company offered to trade it. A blank on a form is not evidence of anything.
 *
 *   "Still getting error T517 is not in fleet, because it isn't — I got rid of it manually."
 *
 * And the third: the Fleet tab renders the last report's stored recommendations as buttons. Sell the
 * trailer in ATS and strike it off by hand — which is precisely what the recommendation instructs — and
 * the button stays, offering to trade a box that is gone, throwing every time it is pressed.
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

let S, yardId, day = 20;
const box = async (u) => (await api('/export')).trailers.find((t) => t.unit === u);
// The tanker is worked every period: utilisation off the Trailer Manager, and lifetime totals climbing.
const file = async (util, dist, loads) => {
  const start = day, end = day + 14; day = end;
  return (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(start), periodEndGame: iso(end),
    lines: [],
    trailerLines: [{ unit: 'TK-1', utilisationPct: util, distanceOnJobMi: dist,
                     loadsTransported: loads, weightTransportedLbs: loads * 40_000 }],
  })).report;
};

(async () => {
  const app = { driverName: 'M. Delacroix', preferredDivision: 'Tanker', experienceYears: 9,
    homeCity: 'Houston', homeState: 'TX', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  yardId = S.company.terminals[0].id;
  S = un(await api(`/terminals/${yardId}/level`, 'POST', { level: 'Large' }));

  // A food-grade tanker nobody is nominally holding — no hired driver, not the player's box. The app
  // has no assignment record for it, which is the normal state of affairs now the report has stopped
  // asking. Everything it knows about this trailer comes off the form.
  await api('/fleet/trailer', 'POST', {
    unit: 'TK-1', type: 'Tanker', subtype: 'Food Grade', division: 'Tanker', year: 2021,
    status: 'InService', inGameGarage: true, homeTerminalId: yardId,
  });

  head('1. A box the figures say is running is not called idle');
  // Three periods, because three is the count at which the company stops watching and starts trading.
  let seed = await file(80, 10_000, 20);
  console.log(`  ..    seeded: ${(await box('TK-1')).utilisationPct}% util`);
  await file(82, 14_200, 28);
  const rep = await file(83, 18_600, 37);

  const tk = await box('TK-1');
  ok('the reading the player typed is on the trailer', tk.utilisationPct === 83, `${tk.utilisationPct}%`);
  ok('and it has counted no idle periods at all', tk.idlePeriods === 0, `${tk.idlePeriods}`);
  ok('so nothing is recommending it for trade',
    !(rep.retirements || []).some((r) => r.unit === 'TK-1'),
    (rep.retirements || []).map((r) => r.unit).join(', ') || 'none');
  ok('and nothing says nobody has been on it',
    !/nobody has been on|no driver has been on/i.test(JSON.stringify(rep)), 'not said');

  head('2. This period\'s reading is what it is judged on, not last period\'s');
  // The ordering fault on its own. A box that has just been reported at 83% must not be assessed on
  // whatever it read a fortnight ago.
  const said = [...(rep.watching || []).map((w) => w.note), ...(rep.findings || [])].join(' | ');
  ok('no watch note calls a working tanker under-used',
    !/TK-1[^|]*under the|TK-1[^|]*not earning/i.test(said),
    (said.match(/[^|]*TK-1[^|]*/i) || ['nothing said'])[0].slice(0, 100));

  head('3. A box nobody reported anything about is unread, not idle');
  // The rule the whole fix turns on. Absence of a figure has never been evidence of anything in this
  // app, and it does not get to condemn a trailer.
  await api('/fleet/trailer', 'POST', {
    unit: 'TK-2', type: 'Tanker', subtype: 'Chemical', division: 'Tanker', year: 2019,
    status: 'InService', inGameGarage: true, homeTerminalId: yardId,
  });
  const quiet = await file(84, 22_000, 46);   // TK-2 gets no row at all
  const tk2 = await box('TK-2');
  ok('an unreported box counts no idle periods', tk2.idlePeriods === 0, `${tk2.idlePeriods}`);
  ok('it is not up for trade', !(quiet.retirements || []).some((r) => r.unit === 'TK-2'), 'not offered');
  // Asked for once, in one line, and last — a note per spare box would put a row on the report for
  // every trailer on the property every fortnight, ahead of the findings that are about something.
  ok('the report asks for the reading instead of guessing',
    (quiet.watching || []).some((w) => /never been read|no utilisation has ever/i.test(w.note)
                                       && /TK-2/.test(w.note)),
    (quiet.watching || []).map((w) => w.note).find((n) => /TK-2/.test(n))?.slice(0, 100) || '(silent)');

  head('4. A box the figures say has stopped is still caught');
  // The feature has to keep working. Reported, and the totals have not moved — that is a real statement
  // about a real box, and it is the one the recommendation was always meant to rest on.
  for (let i = 0; i < 3; i++) {
    const start = day, end = day + 14; day = end;
    await api('/fleetops/report', 'POST', {
      periodStartGame: iso(start), periodEndGame: iso(end), lines: [],
      trailerLines: [
        { unit: 'TK-1', utilisationPct: 85, distanceOnJobMi: 26_000 + i * 4_000,
          loadsTransported: 55 + i * 9, weightTransportedLbs: (55 + i * 9) * 40_000 },
        // TK-2: reported every period, and not one figure moves.
        { unit: 'TK-2', utilisationPct: 0, distanceOnJobMi: 0, loadsTransported: 0, weightTransportedLbs: 0 },
      ],
    });
  }
  const dead = await box('TK-2');
  ok('a box reported as doing nothing does count', dead.idlePeriods >= 3, `${dead.idlePeriods} period(s)`);
  const fo = await api('/fleetops');
  const rec = (fo.retirements || []).find((r) => r.unit === 'TK-2');
  ok('and the company raises it', !!rec, rec?.headline?.slice(0, 90) || '(none)');
  ok('saying it is the figures that have not moved, not that nobody was assigned',
    /figures have not moved|has not moved in/i.test(JSON.stringify(rec || {})),
    (rec?.evidence || []).join(' ').slice(0, 110));
  ok('the working tanker is still left alone',
    !(fo.retirements || []).some((r) => r.unit === 'TK-1'), 'TK-1 untouched');

  head('5. A recommendation for a box already got rid of by hand goes off the screen');
  // What was reported: sell it in ATS, strike it off here, and the button stays behind throwing.
  ok('the button is offered while the box is on the fleet',
    (fo.retirements || []).some((r) => r.unit === 'TK-2'), 'offered');
  await api('/fleet/trailer/TK-2', 'DELETE');
  const after = await api('/fleetops');
  ok('once it is gone the button goes with it',
    !(after.retirements || []).some((r) => r.unit === 'TK-2'),
    (after.retirements || []).map((r) => r.unit).join(', ') || 'none left');
  ok('and no watch note points at it either',
    !(after.watching || []).some((w) => w.unit === 'TK-2'), 'no note');
  ok('the filed report itself is untouched — that is what was recommended on the day',
    ((await api('/export')).fleetReports.find((r) => (r.retirements || [])
      .some((x) => x.unit === 'TK-2')) != null), 'history intact');

  head('6. Retiring something already off the fleet says so instead of throwing');
  const r = await api('/fleetops/retire', 'POST', { unit: 'TK-2', replacementUnit: '', soldFor: 0 });
  console.log(`  ..    ${r.message}`);
  ok('it does not error', true, 'no throw');
  ok('and it says the job is already done rather than calling it a mistake',
    /already off the fleet|nothing left to retire/i.test(r.message || ''), (r.message || '').slice(0, 100));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
