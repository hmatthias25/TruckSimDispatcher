/* The Fleet tab, split in two.
 *
 * It had grown three unrelated jobs on one page: a glance at your own kit, the fortnightly hired-driver
 * report, and the company's asset book. Those run on completely different clocks — daily, fortnightly,
 * and perhaps five times in a career — and interleaving them put the fortnightly job below the
 * once-a-career one. Adding a unit was scattered across four panels on two halves of a very long page.
 *
 * Behaviour that needs a browser cannot be exercised here, so this is source assertions on what the
 * served app.js is: the tab exists and is reachable, each half holds what belongs to it, and the pieces
 * that used to be duplicated or dead are not.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5864}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

/** The body of one top-level view function, so each half can be checked for what it should NOT hold. */
function body(js, name) {
  const start = js.indexOf(`function ${name}() {`);
  if (start < 0) return '';
  const next = js.slice(start + 10).search(/\nfunction [A-Za-z]/);
  return next < 0 ? js.slice(start) : js.slice(start, start + 10 + next);
}

(async () => {
  const js = await (await fetch(B.replace('/api', '') + '/app.js')).text();
  const css = await (await fetch(B.replace('/api', '') + '/styles.css')).text();
  const fleet = body(js, 'viewFleet');
  const equip = body(js, 'viewEquipment');

  head('1. There is an Equipment tab and it is reachable');
  ok('it is in the tab bar', /\['equipment', 'Equipment'\]/.test(js), 'listed');
  ok('and wired to a view', /equipment: viewEquipment/.test(js), 'mapped');
  ok('the view exists', equip.length > 0, `${equip.length} chars`);

  head('2. The asset book moved to it, whole');
  ok('yards', /\$\{terminalsHtml\(\)\}/.test(equip), 'terminals');
  ok('tractors, with the add button', /Tractors \(\$\{S\.trucks\.length\}\)/.test(equip)
    && /data-act="add-truck"/.test(equip), 'tractors');
  ok('trailers, with the add button', /Trailers \(\$\{S\.trailers\.length\}\)/.test(equip)
    && /data-act="add-trailer"/.test(equip), 'trailers');
  ok('and where each unit sits', /\$\{equipmentByYardHtml\(\)\}/.test(equip), 'by garage');

  head('3. And left the Fleet tab, rather than being copied');
  // A panel rendered on both tabs would put two "Add tractor" buttons in the app and duplicate every
  // element id on whichever page held both.
  ok('no tractors table on Fleet', !/Tractors \(\$\{S\.trucks\.length\}\)/.test(fleet), 'gone');
  ok('no trailers table on Fleet', !/Trailers \(\$\{S\.trailers\.length\}\)/.test(fleet), 'gone');
  ok('no yards on Fleet', !/\$\{terminalsHtml\(\)\}/.test(fleet), 'gone');
  ok('no by-garage view on Fleet', !/\$\{equipmentByYardHtml\(\)\}/.test(fleet), 'gone');

  head('4. Fleet keeps the fortnightly loop, and your own assignment');
  ok('your assignment stays', /<h2>Your assignment<\/h2>/.test(fleet), 'kept');
  ok('the hired fleet is still there', /\$\{fleetOpsHtml\(\)\}/.test(fleet), 'kept');
  ok('and it is a fraction of what it was', fleet.length < equip.length * 1.2,
    `fleet ${fleet.length} vs equipment ${equip.length} chars`);

  head('5. The report comes before what the yard is spending');
  // Decisions from the last report, then the roster and the form. Servicing and trade-outs are what the
  // company did about it, and they read as consequences rather than as the reason the tab is open.
  const ops = body(js, 'fleetOpsHtml');
  const decisions = ops.indexOf('fleetDecisionsHtml()');
  const roster = ops.indexOf('<h2>Hired drivers</h2>');
  const pm = ops.indexOf('fleetPmHtml()');
  ok('decisions first', decisions > 0 && decisions < roster, `${decisions} < ${roster}`);
  ok('then the roster and the form', roster > 0 && roster < pm, `${roster} < ${pm}`);
  ok('scheduled maintenance after', pm > roster, `${pm}`);

  head('6. A report coming due is told, not hunted for');
  ok('the Fleet tab carries a pip', /fleet: v\.fleetOps\?\.due\?\.isDue/.test(js), 'pip wired');

  head('7. "Open a yard here" goes somewhere');
  // It pointed at data-tab="terminals", which is not in the view map, so it silently fell through to
  // Dispatch — a button that took you to the wrong tab and said nothing.
  ok('no dead terminals tab target', !/data-tab="terminals"/.test(js), 'gone');
  ok('it points at Equipment', /data-act="tab" data-tab="equipment">Open a yard here/.test(js), 'wired');
  const tabs = [...js.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
  const known = [...js.matchAll(/\['([a-z]+)', '[^']+'\]/g)].map((m) => m[1]);
  const dead = [...new Set(tabs)].filter((t) => !known.includes(t));
  ok('and no other button points at a tab that does not exist', dead.length === 0,
    dead.join(', ') || 'all resolve');

  head('8. Standing explanation is collapsed, not deleted');
  ok('the equipment essays are behind a disclosure',
    /<details class="explainer">/.test(equip), 'collapsed');
  ok('the report form hints too', /<details class="explainer">/.test(ops), 'collapsed');
  ok('and the text is still there', /Affording all this in ATS/.test(equip), 'kept');
  ok('the disclosure is styled', /details\.explainer/.test(css), 'css present');

  head('9. Driver preferences are not equipment');
  // Home terminal, trip length and the home-time arrangement lived inside the Terminals panel because
  // that is where the yard list happened to be. Splitting the asset book onto its own tab left them
  // sitting next to tractor capacity, which is where the mismatch showed.
  const yards = body(js, 'terminalsHtml');
  const prefs = body(js, 'domicilePrefsHtml');
  const career = body(js, 'viewCareer');
  ok('the yards panel is only yards', !/<h3 class="sect">Home terminal<\/h3>/.test(yards), 'clean');
  ok('no trip-length preference on it', !/What you want to be running/.test(yards), 'clean');
  ok('no home-time arrangement on it', !/Home-time arrangement/.test(yards), 'clean');
  ok('they moved to their own panel', /<h3 class="sect">Home terminal<\/h3>/.test(prefs)
    && /What you want to be running/.test(prefs) && /Home-time arrangement/.test(prefs), 'all three');
  ok('mounted on Career, with the other asks',
    /\$\{domicilePrefsHtml\(\)\}/.test(career), 'mounted');

  head('10. And the move took their declarations with them');
  // `last` would have thrown; `open` would have silently resolved to window.open and rendered wrong,
  // which is the worse of the two and the reason it is not called that any more.
  ok('the preferences panel declares what it reads',
    /const pendingMoves =/.test(prefs) && /const last =/.test(prefs), 'declared');
  ok('the yards panel no longer declares what it does not use',
    !/const pendingMoves =/.test(yards) && !/const last =/.test(yards), 'clean');
  // Scoped to the panel that moved: `const open =` appears six other times in app.js, all of them
  // fine. What must not come back is THIS function using a name that shadows window.open, because
  // that is what turned a lost declaration into wrong output instead of a thrown error.
  ok('the preferences panel does not shadow window.open',
    !/\bconst open\b/.test(prefs), 'no shadowing');

  head('11. The view Equipment reads is actually served');
  const v = (await api('/bootstrap')).views;
  ok('the backdrop view is on the snapshot', v.backdrop !== undefined && v.backdrop !== null,
    JSON.stringify(v.backdrop || null));
  ok('and it carries the counts the warning quotes',
    ['any', 'trucks', 'trailers', 'yards'].every((k) => k in v.backdrop),
    Object.keys(v.backdrop || {}).join(', '));

  head('12. #159/#160 What to buy, and where the button for it is');
  // Splitting the asset book out left 30 instructions pointing at the Fleet tab for controls that had
  // moved to Equipment. An app that tells you where to go and is wrong about it is worse than one that
  // says nothing, because you go there and conclude the feature is missing.
  const rec = (await api('/fleetops')).recommendedTruck || '';
  ok('there is a recommendation to check', rec.length > 0, rec.slice(0, 60));
  ok('it sends you to the tab the button is actually on', /Equipment tab/.test(rec), rec.slice(-70));
  ok('and not to the one it moved off', !/Fleet tab/.test(rec), 'no stale pointer');

  // #159: a carrier replacing a unit it just condemned does not buy somebody else's worn-out one.
  // Word-split, not a boundary escape: a backslash-b written through a generator becomes a
  // backspace character and the assertion then passes on everything forever. It has happened
  // here before, more than once.
  ok('the replacement is specified as new',
    rec.split(/[^A-Za-z]+/).includes('NEW'), rec.slice(0, 70));
  ok('and it says why, so a cheap used one on the lot is not tempting',
    /not used|second-hand/i.test(rec), rec.slice(0, 150));
  ok('the old "or-newer" wording is gone', !/or-newer/i.test(rec), 'no used invitation');


  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
