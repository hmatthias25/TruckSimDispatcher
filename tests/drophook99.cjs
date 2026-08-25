/* Issue #99 — drop and hook as a trailer type, open and dedicated.
 *
 * No trailer of your own: Freight Market jobs in ATS, the shipper's trailer, dropped at the other end.
 * No loading, no unloading, no trailer damage — the tractor is the only thing on the property that
 * belongs to the company.
 *
 * Modelled as a TRAILER TYPE on purpose. `trailer == null` is a hard dispatch blocker with eighteen call
 * sites behind it, so teaching all of them a second meaning of null would have been a minefield. As a
 * type it inherits assign, request and re-rig for free.
 *
 * Dedicated is the same thing tied to one ATS company. Harder to run, so it pays a premium and only the
 * top of the ladder is offered it — and the company has to be one the driver can actually reach, because
 * ATS makes no cargo for a city nobody has driven to.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5968}/api`;
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
const iso = (day, hm = '07:00') => `2000-01-${String(day).padStart(2, '0')}T${hm}`;

let S;
async function place(city, state, day, kind = 'Shipper') {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: kind, gameTime: iso(day),
    fuelPct: 90, atsOdometer: 9000 + day * 40, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
  return S;
}

const view = async () => (await api('/bootstrap')).views;

(async () => {
  const app = { driverName: 'D. Hook', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Omaha', homeState: 'NE', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'WER' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. Every carrier has the arrangement on its books');
  const snap = await api('/bootstrap');
  const slot = snap.trailers.find((t) => t.type === 'Drop & Hook');
  ok('the slot exists', !!slot, slot ? slot.unit : 'missing');
  ok('it is not equipment we own', slot.inGameGarage === false, `inGameGarage=${slot.inGameGarage}`);
  ok('and it says there is nothing to buy', /Nothing to buy/i.test(slot.notes || ''), 'noted');
  ok('it is homed at a yard like any other', !!slot.homeTerminalId, slot.homeTerminalId || 'none');

  head('2. It can be asked for like any other trailer');
  const types = (await view()).requests.trailerTypes || [];
  ok('it is on the requestable list', types.includes('Drop & Hook'), types.join(', '));

  head('3. Dedicated is gated on the ladder, and says why');
  let v = await view();
  ok('a company driver is told it is out of reach', !!v.dropHook.dedicatedBlocked,
    (v.dropHook.dedicatedBlocked || '').slice(0, 90));
  ok('and the reason given is the ladder, not the carrier',
    /top of the ladder/i.test(v.dropHook.dedicatedBlocked || ''), (v.dropHook.dedicatedBlocked || '').slice(0, 70));
  ok('worded as something to want rather than a missing button',
    /best seat/i.test(v.dropHook.dedicatedBlocked || ''), 'wording');
  let refused = null;
  try { await api('/career/dedicated/assign', 'POST', { company: 'Wallbert' }); } catch (x) { refused = x.message; }
  ok('and the endpoint refuses it too', refused !== null, (refused || '(allowed!)').slice(0, 70));

  head('4. At the top of the ladder it opens up');
  await place('Omaha', 'NE', 4);
  const ceiling = (await view()).career.ceilingRank;
  await api('/career/promote', 'POST', { rank: ceiling, force: true, note: 'fixture' });
  v = await view();
  ok('rank now allows it', v.dropHook.rankAllows === true, `${v.dropHook.rankAllows}`);

  const offers = await api('/career/dedicated/offers');
  ok('nothing is blocking it', !offers.blocked, offers.blocked || 'clear');
  ok('and there are accounts on offer', (offers.offers || []).length > 0, `${(offers.offers || []).length}`);
  ok('every one is reachable from a state the driver has driven',
    (offers.offers || []).every((f) => /\d+ of your states/.test(f.reach)),
    (offers.offers || [])[0]?.reach || '(none)');
  const names = (offers.offers || []).map((f) => f.name);
  console.log(`     on offer: ${names.join(', ')}`);

  head('5. The list is the real game, not a made-up one');
  let bad = null;
  try { await api('/career/dedicated/assign', 'POST', { company: 'Nowhere Freight Co' }); } catch (x) { bad = x.message; }
  ok('an invented company is refused', bad !== null, (bad || '(allowed!)').slice(0, 70));
  // Werner runs van, reefer, dedicated and intermodal — no flatbed, no bulk. Quarry and steel freight
  // does not move on any of that, so neither should be offered however big they are.
  ok('quarrying is not offered to a van and reefer carrier',
    !names.includes('Coastline Mining') && !names.includes('NAMIQ'), names.join(', ').slice(0, 90));
  ok('nor is a steel mill', !names.includes('Avalanche Steel') && !names.includes('Steeler'),
    names.join(', ').slice(0, 90));

  head('6. Taking one, with the renaming mod handled');
  const pick = names[0];
  let r = await api('/career/dedicated/assign', 'POST', {
    company: pick, asTheGameCallsIt: 'Megamart', renamesCompanies: 'yes',
  });
  ok('the account is filed under what the game shows',
    un(r).driver.dedicatedAccount === 'Megamart', un(r).driver.dedicatedAccount);
  ok('with the stock name kept beside it',
    un(r).driver.dedicatedVanillaName === pick, un(r).driver.dedicatedVanillaName);
  ok('and the message explains the two names', /unmodded it is/i.test(r.message), r.message.slice(-90));
  ok('the mod answer is remembered',
    (await api('/bootstrap')).settings.renamesCompanies === 'yes', 'yes');
  ok('an equipment order was raised to get them on it', !!r.order?.number, r.order?.number || 'none');
  ok('and it says to drop what they are pulling',
    /drop what you are pulling/i.test(r.message), r.message.slice(-100));

  head('7. Report to the yard and it is done');
  await place('Omaha', 'NE', 5, 'Terminal');
  await api(`/equipment/orders/${r.order.number}/complete`, 'POST', {});
  v = await view();
  ok('the driver is on drop and hook', v.dropHook.on === true, `on=${v.dropHook.on}`);
  ok('and it is the dedicated flavour', v.dropHook.dedicated === true, `${v.dropHook.dedicated}`);
  ok('the instruction names the Freight Market',
    /Freight Market/i.test(v.dropHook.instruction || ''), 'wording');
  ok('and says not to take a trailer',
    /not take a trailer/i.test(v.dropHook.instruction || ''), 'wording');
  ok('there is a premium on the loaded mile', v.dropHook.premiumCpm > 0, `$${v.dropHook.premiumCpm}`);

  head('8. There is no dock time to learn');
  const dock = ((await view()).facilityTimes || []).find((f) => f.trailerType === 'Drop & Hook');
  ok('it is not in the learned dock table at all', !dock,
    dock ? `${dock.unloadingHours}h off ${dock.samples}` : 'absent, as it should be');
  ok('because there is no dock — the hook time is the whole of it',
    (await api('/bootstrap')).settings.hookHours > 0,
    `hook ${(await api('/bootstrap')).settings.hookHours}h`);

  head('9. On the board: the trailer never blocks anything, but the divisions still do');
  await place('Omaha', 'NE', 6);
  await api('/board/clear', 'POST', {});
  const bd = await api('/board/add', 'POST', {
    cargo: 'Steel coils', trailerType: 'Flatbed',        // nothing like the dry van they came off
    originCity: 'Omaha', originState: 'NE', destCity: 'Kansas City', destState: 'MO',
    loadedMiles: 165, deadheadMiles: 0, gameRevenue: 1100, deadlineHours: 24, weightLbs: 40000,
    shipper: 'Megamart', receiver: 'Megamart',
  });
  const e = (bd.evaluations || [])[0];
  ok('nothing is refused for the trailer being wrong',
    !(e.hardFails || []).some((x) => /trailer/i.test(x)), (e.hardFails || []).join(' | ') || 'none');
  // Werner does not haul flatbed freight, and being on drop and hook does not change what the company
  // will accept — only what is on the back of the truck.
  ok('but the company still will not take freight it does not run',
    (e.hardFails || []).some((x) => /not a division this company operates/i.test(x)),
    (e.hardFails || []).join(' | ').slice(0, 80) || 'none');
  ok('the board says which ATS market these come off',
    (bd.dispatchNotes || []).some((x) => /Freight Market/i.test(x)),
    (bd.dispatchNotes || []).find((x) => /Freight Market/i.test(x))?.slice(0, 100) || '(none)');
  ok('and it names the account it is tied to',
    (bd.dispatchNotes || []).some((x) => /Megamart/i.test(x)), 'named');

  head('10. Asked-for equipment is an arrangement, not a posting');
  const arr = (await view()).trailerArrangement;
  ok('operations put them here, so it is not by request', arr.byRequest === false, `${arr.byRequest}`);
  r = await api('/career/trailer-arrangement/release', 'POST', {});
  ok('releasing when there is nothing to release says so',
    /already on whatever operations/i.test(r.message), r.message.slice(0, 80));

  head('11. Coming off the account leaves the arrangement');
  await api('/career/dedicated', 'POST', { onDedicated: false, account: '' });
  v = await view();
  ok('still on drop and hook', v.dropHook.on === true, `on=${v.dropHook.on}`);
  ok('but no longer dedicated', v.dropHook.dedicated === false, `${v.dropHook.dedicated}`);
  ok('and the instruction stops naming an account',
    !/Megamart/i.test(v.dropHook.instruction || ''), (v.dropHook.instruction || '').slice(-60));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
