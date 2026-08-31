/* Issue #144 — reading a city board took five to ten minutes.
 *
 * Twelve screenshots is a normal city board. It ran as four calls at BatchSize 3, each awaiting the one
 * before, with extended thinking on a task the app's own prompt describes as transcription.
 *
 * These are SOURCE assertions, not behavioural ones, and that is deliberate: exercising the real path
 * needs a live Anthropic key and the driver's key is theirs, not the suite's. What can be checked
 * without spending anybody's money is that the shape which caused this cannot come back — a serial
 * await in the batch loop, or a thinking budget on a transcription call.
 */
const fs = require('fs');
const path = require('path');

const B = `http://127.0.0.1:${process.env.TSD_PORT || 5860}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

const SRC = fs.readFileSync(path.join(__dirname, '..', 'Services', 'AiService.cs'), 'utf8');

/**
 * The body of one method, so an assertion cannot accidentally read a different one.
 *
 * Matched on the DECLARATION, not the name: `ExtractBatchAsync` appears first at its call site inside
 * ExtractLoadsAsync, so searching for the bare name reads the caller's body instead of the callee's.
 */
function method(name) {
  const decl = new RegExp(`(?:private|public|internal)[^\\n]*\\b${name}\\s*\\(`);
  const m = decl.exec(SRC);
  const at = m ? m.index : -1;
  if (at < 0) return '';
  const from = SRC.indexOf('{', at);
  let depth = 0;
  for (let i = from; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(from, i + 1);
  }
  return '';
}

(async () => {
  head('1. #144 The board reads run at the same time');
  const loads = method('ExtractLoadsAsync');
  ok('the batch loop is not a serial await', !/foreach\s*\([^)]*batches\s*\)\s*\{[\s\S]{0,400}?await ExtractBatchAsync/.test(loads),
    'no foreach-await');
  ok('they are awaited together', /Task\.WhenAll/.test(loads), 'WhenAll');
  ok('with a cap on how many are in flight', /SemaphoreSlim\(MaxConcurrentReads\)/.test(loads), 'gated');
  ok('the cap is a sane number', /MaxConcurrentReads = ([2-9]|1[0-2]);/.test(SRC),
    (SRC.match(/MaxConcurrentReads = \d+/) || [])[0] || '(not found)');

  head('2. #144 Rows still come back in screenshot order');
  // The one real risk in going parallel: reads finish in whatever order they finish, and the rows have
  // to merge in the order the driver pasted them.
  ok('results are collected by index', /results\[idx\] = await ExtractBatchAsync/.test(loads), 'indexed');
  ok('and merged in order afterwards', /foreach \(var part in results\)/.test(loads), 'ordered merge');
  ok('the screenshot number is derived from the index, not a running counter',
    /idx \* BatchSize/.test(loads) && !/offset \+= batch\.Count/.test(loads), 'idx-derived');

  head('3. #144 The lazy-task trap is closed');
  // A Select with an async lambda is a lazy sequence: enumerating it twice fires every request twice.
  ok('the task sequence is materialised', /\}\)\.ToList\(\);\s*\n\s*await Task\.WhenAll/.test(loads),
    'ToList before WhenAll');

  head('4. #144 No thinking budget on a transcription call');
  const batch = method('ExtractBatchAsync');
  ok('the board read has no thinking config', !/Thinking\s*=/.test(batch), 'none');
  ok('but it still reads carefully', /Effort\.High/.test(batch), 'Effort.High kept');
  ok('one screenshot per call', /BatchSize = 1;/.test(SRC),
    (SRC.match(/BatchSize = \d+/) || [])[0] || '(not found)');

  head('5. #144 Nothing here needs a key to fail politely');
  // Answered as a 200 carrying ok:false rather than an HTTP error — the import surface reports its own
  // outcome so a partial read can still hand back the rows it got.
  let r = null, msg = '';
  try { r = await api('/board/extract', 'POST', { images: [] }); }
  catch (e) { msg = e.message; }
  ok('an empty request is refused without calling anything',
    (r && r.ok === false) || !!msg, r ? r.error?.slice(0, 80) : msg.slice(0, 80));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
