/* TruckSim Coach Driver: the duty tablet. Plain script, no build step, like the other two apps. */
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => (n < 0 ? '-€' : '€') + Math.abs(Number(n || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (h) => { if (h == null) return '--'; const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${pad2(m % 60)}`; };
const badge = (kind, text) => `<span class="badge ${kind}">${esc(text)}</span>`;

/* ---- the game clock: an ISO stamp from a fixed epoch, shown as a day number, weekday and 24-hour time. Day 1 is a Monday. */
const EPOCH = Date.UTC(2000, 0, 1);
const DAY_MS = 86400000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ms = (iso) => Date.parse(iso + (/(Z|[+-]\d\d:\d\d)$/.test(iso) ? '' : ':00Z'));
const dayOf = (iso) => (iso ? Math.floor((ms(iso) - EPOCH) / DAY_MS) + 1 : 1);
const todOf = (iso) => (iso ? iso.slice(11, 16) : '');
const dow = (day) => DOW[((day % 7) + 7) % 7];
const gt = (iso) => (iso ? `${dow(dayOf(iso))} · Day ${dayOf(iso)} · ${todOf(iso)}` : '—');
const minsBetween = (a, b) => (a && b ? Math.round((ms(b) - ms(a)) / 60000) : null);
const plusMin = (iso, m) => new Date(ms(iso) + m * 60000).toISOString().slice(0, 16);

let S = null;
let TAB = 'today';
let CHOSEN = { company: '', depot: '' };
let ROUTE_FILTER = { text: '', kind: '', city: '' };
let OPEN_LINE = '';
let STAGED = [];

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(j?.error || t.slice(0, 200));
  return j;
}
function toast(text, bad = false) {
  const el = $('toast');
  el.textContent = text;
  el.className = 'toast' + (bad ? ' bad' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add('hidden'), bad ? 9000 : 6000);
}
/** Run an action, take the snapshot it returns, say what it said, draw again. */
async function act(fn) {
  try {
    const r = await fn();
    if (r && r.snapshot) S = r.snapshot; else if (r && r.version) S = r;
    if (r && r.said) toast(r.said);
    render();
    return r;
  } catch (e) { toast(e.message, true); return null; }
}
function modal(html) { $('modal-box').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); }
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });

/** A day and time pair of inputs, filled in with a moment. */
function when(p, iso, label = 'When') {
  return `<label>${esc(label)}<span style="display:flex;gap:6px">
    <input id="${p}-day" type="number" min="1" style="flex:0 0 86px" value="${dayOf(iso || S.gameTime)}" title="Game day">
    <input id="${p}-tod" style="flex:1" value="${esc(todOf(iso || S.gameTime))}" placeholder="14:30" title="24-hour time"></span></label>`;
}
const whenOf = (p) => ({ day: parseInt($(`${p}-day`).value, 10), time: ($(`${p}-tod`).value || '').trim() });
const num = (id) => { const v = $(id)?.value; return v === '' || v == null ? null : Number(v); };

/* ============================================================ start */

const SKILLS = [['longerDuties', 'Longer Duties'], ['demandingTimetables', 'Demanding Timetables'], ['premiumService', 'Premium Service'],
  ['cushionedJourney', 'Cushioned Journey'], ['passengerFavourite', 'Passenger Favourite'], ['ecoDriving', 'EcoDriving']];
const KIND = { Line: 'Lines', Tour: 'Tours', Mixed: 'Lines and tours' };
const TIER = { 1: 'Budget', 2: 'Mainstream', 3: 'Premium' };

function renderStart() {
  $('start').classList.remove('hidden');
  $('app').classList.add('hidden');
  if (!$('st-skills').innerHTML)
    $('st-skills').innerHTML = SKILLS.map(([k, n]) => `<label>${n}<input id="sk-${k}" type="number" min="0" max="6" value="0"></label>`).join('');
  $('st-companies').innerHTML = S.companies.map((c) => {
    const no = c.whyNot.length > 0;
    const sel = CHOSEN.company === c.id;
    return `<div class="company ${sel ? 'sel' : ''} ${no ? 'no' : ''}" data-co="${c.id}">
      <h4>${esc(c.name)}</h4>
      <div>${badge(c.tier === 3 ? 'teal' : c.tier === 2 ? 'info' : '', TIER[c.tier])} ${badge('', KIND[c.kind])} <span class="muted">from ${eur(c.rate)}/h</span></div>
      <p class="hint">${esc(c.about)}</p>
      ${no ? `<div class="why">${c.whyNot.map(esc).join('<br>')}</div>` : ''}
      ${sel ? `<label>Home depot<select id="st-depot">${c.depots.map((d) => `<option value="${esc(d.key)}" ${CHOSEN.depot === d.key ? 'selected' : ''}>${esc(d.place)}</option>`).join('')}</select></label>` : ''}
    </div>`;
  }).join('');
  document.querySelectorAll('[data-co]').forEach((el) => el.onclick = (e) => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
    const c = S.companies.find((x) => x.id === el.dataset.co);
    if (c.whyNot.length) return toast(`${c.name}: ${c.whyNot.join(' ')}`, true);
    CHOSEN = { company: c.id, depot: c.depots[0].key };
    renderStart();
  });
  const dep = $('st-depot'); if (dep) dep.onchange = () => { CHOSEN.depot = dep.value; };
  $('st-roster').value = S.settings.roster;
  $('st-roster').onchange = async () => { S = await api('/settings', 'POST', { roster: $('st-roster').value }); renderStart(); };
  $('st-level').oninput = $('st-level').onchange = refreshEligibility;
  SKILLS.forEach(([k]) => { $(`sk-${k}`).onchange = refreshEligibility; });
  $('st-go').onclick = () => act(async () => {
    if (!CHOSEN.company) throw new Error('Pick a company first.');
    const skills = Object.fromEntries(SKILLS.map(([k]) => [k, parseInt($(`sk-${k}`).value, 10) || 0]));
    const r = await api('/start', 'POST', { driverName: $('st-name').value, coachLevel: parseInt($('st-level').value, 10) || 0, skills,
      roster: $('st-roster').value, day: parseInt($('st-day').value, 10) || 1, time: $('st-time').value, companyId: CHOSEN.company, homeDepot: CHOSEN.depot });
    TAB = 'today';
    return r;
  });
}
/** Skills typed on the first screen change who will take the driver; the server only knows them once started, so judge here. */
function refreshEligibility() {
  const lv = parseInt($('st-level').value, 10) || 0;
  const sk = Object.fromEntries(SKILLS.map(([k]) => [k, parseInt($(`sk-${k}`).value, 10) || 0]));
  for (const c of S.companies) {
    const why = [];
    if (c.tier >= 2) { if (lv < 4) why.push('Coach level 4 or more.'); if (sk.demandingTimetables < 1) why.push('At least 1 point in Demanding Timetables.'); }
    if (c.tier >= 3) { why.push('30 duties on your record, passengers at 85% and 95% on time: not for a new career.'); }
    c.whyNot = why;
  }
  if (CHOSEN.company && S.companies.find((c) => c.id === CHOSEN.company).whyNot.length) CHOSEN = { company: '', depot: '' };
  renderStart();
}

/* ============================================================ the tablet */

const TABS = [['today', 'Today'], ['run', 'Run'], ['coach', 'Coach'], ['routes', 'Routes'], ['career', 'Career'], ['pay', 'Pay'], ['settings', 'Settings'], ['log', 'Log']];

function render() {
  $('boot').classList.add('hidden');
  if (!S.started) return renderStart();
  $('start').classList.add('hidden');
  $('app').classList.remove('hidden');
  const j = S.job;
  const h = S.hours || {};
  $('bar').innerHTML = `<span class="brand">Coach Driver</span>
    <span class="who">${esc(S.profile.driverName)}</span>
    ${j ? `<span class="chip">${esc(j.company.name)} · <b>${esc(j.rankName)}</b>${j.onProbation ? ' · probation' : ''}</span>` : ''}
    ${j && j.status !== 'Active' ? badge('bad', j.status) : ''}
    <span class="chip">${esc(S.place)}${S.atHome ? ' · home' : ''}</span>
    ${S.coach && j && j.coachBought ? `<span class="chip" title="${esc(S.coach.headline)}">Coach <b style="color:${bandColour(S.coach.band)}">${fmt1(S.coach.damagePct)}%</b></span>` : ''}
    <span class="spacer"></span>
    <span class="chip">Drive <b>${hhmm(h.driveLeft)}</b></span>
    <span class="chip">Week <b>${hhmm(h.weekLeft)}</b></span>
    <span class="clock">${esc(gt(S.gameTime))}</span>`;
  const running = S.duty && S.duty.status === 'Running';
  $('tabs').innerHTML = TABS.map(([k, n]) => `<button data-tab="${k}" class="${TAB === k ? 'on' : ''}">${n}${k === 'run' && running ? '<span class="dot"></span>' : ''}</button>`).join('');
  document.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { TAB = b.dataset.tab; render(); });
  const view = { today: viewToday, run: viewRun, coach: viewCoach, routes: viewRoutes, career: viewCareer, pay: viewPay, settings: viewSettings, log: viewLog }[TAB];
  $('view').innerHTML = view();
  wire[TAB]?.();
}

function clocksHtml() {
  const h = S.hours || {};
  const tile = (k, v, low, out, title = '') => `<div class="clock-tile ${out ? 'out' : low ? 'low' : ''}" title="${esc(title)}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  return `<div class="clocks">
    ${tile('Drive today', hhmm(h.driveLeft), h.driveLeft < 2, h.driveLeft <= 0)}
    ${h.breaks ? tile('Break due in', hhmm(h.untilBreak), h.untilBreak < 1, h.untilBreak <= 0) : tile('Spread left', hhmm(h.spreadLeft), h.spreadLeft < 2, h.spreadLeft <= 0, h.multiManned ? 'Two drivers: 21 hours' : '')}
    ${tile('Week', hhmm(h.weekLeft), h.weekLeft < 8, h.weekLeft <= 0)}
    ${tile('Fortnight', hhmm(h.fortnightLeft), h.fortnightLeft < 10, h.fortnightLeft <= 0)}
    ${tile(h.onTour ? 'Weekly rest (tour)' : 'Weekly rest due', `${Math.max(0, Math.floor(h.hoursToWeeklyRest / 24))}d ${Math.max(0, Math.round(h.hoursToWeeklyRest % 24))}h`, h.hoursToWeeklyRest < 30, h.hoursToWeeklyRest <= 0, gt(h.weeklyRestDue))}
  </div>${h.owesDoubleRest ? '<div class="callout warn" style="margin-top:10px"><h4>Two weekly rests owed</h4><p>The tour put your weekly rest off. Take 69 hours off before the next working week.</p></div>' : ''}`;
}

/* ============================================================ Today */

function viewToday() {
  const j = S.job;
  if (!j || j.status !== 'Active')
    return `<div class="callout stop"><h4>You are not with a company</h4><p>Find another on the Career tab.</p></div>${clocksPanel()}`;
  const notices = [];
  if (!j.coachBought) notices.push(`<div class="callout warn"><h4>Buy your coach</h4>
    <p>${esc(j.company.name)} has assigned you a <b>${esc(j.coachModel)}</b>, fleet number ${esc(j.fleetNumber)}. Buy that model in the game: Contract Jobs need a coach of your own.</p>
    <div class="row-actions"><button class="btn go" id="t-bought">It is in my garage</button></div></div>`);
  for (const d of S.depots.filter((x) => x.here && x.reached && !x.opened))
    notices.push(`<div class="callout info"><h4>${esc(d.city)} is one of your depots</h4>
      <p>Buy the large garage here in the game${d.home ? ': it is your home depot' : ''}, then open it. Duties can start and end there, and a night there is in the rest room.</p>
      <div class="row-actions"><button class="btn go" data-open="${esc(d.city)}|${esc(d.cc)}">The garage is bought: open the depot</button></div></div>`);
  const cn = coachNotice();
  if (cn) notices.push(cn);
  return `${notices.join('')}
    <div class="cols">
      <div>${dutyCard()}${boardPanel()}</div>
      <div>${clocksPanel()}${tourPanel()}${clockMovePanel()}</div>
    </div>`;
}
const clocksPanel = () => `<div class="panel"><h3 class="sect">Your hours</h3>${clocksHtml()}</div>`;

function dutyCard() {
  const d = S.duty;
  if (!d) return '';
  const stops = d.stops.map((s, i) => `<li><b>${esc(s.city)}</b> ${i === 0 ? `departs ${todOf(s.scheduledDepart)}` : `arrives ${todOf(s.scheduledArrive)}`}${d.crew === 'Double' && i < d.stops.length - 1 ? ` · ${s.legDriver === 'You' ? 'you drive on' : 'co-driver drives on'}` : ''}</li>`).join('');
  return `<div class="panel" style="border-color:var(--teal)">
    <div class="panel-head"><h2>${esc(d.number)}: ${esc(d.title)}</h2><div class="spacer"></div>${badge(d.status === 'Running' ? 'warn' : 'teal', d.status === 'Running' ? 'Under way' : 'Assigned')}</div>
    <p>Book on <b>${esc(gt(d.bookOn))}</b> · ${d.crew === 'Double' ? 'Two drivers' : 'Solo'} · ${esc(d.coachModel)} · ${d.km ? `${Math.round(d.km)} km` : ''}</p>
    ${d.why ? `<p class="hint">${esc(d.why)}</p>` : ''}
    <ul>${stops}</ul>
    <div class="row-actions">
      <button class="btn go big" data-tab-go="run">${d.status === 'Running' ? 'Back to the run' : 'Start the run'}</button>
      <div class="spacer"></div>
      ${d.status === 'Running' ? '<button class="btn ghost" data-lost="1">The game lost it</button>' : '<button class="btn ghost" id="t-handback">Hand it back</button>'}
    </div></div>`;
}

function boardPanel() {
  const b = S.board || { offers: [] };
  const offers = b.offers.map((o) => {
    const title = o.kind === 'Tourist' ? `${esc(o.landmark)} ${badge(o.landmarkScope === 'Global' ? 'teal' : 'info', o.landmarkScope || 'Local')}`
      : `${esc(o.from)} → ${esc(o.to)}`;
    return `<div class="offer ${o.assigned ? 'assigned' : ''} ${o.ok ? '' : 'no'}">
      <div style="display:flex;gap:8px;align-items:center"><div class="route">${title}</div><div class="spacer" style="flex:1"></div>
        ${o.assigned ? badge('teal', 'Assigned to you') : o.ok ? badge('', 'Possible') : badge('bad', 'Not for you')}
        ${badge(o.kind === 'Night' ? 'warn' : o.kind === 'Tourist' ? 'info' : '', o.kind)}</div>
      <div class="meta">Departs ${esc(gt(o.departs))} · arrives ${esc(todOf(o.arrives))} · ${stopsText(o)} · ${Math.round(o.km)} km${o.crew === 'Double' ? ' · two drivers' : ''}${o.passengers ? ` · ${o.passengers} passengers` : ''}</div>
      ${o.ok ? `<ul>${o.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : `<ul>${o.why.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`}
      ${o.assigned && !S.duty && o.unknownStops > 0 ? betweenForm(o) : ''}
      ${o.assigned && !S.duty ? `<div class="row-actions"><button class="btn go" data-accept="${o.id}">Take this duty</button></div>` : ''}
    </div>`;
  }).join('');
  return `<div class="panel">
    <div class="panel-head"><h2>The board${b.offers.length ? ` at ${esc(S.boardPlace)}` : ''}</h2><div class="spacer"></div>
      ${b.offers.length ? '<button class="btn tiny ghost" id="b-clear">Clear</button>' : ''}</div>
    ${b.offers.length ? offers : '<p class="muted">Read in the game\'s Contract Jobs and Tourist Jobs menus where you are. Every job is kept in the route library; the company assigns you one.</p>'}
    <h3 class="sect">Read the menu</h3>
    ${S.settings.hasApiKey ? `<div class="drop" id="b-drop"><b>Ctrl+V</b> to paste a screenshot of the menu, or drop them here
        <br><span class="hint">The menu scrolls: paste a screenshot of each screen, up to ${MAX_SHOTS}. They are read together.</span>
        <div class="row-actions" style="justify-content:center"><label class="btn tiny" style="font-weight:600">Browse…<input type="file" id="b-file" accept="image/png,image/jpeg" multiple style="display:none"></label>
          ${STAGED.length ? '<button class="btn tiny ghost" id="b-unstage">Clear them</button>' : ''}</div></div>
      <label style="margin-top:10px">These screenshots are of
        <select id="b-menu"><option value="">Either menu: tell them apart</option><option value="Contract">Contract Jobs</option><option value="Tourist">Tourist Jobs</option></select></label>
      ${STAGED.length ? `<div class="shots">${STAGED.map((s, i) => `<div class="shot"><img src="${s.thumb}" alt="screenshot ${i + 1}"><button class="btn tiny" data-unshot="${i}" title="Remove">✕</button></div>`).join('')}</div>` : ''}
      <div class="row-actions"><label style="display:flex;align-items:center;font-weight:400"><input type="checkbox" id="b-replace" checked>A new board for here</label>
        <div class="spacer"></div><button class="btn go" id="b-read" ${STAGED.length ? '' : 'disabled'}>Read ${STAGED.length || ''} screenshot${STAGED.length === 1 ? '' : 's'}</button></div>`
      : '<p class="hint">With an Anthropic API key in Settings, screenshots of the menu are read for you. Without one, type each job in.</p>'}
    <details ${S.settings.hasApiKey ? '' : 'open'}><summary class="muted" style="cursor:pointer;margin-top:10px">Type a job in</summary>${jobForm()}</details>
  </div>`;
}

/** "4 stops", with the cities between where they are known, and how many are not. */
function stopsText(o) {
  if (o.kind === 'Tourist') return 'out and back';
  const via = (o.between || []).length ? ` via ${o.between.map(esc).join(', ')}` : '';
  return `${o.stops} stops${via}${o.unknownStops ? ` (${o.unknownStops} not named on the menu)` : ''}`;
}
/** The cities a line calls at on the way: the menu counts them but names only the ends. Asked once; the library keeps them. */
function betweenForm(o) {
  const cc = (o.to.split(', ')[1] || '').trim();
  return `<div class="callout info" style="margin-top:10px"><h4>Where does it stop on the way?</h4>
    <p>The menu shows ${o.stops} stops but names only ${esc(o.from.split(', ')[0])} and ${esc(o.to.split(', ')[0])}.
      Open the job's route in the game and put in the ${o.unknownStops === 1 ? 'city it calls at' : `${o.unknownStops} cities it calls at, in order`}.
      The route library keeps the answer, so this is asked once.</p>
    <div class="stoprows">${Array.from({ length: o.unknownStops }, (_, i) => `<div class="stoprow" style="grid-template-columns:2fr 1fr">
      <label>Stop ${i + 1}<input class="bt-city" placeholder="City"></label><label>Country<input class="bt-cc" maxlength="2" value="${esc(cc)}"></label></div>`).join('')}</div></div>`;
}

function jobForm() {
  return `<div class="grid3" style="margin-top:10px">
      <label>Menu<select id="j-menu"><option>Contract</option><option>Tourist</option></select></label>
      <label>Passengers<input id="j-pax" type="number" min="0"></label>
      <label>Pay<input id="j-pay" type="number" min="0"></label>
      <label>Stops in all<input id="j-count" type="number" min="2" placeholder="as listed"><span class="hint">As the menu counts them, ends included.</span></label>
    </div>
    <div id="j-tour" class="grid2 hidden" style="margin-top:8px">
      <label>Landmark<input id="j-landmark" placeholder="e.g. Neuschwanstein"></label>
      <label>Known<select id="j-scope"><option>Local</option><option>Global</option></select></label>
    </div>
    <div class="stoprows" id="j-stops" style="margin-top:8px">${stopRow(0)}${stopRow(1)}</div>
    <div class="row-actions"><button class="btn tiny" id="j-more">Add a stop</button><div class="spacer"></div><button class="btn" id="j-add">Add to the board</button></div>
    <p class="hint">The first stop needs its departure time. Leave a time blank where the menu shows none: it is worked out from the distance.
      The menu names only where a line starts and ends: give those two and the number of stops, and the cities between are asked for when
      the line is assigned. A tourist job needs only the station it leaves from and the city the landmark is in.</p>`;
}
const stopRow = (i) => `<div class="stoprow">
  <label>${i === 0 ? 'Leaves from' : 'Stop'}<input class="j-city" placeholder="City"></label>
  <label>Country<input class="j-cc" placeholder="DE" maxlength="2"></label>
  <label>Station<input class="j-station" placeholder="optional"></label>
  <label>${i === 0 ? 'Departs' : 'Arrives'}<input class="j-time" placeholder="${i === 0 ? '08:15' : ''}"></label>
  <span></span></div>`;

function tourPanel() {
  const t = S.tour;
  const j = S.job;
  if (t && t.status === 'Running') {
    const today = t.today;
    return `<div class="panel"><div class="panel-head"><h2>${esc(t.name)}</h2><div class="spacer"></div>${badge('teal', `${t.passengers} on tour`)}</div>
      <ol>${t.itinerary.map((d) => `<li style="${d.done ? 'color:var(--ink3);text-decoration:line-through' : ''}">${esc(d.city)}: ${esc(d.plan)}</li>`).join('')}</ol>
      ${today ? `<p>Today: <b>${esc(today.plan)}</b> Take a contract line there if the board has one; if not, drive the group yourself.</p>
        <div class="row-actions">${S.duty ? '' : `${when('tl', S.gameTime, 'Leaving at')}<button class="btn go" id="t-leg">Drive the group to ${esc(today.city)}</button>`}</div>` : ''}
      <p class="hint">On a tour the weekly rest can wait up to twelve days. Nights away: ${t.nightsAway}. Tips so far: ${eur(t.tips)}.</p></div>`;
  }
  if (!j || j.company.kind === 'Line') return '';
  const why = S.tourWhyNot || [];
  return `<div class="panel"><h3 class="sect">Tours</h3>
    ${why.length ? `<p class="muted">${why.map(esc).join(' ')}</p>` : `<p>A multi-day tour from home: a city a day, the group's hotel nights paid, tips every day and a bonus at the end.</p>
      <div class="row-actions"><label>Days<select id="t-days">${[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => `<option ${n === 6 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button class="btn go" id="t-tour" style="align-self:end">Plan and start a tour</button></div>`}</div>`;
}

function clockMovePanel() {
  if (S.duty && S.duty.status === 'Running') return '';
  return `<div class="panel"><h3 class="sect">Off duty</h3>
    <p class="hint">When the game clock has moved on without a duty: a rest, the night, the weekend. Time off counts as rest; nine hours is a daily rest, 24 a weekly one.</p>
    <div class="row-actions">${when('ck', S.gameTime, 'The game clock now')}<button class="btn" id="ck-go" style="align-self:end">The clock moved on</button></div>
    <h3 class="sect">Positioning</h3>
    <p class="hint">Driving the coach empty to where the work is, or to a new home depot. Driving time, paid at the plain rate.</p>
    <div class="grid2"><label>To<input id="po-city" placeholder="City"></label><label>Country<input id="po-cc" maxlength="2" placeholder="DE"></label>
      ${when('pod', S.gameTime, 'Left')}${when('poa', S.gameTime, 'Arrived')}
      ${S.job && S.job.coachBought ? damageInputs('po') : ''}</div>
    <div class="row-actions"><div class="spacer"></div><button class="btn" id="po-go">Log the run</button></div></div>`;
}

/* ============================================================ Run */

function viewRun() {
  const d = S.duty;
  if (!d) return `<div class="panel"><p class="muted">No duty assigned. Read the board in on the Today tab and take the company's assignment.</p></div>`;
  const next = nextStep(d);
  const items = d.stops.map((s, i) => {
    const arr = i > 0 ? (s.arrivedAt ? delayBadge(minsBetween(s.scheduledArrive, s.arrivedAt)) : '') : '';
    const dep = i < d.stops.length - 1 && s.departedAt ? delayBadge(minsBetween(s.scheduledDepart, s.departedAt), true) : '';
    const done = i === 0 ? !!s.departedAt : !!s.arrivedAt && (i === d.stops.length - 1 || !!s.departedAt);
    const isNext = next && next.i === i;
    const sat = s.satisfactionPct != null ? `<div class="hint">Passengers ${Math.round(s.satisfactionPct)}% · ${s.veryHappy} very happy · ${s.happy} happy · ${s.unhappy} unhappy · ${s.veryUnhappy} very unhappy</div>` : '';
    const other = (w) => (w === 'You' ? 'Co-driver' : 'You');
    const hand = s.handoverAt ? todOf(s.handoverAt) : s.handoverAfterMinutes ? todOf(plusMin(s.scheduledDepart, s.handoverAfterMinutes)) : '';
    const legInfo = i < d.stops.length - 1 ? `<div class="leg">${Math.round(s.legKm)} km to ${esc(d.stops[i + 1].city)}${d.crew === 'Double'
      ? badge(s.legDriver === 'You' ? 'teal' : 'info', s.legDriver === 'You' ? 'You drive' : 'Co-driver')
        + (s.handoverAfterMinutes || s.handoverAt ? ` then ${badge(other(s.legDriver) === 'You' ? 'teal' : 'info', other(s.legDriver) === 'You' ? 'You drive' : 'Co-driver')} from a rest area ${s.handoverAt ? 'at' : 'about'} ${hand}` : '')
      : ''}</div>` : '';
    return `<div class="tstop ${done ? 'done' : ''} ${isNext ? 'next' : ''}">
        <div class="name">${esc(s.city)}${s.station ? ` <span class="muted" style="font-weight:400">${esc(s.station)}</span>` : ''}</div>
        <div class="times">
          ${i > 0 ? `<span>Arrive <b>${todOf(s.scheduledArrive)}</b>${s.arrivedAt ? ` · ${todOf(s.arrivedAt)} ${arr}` : ''}</span>` : ''}
          ${i < d.stops.length - 1 ? `<span>Depart <b>${todOf(s.scheduledDepart)}</b>${s.departedAt ? ` · ${todOf(s.departedAt)} ${dep}` : ''}</span>` : ''}
          ${i > 0 && s.arrivedAt ? `<span>−${s.alighted} off</span>` : ''}${s.departedAt ? `<span>+${s.boarded} on</span><span>${onBoardAfter(d, i)} aboard</span>` : ''}
        </div>${sat}
        ${isNext ? actionHtml(d, next) : ''}
      </div>${legInfo}`;
  }).join('');
  return `<div class="panel"><div class="panel-head"><h2>${esc(d.number)}: ${esc(d.title)}</h2><div class="spacer"></div>
      ${d.crew === 'Double' ? badge('info', 'Two drivers') : ''} ${badge(d.status === 'Running' ? 'warn' : 'teal', d.status === 'Running' ? 'Under way' : 'Assigned')}</div>
    ${d.crew === 'Double' ? '<p class="hint">In the game you drive the whole way. The legs marked for the co-driver are theirs on the clocks: a break for you. A leg too long for one driver is handed over at a rest area half way.</p>' : ''}
    <div class="timeline">${items}</div>
    ${next && next.kind === 'close' ? closeHtml(d) : ''}
    ${d.status === 'Running' ? lostHtml() : `<div class="row-actions" style="margin-top:12px"><div class="spacer"></div><button class="btn ghost" id="r-handback">Gone from the menu: hand it back</button></div>`}
  </div>
  <div class="panel"><h3 class="sect">Your hours</h3>${clocksHtml()}</div>`;
}
/** Passengers aboard on arriving at a stop, and after leaving it. */
const onBoardAt = (d, i) => d.stops.slice(0, i).reduce((n, s) => n + (s.boarded || 0) - (s.alighted || 0), 0);
const onBoardAfter = (d, i) => onBoardAt(d, i) - (d.stops[i].alighted || 0) + (d.stops[i].boarded || 0);

function delayBadge(m, departure = false) {
  if (m == null) return '';
  if (departure && m < -1) return badge('bad', `${-m} min early`);
  if (m > 15) return badge('bad', `+${m} min`);
  if (m > 5) return badge('warn', `+${m} min`);
  return badge('ok', m > 0 ? `+${m}` : 'on time');
}
/** What the driver does next on a duty: depart a stop, arrive at one, or close it out. */
function nextStep(d) {
  for (let i = 0; i < d.stops.length; i++) {
    const s = d.stops[i];
    if (i > 0 && !s.arrivedAt) return { i, kind: 'arrive' };
    if (i < d.stops.length - 1 && !s.departedAt) return { i, kind: 'depart' };
  }
  return { i: d.stops.length - 1, kind: 'close' };
}
function actionHtml(d, n) {
  const s = d.stops[n.i];
  if (n.kind === 'depart') {
    const swap = d.crew === 'Double' ? `<button class="btn" id="r-swap">${s.legDriver === 'You' ? 'Co-driver takes this leg' : 'I take this leg'}</button>` : '';
    const aboard = n.i === 0 ? 0 : onBoardAt(d, n.i) - (s.alighted || 0);
    return `<div class="action"><div class="grid3">${when('rd', s.scheduledDepart, 'Departed at')}
      <label>Passengers boarded here<input id="rd-on" type="number" min="0" value="${s.boarded || ''}" placeholder="0 if nobody">
        <span class="hint">${n.i === 0 ? 'Everyone the coach leaves with.' : `${aboard} stayed aboard.`}</span></label></div>
      <div class="row-actions">${swap}<div class="spacer"></div><button class="btn go huge" id="r-depart" style="width:auto">Departed ${esc(s.city)}</button></div>
      <p class="hint">Leave on the timetable: leaving early leaves passengers behind, which is worse than being late.</p></div>`;
  }
  if (n.kind === 'arrive') {
    const prev = d.stops[n.i - 1];
    const legHours = (ms(s.scheduledArrive) - ms(prev.scheduledDepart)) / 3600000;
    const brk = S.settings.breaks && prev.legDriver === 'You' && legHours > 4.5 && !prev.handoverAfterMinutes
      ? `<label>Break on the way (min)<input id="ra-break" type="number" min="0" value="45"></label>` : '';
    // Two drivers: a handover on the road, planned half way on a long leg, or logged where it happened. Clear the time if
    // one driver drove it all.
    const hand = d.crew === 'Double' ? `<label>Handed over on the road at<span style="display:flex;gap:6px">
        <input id="rh-day" type="number" min="1" style="flex:0 0 86px" value="${dayOf(prev.departedAt)}">
        <input id="rh-tod" style="flex:1" value="${prev.handoverAfterMinutes ? esc(todOf(plusMin(prev.departedAt, prev.handoverAfterMinutes))) : ''}" placeholder="none"></span>
        <span class="hint">${prev.handoverAfterMinutes ? 'Planned half way, at a rest area. Clear it if one driver drove it all.' : 'Only if you changed over before the stop.'}</span></label>` : '';
    const aboard = onBoardAt(d, n.i);
    const last = n.i === d.stops.length - 1;
    return `<div class="action"><div class="grid3">${when('ra', s.scheduledArrive, 'Arrived at')}
      <label>Passengers off here<input id="ra-off" type="number" min="0" max="${aboard}" value="${last ? aboard : ''}" placeholder="0 if nobody">
        <span class="hint">${aboard} aboard on arrival${last ? ': everyone gets off at the end' : ''}.</span></label>${brk}${hand}</div>
      <h3 class="sect">What the game shows for the passengers here</h3>
      <p class="hint">Every stop is judged like the end of the line: the passengers getting off here give their verdict here. All five are needed; 0 where a group is empty.</p>
      <div class="counts"><label>Satisfaction %<input id="ra-pct" type="number" min="0" max="100"></label>
        <label>Very happy<input id="ra-vh" type="number" min="0"></label><label>Happy<input id="ra-h" type="number" min="0"></label>
        <label>Unhappy<input id="ra-u" type="number" min="0"></label><label>Very unhappy<input id="ra-vu" type="number" min="0"></label></div>
      <div class="row-actions"><div class="spacer"></div><button class="btn go huge" id="r-arrive" style="width:auto">Arrived at ${esc(s.city)}</button></div></div>`;
  }
  return '';
}
function closeHtml(d) {
  const last = d.stops[d.stops.length - 1];
  return `<div class="callout info" style="margin-top:12px"><h4>Close out ${esc(d.number)}</h4>
    <p>The figures from the game's end-of-trip summary, if they changed after the last stop, and whose doing any lateness was.</p>
    <div class="counts"><label>Final satisfaction %<input id="c-pct" type="number" min="0" max="100" value="${last.satisfactionPct ?? ''}"></label>
      <label>Very happy<input id="c-vh" type="number" min="0" value="${last.veryHappy || ''}"></label><label>Happy<input id="c-h" type="number" min="0" value="${last.happy || ''}"></label>
      <label>Unhappy<input id="c-u" type="number" min="0" value="${last.unhappy || ''}"></label><label>Very unhappy<input id="c-vu" type="number" min="0" value="${last.veryUnhappy || ''}"></label></div>
    <div class="grid2" style="margin-top:8px"><label>Any lateness was down to
      <select id="c-fault"><option value="Driver">Me</option><option value="Road">The road: traffic, roadworks, weather</option><option value="Game">The game: a crash, a reload</option><option value="Coach">The coach: a breakdown</option></select></label>
      <label>What happened<input id="c-why" placeholder="optional"></label></div>
    <p class="hint">Only lateness can be put down to something else. An early departure is always the driver's.</p>
    <h3 class="sect">The coach</h3>
    <div class="grid2">${damageInputs('c')}</div>
    <div class="row-actions"><div class="spacer"></div><button class="btn go big" id="r-close">Close out the duty</button></div></div>`;
}

/** The game lost the job: a crash, a reload, the job dropped. Given up with nothing on the record; the time worked is paid. */
function lostHtml() {
  return `<details id="r-lost-box" ${LOST_OPEN ? 'open' : ''} style="margin-top:14px"><summary class="muted" style="cursor:pointer">The game lost this job</summary>
    <div class="callout warn" style="margin-top:8px"><h4>Give the duty up</h4>
    <p>For a crash, a reload or a job the game dropped. Nothing goes on your record, and the time you worked until then is paid.
      The coach's damage is read, as after any run. Afterwards, log a positioning run from wherever the game left you.</p>
    <div class="grid2">${when('rl', S.gameTime, 'The game lost it at')}<label>What happened<input id="rl-why" placeholder="optional: crashed to desktop"></label>
      ${S.job && S.job.coachBought ? damageInputs('rl') : ''}</div>
    <div class="row-actions"><div class="spacer"></div><button class="btn bad" id="r-lost">Give the duty up</button></div></div></details>`;
}
let LOST_OPEN = false;

function closeoutModal(co) {
  const cls = { Excellent: 'go', Good: 'info', Poor: 'warn', Bad: 'stop' }[co.grade] || 'info';
  modal(`<div class="panel-head"><h2>${esc(co.duty.number)} closed</h2>${badge(cls === 'go' ? 'ok' : cls === 'stop' ? 'bad' : cls === 'warn' ? 'warn' : 'info', co.grade)}
      <div class="spacer"></div><button class="btn tiny ghost" data-close>Close</button></div>
    <div class="callout ${cls}"><h4>${esc(co.headline)}</h4></div>
    ${co.notes.length ? `<div class="callout ${co.status !== 'Active' ? 'stop' : 'info'}"><h4>Worth knowing</h4>${co.notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
    <div class="sum">${co.summary.map((sec) => `<section><h3 class="sect">${esc(sec.title)}</h3><dl>${sec.rows.map((r) =>
      `<dt>${esc(r.label)}</dt><dd${r.tone ? ` class="${esc(r.tone)}"` : ''}>${esc(r.value)}${r.detail ? `<small>${esc(r.detail)}</small>` : ''}</dd>`).join('')}</dl></section>`).join('')}</div>
    <div class="row-actions"><div class="spacer"></div><button class="btn go" data-close>Got it</button></div>`);
}

/* ============================================================ Coach */

const fmt1 = (n) => (Math.round((n || 0) * 10) / 10).toString();
const bandColour = (b) => ({ Fine: 'var(--green)', Watch: 'var(--amber)' }[b] || 'var(--red)');
const bandCallout = (b) => ({ Fine: 'go', Watch: 'warn', InShop: 'info' }[b] || 'stop');
const CHECK_NAME = { Service: 'Service', Inspection: 'Safety inspection', 'Annual test': 'Annual test' };
const CAUSE = { Driver: 'You', Other: 'Another road user', Game: 'The game' };

/** The damage the game shows after a run, and whose doing any new damage was. */
function damageInputs(p) {
  const was = S.coach ? fmt1(S.coach.damagePct) : '0';
  return `<label>Coach damage now (%)<input id="${p}-dmg" type="number" min="0" max="100" step="0.1" placeholder="was ${was}">
      <span class="hint">As the game shows it at the end of the run. Was ${was}%. 0 if none.</span></label>
    <label>Any new damage was down to<select id="${p}-cause"><option value="Driver">Me</option><option value="Other">Another road user hit me</option><option value="Game">The game: a glitch, a reload</option></select>
      <span class="hint">Only your own counts against you.</span></label>`;
}

/** On the Today tab, when the coach needs something. */
function coachNotice() {
  const c = S.coach;
  if (!c || !S.job || !S.job.coachBought) return '';
  const due = c.checks.filter((k) => k.status !== 'Ok');
  if (c.band === 'Fine' && !due.length) return '';
  return `<div class="callout ${c.band === 'Fine' ? 'warn' : bandCallout(c.band)}"><h4>${esc(c.band === 'Fine' ? 'The coach' : c.headline)}</h4>
    ${c.lines.map((l) => `<p>${esc(l)}</p>`).join('')}${due.map((k) => `<p>${esc(k.text)}</p>`).join('')}
    <div class="row-actions"><button class="btn" data-tab-go="coach">The Coach tab</button></div></div>`;
}

function viewCoach() {
  const c = S.coach;
  const j = S.job;
  if (!c || !j) return '<div class="panel"><p class="muted">Not with a company.</p></div>';
  if (!j.coachBought) return `<div class="panel"><p class="muted">Buy the ${esc(j.coachModel)} in the game first, and confirm it on the Today tab.</p></div>`;
  const p = c.policy;
  const tile = (k, v, cls = '', title = '') => `<div class="clock-tile ${cls}" title="${esc(title)}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const checkTile = (k) => tile(CHECK_NAME[k.kind], k.kind === 'Service' ? (k.kmLeft >= 0 ? `${Math.round(k.kmLeft).toLocaleString('en-GB')} km` : 'Overdue') : `Day ${dayOf(k.dueAt)}`,
    { Ok: '', Soon: 'low', Due: 'low', Overdue: 'out' }[k.status], k.text);
  const rows = c.entries.map((e) => `<tr><td class="mono muted">${esc(gt(e.gameTime))}</td>
    <td>${badge({ Run: '', Reading: 'info', Repair: 'ok', Service: 'teal', Inspection: 'teal', 'Annual test': 'teal' }[e.kind] || '', e.kind === 'Run' ? e.ref : e.kind)}</td>
    <td>${esc(e.place)}</td>
    <td class="num">${e.kind === 'Repair' ? `${fmt1(e.before)}% → ${fmt1(e.after)}%` : `${fmt1(e.after)}%`}</td>
    <td>${e.incurred > 0 ? `+${fmt1(e.incurred)}% · ${esc(CAUSE[e.cause] || e.cause)}${e.cause === 'Driver' && e.severity !== 'None' ? ' ' + badge(e.severity === 'Minor' ? 'warn' : 'bad', e.severity) : ''}` : e.shopHours ? `${hhmm(e.shopHours)} in the shop` : ''}
      ${e.note ? `<div class="hint">${esc(e.note)}</div>` : ''}</td>
    <td class="num">${e.km ? Math.round(e.km).toLocaleString('en-GB') + ' km' : ''}${e.cost ? ` · ${eur(e.cost)}` : ''}</td></tr>`).join('');
  return `<div class="cols"><div>
    <div class="panel"><div class="panel-head"><h2>${esc(j.coachModel)}</h2><div class="spacer"></div><span class="muted">${esc(j.fleetNumber)}</span></div>
      <div class="grid4">
        ${tile('Damage', `${fmt1(c.damagePct)}%`, c.band === 'Fine' ? '' : c.band === 'Watch' ? 'low' : 'out', c.headline)}
        ${c.checks.map(checkTile).join('')}</div>
      <div class="callout ${bandCallout(c.band)}" style="margin-top:12px"><h4>${esc(c.headline)}</h4>${c.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
        ${c.checks.filter((k) => k.status !== 'Ok').map((k) => `<p>${esc(k.text)}</p>`).join('')}</div>
      <p class="hint">${Math.round(c.km).toLocaleString('en-GB')} km on the books. Damage read ${esc(gt(c.readAt))}.
        ${c.wear.per1000 != null ? `Your damage over the last 15 duties: ${c.wear.per1000}% per 1,000 km (the standard is under ${c.wear.standard}).` : ''}</p>
    </div>
    <div class="panel"><h3 class="sect">The coach's log</h3>
      ${rows ? `<table><thead><tr><th>When</th><th>What</th><th>Where</th><th class="num">Damage</th><th></th><th class="num"></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Nothing yet. The damage is read after every run.</p>'}</div>
    </div><div>
    <div class="panel"><h3 class="sect">At the shop</h3>
      <p class="hint">Do it in the game first, then log it here. A repair can be done anywhere; the service and the inspections only in our own garage: your home depot or an opened depot.
        ${c.atGarage ? 'You are at one now.' : `You are in ${esc(S.place)}, not at a garage of ours.`}</p>
      <div class="grid2" style="margin-bottom:8px">
        <label style="flex-direction:row;align-items:center;gap:8px;font-weight:400"><input type="checkbox" id="mx-repair" ${c.damagePct > 0 ? '' : 'disabled'}> A repair</label>
        <label style="flex-direction:row;align-items:center;gap:8px;font-weight:400"><input type="checkbox" id="mx-service" ${c.atGarage ? '' : 'disabled'}> The service</label>
        <label style="flex-direction:row;align-items:center;gap:8px;font-weight:400"><input type="checkbox" id="mx-insp" ${c.atGarage ? '' : 'disabled'}> The safety inspection</label>
        <label style="flex-direction:row;align-items:center;gap:8px;font-weight:400"><input type="checkbox" id="mx-annual" ${c.atGarage ? '' : 'disabled'}> The annual test</label>
      </div>
      <div class="grid2">${when('mx', S.gameTime, 'Went in at')}
        <label>Damage after the repair (%)<input id="mx-after" type="number" min="0" step="0.1" value="0"></label>
        <label>What the game charged<input id="mx-cost" type="number" min="0" placeholder="optional"><span class="hint">The company's bill, for the record.</span></label>
        <label>Note<input id="mx-note" placeholder="optional"></label></div>
      <div class="row-actions"><div class="spacer"></div><button class="btn go" id="mx-go">Log the visit</button></div>
      <p class="hint">The coach stands in the shop for the work: a repair is about 8 hours to book in plus most of an hour per point, a third quicker in our own garage; the service about 4 hours, an inspection 3. Your rest goes on meanwhile; no duty books on before it is out.</p></div>
    <div class="panel"><h3 class="sect">Put the reading right</h3>
      <p class="hint">The damage is read after every run. If the game shows something else now (a knock while parked, a reload), give it here.</p>
      <div class="grid2">${damageInputs('rd2')}</div>
      <div class="row-actions"><div class="spacer"></div><button class="btn" id="rd2-go">Save the reading</button></div></div>
    <div class="panel"><h3 class="sect">The company's rules</h3>
      <ul><li>Under ${p.watchPct}%: nothing said.</li>
        <li>${p.watchPct}% and up: worth a look the next time it stands at a depot anyway. Not a trip on its own.</li>
        <li>${p.shopPct}% and up: no more passenger work until it is fixed. Under ${p.reviewPct}% a line that ends at home is fine; home is the shop while it is fit to get there.</li>
        <li>${p.reviewPct}% and up: nobody rides in it until it is looked at. Home if it is within a day and under ${p.runHomeMaxPct}%, otherwise the nearest shop.</li>
        <li>${p.outOfServicePct}% and up: out of service. The nearest shop and no further.</li>
        <li>Damage you cause on a run: under 1% is nothing; to 5% minor (no duty bonus); to 15% a poor duty and a strike; to 25% a bad duty; more, a final warning at once.</li>
        <li>Service every ${Math.round(p.serviceIntervalKm).toLocaleString('en-GB')} km; a safety inspection every ${p.inspectionIntervalDays} days; the annual test every year. Past an inspection, the coach carries nobody.</li></ul></div>
    </div></div>`;
}

/* ============================================================ Routes (read-only) */

function viewRoutes() {
  const f = ROUTE_FILTER;
  const text = f.text.toLowerCase();
  const lines = (S.lines || []).filter((l) => (!f.kind || l.kind === f.kind)
    && (!text || [l.from, l.to, l.landmark, ...l.stops.map((s) => s.place)].join(' ').toLowerCase().includes(text)));
  const cities = [...new Set((S.lines || []).flatMap((l) => l.stops.map((s) => s.place)))].sort();
  const rows = lines.map((l) => `<tr class="click" data-line="${l.id}">
      <td>${badge(l.kind === 'Night' ? 'warn' : l.kind === 'Tourist' ? 'info' : '', l.kind)}${l.depot ? ' ' + badge('teal', 'depot') : ''}</td>
      <td><b>${esc(l.from)}</b> → ${l.kind === 'Tourist' ? esc(l.landmark) : `<b>${esc(l.to)}</b>`}</td>
      <td class="num">${esc(l.departs)}</td><td class="num">${esc(l.arrives)}${l.nextDay ? ' +1' : ''}</td>
      <td class="num">${l.kind === 'Tourist' ? '—' : l.stopCount}${l.unknownStops ? ` <span class="muted" title="not named yet">(${l.unknownStops}?)</span>` : ''}</td><td class="num">${Math.round(l.km)}</td>
      <td class="num">${l.timesSeen}</td><td class="num">${l.timesRun}</td>
      <td class="num">${l.timesRun ? `${l.avgDelay > 0 ? '+' : ''}${l.avgDelay}` : '—'}</td>
      <td class="num">${l.timesRun ? `${Math.round(l.avgSatisfaction)}%` : '—'}</td>
      <td>${l.returnWorking ? `${esc(l.returnWorking.departs)} back` : '<span class="muted">—</span>'}</td></tr>
    ${OPEN_LINE === l.id ? `<tr><td></td><td colspan="10"><ol style="margin:0">${l.stops.map((s, i) => `${i === l.stops.length - 1 && l.unknownStops
        ? `<li class="muted">${l.unknownStops} stop${l.unknownStops > 1 ? 's' : ''} on the way, not named yet: asked for when the line is first assigned</li>` : ''}<li>${esc(s.place)}${s.station ? ` · ${esc(s.station)}` : ''} · ${esc(s.time)}${s.dayOffset ? ' (+1 day)' : ''}${s.derived ? ' <span class="muted">(worked out)</span>' : ''}</li>`).join('')}</ol>
      <p class="hint">First seen ${esc(gt(l.firstSeen))}, last seen ${esc(gt(l.lastSeen))}.${l.gamePay ? ` The game paid ${eur(l.gamePay)}.` : ''}${l.passengers ? ` ${l.passengers} passengers.` : ''}</p></td></tr>` : ''}`).join('');
  return `<div class="panel">
    <div class="panel-head"><h2>The route library</h2><div class="spacer"></div><span class="muted">${S.lineCount} line${S.lineCount === 1 ? '' : 's'}, read only</span></div>
    <p class="hint">Every job read off the game's menus, kept and taken to run every day at the same times. The company plans turnarounds and ways home from it.
      Lines change only when a new screenshot is read.</p>
    <div class="grid3"><label>Find<input id="rf-text" value="${esc(f.text)}" placeholder="a city or a landmark"></label>
      <label>Kind<select id="rf-kind"><option value="">All</option><option>Line</option><option>Night</option><option>Tourist</option></select></label>
      <label>City view<select id="rf-city"><option value="">Choose a station</option>${cities.map((c) => `<option ${f.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label></div>
    ${f.city ? '<div id="rf-cityview" class="panel" style="margin-top:12px;background:var(--panel2)">Loading…</div>' : ''}
    ${lines.length ? `<table style="margin-top:12px"><thead><tr><th>Kind</th><th>Line</th><th class="num">Departs</th><th class="num">Arrives</th><th class="num">Stops</th>
      <th class="num">km</th><th class="num">Seen</th><th class="num">Run</th><th class="num">Avg delay</th><th class="num">Passengers</th><th>Return</th></tr></thead>
      <tbody>${rows}</tbody></table>` : '<p class="muted" style="margin-top:12px">Nothing yet. Read in a board on the Today tab.</p>'}
  </div>`;
}

/* ============================================================ Career */

function viewCareer() {
  const j = S.job;
  const r = S.record;
  const dsc = S.discipline;
  const active = j && j.status === 'Active';
  const ladder = j ? j.ladder.map((x) => `<li style="${x.rank === j.rank ? 'color:var(--teal);font-weight:700' : ''}">${esc(x.name)} · ${eur(x.rate)}/h</li>`).join('') : '';
  const depots = S.depots.map((d) => `<tr><td><b>${esc(d.place)}</b>${d.home ? ' ' + badge('teal', 'home') : ''}${d.here ? ' ' + badge('info', 'here') : ''}</td>
    <td>${d.opened ? badge('ok', 'Open') : d.reached ? badge('warn', 'Reached') : badge('', 'Not reached')}</td>
    <td class="num">${d.here ? '—' : Math.round(d.km) + ' km'}</td>
    <td>${d.reached && !d.opened ? `<button class="btn tiny" data-open="${esc(d.city)}|${esc(d.cc)}">Open</button>` : ''}
      ${d.opened && !d.home ? `<button class="btn tiny" data-transfer="${esc(d.city)}|${esc(d.cc)}">Transfer here</button>` : ''}</td></tr>`).join('');
  const market = S.companies.filter((c) => !(active && c.id === j.company.id)).map((c) => `<tr>
    <td><b>${esc(c.name)}</b><div class="hint">${esc(c.about)}</div></td><td>${TIER[c.tier]}</td><td>${KIND[c.kind]}</td><td class="num">${eur(c.rate)}</td>
    <td>${c.whyNot.length ? `<span class="hint" style="color:var(--amber)">${c.whyNot.map(esc).join('<br>')}</span>`
      : `<select id="ap-${c.id}">${c.depots.map((d) => `<option value="${esc(d.key)}">${esc(d.place)}</option>`).join('')}</select>
         <button class="btn tiny go" data-apply="${c.id}" style="margin-top:6px">Join, based here</button>`}</td></tr>`).join('');
  return `<div class="cols"><div>
    ${j ? `<div class="panel"><div class="panel-head"><h2>${esc(j.company.name)}</h2><div class="spacer"></div>${badge(active ? 'ok' : 'bad', j.status)}</div>
      <p>${esc(j.rankName)} at ${eur(j.rate)}/h · based at ${esc(j.home)} · ${esc(j.coachModel)}, ${esc(j.fleetNumber)}</p>
      ${j.onProbation && active ? `<div class="callout warn"><h4>On probation until ${esc(gt(j.probationEndsGameTime))}</h4>
        <p>At least eight duties with passengers happy on average, and no written reprimand. A written reprimand ends it.</p></div>` : ''}
      <h3 class="sect">The ladder here</h3><ol>${ladder}</ol>
      ${j.nextRank && active ? `<h3 class="sect">To ${esc(j.nextRank.name.toLowerCase())}</h3>${j.nextRank.gaps.length
        ? `<ul>${j.nextRank.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : '<p>You qualify: the next review promotes you.</p>'}
        <p class="hint">Reviewed every fortnight after probation.</p>` : ''}</div>` : ''}
    <div class="panel"><h3 class="sect">Your record</h3>
      <div class="grid4"><div class="clock-tile"><div class="k">Duties</div><div class="v">${r.duties}</div></div>
        <div class="clock-tile ${r.avgSatisfaction && r.avgSatisfaction < 70 ? 'low' : ''}"><div class="k">Passengers</div><div class="v">${r.duties ? Math.round(r.avgSatisfaction) + '%' : '—'}</div></div>
        <div class="clock-tile ${r.punctuality && r.punctuality < 90 ? 'low' : ''}"><div class="k">On time</div><div class="v">${r.duties ? Math.round(r.punctuality) + '%' : '—'}</div></div>
        <div class="clock-tile ${dsc.level >= 2 ? 'out' : dsc.level === 1 ? 'low' : ''}"><div class="k">Discipline</div><div class="v" style="font-size:15px">${esc(dsc.levelName)}</div></div></div>
      <p class="hint" style="margin-top:8px">${dsc.strikesSinceStep ? `${dsc.strikesSinceStep} strike${dsc.strikesSinceStep > 1 ? 's' : ''} of 3. ` : ''}${dsc.level ? `${dsc.cleanRun} of 10 clean duties to step down.` : ''}</p>
      ${dsc.entries.length ? `<table><tbody>${dsc.entries.slice(0, 12).map((e) => `<tr><td class="mono muted">${esc(gt(e.gameTime))}</td><td>${badge(e.kind === 'Bonus' ? 'ok' : e.kind === 'Strike' ? 'warn' : e.kind === 'Stepped down' ? 'info' : 'bad', e.kind)}</td><td>${esc(e.text)}</td></tr>`).join('')}</tbody></table>` : ''}
      <h3 class="sect">Recent duties</h3>
      ${S.duties.length ? `<table><thead><tr><th>Duty</th><th>Grade</th><th class="num">Passengers</th><th class="num">On time</th><th class="num">Pay</th></tr></thead><tbody>
        ${S.duties.map((d) => `<tr><td><b>${esc(d.number)}</b> ${esc(d.title)}</td><td>${badge({ Excellent: 'ok', Good: 'info', Poor: 'warn', Bad: 'bad' }[d.grade], d.grade)}</td>
          <td class="num">${Math.round(d.finalSatisfaction)}%</td><td class="num">${Math.round(d.punctualityPct)}%</td><td class="num">${eur(d.pay)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">None yet.</p>'}
    </div></div>
    <div>
    ${active ? `<div class="panel"><h3 class="sect">Depots</h3><p class="hint">Reached when you first get there; opened once you buy the large garage in the game.</p>
      <table><tbody>${depots}</tbody></table></div>` : ''}
    <div class="panel"><h3 class="sect">Your coach level and skills</h3><p class="hint">Update these as you level up in the game: better work and better companies need them.</p>
      <div class="grid3"><label>Coach level<input id="pf-level" type="number" min="0" value="${S.profile.coachLevel}"></label>
        ${SKILLS.map(([k, n]) => `<label>${n}<input id="pf-${k}" type="number" min="0" max="6" value="${S.profile.skills[k] || 0}"></label>`).join('')}</div>
      <div class="row-actions"><div class="spacer"></div><button class="btn" id="pf-save">Save</button></div></div>
    <div class="panel"><h3 class="sect">Other companies</h3><table><tbody>${market}</tbody></table>
      ${active ? '<p class="hint">Joining another company ends this job: you resign.</p>' : ''}</div>
    ${S.history.length ? `<div class="panel"><h3 class="sect">Before</h3>${S.history.map((h) => `<p><b>${esc(h.companyName)}</b> · ${esc(h.ended)} · ${esc(h.why)}</p>`).join('')}</div>` : ''}
    </div></div>`;
}

/* ============================================================ Pay */

function viewPay() {
  const p = S.pay;
  const line = (l) => `<tr><td class="mono muted">${esc(gt(l.gameTime))}</td><td>${esc(l.duty || '')}</td><td>${badge(['Tips', 'Duty bonus', 'Performance bonus', 'Tour bonus'].includes(l.kind) ? 'ok' : '', l.kind)}</td><td>${esc(l.text)}</td><td class="num">${eur(l.amount)}</td></tr>`;
  return `<div class="panel"><div class="panel-head"><h2>This week, so far</h2><div class="spacer"></div><b style="font-size:20px">${eur(p.pendingTotal)}</b></div>
      <p class="hint">By the hour from book-on to book-off. +25% from 22:00 to 06:00, +50% on Sundays, a daily allowance over eight hours, the night allowance away from home,
        tips on excursions, bonuses for excellent work. Paid on Fridays at 18:00. Gross figures.</p>
      ${p.pending.length ? `<table><tbody>${p.pending.slice().reverse().map(line).join('')}</tbody></table>` : '<p class="muted">Nothing yet this week.</p>'}</div>
    <div class="panel"><div class="panel-head"><h2>Payslips</h2><div class="spacer"></div><span class="muted">${eur(p.earned)} paid in all</span></div>
      ${p.payslips.length ? p.payslips.map((s) => `<details><summary style="cursor:pointer;padding:6px 0"><b>${esc(s.number)}</b> · week to ${esc(gt(s.periodEnd))} · <b>${eur(s.gross)}</b></summary>
        <table><tbody>${s.lines.map(line).join('')}</tbody></table></details>`).join('') : '<p class="muted">The first comes on Friday.</p>'}</div>`;
}

/* ============================================================ Settings and log */

function viewSettings() {
  return `<div class="panel"><h3 class="sect">Settings</h3>
    <div class="grid2">
      <label>Company names<select id="se-roster"><option value="Real">Real companies</option><option value="Invented">Invented companies</option></select></label>
      <label>Breaks<select id="se-breaks"><option value="false">Off: the game's lines leave no room for them</option><option value="true">On: the 45-minute break after 4h30 at the wheel</option></select>
        <span class="hint">On, a leg over 4h30 is timetabled with its break, and driving past 4h30 without one is an infringement.</span></label>
      <label class="span2">Anthropic API key<input id="se-key" type="password" placeholder="${S.settings.hasApiKey ? 'A key is saved. Paste a new one to replace it.' : 'For reading screenshots of the job menus'}"></label>
      <label>Model<input id="se-model" value="${esc(S.settings.model)}"></label>
    </div>
    ${S.coach ? `<h3 class="sect">The coach: the company's lines</h3>
    <p class="hint">The Dispatcher's damage lines by default. Damage at or over each one: worth a look at the next depot, then the shop (no passengers beyond the run home), then a review (no passengers at all), then out of service.</p>
    <div class="grid3">
      <label>Worth a look at (%)<input id="se-watch" type="number" min="1" value="${S.coach.policy.watchPct}"></label>
      <label>Shop at (%)<input id="se-shop" type="number" min="1" value="${S.coach.policy.shopPct}"></label>
      <label>Review at (%)<input id="se-review" type="number" min="1" value="${S.coach.policy.reviewPct}"></label>
      <label>Out of service at (%)<input id="se-oos" type="number" min="1" value="${S.coach.policy.outOfServicePct}"></label>
      <label>Service every (km)<input id="se-svc" type="number" min="5000" step="1000" value="${S.coach.policy.serviceIntervalKm}"></label>
      <label>Safety inspection every (days)<input id="se-insp" type="number" min="7" value="${S.coach.policy.inspectionIntervalDays}"></label>
    </div>` : ''}
    <div class="row-actions">${S.settings.hasApiKey ? '<button class="btn ghost" id="se-clearkey">Remove the key</button>' : ''}<div class="spacer"></div><button class="btn go" id="se-save">Save</button></div></div>
    <div class="panel"><h3 class="sect">Start again</h3><p class="hint">A new career from the first screen. The old one is kept in the backups folder.</p>
      <div class="row-actions"><input id="se-reset" placeholder="Type RESET" style="max-width:200px"><button class="btn bad" id="se-reset-go">Start again</button></div></div>
    <p class="muted">TruckSim Coach Driver ${esc(S.version)}</p>`;
}
const viewLog = () => `<div class="panel log"><h3 class="sect">The log</h3>${S.log.map((e) => `<p><span class="when">${esc(gt(e.gameTime))}</span>${badge('', e.channel)} ${esc(e.message)}</p>`).join('') || '<p class="muted">Nothing yet.</p>'}</div>`;

/* ============================================================ wiring */

function wireCommon() {
  document.querySelectorAll('[data-tab-go]').forEach((b) => b.onclick = () => { TAB = b.dataset.tabGo; render(); });
  document.querySelectorAll('[data-lost]').forEach((b) => b.onclick = () => { LOST_OPEN = true; TAB = 'run'; render(); $('r-lost-box')?.scrollIntoView({ block: 'center' }); });
  document.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => { const [city, cc] = b.dataset.open.split('|'); act(() => api('/depots/open', 'POST', { city, cc })); });
  document.querySelectorAll('[data-transfer]').forEach((b) => b.onclick = () => { const [city, cc] = b.dataset.transfer.split('|'); act(() => api('/depots/transfer', 'POST', { city, cc })); });
}

/* Screenshots arrive pasted, dropped or chosen, as many as the menu takes to show: up to 24, as the company-driver
   app takes them. Each is downscaled to a long edge that stays legible without burning image tokens, kept as PNG so
   the game's text stays crisp, with a thumbnail for the strip. */
const MAX_SHOTS = 24, MAX_EDGE = 2000;
function stage(files) {
  for (const f of files) {
    if (!f || !/^image\/(png|jpe?g)$/.test(f.type)) continue;
    if (STAGED.length >= MAX_SHOTS) { toast(`${MAX_SHOTS} screenshots is the most for one read.`, true); break; }
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const draw = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); return c; };
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const t = Math.min(1, 240 / Math.max(w, h));
        if (STAGED.length >= MAX_SHOTS) return;
        STAGED.push({ mediaType: 'image/png', dataBase64: draw(w, h).toDataURL('image/png').split(',')[1],
          thumb: draw(Math.round(w * t), Math.round(h * t)).toDataURL('image/png') });
        render();
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(f);
  }
}
document.addEventListener('paste', (e) => {
  if (TAB !== 'today' || !S?.settings?.hasApiKey) return;
  const files = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile());
  if (files.length) { e.preventDefault(); stage(files); toast(`${files.length} screenshot${files.length > 1 ? 's' : ''} staged.`); }
});

const wire = {
  today() {
    wireCommon();
    if ($('t-bought')) $('t-bought').onclick = () => act(() => api('/coach/bought', 'POST', {}));
    if ($('t-handback')) $('t-handback').onclick = () => act(() => api('/duty/handback', 'POST', { why: 'gone from the menu' }));
    document.querySelectorAll('[data-accept]').forEach((b) => b.onclick = () => act(() => {
      const between = [...document.querySelectorAll('.bt-city')].map((el, i) => ({ city: el.value.trim(), cc: document.querySelectorAll('.bt-cc')[i].value.trim().toUpperCase() }));
      return api('/duty/accept', 'POST', { offerId: b.dataset.accept, between });
    }));
    if ($('b-clear')) $('b-clear').onclick = () => act(() => api('/board/clear', 'POST', {}));
    const drop = $('b-drop');
    if ($('b-file')) $('b-file').onchange = (e) => stage([...e.target.files]);
    if ($('b-unstage')) $('b-unstage').onclick = () => { STAGED = []; render(); };
    document.querySelectorAll('[data-unshot]').forEach((b) => b.onclick = () => { STAGED.splice(+b.dataset.unshot, 1); render(); });
    if (drop) {
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); stage([...e.dataTransfer.files]); };
    }
    if ($('b-read')) $('b-read').onclick = async () => {
      $('b-read').disabled = true; $('b-read').textContent = `Reading ${STAGED.length}…`;
      const r = await act(() => api('/board/read', 'POST', { images: STAGED.map((s) => ({ mediaType: s.mediaType, dataBase64: s.dataBase64 })),
        replace: $('b-replace').checked, menu: $('b-menu').value || null }));
      if (r) { STAGED = []; toast(`${r.added} job${r.added === 1 ? '' : 's'} read off the menu.${r.notes ? ' ' + r.notes : ''}`); render(); }
    };
    const menu = $('j-menu');
    if (menu) {
      menu.onchange = () => $('j-tour').classList.toggle('hidden', menu.value !== 'Tourist');
      $('j-more').onclick = () => $('j-stops').insertAdjacentHTML('beforeend', stopRow($('j-stops').children.length));
      $('j-add').onclick = () => act(async () => {
        const rows = [...document.querySelectorAll('#j-stops .stoprow')].map((r) => ({
          city: r.querySelector('.j-city').value.trim(), cc: r.querySelector('.j-cc').value.trim().toUpperCase(),
          station: r.querySelector('.j-station').value.trim(), time: r.querySelector('.j-time').value.trim(),
        })).filter((x) => x.city);
        const job = { menu: menu.value, stops: rows, passengers: num('j-pax'), pay: num('j-pay'), stopCount: num('j-count') };
        if (menu.value === 'Tourist') { job.landmark = $('j-landmark').value.trim(); job.landmarkScope = $('j-scope').value; }
        return api('/board/add', 'POST', { jobs: [job], replace: false });
      });
    }
    if ($('t-tour')) $('t-tour').onclick = () => act(() => api('/tour/start', 'POST', { days: parseInt($('t-days').value, 10) }));
    if ($('t-leg')) $('t-leg').onclick = () => act(() => api('/tour/leg', 'POST', whenOf('tl')));
    if ($('ck-go')) $('ck-go').onclick = () => act(() => api('/clock', 'POST', whenOf('ck')));
    if ($('po-go')) $('po-go').onclick = () => act(() => {
      const a = whenOf('pod'), b = whenOf('poa');
      return api('/position', 'POST', { city: $('po-city').value, cc: $('po-cc').value.toUpperCase(), departDay: a.day, departTime: a.time, arriveDay: b.day, arriveTime: b.time,
        damage: num('po-dmg'), damageCause: $('po-cause') ? $('po-cause').value : null });
    });
  },
  run() {
    wireCommon();
    const d = S.duty;
    if (!d) return;
    const n = nextStep(d);
    if ($('r-depart')) $('r-depart').onclick = () => act(() => api('/duty/depart', 'POST', { stop: n.i, ...whenOf('rd'), boarded: num('rd-on') }));
    if ($('r-swap')) $('r-swap').onclick = () => act(() => api('/duty/swap', 'POST', { stop: n.i }));
    if ($('r-lost-box')) $('r-lost-box').ontoggle = () => { LOST_OPEN = $('r-lost-box').open; };
    if ($('r-lost')) $('r-lost').onclick = async () => {
      const r = await act(() => api('/duty/handback', 'POST', { why: $('rl-why').value || 'game', ...whenOf('rl'),
        damage: num('rl-dmg'), damageCause: $('rl-cause') ? $('rl-cause').value : null }));
      if (r) { LOST_OPEN = false; TAB = 'today'; render(); }
    };
    if ($('r-handback')) $('r-handback').onclick = () => act(() => api('/duty/handback', 'POST', { why: 'gone from the menu' }));
    if ($('r-arrive')) $('r-arrive').onclick = () => act(() => api('/duty/arrive', 'POST', { stop: n.i, ...whenOf('ra'), alighted: num('ra-off'),
      pct: num('ra-pct'), veryHappy: num('ra-vh'), happy: num('ra-h'), unhappy: num('ra-u'), veryUnhappy: num('ra-vu'), breakMinutes: num('ra-break'),
      handoverDay: $('rh-tod') && $('rh-tod').value.trim() ? parseInt($('rh-day').value, 10) : null, handoverTime: $('rh-tod') ? $('rh-tod').value.trim() : null }));
    if ($('r-close')) $('r-close').onclick = async () => {
      const r = await act(() => api('/duty/close', 'POST', { satisfactionPct: num('c-pct'), veryHappy: num('c-vh'), happy: num('c-h'), unhappy: num('c-u'),
        veryUnhappy: num('c-vu'), fault: $('c-fault').value, delayReason: $('c-why').value, damage: num('c-dmg'), damageCause: $('c-cause').value }));
      if (r && r.closeout) { TAB = 'today'; render(); closeoutModal(r.closeout); }
    };
  },
  coach() {
    wireCommon();
    if ($('mx-go')) $('mx-go').onclick = () => act(() => {
      const kinds = [['mx-repair', 'Repair'], ['mx-service', 'Service'], ['mx-insp', 'Inspection'], ['mx-annual', 'Annual test']].filter(([id]) => $(id).checked).map(([, k]) => k);
      return api('/coach/maintenance', 'POST', { kinds, ...whenOf('mx'), damageAfter: num('mx-after'), cost: num('mx-cost'), note: $('mx-note').value });
    });
    if ($('rd2-go')) $('rd2-go').onclick = () => act(() => api('/coach/damage', 'POST', { damage: num('rd2-dmg'), cause: $('rd2-cause').value }));
  },
  routes() {
    $('rf-kind').value = ROUTE_FILTER.kind;
    $('rf-text').oninput = () => { ROUTE_FILTER.text = $('rf-text').value; const pos = $('rf-text').selectionStart; render(); $('rf-text').focus(); $('rf-text').setSelectionRange(pos, pos); };
    $('rf-kind').onchange = () => { ROUTE_FILTER.kind = $('rf-kind').value; render(); };
    $('rf-city').onchange = () => { ROUTE_FILTER.city = $('rf-city').value; render(); };
    document.querySelectorAll('[data-line]').forEach((tr) => tr.onclick = () => { OPEN_LINE = OPEN_LINE === tr.dataset.line ? '' : tr.dataset.line; render(); });
    if (ROUTE_FILTER.city) {
      const i = ROUTE_FILTER.city.lastIndexOf(', ');
      const city = i < 0 ? ROUTE_FILTER.city : ROUTE_FILTER.city.slice(0, i), cc = i < 0 ? '' : ROUTE_FILTER.city.slice(i + 2);
      api(`/routes/city?city=${encodeURIComponent(city)}&cc=${encodeURIComponent(cc)}`).then((v) => {
        const el = $('rf-cityview'); if (!el) return;
        const list = (xs, f) => xs.length ? `<ul style="margin:4px 0">${xs.map(f).join('')}</ul>` : '<p class="muted">None known.</p>';
        el.innerHTML = `<h3 class="sect">${esc(v.place)}</h3><div class="grid3">
          <div><b>Leaving</b>${list(v.departures, (x) => `<li>${esc(x.time)} to ${esc(x.to)} ${badge(x.kind === 'Night' ? 'warn' : '', x.kind)}</li>`)}</div>
          <div><b>Arriving</b>${list(v.arrivals, (x) => `<li>${esc(x.time)} from ${esc(x.from)}</li>`)}</div>
          <div><b>Calling here</b>${list(v.calls, (x) => `<li>${esc(x.from)} to ${esc(x.to)}</li>`)}</div></div>`;
      }).catch(() => {});
    }
  },
  career() {
    wireCommon();
    document.querySelectorAll('[data-apply]').forEach((b) => b.onclick = () => act(() => api('/jobs/apply', 'POST', { companyId: b.dataset.apply, homeDepot: $(`ap-${b.dataset.apply}`).value })));
    $('pf-save').onclick = () => act(() => api('/profile', 'POST', { coachLevel: parseInt($('pf-level').value, 10) || 0,
      skills: Object.fromEntries(SKILLS.map(([k]) => [k, parseInt($(`pf-${k}`).value, 10) || 0])) }));
  },
  settings() {
    $('se-roster').value = S.settings.roster;
    $('se-breaks').value = String(!!S.settings.breaks);
    $('se-save').onclick = () => act(() => api('/settings', 'POST', { roster: $('se-roster').value, breaks: $('se-breaks').value === 'true',
      anthropicApiKey: $('se-key').value, anthropicModel: $('se-model').value,
      maintenance: $('se-watch') ? { watchPct: num('se-watch'), shopPct: num('se-shop'), reviewPct: num('se-review'), outOfServicePct: num('se-oos'),
        serviceIntervalKm: num('se-svc'), inspectionIntervalDays: num('se-insp') } : null }));
    if ($('se-clearkey')) $('se-clearkey').onclick = () => act(() => api('/settings', 'POST', { clearApiKey: true }));
    $('se-reset-go').onclick = () => act(() => api('/reset', 'POST', { confirm: $('se-reset').value }));
  },
};

(async () => {
  try { S = await api('/bootstrap'); render(); }
  catch (e) { $('boot').textContent = 'Could not reach the app: ' + e.message; }
})();
