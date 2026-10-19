/* TruckSim Owner-Operator — the page. Plain script, no build step, like the company-driver app. */
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hhmm = (h) => { if (h == null) return '--'; const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method, headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw new Error(json?.error || text || `Request failed (${r.status})`);
  return json;
}

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

let S = null;          // the last snapshot
let tab = 'board';
let preview = [];      // rows read off screenshots, waiting to be confirmed

const ADR = ['Explosives', 'Gases', 'Flammable liquids', 'Flammable solids', 'Toxic', 'Corrosive'];
const PRESETS = {
  Easy: 'A mid-age truck and a generous nest egg. Room to learn.',
  Normal: 'An older truck and a nest egg sized to cash flow. The intended game.',
  Hard: 'An older truck and the legal minimum. Every load counts.',
};

// ---------------------------------------------------------------- first screen

async function showStart() {
  $('boot').classList.add('hidden');
  $('app').classList.add('hidden');
  $('start').classList.remove('hidden');
  $('st-adr').innerHTML = ADR.map((a) => `<label><input type="checkbox" value="${esc(a)}"> ${esc(a)}</label>`).join('');
  $('st-preset').innerHTML = Object.keys(PRESETS).map((p) =>
    `<label><input type="radio" name="preset" value="${p}" ${p === 'Normal' ? 'checked' : ''}> ${p}</label>`).join('');
  const hint = () => { $('st-preset-hint').textContent = PRESETS[document.querySelector('input[name=preset]:checked').value]; };
  document.querySelectorAll('input[name=preset]').forEach((r) => r.addEventListener('change', hint));
  hint();
  try {
    const cities = await api('/cities');
    $('st-cities').innerHTML = cities.map((c) => `<option value="${esc(c.city)}, ${esc(c.state)}">`).join('');
  } catch { /* typing still works */ }
  $('st-go').onclick = startCareer;
}

async function startCareer() {
  const home = $('st-home').value.split(',').map((x) => x.trim());
  const body = {
    game: 'ATS',
    driverName: $('st-name').value,
    homeCity: home[0] || '',
    homeState: home[1] || '',
    day: Number($('st-day').value),
    time: $('st-time').value,
    level: Number($('st-level').value),
    longDistance: Number($('st-ld').value),
    highValue: Number($('st-hv').value),
    fragile: Number($('st-fr').value),
    justInTime: Number($('st-jit').value),
    adr: [...document.querySelectorAll('#st-adr input:checked')].map((i) => i.value),
    odometer: Number($('st-odo').value),
    preset: document.querySelector('input[name=preset]:checked').value,
  };
  try {
    S = await api('/start', 'POST', body);
    $('start').classList.add('hidden');
    showApp();
  } catch (e) {
    $('st-error').textContent = e.message;
    $('st-error').classList.remove('hidden');
  }
}

// ---------------------------------------------------------------- app shell

const TABS = [['board', 'Board'], ['brokers', 'Brokers'], ['money', 'Money'], ['home', 'Home'], ['truck', 'Truck & clocks'], ['settings', 'Settings'], ['log', 'Log']];

function showApp() {
  $('boot').classList.add('hidden');
  $('app').classList.remove('hidden');
  render();
}

function render() {
  $('brand-name').textContent = S.profile.driverName;
  $('brand-sub').textContent = `Home: ${S.profile.homeCity}, ${S.profile.homeState} · ${S.profile.preset}`;
  $('ver').textContent = `v${S.version}`;
  const h = S.hos;
  const stat = (k, v, cls = '') => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`;
  $('stats').innerHTML =
    stat('Where', `${S.status.city}, ${S.status.state}`) +
    stat('Clock', S.status.pretty) +
    stat('Drive', hhmm(h.drive), h.drive < 1 ? 'warn' : 'ok') +
    stat('Shift', hhmm(h.shift), h.shift < 1 ? 'warn' : 'ok') +
    stat('Cycle', hhmm(h.cycle), h.cycle < 11 ? 'warn' : 'ok') +
    stat('Cost', `${money(S.settings.costPerMile)}/${S.settings.distanceUnit}`) +
    stat('Can spend', S.gameBank.allowedToSpend == null ? '--' : money(S.gameBank.allowedToSpend), S.gameBank.notYours > 0 ? 'warn' : '') +
    stat('Home life', `${S.home.score} ${S.home.band}`, S.home.score >= 70 ? 'ok' : S.home.score >= 40 ? 'warn' : 'bad');
  $('tabs').innerHTML = TABS.map(([id, name]) => `<button class="${id === tab ? 'on' : ''}" data-tab="${id}">${name}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach((b) => b.onclick = () => { tab = b.dataset.tab; render(); });
  const views = { board: boardView, brokers: brokersView, money: moneyView, home: homeView, truck: truckView, settings: settingsView, log: logView };
  $('view').innerHTML = homeBanner() + views[tab]();
  ({ board: wireBoard, brokers: wireBrokers, money: wireMoney, home: wireHome, truck: wireTruck, settings: wireSettings, log: () => {} })[tab]();
  wireHomeBanner();
  const pending = (S.transfers || []).filter((t) => t.status === 'Pending').length;
  const mt = $('tabs').querySelector('[data-tab=money]');
  if (pending && mt) mt.innerHTML += ` <span class="pip amber">${pending}</span>`;
}

