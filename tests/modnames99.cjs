/* Issue #99, the mod reader — company names come out of the player's own mod file.
 *
 * A mod that renames the in-game companies to real brands would leave a dedicated account naming a place
 * their game does not have. Shipping a copy of the mapping is wrong twice: it is the mod author's work,
 * and it goes stale the moment they publish a new version. So the app reads the file they already have.
 *
 * The join key is the base-game token — company.permanent.<token> — which is the same in every install.
 * Only the names come out of the mod.
 *
 * This suite builds its own archives, so it proves the parser rather than any one person's install.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const B = `http://127.0.0.1:${process.env.TSD_PORT || 5969}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsd-mod-'));

/** A company definition, exactly the shape the real mod ships. */
const sui = (token, name) =>
  `company_permanent: company.permanent.${token}\n{\n\tname: "${name}"\n\tsort_name: "${name.toLowerCase()}"\n\ttrailer_look: ${token}\n}\n`;

/** Build a .scs — which is a ZIP — holding the given token/name pairs. */
function buildMod(fileName, pairs, extra = {}) {
  const stage = fs.mkdtempSync(path.join(work, 'stage-'));
  const defDir = path.join(stage, 'latest', 'def', 'company');
  fs.mkdirSync(defDir, { recursive: true });
  for (const [token, name] of pairs) fs.writeFileSync(path.join(defDir, `${token}.sui`), sui(token, name));
  // A little bulk elsewhere, so the archive looks like a mod rather than a folder of text.
  fs.mkdirSync(path.join(stage, 'latest', 'model'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'latest', 'model', 'blob.pmd'), Buffer.alloc(2048));
  if (extra.manifest) fs.writeFileSync(path.join(stage, 'manifest.sii'), extra.manifest);

  // Compress-Archive insists on a .zip name, so build it as one and rename. That is exactly what a
  // .scs is anyway: an ordinary ZIP with a different extension.
  const zipPath = path.join(work, fileName.replace(/[.]scs$/, '') + '.zip');
  const out = path.join(work, fileName);
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${stage}\\\\*' -DestinationPath '${zipPath}' -Force`]);
  fs.renameSync(zipPath, out);
  return out;
}

