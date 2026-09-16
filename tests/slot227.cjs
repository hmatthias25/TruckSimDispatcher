/* #227 — arriving early quoted the window opening as if it were the appointment.
 *
 * Reported from play: "I had an appointment for 22:00. Got there really early (could sleep if needed on
 * property) at 13:00 and said I had arrived. It then said something about keeping my 18:03 window,
 * totally ignoring that I had an appointment. Was confused so slept and kept the 22:00 appointment."
 *
 * Two separate faults, both in the booked half of ReceiverCall.
 *
 *   1. Every branch did its arithmetic against the SLOT and then printed AppointmentOpensGameTime — the
 *      window opening — beside it. On a load where the two differ that is simply the wrong time, and the
 *      on-time branch handed the opening back as WorkStartsGameTime as well: nine hours of waiting filed
 *      against a start four hours too early. The driver read it as the app having lost the appointment.
 *
 *   2. "They have a door free — taking you early" could fire at 13:00 against a receiver that does not
 *      open until 18:03. Assess already says in its own comment that the window opening outranks any slot
 *      inside it, but the guard only ran when there was no slot at all.
 *
 * The invariants this suite holds the dock to, whichever way the roll goes:
 *   - work never starts before the receiver opens
 *   - the wait quoted is the wait to the start it just named
 *   - the word "slot" is only ever next to the appointment
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5946}/api`;
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

const iso = (day, hm) => `2000-01-${String(day).padStart(2, '0')}T${hm}`;
const gap = (a, b) => (new Date(b + ':00Z') - new Date(a + ':00Z')) / 3600000;

// The reported numbers, to the minute. The gap between them is the whole point: an opening at 18:03 and
// a door held at 22:00 are four hours apart, so any line that confuses the two says so out loud.
const DAY = 12;
const OPENS = iso(DAY, '18:03');
const SLOT = iso(DAY, '22:00');

let S;

(async () => {
  const app = { driverName: 'D. Keane', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2, '06:00') }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: iso(DAY, '06:00'),
    fuelPct: 90, atsOdometer: 5000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 60000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });

  await api('/board/clear', 'POST', {});
  const added = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Denver', originState: 'CO', destCity: 'Aurora', destState: 'CO',
    loadedMiles: 22, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 20,
    weightLbs: 24000, appointmentOpensHours: 12,
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: added.evaluations[0].load.id, overrideTight: true });
  const id = auth.trip.id;
  ok('a load is on the truck', !!id, auth.trip.number);

  // The engine books the slot somewhere inside the window, which is right but seeded. Pin both ends to
  // the reported case so the four-hour gap is the same every run.
  const state = await api('/export');
  const stored = state.trips.find((t) => t.id === id);
  stored.appointmentOpensGameTime = OPENS;
  stored.appointmentGameTime = SLOT;
  await api('/import', 'POST', state);
  const back = (await api('/bootstrap')).trips.find((t) => t.id === id);
  ok('with the reported window and slot on it',
    back.appointmentOpensGameTime === OPENS && back.appointmentGameTime === SLOT,
    `opens ${back.appointmentOpensGameTime} · slot ${back.appointmentGameTime}`);

  /** Report an arrival and hand back the call plus everything it said, as one string. */
  async function arrive(hm) {
    const r = await api(`/trips/${id}/arrived`, 'POST', { gameTime: iso(DAY, hm) });
    const c = r.call;
    return { ...c, said: `${c.headline} ${c.instruction}` };
  }

  /** The three things that have to be true of any answer, wherever the roll lands. */
  function holds(label, at, c) {
    const started = c.workStartsGameTime;
    ok(`${label}: not started before they open`, gap(OPENS, started) >= -0.001,
      `${c.kind} · start ${started}`);
    ok(`${label}: the wait quoted is the wait to that start`,
      Math.abs((c.waitHours || 0) - Math.max(0, gap(at, started))) < 0.02,
      `${(c.waitHours || 0).toFixed(2)}h vs ${Math.max(0, gap(at, started)).toFixed(2)}h`);
    ok(`${label}: "slot" only ever means the appointment`,
      !/slot/i.test(c.said) || (/22:00/.test(c.said) && !/18:03\s*slot/i.test(c.said)),
      c.said.slice(0, 120));
  }

  head('1. The reported arrival — 13:00, nine hours before the 22:00');
  const c13 = await arrive('13:00');
  console.log(`  ..    ${c13.kind}: ${c13.headline}`);
  console.log(`  ..    ${c13.instruction}`);
  ok('the appointment is named, not the window opening', /22:00/.test(c13.said), c13.said.slice(0, 100));
  ok('nothing is called an 18:03 slot', !/18:03\s*slot/i.test(c13.said), 'wording');
  ok('and the driver is not sent to a door before the doors open',
    gap(OPENS, c13.workStartsGameTime) >= -0.001, c13.workStartsGameTime);
  holds('13:00', iso(DAY, '13:00'), c13);

  head('2. Every hour before the window, whichever way the roll goes');
  // The roll is seeded on the arrival hour, so walking the morning walks the branches.
  const kinds = {};
  for (const hm of ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
                    '14:00', '15:00', '16:00', '17:00', '18:00']) {
    const c = await arrive(hm);
    kinds[c.kind] = (kinds[c.kind] || 0) + 1;
    holds(hm, iso(DAY, hm), c);
  }
  console.log(`  ..    rolled ${Object.entries(kinds).map(([k, n]) => `${k}x${n}`).join(' ')}`);
  ok('the sweep actually exercised more than one branch', Object.keys(kinds).length > 1,
    Object.keys(kinds).join(', '));

  head('3. Inside the window but ahead of the slot');
  for (const hm of ['19:00', '20:00', '21:00']) {
    const c = await arrive(hm);
    ok(`${hm}: still never started before arrival`, gap(iso(DAY, hm), c.workStartsGameTime) >= -0.001,
      `${c.kind} · start ${c.workStartsGameTime}`);
    holds(hm, iso(DAY, hm), c);
  }

  head('4. Past the slot is measured against the slot');
  // Most rolls wave a late truck straight in and say nothing, which is correct and asserts nothing. The
  // roll is seeded on the career as well as the hour, so a fixed pair of arrivals is a coin toss across
  // runs — walk the night out until one of them actually holds the door.
  let held = null;
  const nights = ['22:30', '23:00', '23:30'].map((hm) => iso(DAY, hm))
    .concat(['00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00']
      .map((hm) => iso(DAY + 1, hm)));
  for (const at of nights) {
    const r = await api(`/trips/${id}/arrived`, 'POST', { gameTime: at });
    const c = { ...r.call, said: `${r.call.headline} ${r.call.instruction}` };
    ok(`${at.slice(-5)}: never told it missed an 18:03`, !/18:03/.test(c.said),
      `${c.kind} · ${c.said.slice(0, 80)}`);
    if (/booked for/.test(c.said)) held = c;
  }
  ok('a held-out late arrival names the 22:00 it was booked for',
    !!held && /22:00/.test(held.said), held ? held.instruction.slice(0, 110) : 'never rolled a wait');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