// ---------------------------------------------------------------- board

function firstLoadWalkthrough() {
  const hasBoard = (S.board || []).length > 0;
  const called = !!S.lastCall;
  const step = !hasBoard ? 1 : !called ? 3 : 4;
  const li = (n, html) => `<li class="${n < step ? 'done' : n === step ? 'now' : ''}">${html}</li>`;
  return `<div class="panel"><div class="panel-head"><h2>Your first load</h2></div>
    <ol class="walk">
      ${li(1, `<b>In the game</b>, at your home garage in ${esc(S.profile.homeCity)}, open the <b>Freight Market</b> and
        take a screenshot of the board. With no trailer of your own it is the Freight Market, not the Cargo Market.`)}
      ${li(2, '<b>Paste the screenshot below</b> (Ctrl+V), check what was read, and add it.')}
      ${li(3, `<b>Call a starter broker</b> on the <a href="#" data-goto="brokers">Brokers</a> tab. The broker reads the board
        and makes the offer: which job, and at what rate. New authorities get the leftovers.`)}
      ${li(4, '<b>Negotiate, take it, or try another broker.</b> The ranked board below is your own view of what is really on offer.')}
      ${li(5, '<b>Take that job in the game</b>, at the rate you booked.')}
    </ol></div>`;
}

function bookingBanner() {
  const k = S.booking;
  if (!k) return '';
  const l = k.load;
  return `<div class="callout ok"><h4>Booked: ${esc(k.number)} with ${esc(k.brokerName)}</h4>
    <p><b>Take this job in the game:</b> ${esc(l.cargo)} from ${esc(l.shipper || l.originCity)} in ${esc(l.originCity)}
      to ${esc(l.receiver || l.destCity)} in ${esc(l.destCity)}, ${esc(l.destState)}.</p>
    <p>The broker pays <b>${money(k.rate)}</b>${k.quickPay ? ' on quick pay' : `, net ${k.daysToPay}`}. The game will pay
      ${money(k.gamePay)} at delivery: that is the shipper's money passing through, not yours.
      ${k.detentionPerHour ? `Detention ${money(k.detentionPerHour)}/h after ${k.detentionAfterHours} h.` : ''}</p>
    <div class="grid4">
      <label>Delivered, game day<input id="dl-day" type="number" min="1" value="${S.status.day ?? 1}"></label>
      <label>Time<input id="dl-time" placeholder="HH:MM"></label>
      <label>Odometer<input id="dl-odo" type="number" value="${S.status.odometer}"></label>
      <div class="row-actions"><button class="btn go" id="dl-go">Delivered</button></div>
    </div></div>`;
}

function boardView() {
  const loads = S.board || [];
  const intro = (S.bookings || []).length === 0 ? firstLoadWalkthrough() : '';
  return bookingBanner() + intro + `
    <div class="panel">
      <div class="panel-head"><h2>Add from screenshots</h2><span class="sub">Paste (Ctrl+V) or drop a Freight Market screenshot</span></div>
      <div class="dropzone" id="drop">Paste or drop screenshots here${S.settings.hasApiKey ? '' : ' — needs an Anthropic API key in Settings'}</div>
      <div id="preview"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Add by hand</h2></div>
      <div class="grid2">
        <label>Cargo<input id="ad-cargo"></label>
        <label>Destination<input id="ad-dest" placeholder="City, ST"></label>
        <label>Loaded ${esc(S.settings.distanceUnit)}<input id="ad-miles" type="number" min="1"></label>
        <label>Pay<input id="ad-pay" type="number" min="0"></label>
        <label class="span2">Delivery window<input id="ad-window" placeholder="as listed, e.g. Sat 5:48 am - Sat 12:28 pm CDT"></label>
      </div>
      <div class="row-actions"><button class="btn" id="ad-go">Add to board</button></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>The board, ranked</h2><span class="sub">${loads.length} load(s) at ${esc(S.status.city)}</span>
        <span class="spacer"></span>${loads.length ? '<button class="btn tiny ghost" id="bd-clear">Clear</button>' : ''}</div>
      ${loads.length ? loads.map(loadCard).join('') : '<div class="empty">Nothing on the board yet.</div>'}
    </div>`;
}