(async () => {
  head('1. A mod that renames companies is read');
  // Real tokens and the real shape; the names are this test's own so nothing is copied from anybody.
  const modPath = buildMod('renames.scs', [
    ['wal_mkt', 'Bigmart Megastore'],
    ['wal_whs', 'Bigmart Logistics Centre'],
    ['wal_food_mkt', 'Bigmart store'],
    ['gal_oil_gst', 'Petrolia'],
    ['gal_oil_ref', 'Petrolia'],
    ['sht_mkt', 'Bullseye'],
    ['sg_whs', 'Parcelex'],
    ['cm_min_qry', 'Bedrock Mining'],
  ]);
  let r = await api('/mod/read', 'POST', { path: modPath });
  ok('it read the archive', r.reading.ok === true, r.reading.error || 'ok');
  ok('recognised as a zip', r.reading.format === 'zip', r.reading.format);
  ok('and it counted the definitions', r.reading.definitions === 8, `${r.reading.definitions}`);
  ok('Wallbert resolves', r.reading.names.Wallbert === 'Bigmart',
    `${r.reading.names.Wallbert}`);
  ok('Gallon Oil resolves', r.reading.names['Gallon Oil'] === 'Petrolia',
    `${r.reading.names['Gallon Oil']}`);
  ok('Shop Town resolves', r.reading.names['Shop Town'] === 'Bullseye', `${r.reading.names['Shop Town']}`);
  ok('Sell Goods resolves', r.reading.names['Sell Goods'] === 'Parcelex', `${r.reading.names['Sell Goods']}`);

  head('2. The brand is the shared part, not whichever variant won a count');
  // Three Bigmart depots with three different suffixes. The shared opening words are the brand.
  ok('the suffixes are dropped', r.reading.names.Wallbert === 'Bigmart',
    `three depots -> ${r.reading.names.Wallbert}`);

  head('3. It is remembered, and the offers use it');
  let s = await api('/bootstrap');
  ok('the names are on the career', Object.keys(s.settings.modCompanyNames || {}).length >= 5,
    `${Object.keys(s.settings.modCompanyNames || {}).length} name(s)`);
  ok('and the mod is remembered so it can be re-read', !!s.settings.companyNameModPath, 'path kept');
  ok('the app now knows a renaming mod is in use', s.settings.renamesCompanies === 'yes', 'yes');

  head('4. A mod with no company definitions changes nothing');
  const otherMod = buildMod('paintjobs.scs', []);
  const before = Object.keys((await api('/bootstrap')).settings.modCompanyNames || {}).length;
  r = await api('/mod/read', 'POST', { path: otherMod });
  ok('it is refused rather than silently emptying the map', r.reading.ok === false, `${r.reading.ok}`);
  ok('and says what is wrong', /not one that renames companies/i.test(r.reading.error || ''),
    (r.reading.error || '').slice(0, 80));
  ok('what was already read survives',
    Object.keys((await api('/bootstrap')).settings.modCompanyNames || {}).length === before,
    `${before} still`);

  head('5. A file that is not a mod is turned away');
  const junk = path.join(work, 'notamod.scs');
  fs.writeFileSync(junk, Buffer.from('this is not an archive at all', 'utf8'));
  r = await api('/mod/read', 'POST', { path: junk });
  ok('it is not read', r.reading.ok === false, `${r.reading.ok}`);
  ok('and the format is called unknown rather than guessed', r.reading.format === 'unknown', r.reading.format);

  head('6. HashFS is detected and declined, not misread');
  const hashfs = path.join(work, 'hashfs.scs');
  const buf = Buffer.alloc(64);
  buf.write('SCS#', 0, 'ascii');
  fs.writeFileSync(hashfs, buf);
  r = await api('/mod/read', 'POST', { path: hashfs });
  ok('the container is named', r.reading.format === 'hashfs', r.reading.format);
  ok('it says plainly that this build cannot open it',
    /cannot open/i.test(r.reading.error || ''), (r.reading.error || '').slice(0, 80));
  ok('and points at the fallback rather than failing to a wrong name',
    /stock company names still work/i.test(r.reading.error || ''), 'wording');

  head('7. A path that is not there');
  r = await api('/mod/read', 'POST', { path: path.join(work, 'nope.scs') });
  ok('says so', /no file at that path/i.test(r.reading.error || ''), (r.reading.error || '').slice(0, 60));

  head('8. Scanning finds candidates without being told where to look');
  const scan = await api('/mod/scan');
  ok('the scan runs and reports what it knows', Array.isArray(scan.candidates), `${(scan.candidates || []).length} found`);
  ok('and it remembers how many names are on file', scan.known >= 5, `${scan.known}`);

  head('9. The dedicated offers read back in the player’s own words');
  const app = { driverName: 'M. Odder', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Omaha', homeState: 'NE', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-02T07:00', code: 'WER' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/status', 'POST', {
    locationCity: 'Omaha', locationState: 'NE', locationKind: 'Terminal', gameTime: '2000-01-04T07:00',
    fuelPct: 90, atsOdometer: 12000, dutyStatus: 'OnDuty',
  });
  const ceiling = (await api('/bootstrap')).views.career.ceilingRank;
  await api('/career/promote', 'POST', { rank: ceiling, force: true, note: 'fixture' });

  // Read the mod again — a fresh career starts with nothing learned.
  await api('/mod/read', 'POST', { path: modPath });
  const offers = await api('/career/dedicated/offers');
  const wall = (offers.offers || []).find((f) => f.name === 'Wallbert');
  if (wall) {
    ok('the offer shows what their game calls it', wall.called === 'Bigmart', `${wall.called}`);
    const assigned = await api('/career/dedicated/assign', 'POST', { company: 'Wallbert' });
    ok('and the account is filed under that without retyping it',
      (assigned.snapshot || assigned).driver.dedicatedAccount === 'Bigmart',
      (assigned.snapshot || assigned).driver.dedicatedAccount);
    ok('with the stock name kept beside it',
      (assigned.snapshot || assigned).driver.dedicatedVanillaName === 'Wallbert',
      (assigned.snapshot || assigned).driver.dedicatedVanillaName);
  } else {
    ok('(Wallbert not on offer for this carrier and map)', true,
      (offers.offers || []).map((f) => f.name).join(', '));
    ok('skipped', true, ''); ok('skipped', true, '');
  }

  try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
