/* The run to the shipper that the listing did not mention.
 *
 *   "I think the issue here was I had to drive 40 miles to get the load from where I was (and recorded
 *    clocks) because there was nothing available at the dock I was at. Not sure how to handle that."
 *   "there was no way for the app to know this too"
 *
 * True of the exact distance. Not true of the fact that there IS one — the app knows the driver is not
 * at the shipper, knows which town the load starts in, and has coordinates for it.
 *
 * The plan took DeadheadMiles straight off the listing, and ATS very often quotes none. The driver's
 * clocks were read wherever they were standing when they read them, so planning zero is not neutral: it
 * is wrong in the same direction every single time, by exactly the run nobody counted. Eighteen hours
 * twenty-one of plan against nineteen hours eight of cycle, with forty miles missing from both figures,
 * is not a close call — it is a plan that was never measuring the whole trip.
 *
 * So it is estimated off the city coordinates, planned into the hours, and labelled as an estimate
 * everywhere it shows. Where the town is not in the table at all — a map mod — nothing is invented and
 * the driver is told the run is missing from the figures instead.
 *
 * Planning only. It does not touch the deadhead ratio or the scoring, because a load refused on a
 * distance the app made up is a refusal the app made up, and it does not touch what is booked — empty
 * miles come off the odometer at the shipper and always have.
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
const cons = (e) => (e?.cons || []).join(' | ');
const line = (e) => (e?.feasibility?.timeline || []).map((x) => x.label).join(' | ');

async function offer(o) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 40 });
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: 'Dry Van', destCity: 'Salt Lake City', destState: 'UT',
    loadedMiles: 380, deadheadMiles: 0, gameRevenue: 1000, deadlineHours: 48, weightLbs: 38000, ...o,
  });
  return (r.evaluations || [])[0];
}

(async () => {
  const app = { driverName: 'T. Nakagawa', preferredDivision: 'Dry Van', experienceYears: 9,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Receiver', gameTime: iso(4),
    fuelPct: 95, atsOdometer: 50000, truckDamagePct: 2, dutyStatus: 'OnDuty',
  });

  head('1. A load in the next town, with no deadhead quoted');
  // The reported shape: nothing at the dock, so the freight is up the road and the listing says nothing
  // about getting to it.
  const away = await offer({ originCity: 'Colorado Springs', originState: 'CO', atLocation: false });
  console.log(`  ..    ${line(away)}`);
  console.log(`  ..    ${(cons(away).match(/[^|]*no deadhead[^|]*/i) || ['(silent)'])[0].slice(0, 170)}`);
  ok('the run to the shipper is in the plan', /Deadhead \d+ mi/.test(line(away)), line(away).slice(0, 80));
  ok('and it is marked as an estimate on the timeline', /\(estimated\)/.test(line(away)),
    (line(away).match(/Deadhead[^|]*/) || [''])[0]);
  ok('the driver is told it is the app\'s figure, not the game\'s',
    /estimate off the city coordinates, not a figure from the game/i.test(cons(away)),
    (cons(away).match(/[^|]*city coordinates[^|]*/i) || ['(not said)'])[0].slice(0, 120));
  ok('and told the odometer still decides the pay',
    /odometer decides what actually gets paid/i.test(cons(away)), 'said');

  head('2. Which is the difference it was making to the clocks');
  // The point of the whole thing. Same load, same rate, one of them at the dock under the truck.
  const here = await offer({ originCity: 'Denver', originState: 'CO', atLocation: true });
  const awayDrive = away?.feasibility?.driveHours ?? 0;
  const hereDrive = here?.feasibility?.driveHours ?? 0;
  console.log(`  ..    at the dock ${hereDrive}h driving; up the road ${awayDrive}h`);
  ok('the run up the road plans more driving', awayDrive > hereDrive + 0.3,
    `${hereDrive}h vs ${awayDrive}h`);
  ok('and less cycle left at the end of it',
    away.feasibility.cycleRemainingAfter < here.feasibility.cycleRemainingAfter - 0.3,
    `${here.feasibility.cycleRemainingAfter}h vs ${away.feasibility.cycleRemainingAfter}h`);

  head('3. Sitting on the load, nothing is added and nothing is said');
  ok('no deadhead is invented for a load under the truck', !/Deadhead/.test(line(here)),
    line(here).slice(0, 70));
  ok('and it says so as the pro it always was',
    /already sitting at this shipper/i.test((here?.pros || []).join(' ')), 'said');
  ok('with no warning about a run that does not exist',
    !/no deadhead and you are not at the shipper/i.test(cons(here)), 'quiet');

  head('4. A quoted deadhead is still the quoted deadhead');
  // The app does not second-guess a number the game gave. Only the absence of one is filled in.
  const quoted = await offer({ originCity: 'Colorado Springs', originState: 'CO', atLocation: false,
                               deadheadMiles: 12 });
  console.log(`  ..    ${(line(quoted).match(/Deadhead[^|]*/) || [''])[0]}`);
  ok('the listing figure is used as given', /Deadhead 12 mi/.test(line(quoted)),
    (line(quoted).match(/Deadhead[^|]*/) || [''])[0]);
  ok('and is not labelled an estimate', !/Deadhead 12 mi \(estimated\)/.test(line(quoted)), 'not labelled');
  ok('nor is the unquoted warning raised', !/estimate off the city coordinates/i.test(cons(quoted)),
    'quiet');

  head('5. A town off the map is not guessed at');
  // Map mods. Where there are no coordinates the app says the run is missing rather than inventing a
  // distance — the one thing it is not allowed to do.
  const modded = await offer({ originCity: 'Zzyzx Junction', originState: 'CO', atLocation: false });
  console.log(`  ..    ${(cons(modded).match(/[^|]*coordinates for[^|]*/i) || ['(silent)'])[0].slice(0, 150)}`);
  const plannedMod = /Deadhead \d+ mi/.test(line(modded));
  ok('either it found coordinates, or it added nothing and said so',
    plannedMod || /not a town I have coordinates for/i.test(cons(modded)),
    plannedMod ? `planned ${(line(modded).match(/Deadhead[^|]*/) || [''])[0]}` : 'told the driver');
  if (!plannedMod)
    ok('telling the driver the clocks assume they are there',
      /assume you are already there/i.test(cons(modded)), 'said');

  head('6. A gap too big to be a deadhead is a stale position, and is treated as one');
  // The rail on the whole feature, and it was a real failure before it existed: an existing suite left
  // the driver in Wyoming, entered a load out of Iowa, and the estimate planned eleven hundred miles of
  // deadhead into the trip. Literally correct, practically nonsense — a player who enters a board for
  // the town they are standing in has simply not reported in since they moved. Inventing most of a day's
  // driving off a reading nobody updated is worse than inventing nothing.
  const miles_away = await offer({ originCity: 'Burlington', originState: 'IA', atLocation: false });
  console.log(`  ..    ${line(miles_away).slice(0, 90)}`);
  console.log(`  ..    ${(cons(miles_away).match(/[^|]*long way from[^|]*/i) || ['(silent)'])[0].slice(0, 150)}`);
  ok('no cross-country deadhead is planned', !/Deadhead/.test(line(miles_away)),
    (line(miles_away).match(/Deadhead[^|]*/) || ['none planned'])[0]);
  ok('it says the position looks stale instead',
    /long way from/i.test(cons(miles_away)),
    (cons(miles_away).match(/[^|]*long way from[^|]*/i) || ['(not said)'])[0].slice(0, 120));
  ok('and asks them to report in rather than guessing at it',
    /report in again/i.test(cons(miles_away)), 'said');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
