/* Owner-Operator 0.91: an odometer that cannot be right is caught, not kept.
 *
 * Reported from play: 682,790 typed for 628,790 at a close-out, 54,288 mi on a 397 mi run, and Financial health thrown
 * with it. A reading no run could have put on, or no truck could have reached in the game time since the last, is now
 * refused where it is typed, so it can be put right. One that got through before is set to the run's own miles on load.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5994}/api`;
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

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'O. Dometer', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 628502, preset: 'Normal' });
  await api('/board/add-many', 'POST', [{ cargo: 'Cucumbers', destCity: 'Wichita', destState: 'KS', loadedMiles: 200, gameRevenue: 900, deadlineHours: 30 }]);
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere);
  let r = await api('/calls', 'POST', { brokerId: starter.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  const number = r.snapshot.booking.number;

  head('1. Loaded: a reading past anything the run to the shipper could do');
  await api('/run/at-shipper', 'POST', { day: 3, time: '06:30' });
  let why = await refused(() => api('/run/loaded', 'POST', { day: 3, time: '06:50', odometer: 682502 }));
  ok('refused, with the reason', /682,502/.test(why) && /digit typed wrong/.test(why), why);
  r = await api('/run/loaded', 'POST', { day: 3, time: '06:50', odometer: 628503 });
  ok('the right one goes in', r.snapshot.trip.loadedReported === true);

  head('2. The close-out: the reported typo');
  why = await refused(() => api('/deliver', 'POST', { day: 3, time: '11:00', odometer: 682703, drive: 7, shift: 9, break: 4, cycle: 60 }));
  ok('refused, so it can be put right', /54,200 mi since/.test(why) && /200 mi run/.test(why), why);
  S = await api('/bootstrap');
  ok('and nothing moved: still on the load', S.booking && S.booking.number === number && S.trip && S.trip.status !== 'Delivered', S.trip && S.trip.status);
  why = await refused(() => api('/deliver', 'POST', { day: 3, time: '11:00', odometer: 628400, drive: 7, shift: 9, break: 4, cycle: 60 }));
  ok('lower than where it started: refused too', /lower than/.test(why), why);
  r = await api('/deliver', 'POST', { day: 3, time: '11:00', odometer: 628703, drive: 7, shift: 9, break: 4, cycle: 60 });
  ok('the right one closes it out', r.snapshot.bookings.find((k) => k.number === number).status === 'Delivered');

  head('3. Where you are, and fuel: no truck drives that far that fast');
  why = await refused(() => api('/status', 'POST', { day: 3, time: '12:00', odometer: 682800 }));
  ok('a status reading refused', /682,800/.test(why) && /game time/.test(why), why);
  why = await refused(() => api('/fuel', 'POST', { day: 3, time: '12:00', gallons: 50, pricePerGal: 4, odometer: 682800 }));
  ok('a fill\'s reading refused', /682,800/.test(why), why);
  S = await api('/status', 'POST', { day: 3, time: '18:00', odometer: 629050 });
  ok('a real day\'s driving goes in', S.status.odometer === 629050, String(S.status.odometer));

  head('4. One that got through before: set to the run\'s own miles');
  r = await api('/test/odometer', 'POST', { number, endOdometer: 682703 });
  ok('repaired', r.repaired === true && r.endOdometer === 628503 + 200, `${r.endOdometer}`);
  ok('and Financial health counts the run, not 54,000 mi', r.snapshot.finance.weeks[0].miles < 1000, String(r.snapshot.finance.weeks[0].miles));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