function loadCard(v) {
  const f = v.feasibility, l = v.load;
  const verdict = f.verdict === 'Feasible' ? 'ok' : f.verdict === 'Tight' ? 'warn' : 'bad';
  const notes = [...(v.skillNotes || []), ...(f.blockers || []), ...(f.warnings || []), ...(v.notes || [])];
  return `<div class="loadcard">
    <div class="loadcard-head">
      <span class="badge mute">#${v.rank}</span>
      <b>${esc(l.cargo)}</b> to <b>${esc(l.destCity)}, ${esc(l.destState)}</b>
      <span class="badge ${verdict}">${esc(f.verdict)}</span>
      <span class="spacer"></span>
      <button class="btn tiny ghost" data-del="${esc(l.id)}">Remove</button>
    </div>
    <div class="figs">
      <div><div class="k">Game pay</div><div class="money">${money(v.gamePay)}</div></div>
      <div><div class="k">Cost</div><div class="money">${money(v.cost)}</div></div>
      <div><div class="k">Leaves</div><div class="money ${v.netAtGamePay >= 0 ? 'pos' : 'neg'}">${money(v.netAtGamePay)}</div></div>
      <div><div class="k">Per day</div><div class="money ${v.netPerDay >= 0 ? 'pos' : 'neg'}">${money(v.netPerDay)}</div></div>
      <div><div class="k">Distance</div><div class="money">${Math.round(v.miles)} ${esc(S.settings.distanceUnit)}</div></div>
      <div><div class="k">Days</div><div class="money">${v.days}</div></div>
      <div><div class="k">Slack</div><div class="money">${f.slackHours != null ? hhmm(f.slackHours) : '--'}</div></div>
    </div>
    ${notes.length ? `<ul class="reasons">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function renderPreview() {
  const el = $('preview');
  if (!el) return;
  if (!preview.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<p class="hint">Check what was read, untick anything wrong, then add.</p>` +
    preview.map((r, i) => `<div class="previewrow">
      <input type="checkbox" data-pick="${i}" checked>
      <span>${esc(r.cargo)}</span>
      <span>${esc(r.destCity)}, ${esc(r.destState)}</span>
      <span>${Math.round(r.loadedMiles)} ${esc(S.settings.distanceUnit)}</span>
      <span>${money(r.gameRevenue)}</span>
      <span class="hint">${esc(r.windowText)}</span>
    </div>`).join('') +
    `<div class="row-actions"><button class="btn primary" id="pv-add">Add ticked rows</button>
     <button class="btn ghost" id="pv-drop">Discard</button></div>`;
  $('pv-add').onclick = async () => {
    const picked = preview.filter((_, i) => document.querySelector(`[data-pick="${i}"]`).checked);
    const r = await api('/board/add-many', 'POST', picked);
    preview = [];
    S = r.snapshot;
    (r.refused || []).forEach((x) => toast(`${x.cargo} to ${x.destCity}: ${x.reason}`, 'warn'));
    render();
  };
  $('pv-drop').onclick = () => { preview = []; renderPreview(); };
}

async function readImages(files) {
  const images = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const b64 = await new Promise((res) => {
      const rd = new FileReader();
      rd.onload = () => res(String(rd.result).split(',')[1]);
      rd.readAsDataURL(f);
    });
    images.push({ mediaType: f.type, dataBase64: b64 });
  }
  if (!images.length) return;
  $('drop').textContent = 'Reading…';
  try {
    const r = await api('/board/extract', 'POST', { images });
    if (!r.ok) throw new Error(r.error || 'Could not read the screenshot.');
    preview = r.loads;
    renderPreview();
  } catch (e) { toast(e.message, 'bad'); }
  $('drop').textContent = 'Paste or drop screenshots here';
}

function wireBoard() {
  const dl = $('dl-go');
  if (dl) dl.onclick = async () => {
    try {
      const r = await api('/deliver', 'POST', { day: Number($('dl-day').value), time: $('dl-time').value, odometer: Number($('dl-odo').value) });
      S = r.snapshot;
      toast(`${r.invoice.number} raised: ${money(r.invoice.amount)} due from ${r.invoice.brokerName}.`);
      tab = 'money'; render();
    } catch (e) { toast(e.message, 'bad'); }
  };
  document.querySelectorAll('[data-goto]').forEach((a) => a.onclick = (e) => { e.preventDefault(); tab = a.dataset.goto; render(); });
  const drop = $('drop');
  drop.ondragover = (e) => { e.preventDefault(); };
  drop.ondrop = (e) => { e.preventDefault(); readImages([...e.dataTransfer.files]); };
  document.onpaste = (e) => {
    if (tab !== 'board') return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) readImages(files);
  };
  renderPreview();
  $('ad-go').onclick = async () => {
    const dest = $('ad-dest').value.split(',').map((x) => x.trim());
    try {
      const r = await api('/board/add-many', 'POST', [{
        cargo: $('ad-cargo').value, destCity: dest[0] || '', destState: dest[1] || '',
        loadedMiles: Number($('ad-miles').value), gameRevenue: Number($('ad-pay').value),
        windowText: $('ad-window').value, notes: 'Typed in',
      }]);
      S = r.snapshot;
      (r.refused || []).forEach((x) => toast(x.reason, 'warn'));
      render();
    } catch (e) { toast(e.message, 'bad'); }
  };
  const clear = $('bd-clear');
  if (clear) clear.onclick = async () => { S = await api('/board/clear', 'POST'); render(); };
  document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    S = await api(`/board/${b.dataset.del}`, 'DELETE'); render();
  });
}

// ---------------------------------------------------------------- brokers and the phone

let brokerFilter = 'here';

function brokersView() {
  const dir = S.directory || [];
  const shown = dir
    .filter((b) => brokerFilter === 'all' || (brokerFilter === 'here' ? b.worksHere : b.takesYou))
    .sort((a, b) => (b.takesYou - a.takesYou) || ['Starter', 'Established', 'Premium'].indexOf(a.tier) - ['Starter', 'Established', 'Premium'].indexOf(b.tier));
  const r = S.record;
  const tierBadge = (t) => `<span class="badge ${t === 'Starter' ? 'mute' : t === 'Established' ? 'info' : 'violet'}">${esc(t)}</span>`;
  return phoneView() + `<div class="panel">
    <div class="panel-head"><h2>Broker directory</h2>
      <span class="sub">Your record: ${r.loads} load(s), ${r.onTimePct}% on time, ${r.daysWithAuthority} day(s) with your authority</span>
      <span class="spacer"></span>
      <select id="br-filter">
        <option value="here" ${brokerFilter === 'here' ? 'selected' : ''}>Work ${esc(S.status.state)}'s region</option>
        <option value="takes" ${brokerFilter === 'takes' ? 'selected' : ''}>Will take my call</option>
        <option value="all" ${brokerFilter === 'all' ? 'selected' : ''}>Everyone I know</option>
      </select></div>
    ${shown.length ? `<div class="tablewrap"><table class="grid"><thead><tr>
        <th>Broker</th><th>Tier</th><th>Based</th><th>Works</th><th>Pays</th><th>Credit</th><th>Requirement</th><th>Notes</th><th></th>
      </tr></thead><tbody>${shown.map((b) => `<tr>
        <td><b>${esc(b.name)}</b><div class="hint">${esc(b.rep)}${b.loadsBooked ? ` · ${b.loadsBooked} load(s) with you` : ''}</div></td>
        <td>${tierBadge(b.tier)}</td>
        <td>${esc(b.city)}, ${esc(b.state)}</td>
        <td>${esc(b.regions.join(', '))}</td>
        <td>net ${b.daysToPay}<div class="hint">quick pay ${b.quickPayFeePct}%</div></td>
        <td>${esc(b.credit)}</td>
        <td>${b.takesYou ? '<span class="badge ok">Will take you</span>' : `<span class="hint">${esc(b.requirement)}</span>`}</td>
        <td class="hint">${esc((b.notes || []).join(' '))}</td>
        <td><button class="btn tiny ${b.takesYou && b.worksHere ? 'primary' : ''}" data-call="${esc(b.id)}">Call</button></td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nobody in this view yet.</div>'}
  </div>`;
}

function phoneView() {
  const c = S.call || (S.lastCall && S.lastCall.status !== 'Open' ? S.lastCall : null);
  if (!c) return '';
  const open = c.status === 'Open';
  const view = (S.board || []).find((v) => c.load && v.load.id === c.load.id);
  const net = view ? c.offer - view.cost : null;
  const turns = (c.turns || []).map((t) => `<div class="turn ${t.who}"><b>${t.who === 'broker' ? esc(c.rep) : 'You'}:</b> ${esc(t.text)}</div>`).join('');
  return `<div class="panel phone">
    <div class="panel-head"><h2>On the phone: ${esc(c.rep)}, ${esc(c.broker)}</h2>
      <span class="badge ${open ? 'warn' : c.status === 'Booked' ? 'ok' : 'mute'}">${open ? esc(c.mood) : esc(c.status)}</span></div>
    ${c.load && open ? `<div class="figs">
      <div><div class="k">Offer</div><div class="money">${money(c.offer)}</div></div>
      <div><div class="k">The load</div><div class="money">${esc(c.load.cargo)} to ${esc(c.load.destCity)}, ${esc(c.load.destState)}</div></div>
      ${view ? `<div><div class="k">Your cost</div><div class="money">${money(view.cost)}</div></div>
      <div><div class="k">Leaves you</div><div class="money ${net >= 0 ? 'pos' : 'neg'}">${money(net)}</div></div>
      <div><div class="k">Verdict</div><div class="money">${esc(view.feasibility.verdict)}</div></div>` : ''}
    </div>` : ''}
    <div class="transcript">${turns}</div>
    ${open ? `<div class="sayrow">
        <input id="ph-text" placeholder="${S.aiPhone ? 'Say something, e.g. 2,150 and you pay detention, Lyon is dead this week' : 'Type a figure, or use the buttons'}">
        <button class="btn primary" id="ph-say">Say</button></div>
      <div class="row-actions">
        <button class="btn go" data-move="accept">Take it at ${money(c.offer)}</button>
        <label class="inline">Counter <input id="ph-amount" type="number" step="5" value="${Math.round(c.offer * 1.1 / 5) * 5}"></label>
        <span class="chkrow" id="ph-args">
          <label><input type="checkbox" value="deadMarket"> Dead market</label>
          <label><input type="checkbox" value="deadhead"> Deadhead</label>
          <label><input type="checkbox" value="tight"> Tight window</label>
          <label><input type="checkbox" value="record"> My record</label>
          <label><input type="checkbox" value="walk"> Or I walk</label>
        </span>
        <button class="btn" data-move="counter">Counter</button>
        <button class="btn ghost" data-move="better">Anything better?</button>
        <button class="btn ghost" data-move="quickpay">Quick pay?</button>
        <button class="btn ghost" data-move="detention">Detention?</button>
        <button class="btn danger" data-move="decline">Pass</button>
      </div>` : ''}
  </div>`;
}

async function say(body) {
  const c = S.call;
  try {
    const r = await api(`/calls/${c.id}/say`, 'POST', body);
    S = r.snapshot;
    if (r.call.status === 'Booked') toast('Booked. Take the job in the game.');
    render();
  } catch (e) { toast(e.message, 'bad'); }
}

function wireBrokers() {
  const f = $('br-filter');
  if (f) f.onchange = () => { brokerFilter = f.value; render(); };
  document.querySelectorAll('[data-call]').forEach((b) => b.onclick = async () => {
    try {
      const r = await api('/calls', 'POST', { brokerId: b.dataset.call });
      S = r.snapshot;
      if (!S.call) S.lastCall = r.call;
      render();
    } catch (e) { toast(e.message, 'bad'); }
  });
  const text = $('ph-text');
  if (text) {
    const go = () => { if (text.value.trim()) say({ text: text.value.trim() }); };
    $('ph-say').onclick = go;
    text.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }
  document.querySelectorAll('[data-move]').forEach((b) => b.onclick = () => {
    const m = b.dataset.move;
    if (m === 'counter') {
      say({ kind: 'counter', amount: Number($('ph-amount').value),
        arguments: [...document.querySelectorAll('#ph-args input:checked')].map((i) => i.value) });
    } else if (m === 'quickpay' || m === 'detention') say({ kind: 'terms', term: m });
    else say({ kind: m });
  });
}

// ---------------------------------------------------------------- money

function moneyView() {
  const tr = S.transfers || [], inv = S.invoices || [], g = S.gameBank, h = S.holding;
  const pending = tr.filter((t) => t.status === 'Pending'), done = tr.filter((t) => t.status === 'Done');
  return `<div class="panel"><div class="panel-head"><h2>Game bank</h2>
      <span class="sub">Only money you are allowed to spend should stay in it.</span></div>
    <div class="figs">
      <div><div class="k">Allowed to spend</div><div class="money big ${g.allowedToSpend == null ? '' : 'pos'}">${g.allowedToSpend == null ? 'Report it below' : money(g.allowedToSpend)}</div></div>
      <div><div class="k">In the game bank</div><div class="money">${g.estimate == null ? '--' : money(g.estimate)}</div></div>
      <div><div class="k">Not yours: to move</div><div class="money ${g.notYours > 0 ? 'neg' : ''}">${money(g.notYours)}</div></div>
    </div>
    <p class="hint">${g.reported == null ? 'Tell the app what the game bank shows, and it keeps track from there.'
      : `Read ${esc(g.reportedGameTime.replace('T', ' '))} at ${money(g.reported)}, kept current since by deliveries and the moves you mark done. Spending in the game is not seen: read it again after you spend.`}</p>
    <div class="sayrow"><input id="gb-bal" type="number" step="0.01" placeholder="Game bank balance, as the game shows it">
      <button class="btn" id="gb-save">Update</button></div>
  </div>
  <div class="panel"><div class="panel-head"><h2>Transfers to make</h2>
      <span class="sub">In the GDC Companion App. This app never moves money: it says what, which way and when.</span></div>
    ${S.gameRunning && pending.some((t) => t.needsGameClosed) ? `<div class="callout"><p>The game is running. Moves out of the
      game bank can only be made with it closed.</p></div>` : ''}
    ${pending.length ? pending.map((t) => `<div class="loadcard">
        <div class="loadcard-head"><b>${money(t.amount)}</b>&nbsp;${esc(t.from)} → ${esc(t.to)}
          ${t.needsGameClosed ? '<span class="badge warn">game closed</span>' : ''}<span class="spacer"></span>
          <button class="btn tiny go" data-done="${esc(t.id)}" ${t.needsGameClosed && S.gameRunning ? 'disabled' : ''}>I've moved it</button></div>
        <p class="hint">${esc(t.reason)}</p></div>`).join('') : '<div class="empty">Nothing to move.</div>'}
  </div>
  <div class="panel"><div class="panel-head"><h2>Broker holding</h2><span class="sub">The Companion App account delivery pay waits in</span></div>
    <div class="figs">
      <div><div class="k">Should hold</div><div class="money">${money(h.balance)}</div></div>
      <div><div class="k">Waiting on brokers</div><div class="money">${money(h.waitingOnBrokers)}</div></div>
      <div><div class="k">Brokers' share</div><div class="money">${money(h.brokersShare)}</div></div>
      <div><div class="k">Yours to move out</div><div class="money ${h.yoursToMove > 0 ? 'pos' : ''}">${money(h.yoursToMove)}</div></div>
    </div>
    <p class="hint">The game's pay for every load goes in. When a broker pays, your rate comes out to your account; the rest of
      that load's pay is the broker's share and stays.</p></div>
  <div class="panel"><div class="panel-head"><h2>Owed to you</h2><span class="sub">${money(S.owedToYou)} outstanding</span></div>
    ${inv.length ? `<div class="tablewrap"><table class="grid"><thead><tr><th>Invoice</th><th>Load</th><th>Broker</th><th>Rate</th><th>Game paid</th><th>Due</th><th>Status</th></tr></thead>
      <tbody>${inv.map((i) => `<tr><td>${esc(i.number)}</td><td>${esc(i.bookingNumber)}</td><td>${esc(i.brokerName)}</td>
        <td>${money(i.amount)}</td><td>${money(i.gamePay)}</td><td>${esc(i.dueGameTime.replace('T', ' '))}</td>
        <td><span class="badge ${i.status === 'Paid' ? 'ok' : 'warn'}">${esc(i.status)}</span></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No invoices yet. Deliver a booked load and the broker owes you.</div>'}
  </div>
  ${done.length ? `<div class="panel"><div class="panel-head"><h2>Moved</h2></div>
    ${done.map((t) => `<div class="hint">${money(t.amount)} ${esc(t.from)} → ${esc(t.to)} (${esc(t.reference)})</div>`).join('')}</div>` : ''}`;
}

function wireMoney() {
  $('gb-save').onclick = async () => {
    try { S = await api('/bank', 'POST', { balance: Number($('gb-bal').value) }); toast('Game bank updated.'); render(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  document.querySelectorAll('[data-done]').forEach((b) => b.onclick = async () => {
    try { S = await api(`/transfers/${b.dataset.done}/done`, 'POST'); render(); } catch (e) { toast(e.message, 'bad'); }
  });
}

// ---------------------------------------------------------------- home

function homeBanner() {
  const h = S.home;
  if (!h) return '';
  if (h.bottomUntil) return `<div class="callout bad"><h4>Home life has hit bottom</h4>
    <p>Go home. No broker will book you until ${esc(h.bottomUntil.replace('T', ' '))}, and the truck's costs keep running.</p></div>`;
  if (h.call) return `<div class="callout bad"><h4>Home called</h4><p>${esc(h.call.reason)} Be home by
    ${esc(h.call.beHomeByGameTime.replace('T', ' '))}.</p>
    ${S.booking ? `<p>You are booked on ${esc(S.booking.number)}. Deliver it on the way if you can, or hand it back: that is a
      cancellation on your record with ${esc(S.booking.brokerName)}.</p>
      <div class="row-actions"><button class="btn danger" id="hb-go">Hand ${esc(S.booking.number)} back</button></div>` : ''}</div>`;
  if (h.holiday) return `<div class="callout"><p><b>${esc(h.holiday)}.</b> Freight is quiet and brokers keep more of it. A good time to be home: days at home count double.</p></div>`;
  return '';
}

function wireHomeBanner() {
  const hb = $('hb-go');
  if (hb) hb.onclick = async () => {
    if (!confirm('Hand the load back? It goes on your record as a cancellation.')) return;
    try { S = await api('/booking/handback', 'POST', { why: 'needed at home' }); render(); } catch (e) { toast(e.message, 'bad'); }
  };
}

function homeView() {
  const h = S.home;
  return `<div class="panel"><div class="panel-head"><h2>Home life</h2><span class="sub">${h.score} of 100: ${esc(h.band)}</span></div>
      <div class="meter"><div class="bar" style="width:${h.score}%"></div></div>
      <p>${h.atHome ? `You are home in ${esc(S.profile.homeCity)}.` : `Out ${h.daysOut} day(s). ${h.dueHomeInDays >= 0
        ? `Due home in ${h.dueHomeInDays} day(s).` : `<b>${-h.dueHomeInDays} day(s) past your promise.</b>`}`}</p>
      <p class="hint">It drops a little each day out, faster past your promise, and recovers at home. A full home time as promised
        counts for more. Below 40, home starts to call; at 0 you go home for a week whatever is booked.</p></div>
    <div class="panel"><div class="panel-head"><h2>Dates at home</h2></div>
      ${h.dates.length ? h.dates.map((d) => `<div><b>Day ${d.day}</b>: ${esc(d.title)}</div>`).join('') : '<div class="empty">Nothing on the calendar.</div>'}
      ${h.recent.length ? `<p class="hint">${h.recent.map((d) => `Day ${d.day}, ${esc(d.title)}: ${d.status === 'Made' ? 'made it' : 'missed'}`).join(' · ')}</p>` : ''}</div>
    <div class="panel"><div class="panel-head"><h2>Your promise</h2></div>
      <div class="grid2">
        <label>Home every (days)<input id="hp-every" type="number" min="5" max="42" value="${h.everyDays}"></label>
        <label>For (days)<input id="hp-for" type="number" min="1" max="10" value="${h.homeDays}"></label>
      </div>
      <p class="hint">Change it if you need to, but not every week: each change costs a little.</p>
      <div class="row-actions"><button class="btn primary" id="hp-save">Save</button></div></div>`;
}

function wireHome() {
  $('hp-save').onclick = async () => {
    try {
      S = await api('/home/promise', 'POST', { everyDays: Number($('hp-every').value), homeDays: Number($('hp-for').value) });
      toast('Promise saved.'); render();
    } catch (e) { toast(e.message, 'bad'); }
  };
}

// ---------------------------------------------------------------- truck & clocks

function truckView() {
  const st = S.status, h = S.hos;
  const [, time] = (st.gameTime || 'T00:00').split('T');
  return `<div class="panel"><div class="panel-head"><h2>Where and when</h2></div>
      <div class="grid2">
        <label>City<input id="tr-city" value="${esc(st.city)}"></label>
        <label>State<input id="tr-state" class="up" value="${esc(st.state)}"></label>
        <label>Game day<input id="tr-day" type="number" min="1" value="${st.day ?? 1}"></label>
        <label>Time<input id="tr-time" value="${esc(time)}"></label>
        <label>Odometer<input id="tr-odo" type="number" value="${st.odometer}"></label>
        <label>Fuel %<input id="tr-fuel" type="number" min="0" max="100" value="${st.fuelPct}"></label>
      </div>
      <div class="row-actions"><button class="btn primary" id="tr-save">Save</button></div></div>
    <div class="panel"><div class="panel-head"><h2>Clocks</h2><span class="sub">Hours left on each, from the game</span></div>
      <div class="skillgrid">
        <label>Drive<input id="hs-drive" type="number" step="0.01" value="${h.drive}"></label>
        <label>Shift<input id="hs-shift" type="number" step="0.01" value="${h.shift}"></label>
        <label>Break<input id="hs-brk" type="number" step="0.01" value="${h.brk}"></label>
        <label>Cycle<input id="hs-cycle" type="number" step="0.01" value="${h.cycle}"></label>
      </div>
      <div class="row-actions"><button class="btn primary" id="hs-save">Save clocks</button></div></div>
    <div class="panel"><div class="panel-head"><h2>Truck</h2></div>
      ${S.truck ? `<p>${esc(S.truck.year)} ${esc(S.truck.make)} ${esc(S.truck.model)}, ${S.truck.avgMpg} mpg, power-only.</p>` : ''}</div>`;
}

function wireTruck() {
  $('tr-save').onclick = async () => {
    try {
      S = await api('/status', 'POST', {
        locationCity: $('tr-city').value, locationState: $('tr-state').value,
        day: Number($('tr-day').value), time: $('tr-time').value,
        odometer: Number($('tr-odo').value), fuelPct: Number($('tr-fuel').value),
      });
      toast('Saved.'); render();
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('hs-save').onclick = async () => {
    try {
      S = await api('/hos', 'POST', {
        driveRemaining: Number($('hs-drive').value), shiftRemaining: Number($('hs-shift').value),
        breakRemaining: Number($('hs-brk').value), cycleRemaining: Number($('hs-cycle').value),
      });
      toast('Clocks saved.'); render();
    } catch (e) { toast(e.message, 'bad'); }
  };
}

// ---------------------------------------------------------------- settings

function settingsView() {
  const k = S.profile.skills, lim = S.settings.longDistanceLimits;
  return `<div class="panel"><div class="panel-head"><h2>Costs</h2></div>
      <label>All-in cost per ${esc(S.settings.distanceUnit)}<input id="se-cpm" type="number" step="0.01" value="${S.settings.costPerMile}">
        <span class="hint">Fuel, tolls, the truck note, insurance, maintenance and living on the road. Typed in until
          the GDC Companion App link supplies it.</span></label>
      <div class="row-actions"><button class="btn primary" id="se-cpm-save">Save</button></div></div>
    <div class="panel"><div class="panel-head"><h2>Skills</h2></div>
      <div class="skillgrid">
        <label>Long Distance<input id="sk-ld" type="number" min="0" max="6" value="${k.longDistance}"></label>
        <label>High Value<input id="sk-hv" type="number" min="0" max="6" value="${k.highValue}"></label>
        <label>Fragile<input id="sk-fr" type="number" min="0" max="6" value="${k.fragile}"></label>
        <label>Just-In-Time<input id="sk-jit" type="number" min="0" max="6" value="${k.justInTime}"></label>
      </div>
      <div class="chkrow" id="sk-adr">${ADR.map((a) => `<label><input type="checkbox" value="${esc(a)}" ${k.adr.includes(a) ? 'checked' : ''}> ${esc(a)}</label>`).join('')}</div>
      <div class="row-actions"><button class="btn primary" id="sk-save">Save skills</button></div></div>
    <div class="panel"><div class="panel-head"><h2>Long Distance limits</h2><span class="sub">Longest job at each level, in ${esc(S.settings.distanceUnit)}. Blank is anywhere.</span></div>
      <p class="hint">The vanilla game's figures. Economy mods (GDC's among them) change these: set them to match yours.</p>
      <div class="skillgrid">${lim.map((v, i) => `<label>Level ${i}<input data-ld="${i}" type="number" min="1" value="${v ?? ''}"></label>`).join('')}</div>
      <div class="row-actions"><button class="btn primary" id="ld-save">Save limits</button>
        <button class="btn ghost" id="ld-reset">Back to the game's defaults</button></div></div>
    <div class="panel"><div class="panel-head"><h2>AI</h2></div>
      <label>Anthropic API key<input id="se-key" type="password" placeholder="${S.settings.hasApiKey ? 'A key is saved. Paste a new one to replace it.' : 'sk-ant-...'}">
        <span class="hint">Reads screenshots, and will voice the brokers on the phone. Stored in your career file on this PC only.</span></label>
      <div class="row-actions"><button class="btn primary" id="se-key-save">Save key</button></div></div>`;
}

function wireSettings() {
  const save = async (body, msg) => {
    try { S = await api('/settings', 'POST', body); toast(msg); render(); } catch (e) { toast(e.message, 'bad'); }
  };
  $('se-cpm-save').onclick = () => save({ costPerMile: Number($('se-cpm').value) }, 'Cost saved.');
  $('sk-save').onclick = () => save({ skills: {
    longDistance: Number($('sk-ld').value), highValue: Number($('sk-hv').value),
    fragile: Number($('sk-fr').value), justInTime: Number($('sk-jit').value),
    adr: [...document.querySelectorAll('#sk-adr input:checked')].map((i) => i.value),
  } }, 'Skills saved.');
  $('ld-save').onclick = () => save({ longDistanceLimits: [...document.querySelectorAll('[data-ld]')]
    .map((i) => (i.value === '' ? null : Number(i.value))) }, 'Limits saved.');
  $('ld-reset').onclick = () => save({ resetLongDistance: true }, 'Back to the game defaults.');
  $('se-key-save').onclick = () => save({ anthropicApiKey: $('se-key').value }, 'Key saved.');
}

// ---------------------------------------------------------------- log

function logView() {
  const ev = S.events || [];
  return `<div class="panel"><div class="panel-head"><h2>Log</h2></div>
    ${ev.length ? `<div class="log">${ev.map((e) => `<div><span class="badge mute">${esc(e.channel)}</span> ${esc(e.message)}</div>`).join('')}</div>`
                : '<div class="empty">Nothing yet.</div>'}</div>`;
}

// ---------------------------------------------------------------- boot

(async () => {
  try {
    S = await api('/bootstrap');
    if (S.started) showApp(); else showStart();
  } catch (e) {
    $('boot').textContent = `Could not reach the app: ${e.message}`;
  }
})();
