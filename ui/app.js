'use strict';

/* ============================================================ state */
let S = null;              // latest snapshot from the server
let TAB = 'dispatch';
let DECISION = null;       // last board evaluation
let PACKET = '';
let AI_REPLY = null;
let TRIP_AUDIT = null;
let RECON = null;
let SHOTS = [];            // pending screenshots {mediaType, dataBase64, thumb, name}
let EXTRACT = null;        // last extraction result, awaiting confirmation
let HOSREAD = null;        // last GDC Companion read: what it saved, and how to undo it
let HOSWAS = null;         // the clocks that were on file before that read
let DISCOVERY = null;      // "new city reached" notice awaiting acknowledgement
let REACHED_PAGE = 1;      // which page of the reached-cities list is showing
/* Which board the driver is showing us: what is on offer at this dock, or the whole city. Starts
   local because that is the first thing you see when the trailer comes off. */
let BOARD_STAGE = 'local';
let BUSY = '';             // label of an in-flight long operation

const TABS = [
  ['dispatch', 'Dispatch'],
  ['active', 'Active Load'],
  ['trips', 'Trips'],
  ['fleet', 'Fleet'],
  ['payroll', 'Payroll'],
  ['finance', 'Finances'],
  ['maint', 'Maintenance'],
  ['safety', 'Safety'],
  ['career', 'Career'],
  ['market', 'Job Market'],
  ['packet', 'Dispatch Packet'],
  ['settings', 'Settings'],
];

/* ============================================================ helpers */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sv = (id) => ($(id)?.value ?? '').trim();
const fv = (id) => { const n = parseFloat($(id)?.value); return isNaN(n) ? 0 : n; };
/* Empty means "not reported", which is different from zero — a blank clock must not read as 0 hours left. */
const fvn = (id) => {
  const raw = ($(id)?.value ?? '').trim();
  if (raw === '') return null;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
};
const bv = (id) => !!$(id)?.checked;

/* ---- durations in HH:MM
   Every HOS display in the world reads 8:45, not 8.75. Converting in your head on every report is
   friction, and typing 8.45 for eight-and-three-quarters is an eighteen-minute error that propagates
   silently into every projection. Stored as decimal hours; only entry and display change. */
const hhmm = (hours) => {
  const h = Math.max(0, +hours || 0);
  let whole = Math.floor(h + 1e-9);
  let mins = Math.round((h - whole) * 60);
  if (mins === 60) { whole += 1; mins = 0; }
  return `${whole}:${String(mins).padStart(2, '0')}`;
};

/** Reads an HH:MM field back to decimal hours. A decimal typed in anyway is accepted and converted. */
const hv = (id) => {
  const raw = ($(id)?.value ?? '').trim();
  if (!raw) return 0;
  if (raw.includes(':')) {
    const [h, m] = raw.split(':');
    return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60;
  }
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
};

/** Same, but blank stays blank — for optional clocks that must not read as zero. */
const hvn = (id) => {
  const raw = ($(id)?.value ?? '').trim();
  return raw === '' ? null : hv(id);
};
const list = (id) => sv(id).split(',').map((x) => x.trim()).filter(Boolean);

const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n) => (n < 0 ? '-$' : '$') + Math.abs(+n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const num = (n, d = 0) => (+n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const hrs = (n) => hhmm(n);

/**
 * What to call a unit. ATS gives every truck and trailer an ID that is visible in game, and where the
 * player has entered one that is the name they can actually match against the equipment in front of
 * them. Falls back to the number the app assigned.
 *
 * Display only — every lookup, assignment and work order still keys on the assigned unit number.
 */
const uref = (unit) => {
  const u = (unit || '').trim();
  if (!u) return '';
  const hit = (S.trucks || []).find((x) => x.unit === u) || (S.trailers || []).find((x) => x.unit === u);
  return hit && hit.gameId ? hit.gameId : u;
};
const pct = (n, d = 1) => (+n || 0).toFixed(d) + '%';

/* ---- the game clock -------------------------------------------------------
   ATS has no calendar, only elapsed days and a time of day, so everything the
   player reads or types is "Day N" plus HH:MM. The wire format stays an ISO
   datetime measured from a fixed epoch, which keeps all the date arithmetic on
   the server unchanged.                                                       */
const EPOCH = Date.UTC(2000, 0, 1);
const DAY_MS = 86400000;

const dayOf = (iso) => {
  const t = Date.parse(isoUtc(iso));
  return isNaN(t) ? 1 : Math.floor((t - EPOCH) / DAY_MS) + 1;
};
const timeOf = (iso) => {
  const t = Date.parse(isoUtc(iso));
  if (isNaN(t)) return '00:00';
  const d = new Date(t);
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
};
/** Treat the stored local-style timestamp as UTC so day maths never shifts with the machine. */
function isoUtc(iso) {
  if (!iso) return '';
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z';
}
/** Day number + HH:MM back into the wire format. */
function toIso(day, hhmm) {
  const d = Math.max(1, parseInt(day, 10) || 1);
  const [h, m] = String(hhmm || '00:00').split(':').map((x) => parseInt(x, 10) || 0);
  const t = new Date(EPOCH + (d - 1) * DAY_MS + h * 3600000 + m * 60000);
  return t.toISOString().slice(0, 16);
}

/** Pretty game time — what the player sees everywhere. */
function gt(v) {
  if (!v) return '—';
  const t = Date.parse(isoUtc(v));
  if (isNaN(t)) return esc(v);
  return `Day ${dayOf(v)} · ${timeOf(v)}`;
}

/** A paired day-number + time-of-day input. */
function dayTimeInput(idPrefix, iso, label) {
  return `<label>${esc(label)}
    <span style="display:flex;gap:6px">
      <input id="${idPrefix}-day" type="number" min="1" step="1" style="flex:0 0 92px"
        value="${iso ? dayOf(iso) : (S ? dayOf(S.status.gameTime) : 1)}" title="Game day">
      <input id="${idPrefix}-tod" type="time" step="60" style="flex:1"
        value="${iso ? timeOf(iso) : (S ? timeOf(S.status.gameTime) : '06:00')}" title="Time of day">
    </span></label>`;
}
const readDayTime = (idPrefix) => toIso(sv(idPrefix + '-day'), sv(idPrefix + '-tod'));
const badge = (kind, text) => `<span class="badge ${kind}">${esc(text)}</span>`;

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 8000 : 4200);
}

async function api(path, method = 'GET', body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opt);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

/** Absorb any response that carries a snapshot, or is one. */
function absorb(resp) {
  if (!resp) return resp;
  if (resp.snapshot) { S = resp.snapshot; return resp; }
  if (resp.onboarded !== undefined) { S = resp; return resp; }
  return resp;
}

async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg, 'ok');
    render();
    return r;
  } catch (e) {
    toast(e.message, 'bad');
    return null;
  }
}

function copyText(text, label = 'Copied to clipboard.') {
  const done = () => toast(label, 'ok');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallback());
  } else fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch { toast('Copy failed — select the text manually.', 'bad'); }
    ta.remove();
  }
}

function modal(html) { $('modal-body').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); $('modal-body').innerHTML = ''; }

/* ============================================================ boot */
(async function boot() {
  try {
    const data = await api('/bootstrap');
    S = data;
    $('boot').classList.add('hidden');
    if (!S.onboarded) {
      $('onboarding').classList.remove('hidden');
      $('ap-gameday').value = 1; $('ap-gametod').value = '06:00';
      document.title = 'Driver Application — TruckSim Dispatcher';
    } else {
      $('appshell').classList.remove('hidden');
      const fromUrl = location.hash.replace('#', '');
      if (TABS.some(([k]) => k === fromUrl)) TAB = fromUrl;
      render();
      if (TAB === 'finance') loadLedger();
      if (TAB === 'fleet') loadFleetOps();
      // A board left sitting is an open decision — show it again instead of making
      // the driver re-run the evaluation after every reload.
      if (S.board.length) {
        try { DECISION = await api('/board/evaluate'); render(); } catch { /* non-fatal */ }
      }
    }
  } catch (e) {
    $('boot').innerHTML = `<div class="callout stop">Could not reach the local server: ${esc(e.message)}</div>`;
  }
})();

/* ============================================================ onboarding */
function readApplication() {
  return {
    driverName: sv('ap-name'),
    preferredDivision: sv('ap-div1'),
    secondDivision: sv('ap-div2'),
    transmissionPreference: sv('ap-trans'),
    experienceYears: fv('ap-exp'),
    freightExperience: list('ap-freight'),
    preferredTripLength: sv('ap-length'),
    homeTimePreference: sv('ap-hometime'),
    homeCity: sv('ap-city'),
    homeState: sv('ap-state').toUpperCase(),
    willNotHaul: list('ap-nohaul'),
    acceptsProbation: bv('ap-probation'),
    hasHazmat: bv('ap-hazmat'),
    hasTanker: bv('ap-tanker'),
    hasDoublesTriples: bv('ap-doubles'),
    notes: sv('ap-notes'),
  };
}

const stars = (n) => '★'.repeat(n) + '<span style="color:var(--line3)">' + '★'.repeat(5 - n) + '</span>';

/** The job market: who is hiring, who would take you, and who to come back to later. */
function renderMarket(market, { onboarding }) {
  const open = market.filter((c) => c.wouldHire && !c.isCurrentEmployer);
  const shut = market.filter((c) => !c.wouldHire && !c.isCurrentEmployer);
  const anyReal = market.some((c) => c.isRealCompany);

  const card = (c) => `
    <div class="loadcard ${c.wouldHire ? 'auth' : 'reject'}">
      <div class="loadcard-head">
        ${c.wouldHire ? badge('ok', 'would hire you') : badge('bad', 'not yet')}
        <span class="lane">${esc(c.name)}</span>
        <span class="sub">${esc(c.hqCity)}, ${esc(c.hqState)} · ${esc(c.size)}</span>
        <div class="spacer"></div>
        <b style="font-family:var(--mono)">$${(+c.loadedCpm).toFixed(3)}/mi</b>
        ${c.postedLoadedCpm && Math.abs(c.loadedCpm - c.postedLoadedCpm) > 0.0005
          ? `<span class="hint" style="margin:0">posted $${(+c.postedLoadedCpm).toFixed(3)}</span>` : ''}
      </div>
      <div class="kv">
        <span>${badge(
          c.condition?.state === 'Expanding' ? 'ok'
          : c.condition?.state === 'Hiring freeze' ? 'bad'
          : c.condition?.state === 'Tightening' ? 'warn' : 'mute',
          c.condition?.state || 'Steady')}</span>
        <span>divisions <b>${esc(c.divisions.join(', '))}</b></span>
        ${c.specialized ? '<span>' + badge('violet', 'specialised') + '</span>' : ''}
        ${c.requiresHazmat ? '<span>' + badge('warn', 'hazmat required') + '</span>' : ''}
        ${c.requiresTanker ? '<span>' + badge('warn', 'tanker required') + '</span>' : ''}
        ${c.takesRookies ? '<span>' + badge('info', 'hires rookies') + '</span>' : ''}
      </div>
      <p style="margin:0 0 8px;color:var(--ink2)">${esc(c.blurb)}</p>
      <div class="kv">
        <span>pay ${stars(c.payStars)}</span>
        <span>equipment ${stars(c.equipmentStars)}</span>
        <span>home time ${stars(c.homeTimeStars)}</span>
        <span>yards <b>${esc([c.hqCity + ', ' + c.hqState].concat(c.yards).join(' · '))}</b></span>
      </div>
      <p class="hint" style="margin-bottom:6px"><b>Their bar:</b> ${esc(c.standardsNote)}</p>
      ${c.condition && c.condition.state !== 'Steady' ? `<p class="hint" style="margin-bottom:6px">
        <b>${esc(c.condition.state)}:</b> ${esc(c.condition.note)}
        ${!c.condition.hiring ? ` Reviewed around <b>${gt(c.condition.reviewedOn)}</b>.` : ''}</p>` : ''}
      ${!c.wouldHire && c.loadsToQualify > 0 ? `<div class="progress-row">
        <span class="pl">Credited experience ${num(c.creditedExperienceYears, 1)} of ${num(c.minExperienceYears, 1)} yr</span>
        <span class="pb"><i style="width:${Math.min(100, (c.creditedExperienceYears / Math.max(0.1, c.minExperienceYears)) * 100)}%"></i></span>
        <span class="pv">~${c.loadsToQualify} more load(s)</span></div>` : ''}
      ${c.wouldHire
        ? `<ul class="reasons good">${c.screening.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
           ${c.screening.conditions.length ? `<ul class="reasons">${c.screening.conditions.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
           <div class="row-actions"><button class="btn go" data-act="${onboarding ? 'apply-onboard' : 'apply-move'}" data-code="${esc(c.code)}">
             Apply to ${esc(c.name)}</button></div>`
        : `<ul class="reasons bad">${c.screening.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
           <p class="hint">Come back when that changes — carriers reconsider.</p>`}
    </div>`;

  const html = `
    <div class="panel">
      <div class="panel-head"><h2>Carriers hiring</h2>
        <span class="sub">${open.length} would take you now · ${shut.length} to work toward</span></div>
      ${anyReal ? `<div class="callout mute">
        <p><b>About these companies.</b> These are real US carriers, and their headquarters and the
          freight they haul are factual. The <b>pay rates, hiring standards and star ratings are made up
          for this game</b> — they are not these companies' real terms of employment. Prefer invented
          carriers instead? Switch the roster in Settings.</p></div>` : ''}
      ${open.length === 0 ? `<div class="callout warn"><h4>Nobody on this roster will take you yet</h4>
        <p>Lower the experience bar by editing your application, or switch to the fictional roster in
          Settings — it has a carrier that takes anyone with a Class A.</p></div>` : ''}
      ${open.map(card).join('')}
      ${shut.length ? `<h3 class="sect">Not yet — build toward these</h3>${shut.map(card).join('')}` : ''}
    </div>`;

  const host = onboarding ? $('market-result') : null;
  if (host) { host.innerHTML = html; host.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  return html;
}

/** What the player has to go do in ATS before the first dispatch means anything. */
function setupChecklistHtml(steps) {
  if (!steps?.length) return '';
  return `<h3 class="sect">Before your first load — set this up in ATS</h3>
    <div class="callout info"><p>The app can run the carrier, but only you can buy the garage and the
      truck in the game. Work down this list, then come back to the Dispatch tab.</p></div>
    ${steps.map((st, i) => `<div class="loadcard ${st.caution ? 'reject' : 'backup'}">
      <div class="loadcard-head"><span class="unit">${i + 1}</span>
        <span class="lane">${esc(st.title)}</span></div>
      <p style="margin:0 0 6px;color:var(--ink2);white-space:pre-wrap">${esc(st.detail)}</p>
      <p class="hint" style="margin:0 0 ${st.caution ? '8px' : '0'}"><b>Why:</b> ${esc(st.why)}</p>
      ${st.caution ? `<div class="callout warn" style="margin:0">
        <h4>Read this first</h4><p style="white-space:pre-wrap">${esc(st.caution)}</p></div>` : ''}
    </div>`).join('')}`;
}

function renderDecision(d, extra = '') {
  const cls = d.hired ? 'go' : 'stop';
  $('hire-result').innerHTML = `
    <div class="panel">
      <div class="callout ${cls}">
        <h4>${esc(d.decision)}</h4>
        ${d.reasons.map((r) => `<p>${esc(r)}</p>`).join('')}
        ${d.conditions.length ? `<ul>${d.conditions.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      </div>
      ${extra}
    </div>`;
  $('hire-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[id],[data-act]');
  if (!t) return;

  if (t.id === 'btn-market') {
    const app = readApplication();
    if (!app.driverName) return toast('Put a name on the application first.', 'bad');
    return run(async () => {
      const r = await api('/onboarding/market', 'POST', app);
      renderMarket(r.market, { onboarding: true });
    });
  }

  if (t.dataset.act === 'apply-onboard') {
    const app = readApplication();
    const gameTime = toIso(sv('ap-gameday'), sv('ap-gametod'));
    const code = t.dataset.code;
    return run(async () => {
      const r = await api('/onboarding/hire', 'POST', { application: app, force: false, gameTime, code });
      if (!r.hired) { renderDecision(r.decision); return toast('Application declined.', 'bad'); }
      S = r.snapshot;
      $('market-result').innerHTML = '';
      const t2 = r.truck, tr = r.trailer;
      renderDecision(r.decision, `
        <h3 class="sect">Your carrier</h3>
        <dl class="kvlist">
          <dt>Company</dt><dd>${esc(r.company.name)} (${esc(r.company.code)})</dd>
          <dt>Headquarters</dt><dd>${esc(r.company.terminalCity)}, ${esc(r.company.terminalState)}</dd>
          <dt>Yards</dt><dd>${esc((r.company.terminals || []).map((x) => `${x.city}, ${x.state} (${x.level})`).join(' · '))}</dd>
          <dt>Divisions</dt><dd>${esc(r.company.divisions.join(', '))}</dd>
          <dt>Pay</dt><dd>$${(+S.driver.pay.loadedCpm).toFixed(3)}/loaded mi · $${(+S.driver.pay.deadheadCpm).toFixed(3)}/empty mi</dd>
          <dt>Truck</dt><dd>${t2 ? `Unit ${esc(t2.unit)} — ${t2.year} ${esc(t2.make)} ${esc(t2.model)}, ${esc(t2.transmission)}` : '—'}</dd>
          <dt>Trailer</dt><dd>${tr ? `${esc(tr.unit)} — ${esc(tr.length)} ${esc(tr.type)}` : '—'}</dd>
        </dl>
        ${setupChecklistHtml(r.setup)}
        <div class="row-actions"><button class="btn primary" data-act="enter-app">Go to the dispatch board</button></div>`);
      toast(`Hired at ${r.company.name}.`, 'ok');
    });
  }

  if (t.dataset.act === 'enter-app') {
    $('onboarding').classList.add('hidden');
    $('appshell').classList.remove('hidden');
    return render();
  }

  if (t.id === 'btn-refresh') return run(async () => absorb(await api('/bootstrap')), 'Reloaded.');

  if (t.dataset.act) return handleAction(t.dataset.act, t.dataset, ev);
});

/* The garage dropdowns act on change, not click. */
document.addEventListener('change', (ev) => {
  const el = ev.target.closest('select[data-act="relocate"]');
  if (!el) return;
  run(async () => absorb(await api('/equipment/relocate', 'POST', {
    unit: el.dataset.unit, unitKind: el.dataset.kind, terminalId: el.value,
  })), `${el.dataset.kind} ${el.dataset.unit} re-homed.`);
});

/* The odometer is the one number a typo makes silently wrong, so it is checked as it is typed
   rather than argued about after the trip has posted. */
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'c-odo' || ev.target.id === 'c-miles') paintOdometerHint();
});

document.addEventListener('click', (ev) => { if (ev.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeModal(); });

/* ---- screenshot capture: paste, drop, browse ---------------------------- */

/** Downscale to a long edge that stays legible without burning image tokens. */
const MAX_EDGE = 2000;

function addImageFile(file) {
  if (!file || !/^image\/(png|jpe?g)$/.test(file.type)) return;
  // The server reads these in small batches, so there is no practical ceiling — this is a sanity stop.
  if (SHOTS.length >= 24) return toast('Twenty-four screenshots is the limit per read.', 'bad');
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const draw = (cw, ch) => {
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        return c;
      };
      // PNG keeps game text crisp; the thumbnail is only for the staging strip.
      const full = draw(w, h).toDataURL('image/png');
      const tScale = Math.min(1, 320 / Math.max(w, h));
      const thumb = draw(Math.round(w * tScale), Math.round(h * tScale)).toDataURL('image/png');
      SHOTS.push({
        mediaType: 'image/png',
        dataBase64: full.split(',')[1],
        thumb: thumb.split(',')[1],
        name: file.name || `pasted ${SHOTS.length + 1} (${w}×${h})`,
      });
      render();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

document.addEventListener('paste', (ev) => {
  if (!S?.onboarded || TAB !== 'dispatch') return;
  const items = [...(ev.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/'));
  if (!items.length) return;
  ev.preventDefault();
  items.forEach((i) => addImageFile(i.getAsFile()));
  toast(`${items.length} screenshot(s) staged.`, 'ok');
});

document.addEventListener('dragover', (ev) => {
  if (ev.target.closest('#dropzone')) { ev.preventDefault(); ev.target.closest('#dropzone').classList.add('over'); }
});
document.addEventListener('dragleave', (ev) => {
  const z = ev.target.closest('#dropzone'); if (z) z.classList.remove('over');
});
document.addEventListener('drop', (ev) => {
  const z = ev.target.closest('#dropzone');
  if (!z) return;
  ev.preventDefault();
  z.classList.remove('over');
  [...(ev.dataTransfer?.files || [])].forEach(addImageFile);
});
document.addEventListener('change', (ev) => {
  if (ev.target.id === 'shot-file') [...ev.target.files].forEach(addImageFile);
});

window.addEventListener('hashchange', () => {
  const k = location.hash.replace('#', '');
  if (S?.onboarded && TABS.some(([t]) => t === k) && k !== TAB) {
    TAB = k; render();
    if (TAB === 'finance') loadLedger();
    if (TAB === 'fleet' && !FLEETOPS) loadFleetOps();
  }
});

/* ============================================================ shell render */
let PRIV = { summary: '' };   // freight-selection authority for the current rank

function render() {
  if (!S || !S.onboarded) return;
  const v = S.views;
  PRIV = v.privileges || { summary: '' };

  $('tb-code').textContent = S.company.code || 'CO';
  $('tb-company').textContent = S.company.name || 'Carrier';
  $('tb-terminal').textContent = `${S.company.terminalCity}, ${S.company.terminalState} · ${S.driver.rankTitle}`;

  // Name the tab after the carrier and the current view — a browser tab parked on a second
  // monitor should say which company and which screen it is showing.
  const tabLabel = (TABS.find(([k]) => k === TAB) || [, 'Dispatch'])[1];
  document.title = `${S.company.code || 'TSD'} · ${tabLabel} — TruckSim Dispatcher`;

  const dmgCls = (d) => d >= S.settings.maintenance.outOfServicePct ? 'bad'
    : d >= S.settings.maintenance.mandatoryReviewPct ? 'warn' : 'ok';
  const cyc = v.hos.cycleRemaining;
  $('tb-stats').innerHTML = [
    stat('Game clock', gt(S.status.gameTime)),
    stat('Location', `${S.status.locationCity || '—'}${S.status.locationState ? ', ' + S.status.locationState : ''}`),
    stat('Drivable', hrs(v.hos.drivableNowHours), v.hos.drivableNowHours < 1 ? 'bad' : v.hos.drivableNowHours < 3 ? 'warn' : 'ok'),
    stat('Cycle', hrs(cyc), cyc <= 0 ? 'bad' : cyc <= 18 ? 'warn' : 'ok'),
    stat('Fuel', pct(S.status.fuelPct, 0), S.status.fuelPct < 20 ? 'bad' : S.status.fuelPct < 35 ? 'warn' : 'ok'),
    stat('Tractor', pct(S.status.truckDamagePct), dmgCls(S.status.truckDamagePct)),
    stat('Operating cash', money0(v.finance.accounts.find((a) => a.key === 'operating')?.balance ?? 0)),
    stat('Unsettled pay', money0(S.driver.unsettledPay)),
  ].join('');

  const openWo = S.workOrders.filter((w) => w.status === 'Open').length;
  const unsettled = S.trips.filter((t) => !t.settlementNumber && (t.status === 'Delivered' || t.status === 'Cancelled') && t.pay.total !== 0).length;
  const pips = {
    active: v.activeTrip ? '<span class="pip amber">1</span>' : '',
    maint: openWo ? `<span class="pip">${openWo}</span>` : '',
    payroll: unsettled ? `<span class="pip amber">${unsettled}</span>` : '',
    dispatch: S.board.length ? `<span class="pip amber">${S.board.length}</span>` : '',
    career: (v.career.availableActions || []).length ? `<span class="pip amber">!</span>` : '',
  };
  $('tabs').innerHTML = TABS.map(([k, label]) =>
    `<button data-act="tab" data-tab="${k}" class="${TAB === k ? 'on' : ''}">${label}${pips[k] || ''}</button>`).join('');

  $('tb-version').textContent = S.views.versionDisplay || '';
  $('banner').innerHTML = bannerHtml();

  const view = ({
    dispatch: viewDispatch, active: viewActive, trips: viewTrips, fleet: viewFleet,
    payroll: viewPayroll, finance: viewFinance, maint: viewMaint, safety: viewSafety,
    career: viewCareer, market: viewJobMarket, packet: viewPacket, settings: viewSettings,
  }[TAB] || viewDispatch);

  // A bug in one tab must not blank the whole console — surface it instead.
  try {
    $('view').innerHTML = view();
  } catch (e) {
    $('view').innerHTML = `<div class="panel"><div class="callout stop">
      <h4>This tab failed to render</h4>
      <p>${esc(e.message)}</p>
      <p class="hint">Your career file is untouched. Try another tab, or Refresh.</p></div>
      <pre class="packet">${esc(e.stack || '')}</pre></div>`;
    console.error(e);
  }

  if ($('c-milehint')) paintOdometerHint();

  $('foot-data').textContent = `Career file saved on every change · trip numbers ${S.views.nextNumbers.freight} next`
    + ` · TruckSim Dispatcher ${S.views.versionDisplay || ''}`;
}

const stat = (k, v, cls = '') => `<div class="stat ${cls}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;

function bannerHtml() {
  const v = S.views;
  let out = '';

  // An open equipment order is the most actionable thing on the screen — it belongs at the top.
  const o = v.equipmentOrder;
  if (o) {
    const up = o.kind === 'Upgrade';
    out += `<div class="callout ${up ? 'go' : 'warn'}">
      <h4>${up ? 'Equipment upgrade' : o.kind === 'Downgrade' ? 'Equipment downgrade' : 'Equipment order'}
        — ${esc(o.number)}</h4>
      <p>${esc(o.instruction)}</p>
      <p class="hint" style="margin:0 0 8px">Reason: ${esc(o.reason)}</p>
      <div class="row-actions">
        <button class="btn ${up ? 'go' : 'primary'}" data-act="complete-eq" data-num="${esc(o.number)}">
          Done — I swapped in ATS</button>
        <button class="btn ghost" data-act="decline-eq" data-num="${esc(o.number)}">Not yet</button>
      </div></div>`;
  }

  const fd = v.fleetOps && v.fleetOps.due;
  if (fd && (fd.isDue || fd.isSoon))
    out += `<div class="callout ${fd.isDue ? 'warn' : 'info'}">
      <h4>${fd.isDue ? 'Fleet report due' : 'Fleet report coming due'}</h4>
      <p>${esc(fd.message)}</p>
      ${fd.isDue ? '<div class="row-actions"><button class="btn primary" data-act="goto-fleet">Go and file it</button></div>' : ''}
    </div>`;

  if (v.pm && (v.pm.due || v.pm.soon))
    out += `<div class="callout ${v.pm.due ? 'warn' : 'info'}">
      <h4>${v.pm.due ? 'Preventive service overdue' : 'PM coming due'}</h4>
      <p>${esc(v.pm.message)}</p></div>`;

  if (S.driver.status === 'Suspended')
    out += `<div class="callout stop"><h4>Driver suspended</h4><p>No freight until Safety clears you. See the Safety tab.</p></div>`;
  if (S.driver.status === 'Terminated')
    out += `<div class="callout stop"><h4>Employment terminated</h4><p>This career file is closed. Start a new one from Settings → Data.</p></div>`;
  if (v.dispatchBlockers.length && TAB !== 'settings')
    out += `<div class="callout stop"><h4>Not clear to run</h4><ul>${v.dispatchBlockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>`;
  if (v.maintenanceAlerts.length && TAB !== 'maint')
    out += `<div class="callout warn"><h4>Maintenance attention</h4><ul>${v.maintenanceAlerts.slice(0, 4).map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>`;
  if (v.hos.resetWatch)
    out += `<div class="callout warn"><h4>Reset watch</h4><p>${esc(v.hos.resetWatch)}</p></div>`;
  return out;
}

/* ============================================================ DISPATCH */
function viewDispatch() {
  const v = S.views, st = S.status, h = S.hos;
  const t = v.truck, tr = v.trailer;

  return `
  <div class="cols">
    <div>
      <div class="panel">
        <div class="panel-head"><h2>Report from the game</h2>
          <span class="sub">Operations plans off these numbers — keep them current.</span></div>
        ${st.carriedForwardFrom ? `<div class="callout go">
          <h4>Carried forward from ${esc(st.carriedForwardFrom)}</h4>
          <p>These are the readings you gave me when you closed ${esc(st.carriedForwardFrom)} out at
            ${gt(st.carriedForwardGameTime)}. If nothing has changed since, just confirm them —
            no need to type them again. Edit anything that has moved.</p>
          <div class="row-actions">
            <button class="btn go" data-act="confirm-status">Confirm — nothing changed</button>
          </div></div>` : ''}
        <div class="grid2">
          ${dayTimeInput('st-time', st.gameTime, 'In-game day & time')}
          <label>Duty status
            <select id="st-duty">${['OffDuty', 'SleeperBerth', 'OnDuty', 'Driving'].map((x) =>
              `<option ${st.dutyStatus === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label>City<input id="st-city" value="${esc(st.locationCity)}"></label>
          <label>State<input id="st-state" class="up" maxlength="2" value="${esc(st.locationState)}"></label>
          <label>Where exactly
            <select id="st-kind">${['Terminal', 'Shipper', 'Receiver', 'TruckStop', 'RestArea', 'Road', 'Other'].map((x) =>
              `<option ${st.locationKind === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label>Detail<input id="st-detail" value="${esc(st.locationDetail)}" placeholder="e.g. Walmart DC dock 14"></label>
          <label>Fuel %<input id="st-fuel" type="number" min="0" max="100" step="1" value="${st.fuelPct}"></label>
          <label>ATS odometer<input id="st-odo" type="number" step="1" value="${Math.round(st.atsOdometer)}"></label>
          <label>ATS bank balance $<input id="st-bank" type="number" step="1"
            value="${S.views.position.hasReportedBalance ? Math.round(st.atsBankBalance) : ''}"
            placeholder="what your game shows"
            title="The company's cash. Leave blank if you have not checked it — blank is not zero."></label>
          <label>Tractor damage %<input id="st-tdmg" type="number" min="0" max="100" step="0.1" value="${st.truckDamagePct}"></label>
          <label>Trailer damage %<input id="st-trdmg" type="number" min="0" max="100" step="0.1" value="${st.trailerDamagePct}"></label>
        </div>
        <div class="row-actions"><button class="btn primary" data-act="save-status">Update status</button></div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Hours of service</h2>
          ${h.confirmed === false ? badge('warn', 'not confirmed') : ''}
          <div class="spacer"></div>
          <span class="sub">Your HOS display is authoritative. Type what it says.</span></div>
        ${h.carriedForwardFrom ? `<div class="callout go">
          <p>Clocks came off your HOS display when you closed <b>${esc(h.carriedForwardFrom)}</b> out at
            ${gt(h.asOfGameTime)}. Still good if you have not driven since.</p></div>`
        : h.confirmed === false ? `<div class="callout warn">
          <p>These clocks were last read at ${gt(h.asOfGameTime)} and a load has run since. Re-read your
            HOS display before I plan anything off them.</p></div>` : ''}
        <div class="${v.hos.breakEnforced ? 'grid4' : 'grid3'}">
          <label>Drive left<input id="h-drive" inputmode="numeric" placeholder="8:45" value="${hhmm(h.driveRemaining)}"></label>
          <label>Shift left<input id="h-shift" inputmode="numeric" placeholder="11:30" value="${hhmm(h.shiftRemaining)}"></label>
          ${v.hos.breakEnforced
            ? `<label>Break clock<input id="h-break" inputmode="numeric" placeholder="6:15" value="${hhmm(h.breakRemaining)}"></label>`
            : ''}
          <label>Cycle left<input id="h-cycle" inputmode="numeric" placeholder="52:00" value="${hhmm(h.cycleRemaining)}"></label>
        </div>
        ${v.hos.breakEnforced
          ? `<p class="hint">Break clock = hours of <em>driving</em> left before the
             ${(S.settings.hos.breakLength * 60).toFixed(0)}-minute break is required. It is not available driving time.</p>`
          : `<p class="hint">The ${(S.settings.hos.breakLength * 60).toFixed(0)}-minute break is switched off in Settings,
             so dispatch never plans one and the break clock is not tracked. Your ${num(S.settings.hos.shiftLimit, 0)}-hour
             window is the binding stop.</p>`}
        <div class="grid2">
          <label>Hours coming back (recap)
            <input id="h-recap" placeholder="8:00 in 1, 10:30 in 2" value="${esc((h.recap || []).map((r) => `${hhmm(r.hours)} in ${r.inDays}`).join(', '))}"></label>
          <label>Source<input id="h-source" value="${esc(h.source)}" placeholder="e.g. Realistic HOS mod ELD"></label>
        </div>
        ${hosReadHtml()}
        ${recapExplainerHtml()}
        <label>Note to dispatch<input id="h-notes" value="${esc(h.notes)}" placeholder="optional"></label>
        <div class="row-actions"><button class="btn primary" data-act="save-hos">Report clocks</button></div>

        <h3 class="sect">Projected right now</h3>
        ${metersHtml(v.hos)}
        <div class="callout ${v.hos.drivableNowHours <= 0 ? 'stop' : 'info'}" style="margin-top:12px">
          <p><b>${esc(v.hos.nextRequiredAction)}</b></p>
          <p>Binding clock: ${esc(v.hos.bindingClock)}. At ${num(v.hos.effectiveMph, 1)} mph effective that is about
            <b>${num(v.hos.projectedMilesNow)} mi</b> today, ${num(v.hos.stintMiles)} mi before the break.</p>
        </div>
        ${recapAdviceHtml()}
      </div>
    </div>

    <div>
      <div class="panel">
        <div class="panel-head"><h2>${BOARD_STAGE === 'local' ? 'Jobs at this location' : 'The city freight board'}</h2>
          <div class="spacer"></div>
          <span class="sub">One row per job you can see in ATS.</span></div>

        <div class="row-actions" style="margin:0 0 10px">
          <button class="btn ${BOARD_STAGE === 'local' ? 'primary' : 'ghost'}" data-act="board-stage" data-stage="local">
            Jobs at this location</button>
          <button class="btn ${BOARD_STAGE === 'city' ? 'primary' : 'ghost'}" data-act="board-stage" data-stage="city">
            Full city board</button>
        </div>
        <p class="hint">${BOARD_STAGE === 'local'
          ? `In ATS: <b>find other load from this location</b>. Just the handful going out from where you are
             standing — origin is filled in and there is no deadhead. Show me these first; if none of them
             work I will ask for the whole city.`
          : `Everything on offer in ${esc(st.locationCity || 'this city')}, including jobs you would deadhead to.`}</p>

        <div class="grid2">
          <label>Cargo<input id="b-cargo" placeholder="e.g. Frozen Foods"></label>
          <label>Trailer required
            <select id="b-trailer">${['', 'Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Tanker', 'Lowboy', 'Car Hauler', 'Livestock', 'Log', 'Hopper', 'Dump']
              .map((x) => `<option value="${x}" ${(tr && tr.type === x) ? 'selected' : ''}>${x || '(same as assigned)'}</option>`).join('')}</select></label>
          ${BOARD_STAGE === 'local'
            ? `<input type="hidden" id="b-ocity" value="${esc(st.locationCity)}">
               <input type="hidden" id="b-ostate" value="${esc(st.locationState)}">
               <input type="hidden" id="b-dh" value="0">`
            : `<label>Origin city<input id="b-ocity" value="${esc(st.locationCity)}"></label>
               <label>Origin state<input id="b-ostate" class="up" maxlength="2" value="${esc(st.locationState)}"></label>`}
          <label>Destination city<input id="b-dcity" placeholder="e.g. Boise"></label>
          <label>Destination state<input id="b-dstate" class="up" maxlength="2" placeholder="ID"></label>
          <label>Loaded miles<input id="b-miles" type="number" step="1" min="0" placeholder="ATS distance"></label>
          ${BOARD_STAGE === 'local' ? '' : `<label>Deadhead miles<input id="b-dh" type="number" step="1" min="0" value="0"></label>`}
          <label>Job revenue $<input id="b-rev" type="number" step="1" min="0" placeholder="ATS payout"></label>
          <label>Time to deliver<input id="b-deadline" inputmode="numeric" placeholder="h:mm from the listing"></label>
          <label>Receiver opens in<input id="b-opens" inputmode="numeric" placeholder="h:mm, optional"></label>
          <label>Weight lb<input id="b-weight" type="number" step="1" min="0" placeholder="optional"></label>
          <label>ATS nav estimate<input id="b-nav" inputmode="numeric" placeholder="h:mm, optional"></label>
          <label>Shipper<input id="b-shipper" placeholder="optional"></label>
          <label>Receiver<input id="b-receiver" placeholder="optional"></label>
          <label>Extra stops<input id="b-stops" type="number" step="1" min="0" value="0"></label>
          <label>Broker / market<input id="b-broker" placeholder="optional"></label>
          <label>HazMat class<select id="b-hazclass">
            <option value="">none</option>
            ${(S.views.endorsements?.all || []).map((x) =>
              `<option value="${esc(x.key)}">${esc(x.label)}</option>`).join('')}
          </select></label>
        </div>
        <fieldset>
          <legend>Flags</legend>
          <label class="chk"><input type="checkbox" id="b-urgent"> Urgent</label>
          <label class="chk"><input type="checkbox" id="b-fragile"> Fragile</label>
          <label class="chk"><input type="checkbox" id="b-hazmat"> Hazmat</label>
          <label class="chk"><input type="checkbox" id="b-oversize"> Oversize</label>
          <label class="chk"><input type="checkbox" id="b-tarp"> Needs tarp</label>
        </fieldset>
        <div class="row-actions">
          <button class="btn primary" data-act="board-add">Add to board</button>
          <button class="btn ghost" data-act="board-clear" ${S.board.length ? '' : 'disabled'}>Clear board</button>
        </div>
      </div>

      ${restartHtml()}
      ${screenshotHtml()}
      ${boardTableHtml()}
      ${decisionHtml()}
      ${homeTimeHtml()}
      ${DISCOVERY ? discoveryHtml(DISCOVERY) : ''}
      ${garageOpportunitiesHtml()}
      ${citiesReachedHtml()}
      ${resetOptionsHtml()}
    </div>
  </div>
  ${extractHtml()}`;
}

/**
 * Reads the odometer back to the driver as they type it — the miles it works out to, and whether it
 * looks wrong. Mirrors the server's check so nothing is a surprise after the trip posts. It never
 * disables the button: a warning is the app saying "check this", not refusing the number.
 */
function paintOdometerHint() {
  const el = $('c-milehint');
  const t = S.views.activeTrip;
  if (!el || !t) return;

  const start = +S.views.startOdometer || 0;
  const end = fv('c-odo');
  const dh = +t.deadheadMiles || 0;
  const planned = (+t.dispatchedMiles || 0) + dh;
  const typed = fv('c-miles');

  if (typed > 0) {
    el.className = 'hint';
    el.textContent = `Using your ${num(typed)} loaded mi instead of the odometer.`;
    return;
  }
  if (!start || !end) {
    el.className = 'hint';
    el.textContent = start
      ? `Started at ${num(start)}. Enter the ending odometer and I will work the miles out.`
      : 'No starting odometer on file — type the miles run instead.';
    return;
  }

  const delta = end - start;
  let warn = '';
  if (delta < 0) warn = `That reads ${num(end)} against a start of ${num(start)} — an odometer does not run backwards.`;
  else if (delta < 0.5) warn = `The odometer has not moved off ${num(start)}.`;
  else if (planned > 0 && delta > Math.max(planned * 2.5, planned + 250))
    warn = `${num(delta)} mi against a ${num(planned)} mi routing — that looks like a stray digit.`;
  else if (planned > 0 && delta < planned * 0.5 && planned - delta > 50)
    warn = `${num(delta)} mi against a ${num(planned)} mi routing — that is well short of the run.`;

  el.className = warn ? 'hint bad' : 'hint';
  el.textContent = warn
    ? `${warn} Check it, or type the miles to override.`
    : `${num(start)} → ${num(end)} = ${num(delta)} mi${dh > 0 ? `, less ${num(dh)} deadhead = ${num(delta - dh)} loaded` : ''}.`;
}

/**
 * Out of window on a customer's property. This is legal, it is not the driver's fault, and they still
 * cannot move the truck — three facts that surprise almost everyone, so they get stated outright.
 */
function strandedHtml() {
  const st = S.views.stranded;
  if (!st || !st.isStranded) return '';
  return `<div class="panel">
    <div class="panel-head"><h2>You are out of hours where you are standing</h2>
      ${badge('warn', 'not a violation')}
      <div class="spacer"></div>
      <span class="sub">${esc(st.fault)} fault &middot; nothing on your record</span></div>
    <div class="callout stop">
      <h4>${esc(st.headline)}</h4>
      ${st.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
    </div>
    <div class="meters">
      ${fkpi('Drive left', hhmm(st.driveRemaining), st.driveRemaining <= 0.1 ? 'bad' : '')}
      ${fkpi('Window left', hhmm(st.shiftRemaining), st.shiftRemaining <= 0.1 ? 'bad' : '')}
      ${fkpi('Where', esc(st.where || '—'))}
      ${fkpi('Rest needed', hhmm(S.settings.hos.offDutyReset), 'warn')}
    </div>
  </div>`;
}

/**
 * The four things dispatch asks for after loading. They used to be asked for with nowhere to put them,
 * which is worse than not asking — the driver goes looking and concludes they have missed something.
 */
function loadedReportHtml(t) {
  const loaded = (t.events || []).some((e) => e.kind === 'EndLoad' || e.kind === 'Loaded');
  const done = t.loadedReported;
  return `<div class="panel">
    <div class="panel-head"><h2>Report after loading</h2>
      ${done ? badge('ok', 'reported') : loaded ? badge('warn', 'due now') : badge('mute', 'once you are loaded')}
      <div class="spacer"></div>
      <span class="sub">${done ? 'dispatch has what it asked for' : 'weight and trailer condition as you pull out'}</span></div>

    ${done ? `<div class="callout go">
      <p>Reported: ${t.weightLbs > 0 ? `<b>${num(t.weightLbs)} lb</b>` : 'no weight given'}${
        t.weightVarianceNote ? ` — ${esc(t.weightVarianceNote)}` : ''}. Trailer at ${num(t.trailerDamageAtHook, 1)}%,
        odometer ${num(t.startOdometer)}.</p>
      <p class="hint" style="margin:0">Nothing more needed on this load until you deliver.</p>
    </div>` : `
    <div class="grid3">
      <label>Actual weight lb<input id="ld-weight" type="number" step="100" placeholder="${t.weightLbs > 0 ? num(t.weightLbs) : 'from the job'}"></label>
      <label>Trailer damage % now<input id="ld-trdmg" type="number" step="0.1" min="0" max="100" value="${S.status.trailerDamagePct}"></label>
      <label>Odometer<input id="ld-odo" type="number" step="1" value="${Math.round(S.status.atsOdometer)}"></label>
    </div>
    <p class="hint">The weight is often not what the board said — scaled heavy is worth having on the record. Trailer
      damage here is the reading the shop rules work from, so a trailer you hooked at ${num(S.settings.maintenance.stopDispatchPct, 0)}%
      or worse stops dispatch now rather than at the next delivery. Leave anything blank and it stays as it was.</p>
    <div class="row-actions">
      <button class="btn primary" data-act="report-loaded" data-id="${t.id}">Report it</button>
    </div>`}
  </div>`;
}

/**
 * The receipt for a screenshot read: what went in, where it was read from, and how to undo it.
 *
 * It is a receipt rather than a form because the read has already been saved. A driver pasting this
 * daily should not have to decide which of two panels a number came off — that decision is the mistake
 * the recap page invites, since it prints used and remaining side by side and the used figures are the
 * bigger, bolder ones. So the app makes the call, shows its working, and leaves one button to reverse it.
 */
function hosReadHtml() {
  if (!HOSREAD) return '';
  const r = HOSREAD;
  const label = { driveText: 'drive', shiftText: 'shift', breakText: 'break', cycleText: 'cycle',
    todayDayText: "today's day number", notScreen: 'the page itself' };
  const missing = (r.unreadable || []).map((m) => label[m] || m);
  const bad = (r.disagreements || []).length > 0 || missing.length > 0;
  return `<div class="${bad ? 'rule' : 'note'}" style="margin:10px 0">
    <h4>Entered from your GDC Companion recap page</h4>
    <p><b>${esc((r.saved || []).join(' &middot; ').replace(/&middot;/g, '·'))}</b> &mdash; already saved,
      nothing else to press.</p>
    ${r.clocksFrom ? `<p class="hint">Clocks read from: ${esc(r.clocksFrom)}</p>` : ''}
    ${r.recapSource ? `<p class="hint">Recap ${esc(r.recapSource)}.</p>` : ''}
    ${(r.recap || []).length ? `<p class="hint">Coming back:
      ${esc(r.recap.map((x) => `${hhmm(x.hours)} in ${x.inDays} day${x.inDays === 1 ? '' : 's'}`).join(', '))}</p>` : ''}
    ${(r.kept || []).length ? `<p><b>Could not read ${esc(missing.join(', ') || 'everything')}.</b>
      ${esc(r.kept.join(', '))} &mdash; check those four boxes and press
      ${esc(SAVE_HOS_LABEL)} if they are wrong.</p>` : ''}
    ${(r.disagreements || []).map((d) => `<p><b>Worth knowing:</b> ${esc(d)}</p>`).join('')}
    ${r.notes ? `<p class="hint">${esc(r.notes)}</p>` : ''}
    ${r.confidence && r.confidence !== 'high'
      ? `<p>The reader rated its own confidence <b>${esc(r.confidence)}</b>.</p>` : ''}
    <div class="row-actions" style="margin-top:8px">
      ${HOSWAS ? '<button class="btn tiny" data-act="hosread-undo">Undo — put the old clocks back</button>' : ''}
      <button class="btn tiny ghost" data-act="hosread-drop">Dismiss</button>
    </div>
  </div>`;
}

/** Named once so the receipt and the button cannot drift apart. */
const SAVE_HOS_LABEL = 'Report clocks';

/**
 * What recap is, in the two sentences it actually takes. Collapsed, because a driver who knows does
 * not need it and a driver who does not will open it exactly once.
 */
function recapExplainerHtml() {
  const h = S.settings.hos;
  return `<details class="score" style="margin:0 0 10px">
    <summary>What is recap, and why does it matter?</summary>
    <p class="hint" style="margin:6px 0">Your ${num(h.cycleLimit, 0)}-hour cycle is a <b>rolling ${h.cycleDays}-day window</b>, not a tank
      that empties and gets refilled. Each midnight, the hours you worked ${h.cycleDays} days ago drop out of the
      window and come back to you. That is recap. You do not have to do anything to earn it — it happens
      because time passed.</p>
    <div class="tablewrap"><table>
      <thead><tr><th style="width:1.4in"></th><th>What you get back</th><th>What it costs</th></tr></thead>
      <tbody>
        <tr><td><b>Recap</b></td><td>Only the hours you worked ${h.cycleDays} days ago</td><td>Waiting until midnight</td></tr>
        <tr><td><b>${num(h.cycleRestartHours, 0)}-hour restart</b></td><td>The full ${num(h.cycleLimit, 0)}, all at once</td><td>${num(h.cycleRestartHours, 0)} hours parked</td></tr>
      </tbody>
    </table></div>
    <p class="hint" style="margin:6px 0 0">Read the projection off your HOS display and type it as
      <code>8:00 in 1</code> — eight hours returning one day from now. I will work out which is the better play,
      and tell you. Note the restart <b>wipes the window clean</b>, so taking it throws any pending recap away.</p>
  </details>`;
}

/** Dispatch's call on recap versus the 34, with the arithmetic shown. */
function recapAdviceHtml() {
  const r = S.views.recap;
  if (!r || r.verdict === 'None') return '';

  // Only worth the space when the cycle is actually the problem.
  const cyc = S.views.hos.cycleRemaining;
  const watching = cyc <= S.settings.scoring.resetWatchCycleHours;
  if (!watching && r.verdict === 'NoData') return '';

  const cls = r.verdict === 'Wait' ? 'go' : r.verdict === 'Restart' ? 'warn' : 'info';
  return `<div class="callout ${cls}" style="margin-top:12px">
    <h4>${esc(r.headline)}</h4>
    ${r.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
    ${r.verdict === 'Wait' ? `<div class="meters" style="margin-top:8px">
      ${fkpi('Wait', hhmm(r.waitHours), 'ok')}
      ${fkpi('You get back', hhmm(r.nextHours))}
      ${fkpi('Cycle after', hhmm(r.cycleAfter))}
      ${fkpi('vs restart', hhmm(S.settings.hos.cycleRestartHours), 'warn')}
    </div>` : ''}
  </div>`;
}

/**
 * Reporting a 34-hour restart. Two stages on purpose: arriving starts the clock, and the app checks the
 * elapsed game time and the cycle before it puts freight back on. A restart taken on trust is not a
 * restart — it is a way of ignoring the one rule the app exists to enforce.
 */
function restartHtml() {
  const r = S.views.restart;
  if (!r || !r.needed) return '';
  const o = r.order;

  return `<div class="panel">
    <div class="panel-head"><h2>34-hour restart</h2>
      ${badge(o && o.status === 'Arrived' ? 'warn' : 'bad', o ? o.status.toLowerCase() : 'required')}
      <div class="spacer"></div>
      <span class="sub">no freight until this is sat</span></div>

    ${(r.instructions || []).map((x) => `<p>${esc(x)}</p>`).join('')}

    ${!o || o.status === 'Ordered' ? `
      <p class="hint">Report in when you are parked up and I will start the clock. Give me the game time
        you got there, and where, if it is not where I sent you.</p>
      <div class="grid3">
        ${dayTimeInput('rs-arr', S.status.gameTime, 'Arrived at (game)')}
        <label>City<input id="rs-city" value="${esc(S.status.locationCity)}"></label>
        <label>State<input id="rs-state" value="${esc(S.status.locationState)}" maxlength="2"></label>
      </div>
      <div class="row-actions"><button class="btn primary" data-act="restart-arrived">I am parked up</button></div>`
    : `
      <div class="callout info">
        <p style="margin:0">Clock started ${gt(o.arrivedGameTime)}. Eligible
          <b>${gt(o.eligibleGameTime)}</b> — that is the earliest you can legally roll.</p>
      </div>
      <p class="hint">When you have sat the full ${num(o.requiredHours, 0)} hours, re-read your HOS display,
        report your clocks above, then confirm here. I check the elapsed time and the cycle before I put
        freight on the truck.</p>
      <div class="grid2">
        ${dayTimeInput('rs-done', S.status.gameTime, 'Rolling again at (game)')}
        <div class="row-actions" style="align-self:end">
          <button class="btn go" data-act="restart-complete">The 34 is done</button>
        </div>
      </div>`}
  </div>`;
}

function metersHtml(h) {
  const m = (lbl, val, lim) => {
    const p = lim > 0 ? Math.max(0, Math.min(100, (val / lim) * 100)) : 0;
    const cls = p <= 8 ? 'bad' : p <= 25 ? 'warn' : 'ok';
    return `<div class="meter ${cls}"><div class="lbl">${lbl}</div><div class="big">${hhmm(val)}</div>
      <div class="of">of ${hhmm(lim)}</div><div class="bar"><i style="width:${p}%"></i></div></div>`;
  };
  return `<div class="meters">
    ${m('Drive', h.driveRemaining, h.driveLimit)}
    ${m('Shift window', h.shiftRemaining, h.shiftLimit)}
    ${h.breakEnforced ? m('Break clock', h.breakRemaining, h.breakLimit) : ''}
    ${m('Cycle', h.cycleRemaining, h.cycleLimit)}
  </div>`;
}

/* ---- screenshot import -------------------------------------------------- */
function screenshotHtml() {
  const on = S.views.aiConfigured;
  return `<div class="panel">
    <div class="panel-head"><h2>Import from screenshots</h2>
      ${badge(on ? 'ok' : 'mute', on ? 'reader ready' : 'needs API key')}
      <div class="spacer"></div>
      <span class="sub">${SHOTS.length ? SHOTS.length + ' image(s) staged' : 'paste, drop or browse'}</span></div>

    <div class="dropzone" id="dropzone" tabindex="0">
      <b>Ctrl+V to paste a screenshot</b>
      <span>or drop image files here, or <label class="linky" for="shot-file">browse</label></span>
      <input type="file" id="shot-file" accept="image/png,image/jpeg" multiple class="offscreen">
      <span class="hint" style="margin:0">The board only shows ~10 jobs at a time — paste as many
        screenshots as you need. They are read in small batches and merged, and duplicates are dropped.</span>
      <span class="hint" style="margin:0">Pasting your <b>GDC Companion</b> recap page instead? Paste it
        here and press <b>Enter my clocks from this</b> — the four clocks and the whole recap
        projection go in for you. Nothing to type, and there is an undo if it reads it wrong.</span>
    </div>

    ${SHOTS.length ? `<div class="shots">${SHOTS.map((s, i) => `
      <figure class="shot">
        <img src="data:${s.mediaType};base64,${s.thumb}" alt="screenshot ${i + 1}">
        <figcaption>${esc(s.name)} <button class="btn tiny ghost" data-act="shot-del" data-i="${i}">✕</button></figcaption>
      </figure>`).join('')}</div>
      <div class="row-actions">
        <button class="btn primary" data-act="extract" ${on && !BUSY ? '' : 'disabled'}>
          ${BUSY === 'extract' ? 'Reading…' : `Read ${SHOTS.length} screenshot(s) as freight`}</button>
        <button class="btn" data-act="extract-hos" ${on && !BUSY ? '' : 'disabled'}>
          ${BUSY === 'hosread' ? 'Reading…' : 'Enter my clocks from this'}</button>
        <button class="btn ghost" data-act="shots-clear">Clear images</button>
      </div>` : ''}

    ${on ? `<p class="hint">Reading a screenshot sends that image to the Anthropic API using your key.
      Nothing is sent unless you press the button. Model in use: <b>${esc(S.settings.anthropicModel)}</b>
      — a cheaper model such as <code>claude-sonnet-5</code> or <code>claude-haiku-4-5</code> is usually
      plenty for reading a board, and you can change it in Settings.</p>`
      : `<div class="callout mute">
        <p><b>This one feature needs an API key.</b> Everything else in the app works offline. Add a key
          in <b>Settings → In-app dispatcher</b> and this reads your board screenshots straight into
          the load list.</p>
        <p>Without a key you can still paste an image here — it will display large so you can read the
          numbers off it while you type them into the form above.</p></div>`}
  </div>`;
}

function extractHtml() {
  if (!EXTRACT) return '';
  if (!EXTRACT.ok) return `<div class="panel"><div class="callout stop">
    <h4>Could not read the screenshots</h4><p>${esc(EXTRACT.error)}</p></div></div>`;

  const rows = EXTRACT.loads;
  if (!rows.length) return `<div class="panel"><div class="callout warn">
    <h4>No job rows found</h4><p>${esc(EXTRACT.notes || 'Nothing legible in those images.')}</p></div></div>`;

  const conf = (c) => badge(c === 'high' ? 'ok' : c === 'medium' ? 'warn' : 'bad', c);
  const cell = (i, f, val, w = '') =>
    `<input id="x-${f}-${i}" value="${esc(val)}" style="min-width:${w || '82px'};padding:4px 6px;margin:0;font-size:12px">`;

  return `<div class="panel">
    <div class="panel-head"><h2>Confirm what was read</h2>
      <span class="sub">${rows.length} row(s) · ${esc(EXTRACT.model)} · ${EXTRACT.outputTokens} out tokens</span>
      <div class="spacer"></div>
      <button class="btn ghost tiny" data-act="extract-cancel">Discard</button></div>

    <div class="callout warn">
      <p><b>Check these before they go on the board.</b> Nothing here is on the board yet. A misread
        payout or mileage would corrupt every feasibility and rate decision, so operations will not
        act on numbers you have not eyeballed.</p>
      ${EXTRACT.notes ? `<p><b>Reader notes:</b> ${esc(EXTRACT.notes)}</p>` : ''}
    </div>

    ${rows.some((l) => l.windowWarning) ? `<div class="callout warn">
      <h4>Check these delivery windows</h4>
      ${rows.filter((l) => l.windowWarning).map((l) =>
        `<p style="margin:4px 0"><b>${esc(l.cargo || 'row')} → ${esc(l.destCity || '?')}</b>: ${esc(l.windowWarning)}</p>`).join('')}
      <p class="hint" style="margin:4px 0 0">The window becomes the appointment you are judged against, so
        it is worth a second look. Correct it in the row if it is wrong, or leave it and stage the load.</p>
    </div>` : ''}

    <div class="tablewrap"><table>
      <thead><tr><th></th><th>Cargo</th><th>Origin</th><th>ST</th><th>Destination</th><th>ST</th>
        <th class="num">Loaded mi</th><th class="num">Revenue</th><th class="num">Deliver in</th>
        <th class="num">Weight lb</th><th>Trailer</th><th>Read</th></tr></thead>
      <tbody>${rows.map((l, i) => {
        const missing = (l.unreadable || []);
        const bad = (f) => missing.includes(f) || (f === 'deadlineHours' && l.windowWarning)
          ? ' style="outline:1px solid var(--red)"' : '';
        return `<tr>
          <td><input type="checkbox" id="x-use-${i}" ${l.confidence === 'low' ? '' : 'checked'} style="margin:0"></td>
          <td>${cell(i, 'cargo', l.cargo, '128px')}</td>
          <td>${cell(i, 'ocity', l.originCity, '104px')}</td>
          <td>${cell(i, 'ostate', l.originState, '44px')}</td>
          <td>${cell(i, 'dcity', l.destCity, '104px')}</td>
          <td>${cell(i, 'dstate', l.destState, '44px')}</td>
          <td><span${bad('loadedMiles')}>${cell(i, 'miles', l.loadedMiles || '', '72px')}</span></td>
          <td><span${bad('gameRevenue')}>${cell(i, 'rev', l.gameRevenue || '', '82px')}</span></td>
          <td><span${bad('deadlineHours')}>${cell(i, 'dl', l.deadlineHours ? hhmm(l.deadlineHours) : '', '72px')}</span></td>
          <td>${cell(i, 'wt', l.weightLbs || '', '82px')}</td>
          <td>${cell(i, 'trailer', l.trailerType, '92px')}</td>
          <td>${conf(l.confidence)}${missing.length ? '<br>' + badge('bad', 'gaps') : ''}</td>
        </tr>`;
      }).join('')}</tbody></table></div>

    <p class="hint">Rows read with low confidence start unticked. Fields the reader could not make out
      are outlined in red and left blank — loaded miles, revenue and the delivery window are all
      required before a load can be evaluated.</p>
    <div class="row-actions">
      <button class="btn go" data-act="extract-commit">Add ticked rows to the board</button>
      <button class="btn ghost" data-act="extract-cancel">Discard</button>
    </div>
  </div>`;
}

function boardTableHtml() {
  if (!S.board.length) return '';
  return `<div class="panel">
    <div class="panel-head"><h2>Board (${S.board.length})</h2><div class="spacer"></div>
      <button class="btn primary tiny" data-act="board-eval">Evaluate &amp; assign</button></div>
    <div class="tablewrap"><table>
      <thead><tr><th>Cargo</th><th>Lane</th><th class="num">Loaded</th><th class="num">DH</th>
        <th class="num">Revenue</th><th class="num">$/mi</th><th class="num">Deliver in</th><th></th></tr></thead>
      <tbody>${S.board.map((l) => {
        const tot = l.loadedMiles + l.deadheadMiles;
        return `<tr>
          <td>${esc(l.cargo)}${l.isHazmat ? ' ' + badge('bad', 'hazmat') : ''}${l.isUrgent ? ' ' + badge('warn', 'urgent') : ''}</td>
          <td>${esc(l.originCity)}, ${esc(l.originState)} → <b>${esc(l.destCity)}, ${esc(l.destState)}</b></td>
          <td class="num">${num(l.loadedMiles)}</td><td class="num">${num(l.deadheadMiles)}</td>
          <td class="num">${money0(l.gameRevenue)}</td>
          <td class="num">${tot > 0 ? '$' + (l.gameRevenue / tot).toFixed(2) : '—'}</td>
          <td class="num">${hhmm(l.deadlineHours)}</td>
          <td><button class="btn tiny ghost" data-act="board-del" data-id="${l.id}">✕</button></td></tr>`;
      }).join('')}</tbody></table></div></div>`;
}

function decisionHtml() {
  if (!DECISION) return '';
  const d = DECISION;
  const cls = d.authorizedLoadId ? 'go' : d.rejectAll ? 'stop' : 'warn';
  return `<div class="panel">
    <div class="panel-head"><h2>Operations decision</h2>
      <div class="spacer"></div>
      <span class="sub">${esc(S.driver.rankTitle)}</span></div>
    ${!PRIV.canChooseAlternateLoad && d.evaluations.length > 1
      ? `<div class="callout mute"><p>${esc(PRIV.summary)}</p></div>` : ''}
    <div class="callout ${cls}">
      <h4>${esc(d.headline)}</h4>
      ${d.rationale ? `<p>${esc(d.rationale)}</p>` : ''}
      ${d.dispatchNotes.length ? `<ul>${d.dispatchNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </div>
    ${d.infoNeeded.length ? `<div class="callout warn"><h4>I need this before committing freight</h4>
      <ul>${d.infoNeeded.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    ${d.outOfHours ? `<div class="callout stop">
      <h4>${d.needsRestart ? 'You need the 34-hour restart' : 'You are out of hours'}</h4>
      <p>${esc(d.rationale)}</p>
      <p class="hint" style="margin:0">The board has been cleared — those jobs will have turned over by
        the time you are legal. Report your clock when you are back on duty and enter a fresh one.</p>
      <div class="row-actions">
        <button class="btn" data-act="tab" data-tab="dispatch">Report my clocks</button>
      </div></div>` : ''}
    ${d.evaluations.map((e) => loadCardHtml(e, d)).join('')}
    ${d.localOnly ? `<div class="callout info">
      <h4>Next step: the wider board</h4>
      <p>Nothing at this dock is worth running. Open the full freight board for
        <b>${esc(S.status.locationCity)}</b> in ATS and enter it — that is a different, usually longer
        list than what is offered where you are parked.</p>
      <div class="row-actions">
        <button class="btn primary" data-act="board-stage" data-stage="city">Show the city board</button>
        <button class="btn ghost" data-act="reject-all">Nothing in the city either — log it</button>
      </div></div>`
    : d.rejectAll && !d.infoNeeded.length ? `<div class="row-actions">
      <button class="btn danger" data-act="reject-all">Reject the board &amp; log it</button></div>` : ''}
  </div>`;
}

function loadCardHtml(e, d) {
  const rec = e.recommendation;
  const cls = rec === 'Authorize' ? 'auth' : rec === 'Backup' ? 'backup' : 'reject';
  const fb = { Feasible: 'ok', Tight: 'warn', Infeasible: 'bad' }[e.feasibility.verdict] || 'mute';
  const isAuth = d.authorizedLoadId === e.load.id;
  const canForce = rec !== 'Reject' && e.feasibility.verdict === 'Tight' && !e.hardFails.length;
  return `<div class="loadcard ${cls}">
    <div class="loadcard-head">
      ${badge(rec === 'Authorize' ? 'ok' : rec === 'Backup' ? 'info' : 'bad', rec)}
      <span class="lane">${esc(e.load.originCity)}, ${esc(e.load.originState)}
        &nbsp;→&nbsp; ${esc(e.load.destCity)}, ${esc(e.load.destState)}</span>
      ${badge('mute', e.load.trailerType || 'van')}
      <div class="spacer"></div>
      ${badge(fb, e.feasibility.verdict)}
      ${badge(e.destTier === 1 ? 'ok' : e.destTier === 2 ? 'mute' : 'warn', 'tier ' + e.destTier)}
      ${e.destResetFriendly ? badge('violet', 'reset ok') : ''}
      <span class="rate">${money0(e.load.gameRevenue)}</span>
    </div>
    <div class="kv">
      <span>${esc(e.load.cargo)}</span>
      <span>all-in <b>$${e.allInRpm.toFixed(2)}</b>/mi</span>
      <span>loaded <b>$${e.loadedRpm.toFixed(2)}</b>/mi</span>
      <span>${num(e.load.loadedMiles)} mi + <b>${num(e.load.deadheadMiles)}</b> DH</span>
      ${e.feasibility.waitForAppointmentHours > 0
        ? `<span>wait for dock <b>${hhmm(e.feasibility.waitForAppointmentHours)}</b></span>` : ''}
      <span>slack <b>${hhmm(e.feasibility.slackHours)}</b></span>
      <span>drive <b>${hhmm(e.feasibility.driveHours)}</b></span>
      <span>rests <b>${e.feasibility.restsRequired}</b></span>
      <span>fuel <b>${e.feasibility.fuelStopsRequired}</b></span>
      <span>your pay <b>${money(e.estimatedDriverPay)}</b></span>
      <span>margin <b>${money(e.estimatedMargin)}</b></span>
    </div>
    <div class="kv"><span>ETA <b>${gt(e.feasibility.projectedArrivalGameTime)}</b></span>
      ${e.feasibility.appointmentOpensGameTime
        ? `<span>window <b>${gt(e.feasibility.appointmentOpensGameTime)} → ${gt(e.feasibility.dueGameTime)}</b></span>`
        : `<span>due <b>${gt(e.feasibility.dueGameTime)}</b></span>`}
      <span>cycle after <b>${hhmm(e.feasibility.cycleRemainingAfter)}</b></span></div>
    ${e.hardFails.length ? `<ul class="reasons bad">${e.hardFails.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${e.pros.length ? `<ul class="reasons good">${e.pros.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${e.cons.length ? `<ul class="reasons bad">${e.cons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <details class="score"><summary>Scoring detail (${e.score.toFixed(2)}) and HOS timeline</summary>
      <ul>${e.scoreDetail.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${timelineHtml(e.feasibility)}
    </details>
    <div class="row-actions" style="margin-top:10px">
      ${isAuth ? `<button class="btn go" data-act="authorize" data-id="${e.load.id}">Accept ${esc(d.nextTripNumberPreview)}</button>` : ''}
      ${!isAuth && rec === 'Backup' && e.feasibility.verdict === 'Feasible' && PRIV.canChooseAlternateLoad
        ? `<button class="btn" data-act="authorize" data-id="${e.load.id}">Take this one instead</button>` : ''}
      ${!isAuth && rec === 'Backup' && e.feasibility.verdict === 'Feasible' && !PRIV.canChooseAlternateLoad && PRIV.canRequestAlternate
        ? `<button class="btn ghost" data-act="request-alt" data-id="${e.load.id}">Ask dispatch for this one</button>` : ''}
      ${canForce && PRIV.canOverrideTightLoad
        ? `<button class="btn danger" data-act="authorize" data-id="${e.load.id}" data-force="1">Accept as exception (sub-buffer)</button>` : ''}
    </div>
  </div>`;
}

/** A load needing a different trailer is solvable — show how, rather than just refusing. */

function timelineHtml(f) {
  if (!f.timeline?.length) return '';
  return `<div class="tablewrap"><table class="tl">
    <thead><tr><th>Segment</th><th>From</th><th>To</th><th class="num">Time</th><th class="num">Miles</th>
      <th class="num">Drive</th><th class="num">Shift</th><th class="num">Break</th><th class="num">Cycle</th></tr></thead>
    <tbody>${f.timeline.map((s) => `<tr class="${s.kind}">
      <td>${esc(s.label)}</td><td>${gt(s.startGameTime)}</td><td>${gt(s.endGameTime)}</td>
      <td class="num">${hhmm(s.hours)}</td><td class="num">${s.miles ? num(s.miles) : ''}</td>
      <td class="num">${hhmm(s.driveRemainingAfter)}</td><td class="num">${hhmm(s.shiftRemainingAfter)}</td>
      <td class="num">${hhmm(s.breakRemainingAfter)}</td><td class="num">${hhmm(s.cycleRemainingAfter)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function resetOptionsHtml() {
  const opts = S.views.resetOptions || [];
  if (!opts.length || S.hos.cycleRemaining > S.settings.scoring.resetWatchCycleHours) return '';
  return `<div class="panel">
    <div class="panel-head"><h2>Reset-capable markets</h2>
      <span class="sub">Parking, fuel and freight nearby — aim the truck at one of these.</span></div>
    <div class="tablewrap"><table><thead><tr><th>City</th><th>State</th><th>Tier</th><th>Strong divisions</th></tr></thead>
      <tbody>${opts.map((c) => `<tr><td><b>${esc(c.city)}</b></td><td class="mono">${esc(c.state)}</td>
        <td>${badge(c.tier === 1 ? 'ok' : c.tier === 2 ? 'mute' : 'warn', 'T' + c.tier)}</td>
        <td>${esc((c.strongDivisions || []).join(', '))}</td></tr>`).join('')}</tbody></table></div>
    <div class="row-actions"><button class="btn" data-act="show-move">Order an empty move / maintenance move</button></div>
  </div>`;
}

/* ============================================================ ACTIVE LOAD */
function viewActive() {
  const t = S.views.activeTrip;
  if (!t) return `<div class="panel"><div class="empty">No open load. Head to the Dispatch tab, enter the board
    and let operations assign you something.</div>
    <div class="row-actions" style="justify-content:center">
      <button class="btn" data-act="tab" data-tab="dispatch">Go to Dispatch</button>
      <button class="btn ghost" data-act="show-move">Log an empty / maintenance move</button></div></div>`;

  const f = t.feasibilityAtDispatch;
  return `
  <div class="panel">
    <div class="panel-head"><h2>${esc(t.number)} — ${esc(t.cargo)}</h2>
      ${badge(t.status === 'InTransit' ? 'info' : 'warn', t.status)}
      <div class="spacer"></div><span class="sub">${esc(t.division)} division · trailer ${esc(t.trailerUnit)} · unit ${esc(t.truckUnit)}</span></div>
    <dl class="kvlist">
      <dt>Lane</dt><dd>${esc(t.originCity)}, ${esc(t.originState)} → ${esc(t.destCity)}, ${esc(t.destState)}</dd>
      <dt>Dispatched</dt><dd>${num(t.dispatchedMiles)} loaded + ${num(t.deadheadMiles)} deadhead mi</dd>
      <dt>Revenue</dt><dd>${money(t.gameRevenue)} from ATS → ${money(t.companyRevenue)} booked</dd>
      <dt>Dispatched at</dt><dd>${gt(t.dispatchedGameTime)}</dd>
      ${t.appointmentOpensGameTime
        ? `<dt>Window</dt><dd>${gt(t.appointmentOpensGameTime)} → <b>${gt(t.dueGameTime)}</b>
             <div class="sub">They will not take it before the window opens.</div></dd>`
        : `<dt>Due</dt><dd>${gt(t.dueGameTime)}</dd>`}
      ${t.weightLbs ? `<dt>Weight</dt><dd>${num(t.weightLbs)} lb</dd>` : ''}
      <dt>Rationale</dt><dd style="font-family:inherit">${esc(t.authorizationRationale)}</dd>
    </dl>
    ${f ? `<h3 class="sect">Plan captured at authorization</h3>
      <div class="callout ${f.verdict === 'Feasible' ? 'go' : 'warn'}">
        <p><b>${esc(f.verdict)}</b> — ${hhmm(f.slackHours)} slack against a ${hhmm(f.requiredBufferHours)} required buffer.
          ${f.restsRequired} rest(s), ${f.breaksRequired} break(s), ${f.fuelStopsRequired} fuel stop(s),
          ${hhmm(f.driveHours)} driving over ${num(f.totalMiles)} mi.</p>
        ${f.warnings.length ? `<ul>${f.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      </div>
      <details class="score"><summary>Full HOS timeline</summary>${timelineHtml(f)}</details>` : ''}
  </div>

  ${strandedHtml()}
  ${loadedReportHtml(t)}

  <div class="cols">
    <div class="panel">
      <div class="panel-head"><h2>Trip log</h2><span class="sub">Log events as they happen.</span></div>
      <div class="grid2">
        ${dayTimeInput('ev-time', S.status.gameTime, 'Game time')}
        <label>Event
          <select id="ev-kind">${[
            ['BeginLoad', 'Begin load'], ['EndLoad', 'End load'],
            ['BeginUnload', 'Begin unload'], ['EndUnload', 'End unload'],
            ['Fuel', 'Fuel'], ['Break', 'Break'], ['Rest', 'Rest'], ['Scale', 'Scale'],
            ['Delay', 'Delay'], ['Breakdown', 'Breakdown'], ['Note', 'Note'],
          ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      </div>
      <label>Detail <span class="sub">— optional</span>
        <input id="ev-detail" placeholder="only if there is something worth noting"></label>
      <p class="hint">The event type and time are the record. Leave this blank unless something happened
        worth reading back later — a delay, a scale, damage, why you stopped where you did.</p>
      <fieldset><legend>If this is a fuel stop</legend>
        <div class="grid4">
          <label>Gallons<input id="ev-gal" type="number" step="0.1" placeholder="0"></label>
          <label>$/gal<input id="ev-price" type="number" step="0.001" placeholder="0.000"></label>
          <label>City<input id="ev-city" placeholder="${esc(S.status.locationCity)}"></label>
          <label>State<input id="ev-state" class="up" maxlength="2" placeholder="${esc(S.status.locationState)}"></label>
        </div>
        <p class="hint">Log each fill as you make it and it lands on the close-out for you — no adding
          three stops up from memory at the end.</p>
      </fieldset>
      <div class="row-actions"><button class="btn primary" data-act="log-event" data-id="${t.id}">Add to log</button></div>
      ${t.events.length ? `<div class="log" style="margin-top:12px">${t.events.slice().reverse().map((e) =>
        `<div><span class="ch">${esc(e.kind)}</span><span>${gt(e.gameTime)} — ${esc(e.detail)}${
          e.gallons ? ` <b>${num(e.gallons, 1)} gal</b>${e.pricePerGal ? ` @ $${num(e.pricePerGal, 3)}` : ''}` : ''
        }</span></div>`).join('')}</div>` : ''}
    </div>

    ${t.windowWarning ? `<div class="panel">
      <div class="panel-head"><h2>Check this load's delivery window</h2>
        ${badge('warn', 'not confirmed')}</div>
      <p>${esc(t.windowWarning)}</p>
      <p class="hint">Due ${gt(t.dueGameTime)} as it stands. ATS shows the window as a time range on the
        job screen &mdash; the second time is the appointment. Read it off the game and correct it here;
        the window is measured from when the load was dispatched, so this puts the appointment where it
        should have been all along.</p>
      <div class="grid3">
        <label>Time to deliver<input id="wf-hours" inputmode="numeric" placeholder="h:mm from the job screen"></label>
        <label>Note<input id="wf-note" placeholder="e.g. window reads 6:15 AM to 12:55 PM"></label>
        <div class="row-actions" style="align-self:end">
          <button class="btn go" data-act="fix-window" data-id="${esc(t.id)}">Correct the window</button>
        </div>
      </div>
    </div>` : ''}

    <div class="panel">
      <div class="panel-head"><h2>Close the load out</h2><span class="sub">Operations audits the trip from these numbers.</span></div>
      <div class="grid2">
        ${dayTimeInput('c-time', S.status.gameTime, 'Delivered at (game)')}
        <label>Ending odometer<input id="c-odo" type="number" step="1" value="${Math.round(S.status.atsOdometer)}"></label>
        <label>Miles run — override<input id="c-miles" type="number" step="1" placeholder="from odometer"></label>
        <label>Actual payout $<input id="c-rev" type="number" step="1" value="${Math.round(t.gameRevenue)}"></label>
        <label>Tolls $<input id="c-tolls" type="number" step="0.01" value="0"></label>
        <label>Repairs $<input id="c-repair" type="number" step="0.01" value="0"></label>
        <label>Fines $<input id="c-fines" type="number" step="0.01" value="0"></label>
        <label>Other expense $<input id="c-other" type="number" step="0.01" value="0"></label>
        <label>Tractor damage % after<input id="c-tdmg" type="number" step="0.1" min="0" max="100" value="${S.status.truckDamagePct}"></label>
        <label>Trailer damage % after<input id="c-trdmg" type="number" step="0.1" min="0" max="100" value="${S.status.trailerDamagePct}"></label>
        <label>Cargo damage %<input id="c-cargo" type="number" step="0.1" min="0" max="100" value="0"></label>
        <label>Fuel % now<input id="c-fuelpct" type="number" step="1" min="0" max="100" value="${S.status.fuelPct}"></label>
      </div>
      <p class="hint" id="c-milehint"></p>
      ${fuelStopsHtml(t)}
      ${clocksAtDeliveryHtml()}
      ${facilityHtml(t)}
      <fieldset><legend>Time and accessorials</legend>
        <div class="grid4">
          <label>Layover days<input id="c-lay" type="number" step="0.5" value="0"></label>
          <label>Breakdown days<input id="c-bd" type="number" step="0.5" value="0"></label>
          <label>Extra stops<input id="c-stops" type="number" step="1" value="${t.extraStops}"></label>
          <label>Tarps used<input id="c-tarps" type="number" step="1" value="${t.tarpsUsed}"></label>
          <label class="chk" style="margin-top:26px"><input type="checkbox" id="c-late"> ATS flagged late</label>
        </div>
      </fieldset>
      <label>If anything delayed you, what happened?
        <input id="c-delay" placeholder="e.g. closed for construction east of Ely — operations decides fault, not you"></label>
      <label>If the equipment took damage, how?
        <input id="c-dmgcause" placeholder="e.g. blew a steer recap · deer strike · AI traffic spawned into me"></label>
      <label>Notes<input id="c-notes" placeholder="optional"></label>
      <div class="row-actions">
        <button class="btn go" data-act="complete-trip" data-id="${t.id}">Deliver &amp; audit</button>
        <button class="btn danger" data-act="show-cancel" data-id="${t.id}">Cancel this load</button>
      </div>
    </div>
  </div>
  ${TRIP_AUDIT ? auditHtml(TRIP_AUDIT) : ''}`;
}

/* ---- home time
   The one driver preference the company is on the hook for, so it gets a visible clock rather than
   living in the scoring detail where nobody would find it. */
function homeTimeHtml() {
  const h = S.views.homeTime;
  if (!h || !h.tracked) return '';
  const cls = h.overdue ? 'stop' : h.dueSoon ? 'warn' : 'info';
  const pctOut = h.intervalDays > 0 ? Math.min(100, (h.daysOut / h.intervalDays) * 100) : 0;
  return `<div class="panel">
    <div class="panel-head"><h2>Home time</h2>
      ${h.overdue ? badge('bad', 'overdue') : h.dueSoon ? badge('warn', 'due soon') : badge('ok', 'on schedule')}
      <div class="spacer"></div><span class="sub">${esc(h.arrangement)}</span></div>
    ${h.reassignmentNotice ? `<div class="callout warn">
      <h4>Trailer change coming</h4>
      <p style="margin:0">${esc(h.reassignmentNotice)}</p></div>` : ''}
    <div class="meter ${h.overdue ? 'bad' : h.dueSoon ? 'warn' : 'ok'}">
      <div class="lbl">Days out of ${h.intervalDays}</div>
      <div class="big">${num(h.daysOut, 1)}</div>
      <div class="of">home yard ${esc(h.terminalLabel || '—')}</div>
      <div class="bar"><i style="width:${pctOut}%"></i></div>
    </div>
    <div class="callout ${cls}" style="margin-top:12px"><p>${esc(h.headline)}</p>
      ${h.milesFromHome !== null && h.milesFromHome !== undefined
        ? `<p>Roughly <b>${num(h.milesFromHome)} mi</b> from ${esc(h.terminalLabel)} right now${
            h.atHome ? ' — close enough to take it.' : '.'}</p>` : ''}
      ${h.homeTimesTaken > 0 ? `<p class="sub">${h.homeTimesTaken} home time(s) taken · last home ${gt(h.lastHomeGameTime)}.</p>` : ''}
    </div>
    <p class="hint">Distance is deliberately rough — it only has to tell a load heading home from one
      heading away. Report in at the yard itself to log the home time as taken.</p>
  </div>`;
}

/* ---- city discovery
   ATS never generates cargo for a city that was revealed with a save editor instead of driven to, so
   the carrier's network can only grow to places the driver has actually reached. */
function discoveryHtml(n) {
  if (!n) return '';
  return `<div class="callout ${n.recommended ? 'go' : 'info'}" style="margin-top:14px">
    <h4>${esc(n.headline)}</h4>
    ${n.detail && n.detail.length ? `<ul>${n.detail.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${n.garageAvailable ? `<div class="row-actions">
      <button class="btn" data-act="tab" data-tab="terminals">Open a yard here</button>
      <button class="btn ghost" data-act="decline-garage"
        data-city="${esc(n.city)}" data-state="${esc(n.state)}">Not interested</button>
    </div>` : ''}
  </div>`;
}

/**
 * Yards the company would actually open — which is a much smaller list than everywhere you have been.
 * Limited to the employer's own network: you are a driver, not the person who decides where Prime
 * builds terminals.
 */
function garageOpportunitiesHtml() {
  const ops = S.views.garageOpportunities || [];
  if (!ops.length) return '';
  return `<div class="panel">
    <div class="panel-head"><h2>Yards you could open</h2>
      <span class="sub">${ops.length} on our network, reached, not ours yet</span></div>
    <p class="hint">These are cities <b>${esc(S.company.name || 'we')}</b> runs terminals in that you have driven to
      and we do not have a yard in. A garage is only worth buying somewhere you have actually been — ATS
      will not generate cargo in a city you revealed with an editor rather than discovered.</p>
    <div class="tablewrap"><table>
      <thead><tr><th>City</th><th>Reached</th><th>Market</th><th></th></tr></thead><tbody>
      ${ops.map((c) => `<tr>
        <td><b>${esc(c.city)}</b>${c.state ? ', ' + esc(c.state) : ''}</td>
        <td>${c.discoveredGameTime ? gt(c.discoveredGameTime) : '—'}</td>
        <td>${c.tier ? `Tier ${c.tier}${c.resetFriendly ? ' · reset-friendly' : ''}` : '—'}</td>
        <td><button class="btn tiny ghost" data-act="decline-garage"
          data-city="${esc(c.city)}" data-state="${esc(c.state)}">Dismiss</button></td></tr>`).join('')}
    </tbody></table></div>
  </div>`;
}

/**
 * Everywhere the truck has actually been. This used to be the heading on the opportunity list above,
 * which is filtered down hard — so a career with a dozen cities showed three and looked like it had
 * lost the rest. They were always in the career file; nothing was ever dropped.
 */
function citiesReachedHtml() {
  const all = S.views.reached || [];
  if (!all.length) return '';

  const cls = (st) => st === 'Yard here' ? 'ok' : st === 'Could buy' ? 'warn' : 'mute';
  const owned = all.filter((c) => c.status === 'Yard here').length;
  const open = all.filter((c) => c.status === 'Could buy').length;

  return `<div class="panel">
    <div class="panel-head"><h2>Cities you have reached</h2>
      <span class="sub">${all.length} total · ${owned} with a yard · ${open} we could open</span></div>
    <p class="hint">Every city you have reported being in. Reaching one is what makes its freight board
      readable to dispatch, whether or not there is ever a yard there.
      ${S.views.networkSummary ? esc(S.views.networkSummary) + ' A city off that network is still on the map — it is just not somewhere the company opens terminals.' : ''}</p>
    ${(() => {
      // Paged rather than capped. An earlier version showed six of twelve with no indication and made
      // it look like cities had been lost — the count and the range stay visible here, and every city
      // is one page away.
      const per = 10;
      const pages = Math.max(1, Math.ceil(all.length / per));
      const page = Math.min(Math.max(1, REACHED_PAGE), pages);
      const from = (page - 1) * per;
      const shown = all.slice(from, from + per);
      return `<div class="tablewrap"><table>
        <thead><tr><th>City</th><th>Reached</th><th>On</th><th>Market</th><th>Yard</th></tr></thead><tbody>
        ${shown.map((c) => `<tr>
          <td><b>${esc(c.city)}</b>${c.state ? ', ' + esc(c.state) : ''}</td>
          <td>${c.discoveredGameTime ? gt(c.discoveredGameTime) : '<span class="sub">before tracking</span>'}</td>
          <td class="sub">${esc(c.tripNumber || '—')}</td>
          <td>${c.tier ? `Tier ${c.tier}${c.resetFriendly ? ' · reset' : ''}` : '<span class="sub">unknown</span>'}</td>
          <td>${badge(cls(c.status), c.status)}</td></tr>`).join('')}
      </tbody></table></div>
      ${pages > 1 ? `<div class="row-actions" style="margin-top:8px">
        <button class="btn tiny ghost" data-act="reached-page" data-page="${page - 1}"
          ${page <= 1 ? 'disabled' : ''}>← Newer</button>
        <span class="sub">${from + 1}–${Math.min(from + per, all.length)} of ${all.length}
          · page ${page} of ${pages}</span>
        <button class="btn tiny ghost" data-act="reached-page" data-page="${page + 1}"
          ${page >= pages ? 'disabled' : ''}>Older →</button>
      </div>` : ''}`;
    })()}
  </div>`;
}

/* ---- fuel stops on the close-out
   A trip can fuel several times at several prices, so each fill is its own line. Stops logged from the
   trip log during the run are already here; the driver only adds what they did not log. */
let FUEL = { tripId: null, seeded: 0, rows: [] };

function fuelRows(t) {
  const server = t.fuelStops || [];
  if (FUEL.tripId !== t.id) {
    FUEL = { tripId: t.id, seeded: server.length, rows: server.map((f) => ({ ...f, logged: true })) };
  } else if (server.length > FUEL.seeded) {
    // A fill was just logged on the trip log. Fold it in without discarding rows typed here.
    FUEL.rows = FUEL.rows.concat(server.slice(FUEL.seeded).map((f) => ({ ...f, logged: true })));
    FUEL.seeded = server.length;
  }
  return FUEL.rows;
}

/* Pull whatever is currently in the inputs back into state, so adding or removing a row does not
   throw away what the driver has already typed into the others. */
function harvestFuel() {
  FUEL.rows = FUEL.rows.map((r, i) => ({
    ...r,
    gallons: fv(`fs-gal-${i}`),
    pricePerGal: fv(`fs-price-${i}`),
    city: sv(`fs-city-${i}`),
    state: sv(`fs-state-${i}`),
  }));
  return FUEL.rows.filter((r) => r.gallons > 0 || r.cost > 0);
}

function fuelStopsHtml(t) {
  const rows = fuelRows(t);
  const gal = rows.reduce((a, r) => a + (+r.gallons || 0), 0);
  const cost = rows.reduce((a, r) => a + (+r.gallons || 0) * (+r.pricePerGal || 0) || 0, 0);
  const mi = (t.dispatchedMiles || 0) + (t.deadheadMiles || 0);

  return `<fieldset><legend>Fuel stops</legend>
    ${rows.length ? `<div class="tablewrap"><table><thead><tr>
        <th>Gallons</th><th>$/gal</th><th>City</th><th>ST</th><th class="num">Cost</th><th></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr>
        <td><input id="fs-gal-${i}" type="number" step="0.1" style="width:86px" value="${r.gallons || ''}"></td>
        <td><input id="fs-price-${i}" type="number" step="0.001" style="width:86px" value="${r.pricePerGal || ''}"></td>
        <td><input id="fs-city-${i}" style="width:128px" value="${esc(r.city || '')}"></td>
        <td><input id="fs-state-${i}" class="up" maxlength="2" style="width:50px" value="${esc(r.state || '')}"></td>
        <td class="num">${money((+r.gallons || 0) * (+r.pricePerGal || 0))}</td>
        <td>${r.logged ? badge('mute', 'logged') : ''}
          <button class="btn tiny ghost" data-act="del-fuel-row" data-i="${i}" title="Remove this stop">×</button></td>
      </tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">No fuel bought on this trip.</div>`}
    <div class="row-actions">
      <button class="btn ghost" data-act="add-fuel-row">+ Add a fuel stop</button>
      ${rows.length ? `<span class="sub">${num(gal, 1)} gal · ${money(cost)}${
        gal > 0 ? ` · blended $${num(cost / gal, 3)}/gal` : ''}${
        gal > 0 && mi > 0 ? ` · ${num(mi / gal, 1)} mpg` : ''}</span>` : ''}
    </div>
  </fieldset>`;
}

/* ---- facility time
   Loading, unloading and detention come from the Begin/End pairs in the trip log. Detention is pay,
   so showing the working matters more than showing a box to type a number into. */
function facilityHtml(t) {
  const at = (kind) => {
    const hit = (t.events || []).filter((e) => e.kind === kind).map((e) => e.gameTime).filter(Boolean).sort();
    return hit.length ? hit[0] : null;
  };
  const span = (a, b) => {
    const x = at(a), y = at(b);
    if (!x || !y) return null;
    const h = (Date.parse(isoUtc(y)) - Date.parse(isoUtc(x))) / 3600000;
    return h >= 0 ? h : null;
  };
  const load = span('BeginLoad', 'EndLoad');
  const unload = span('BeginUnload', 'EndUnload');
  const free = S.driver.pay.detentionFreeHours || 0;
  const det = (load === null && unload === null) ? null
    : Math.max(0, (load || 0) - free) + Math.max(0, (unload || 0) - free);

  const line = (label, hours, a, b) => hours === null
    ? `<tr><td>${label}</td><td colspan="2" class="sub">not logged — log <b>${a}</b> and <b>${b}</b>, or type it below</td></tr>`
    : `<tr><td>${label}</td><td class="num"><b>${hhmm(hours)}</b></td>
        <td class="sub">${gt(at(a))} → ${gt(at(b))}</td></tr>`;

  return `<fieldset><legend>Facility time — from your trip log</legend>
    <div class="tablewrap"><table><tbody>
      ${line('Loading', load, 'BeginLoad', 'EndLoad')}
      ${line('Unloading', unload, 'BeginUnload', 'EndUnload')}
      ${det === null ? '' : `<tr><td><b>Detention</b></td>
        <td class="num"><b style="color:${det > 0 ? 'var(--amber2)' : 'var(--ink3)'}">${hhmm(det)}</b></td>
        <td class="sub">${det > 0 ? `beyond ${hhmm(free)} free at each stop — this is paid`
          : `both stops inside the ${hhmm(free)} free window`}</td></tr>`}
    </tbody></table></div>
    ${load === null || unload === null ? `<div class="grid3" style="margin-top:8px">
      <label>Loading<input id="c-load" inputmode="numeric" placeholder="h:mm" value="${hhmm(t.loadingHours)}"></label>
      <label>Unloading<input id="c-unload" inputmode="numeric" placeholder="h:mm" value="${hhmm(t.unloadingHours)}"></label>
      <label>Detention<input id="c-det" inputmode="numeric" placeholder="h:mm" value="0:00"></label>
    </div>
    <p class="hint">Fallback for what you did not log. Log the pairs next time and this works itself out.</p>`
      : `<p class="hint">Derived from the log, so there is nothing to type. The audit shows the times it used.</p>`}
  </fieldset>`;
}

/* ---- clocks at delivery
   Reporting them here is what stops the Dispatch tab asking for the same four numbers again. */
function clocksAtDeliveryHtml() {
  const brk = S.views.hos.breakEnforced;
  return `<fieldset><legend>Clocks at delivery — optional, saves reporting them again</legend>
    <div class="${brk ? 'grid4' : 'grid3'}">
      <label>Drive left<input id="c-hdrive" inputmode="numeric" placeholder="h:mm"></label>
      <label>Shift left<input id="c-hshift" inputmode="numeric" placeholder="h:mm"></label>
      ${brk ? `<label>Break clock<input id="c-hbreak" inputmode="numeric" placeholder="h:mm"></label>` : ''}
      <label>Cycle left<input id="c-hcycle" inputmode="numeric" placeholder="h:mm"></label>
    </div>
    <p class="hint">Read them off your HOS display while you are stopped at the receiver and dispatch can
      plan the next load straight away. Leave blank and I will ask for them on the Dispatch tab.</p>
  </fieldset>`;
}

/* Everything a status report can set off. Payday and arriving home both happen because the clock
   moved, so they surface here rather than being something the driver has to go looking for. */
function afterStatus(r, fallback = 'Status updated.') {
  const paid = r.paid || [];
  if (paid.length) return paydayModal(paid);
  if (r.homeBrief) return homeBriefModal(r.homeBrief);
  toast(DISCOVERY ? DISCOVERY.headline : fallback, 'ok');
}

/* Payday. Getting paid should not be a line in a log you scroll past. */
function paydayModal(paid) {
  const total = paid.reduce((a, p) => a + (p.stub ? p.stub.net : p.gross), 0);
  modal(`<div class="panel-head"><h2>${paid.length > 1 ? 'You have been paid' : 'Payday'}</h2>
      ${badge('ok', money(total) + ' net')}
      <div class="spacer"></div>
      <button class="btn tiny ghost" data-act="close-modal">Close</button></div>

    ${paid.map((p) => p.stub ? `
      <h3 class="sect">${esc(p.number)} — ${esc(p.notes)}</h3>
      ${stubTableHtml(p)}` : `
      <h3 class="sect">${esc(p.number)}</h3>
      <p>${money(p.gross)} gross.</p>`).join('')}

    <p class="hint">Payday is every Friday. Nothing to press — it runs when your clock crosses one.
      Full stubs are on the Payroll tab.</p>
    <div class="row-actions">
      <div style="flex:1"></div>
      <button class="btn" data-act="tab" data-tab="payroll">Open Payroll</button>
      <button class="btn primary" data-act="close-modal">Got it</button>
    </div>`);
}

/* The brief handed over when the driver reports in at their home yard. */
function homeBriefModal(b) {
  const sec = (title, items, cls) => items && items.length
    ? `<div class="callout ${cls}"><h4>${title}</h4>
        <ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';

  modal(`<div class="panel-head"><h2>Home</h2>
      ${badge('ok', esc(b.terminal))}
      <div class="spacer"></div>
      <button class="btn tiny ghost" data-act="close-modal">Close</button></div>

    <div class="callout go"><p style="margin:0">${esc(b.headline)}</p></div>

    ${b.nothingToDo ? `<div class="callout info">
      <h4>Nothing needs doing</h4>
      <p style="margin:0">Equipment is inside every threshold and there is no paperwork outstanding.
        Park it and take your days.</p></div>` : ''}

    ${sec('Parking and your reset', b.parking, 'info')}
    ${sec('The shop', b.shop, 'warn')}
    ${sec('Equipment', b.equipment, 'info')}
    ${b.betterUnitAvailable ? `<div class="row-actions" style="margin:-6px 0 12px">
      <button class="btn" data-act="ask-better-unit">Put in for unit ${esc(b.betterUnit)}</button>
      <span class="sub">answered while you are standing here</span>
    </div>` : ''}
    ${sec('Paperwork while you are standing still', b.paperwork, 'mute')}

    <div class="row-actions">
      <div style="flex:1"></div>
      <button class="btn" data-act="tab" data-tab="maint">Maintenance</button>
      <button class="btn primary" data-act="close-modal">Got it</button>
    </div>`);
}

/* The audit, shown the moment a load closes. It used to render inline on the tab, where it sat until
   the next dispatch was taken — by which point it was about the wrong trip and easily missed. */
function auditModal(a) {
  const late = a.trip.serviceResult === 'Late';
  const cls = late ? (a.faultAttribution === 'Driver' ? 'stop' : 'warn') : 'go';

  modal(`<div class="panel-head"><h2>${esc(a.trip.number)} closed</h2>
      ${badge(late ? 'bad' : 'ok', a.trip.serviceResult)}
      <div class="spacer"></div>
      <button class="btn tiny ghost" data-act="close-modal">Close</button></div>

    <div class="callout ${cls}">
      <h4>${esc(a.headline)}</h4>
      ${a.faultRationale ? `<p>${esc(a.faultRationale)}</p>` : ''}
    </div>

    ${(a.requestAnswers || []).length ? `<div class="callout ${a.homeRequestGranted ? 'go' : 'info'}">
      <h4>Operations came back to you</h4>
      ${a.requestAnswers.map((x) => `<p>${esc(x)}</p>`).join('')}</div>` : ''}

    ${(a.warnings || []).length ? `<div class="callout warn">
      <h4>Check these numbers</h4>
      ${a.warnings.map((w) => `<p>${esc(w)}</p>`).join('')}
      <p class="hint" style="margin:0">Posted as reported — correct it on the trip if it was a typo.</p></div>` : ''}

    ${(a.whatsNext || []).length ? `<div class="callout ${a.restartOrdered ? 'stop' : 'warn'}">
      <h4>${a.restartOrdered ? 'Before your next load — restart required' : 'Before your next load'}</h4>
      ${a.whatsNext.map((x) => `<p>${esc(x)}</p>`).join('')}
      ${a.restartOrdered ? `<div class="row-actions">
        <button class="btn" data-act="tab" data-tab="dispatch">Report the restart on Dispatch</button>
      </div>` : ''}</div>` : ''}

    ${a.homeTimeNote ? `<div class="callout ${a.gotYouHome ? 'go' : 'info'}">
      <h4>${a.gotYouHome ? 'That load got you home' : 'Home time'}</h4>
      <p style="margin:0">${esc(a.homeTimeNote)}</p></div>` : ''}

    <div class="cols">
      <div>
        ${auditSection('Service', a.serviceFindings)}
        ${auditSection('Mileage', a.mileageFindings)}
        ${auditSection('Money', a.moneyFindings)}
      </div>
      <div>
        ${auditSection('Equipment', a.equipmentFindings)}
        ${a.trip.pay.lines.length ? `<h3 class="sect">Your pay — ${money(a.driverPay)}</h3>
          <ul class="reasons">${a.trip.pay.lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${a.carriedForward && a.carriedForward.length ? `<h3 class="sect">Carried forward</h3>
          <ul class="reasons">${a.carriedForward.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>

    ${a.homeTimeInstructions && a.homeTimeInstructions.length ? `<div class="callout go">
      <h4>When you get in</h4>
      <ul>${a.homeTimeInstructions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}

    ${a.directives.length ? `<div class="callout ${a.maintenanceStatus === 'OutOfService' ? 'stop' : 'info'}">
      <h4>What happens next</h4>
      <ul>${a.directives.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}

    ${a.disciplineRecommendation ? `<div class="callout stop">
      <h4>Safety has issued: ${esc(a.disciplineRecommendation.replace(/([a-z])([A-Z])/g, '$1 $2'))}</h4>
      <p>Incident ${esc(a.incidentNumber || '')} was opened. Acknowledge it on the Safety tab.</p></div>` : ''}

    ${a.discovery ? discoveryHtml(a.discovery) : ''}

    <div class="row-actions">
      <div style="flex:1"></div>
      <button class="btn primary" data-act="close-modal">Got it</button>
    </div>`);
}

const auditSection = (title, items) => items && items.length
  ? `<h3 class="sect">${title}</h3><ul class="reasons">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

function auditHtml(a) {
  const sec = (title, items) => items.length
    ? `<h3 class="sect">${title}</h3><ul class="reasons">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  return `<div class="panel">
    <div class="panel-head"><h2>Trip audit — ${esc(a.trip.number)}</h2>
      ${badge(a.trip.serviceResult === 'OnTime' ? 'ok' : a.trip.serviceResult === 'Late' ? 'bad' : 'mute', a.trip.serviceResult)}</div>
    <div class="callout ${a.trip.serviceResult === 'Late' ? (a.faultAttribution === 'Driver' ? 'stop' : 'warn') : 'go'}">
      <h4>${esc(a.headline)}</h4>${a.faultRationale ? `<p>${esc(a.faultRationale)}</p>` : ''}</div>
    ${sec('Service', a.serviceFindings)}${sec('Mileage', a.mileageFindings)}
    ${sec('Money', a.moneyFindings)}${sec('Equipment', a.equipmentFindings)}
    ${a.carriedForward && a.carriedForward.length ? `<div class="callout go" style="margin-top:14px">
      <h4>Carried forward to the next dispatch${a.clocksReported ? ', clocks included' : ''}</h4>
      <p>You do not need to type any of this again — confirm it on the Dispatch tab.</p>
      <ul>${a.carriedForward.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${a.homeTimeInstructions && a.homeTimeInstructions.length ? `<div class="callout go" style="margin-top:14px">
      <h4>Home time — report to the yard</h4>
      <ul>${a.homeTimeInstructions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${a.discovery ? discoveryHtml(a.discovery) : ''}
    ${a.directives.length ? `<div class="callout ${a.maintenanceStatus === 'OutOfService' ? 'stop' : 'info'}" style="margin-top:14px">
      <h4>What happens next</h4><ul>${a.directives.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${a.trip.pay.lines.length ? `<h3 class="sect">Driver pay accrued — ${money(a.driverPay)}</h3>
      <ul class="reasons">${a.trip.pay.lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${a.disciplineRecommendation ? `<div class="callout stop" style="margin-top:14px">
      <h4>Safety has issued: ${esc(a.disciplineRecommendation.replace(/([a-z])([A-Z])/g, '$1 $2'))}</h4>
      <p>Incident ${esc(a.incidentNumber || '')} was opened and the action follows from it.
        Read it and acknowledge it on the Safety tab.</p></div>` : ''}
    <div class="row-actions"><button class="btn ghost" data-act="clear-audit">Dismiss</button></div>
  </div>`;
}

/* ============================================================ TRIPS */
function viewTrips() {
  const trips = S.trips;
  return `<div class="panel">
    <div class="panel-head"><h2>Trip records</h2>
      <span class="sub">${trips.length} on file · click a row for the full record</span>
      <div class="spacer"></div><button class="btn tiny" data-act="show-move">Log a move</button></div>
    ${trips.length ? `<div class="tablewrap"><table>
      <thead><tr><th>Trip</th><th>Cargo</th><th>Lane</th><th class="num">Miles</th><th class="num">Revenue</th>
        <th>Service</th><th>Fault</th><th class="num">Your pay</th><th>Settled</th></tr></thead>
      <tbody>${trips.map((t) => `<tr data-act="trip-detail" data-id="${t.id}" style="cursor:pointer">
        <td class="mono">${esc(t.number)}</td><td>${esc(t.cargo)}</td>
        <td>${esc(t.originCity)}, ${esc(t.originState)} → ${esc(t.destCity)}, ${esc(t.destState)}</td>
        <td class="num">${num((t.actualMiles || t.dispatchedMiles) + t.deadheadMiles)}</td>
        <td class="num">${money0(t.companyRevenue)}</td>
        <td>${badge(t.serviceResult === 'OnTime' ? 'ok' : t.serviceResult === 'Late' ? 'bad' : 'mute',
          t.status === 'Cancelled' ? 'cancelled' : t.serviceResult === 'NotApplicable' ? t.status : t.serviceResult)}</td>
        <td>${t.faultAttribution === 'None' ? '—' : badge(t.faultAttribution === 'Driver' ? 'bad' : 'info', t.faultAttribution)}</td>
        <td class="num">${money(t.pay.total)}</td>
        <td class="mono">${esc(t.settlementNumber || '—')}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No trips yet.</div>'}
  </div>`;
}

function tripDetailModal(id) {
  const t = S.trips.find((x) => x.id === id);
  if (!t) return;
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  modal(`
    <div class="panel-head"><h2>${esc(t.number)} — ${esc(t.cargo)}</h2>
      ${badge(t.serviceResult === 'OnTime' ? 'ok' : t.serviceResult === 'Late' ? 'bad' : 'mute', t.status)}
      <div class="spacer"></div><button class="btn tiny ghost" data-act="close-modal">Close</button></div>
    <dl class="kvlist">
      ${row('Kind / division', esc(t.kind) + ' · ' + esc(t.division))}
      ${row('Origin', esc(t.originCity) + ', ' + esc(t.originState) + (t.shipper ? ' — ' + esc(t.shipper) : ''))}
      ${row('Destination', esc(t.destCity) + ', ' + esc(t.destState) + (t.receiver ? ' — ' + esc(t.receiver) : ''))}
      ${row('Dispatched miles', num(t.dispatchedMiles) + ' loaded / ' + num(t.deadheadMiles) + ' deadhead'
        + (t.repositionMiles > 0 ? ' / ' + num(t.repositionMiles) + ' repositioning' : ''))}
      ${t.repositionNote ? row('Empty leg before this load', t.repositionNote) : ''}
      ${row('Actual miles', num(t.actualMiles))}
      ${row('Odometer', num(t.startOdometer) + ' → ' + num(t.endOdometer))}
      ${row('ATS revenue / booked', money(t.gameRevenue) + ' / ' + money(t.companyRevenue))}
      ${row('Dispatched / due / delivered', gt(t.dispatchedGameTime) + ' · ' + gt(t.dueGameTime) + ' · ' + gt(t.deliveredGameTime))}
      ${t.appointmentOpensGameTime
        ? row('Delivery window', gt(t.appointmentOpensGameTime) + ' → ' + gt(t.dueGameTime)) : ''}
      ${row('Fuel', num(t.fuelGallons, 1) + ' gal · ' + money(t.fuelCost))}
      ${row('Tolls / repairs / fines', money(t.tolls) + ' · ' + money(t.repairCost) + ' · ' + money(t.fines))}
      ${row('Unit / trailer', esc(t.truckUnit) + ' / ' + esc(t.trailerUnit))}
      ${row('Tractor damage', pct(t.truckDamageBefore) + ' → ' + pct(t.truckDamageAfter))}
      ${row('Trailer damage', pct(t.trailerDamageBefore) + ' → ' + pct(t.trailerDamageAfter))}
      ${row('Cargo damage', pct(t.cargoDamagePct))}
      ${row('Detention / layover / breakdown', hhmm(t.detentionHours) + ' · ' + num(t.layoverDays, 1) + ' d · ' + num(t.breakdownDays, 1) + ' d')}
      ${row('Fault', esc(t.faultAttribution))}
      ${row('Driver pay', money(t.pay.total) + (t.settlementNumber ? ' (paid on ' + esc(t.settlementNumber) + ')' : ' (unsettled)'))}
      ${t.cancelReason ? row('Cancelled because', esc(t.cancelReason)) : ''}
      ${t.notes ? row('Notes', esc(t.notes)) : ''}
    </dl>
    ${t.pay.lines.length ? `<h3 class="sect">Pay detail</h3><ul class="reasons">${t.pay.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${t.events.length ? `<h3 class="sect">Trip log</h3><div class="log">${t.events.map((e) =>
      `<div><span class="ch">${esc(e.kind)}</span><span>${gt(e.gameTime)} — ${esc(e.detail)}</span></div>`).join('')}</div>` : ''}
    ${t.feasibilityAtDispatch ? `<h3 class="sect">Plan at authorization (${esc(t.feasibilityAtDispatch.verdict)})</h3>
      ${timelineHtml(t.feasibilityAtDispatch)}` : ''}`);
}

/* ============================================================ FLEET */
function viewFleet() {
  const t = S.views.truck, tr = S.views.trailer;
  const b = S.views.backdrop || {};
  return `
  ${b.any ? `<div class="callout warn">
    <h4>Equipment on the book that ATS knows nothing about</h4>
    <p>${[b.trucks ? `${b.trucks} tractor(s)` : '', b.trailers ? `${b.trailers} trailer(s)` : '',
         b.yards ? `${b.yards} yard(s) in cities you have not reached` : '']
        .filter(Boolean).join(', ')}. These were never bought in your game, so their damage and mileage
      are fiction — and a truck based in an undiscovered city would never see cargo, because ATS does not
      generate freight for cities you did not drive to.</p>
    <p>Trim the book to what you actually own. Anything with real trip history, anything assigned to you
      or to a hired driver, and headquarters are all kept.</p>
    <div class="row-actions">
      <button class="btn" data-act="trim-fleet" data-yards="0">Trim equipment only</button>
      ${b.yards ? `<button class="btn" data-act="trim-fleet" data-yards="1">Trim equipment and yards</button>` : ''}
    </div></div>` : ''}
  <div class="panel">
    <div class="panel-head"><h2>Your assignment</h2></div>
    <div class="cols">
      <div>${t ? `<dl class="kvlist">
        <dt>Unit</dt><dd>${esc(t.gameId || t.unit)}${t.gameId ? ` <span class="sub">(unit ${esc(t.unit)})</span>` : ''}</dd>
        <dt>Tractor</dt><dd>${t.year} ${esc(t.make)} ${esc(t.model)}</dd>
        <dt>Driveline</dt><dd>${esc(t.engine)} · ${esc(t.transmission)}</dd>
        <dt>Spec</dt><dd>${esc(t.cabConfig)} · ${esc(t.wheelbase)} · governed ${t.governedMph} mph</dd>
        <dt>Fuel / economy</dt><dd>${num(t.fuelCapacityGal)} gal · ${num(t.avgMpg, 1)} mpg</dd>
        <dt>Company service mi</dt><dd>${num(t.serviceMiles)}</dd>
        <dt>ATS odometer</dt><dd>${num(t.atsOdometer)}</dd>
        <dt>PM</dt><dd>last at ${num(t.lastServiceMiles)} · every ${num(t.serviceIntervalMiles)} mi
          (${num(Math.max(0, t.serviceIntervalMiles - (t.serviceMiles - t.lastServiceMiles)))} mi to go)</dd>
        <dt>Damage</dt><dd>${pct(t.damagePct)}</dd>
        <dt>Note</dt><dd style="font-family:inherit">${esc(t.notes || '—')}</dd>
      </dl>` : '<div class="empty">No truck assigned.</div>'}</div>
      <div>${tr ? `<dl class="kvlist">
        <dt>Trailer</dt><dd>${esc(tr.unit)}</dd>
        <dt>Equipment</dt><dd>${tr.year} ${esc(tr.make)} · ${esc(tr.length)} ${esc(tr.type)} · ${esc(tr.axles)}</dd>
        <dt>Division</dt><dd>${esc(tr.division)}</dd>
        <dt>Service mi</dt><dd>${num(tr.serviceMiles)}</dd>
        <dt>Damage</dt><dd>${pct(tr.damagePct)}</dd>
        <dt>Located</dt><dd>${esc(tr.currentLocation || '—')}</dd>
      </dl>` : '<div class="empty">No trailer assigned.</div>'}</div>
    </div>
    <h3 class="sect">Reassign</h3>
    <div class="grid3">
      <label>Tractor<select id="as-truck"><option value="">(no change)</option>
        ${S.trucks.map((x) => `<option value="${esc(x.unit)}">${esc(x.gameId || x.unit)} — ${x.year} ${esc(x.make)} ${esc(x.model)} (${esc(x.status)})</option>`).join('')}</select></label>
      <label>Trailer<select id="as-trailer"><option value="">(no change)</option>
        ${S.trailers.map((x) => `<option value="${esc(x.unit)}">${esc(x.gameId || x.unit)} — ${esc(x.length)} ${esc(x.type)} (${esc(x.status)})</option>`).join('')}</select></label>
      <label style="align-self:end"><button class="btn primary wide" data-act="assign">Assign equipment</button></label>
    </div>
    <p class="hint">Operations normally decides equipment. Reassigning yourself is an override — it is logged.</p>
  </div>

  ${terminalsHtml()}
  ${fleetOpsHtml()}

  <div class="callout warn">
    <h4>Affording all this in ATS</h4>
    <p>The company modelled here — ${(S.company.terminals || []).length} yard(s),
      ${S.trucks.length} tractor(s), plus hired drivers — costs far more than a fresh ATS profile has.
      Two honest ways to play it:</p>
    <ul>
      <li><b>Start small and grow (recommended, no tools).</b> Delete the yards and units you do not
        actually own, keep the one truck you bought, and add things here as you buy them in the game.
        Every system in this app works the same for a one-truck operation.</li>
      <li><b>Seed your game with a save editor or mods.</b> Money lives in
        <span class="mono">Documents\\American Truck Simulator\\profiles\\&lt;profile&gt;\\save\\&lt;slot&gt;\\game.sii</span>
        (encrypted — SII_Decrypt opens it; TS SE Tool is a dedicated editor). Mods can unlock all
        dealerships, garages, cities and recruiting agencies, which ATS otherwise hides until you drive
        to them.</li>
    </ul>
    <p><b>Back up your profile folder before running any editor.</b> Editors can corrupt a save, TS SE
      Tool is alpha software, and SCS cannot support a modified save because they cannot tell what
      changed. If that puts you off, take the first option — it is the better roleplay anyway.</p>
  </div>

  <div class="callout info">
    <h4>Real equipment vs company backdrop</h4>
    <p>ATS lets you buy trucks and trailers, but it gives you no way to <em>set</em> damage — damage
      only accrues from driving, and only on the unit you are actually in. So the app tracks condition
      on equipment marked <b>in garage</b> and treats the rest as the carrier's paper fleet:
      real for roleplay, but never given invented damage and never the subject of a shop directive
      you could not act on.</p>
    <p>Mark a unit <b>in garage</b> once you have bought its equivalent in ATS. Delete anything the
      company should not own, and add units as you buy them.</p>
  </div>

  ${equipmentByYardHtml()}

  <div class="panel">
    <div class="panel-head"><h2>Tractors (${S.trucks.length})</h2>
      <span class="sub">${S.trucks.filter((t) => t.inGameGarage).length} in your ATS garage</span>
      <div class="spacer"></div>
      <button class="btn tiny" data-act="stock-yard">Stock a yard</button>
      <button class="btn tiny primary" data-act="add-truck">Add tractor</button></div>
    <div class="tablewrap"><table>
      <thead><tr><th>Unit</th><th>Tractor</th><th>Driveline</th><th>Cab</th><th class="num">Gov</th>
        <th class="num">Service mi</th><th>Garage</th><th class="num">Damage</th><th>Status</th><th>Driver</th><th></th></tr></thead>
      <tbody>${S.trucks.map((x) => `<tr>
        <td><span class="unit">${esc(x.gameId || x.unit)}</span>${x.gameId
            ? `<div class="sub" style="font-size:10px">unit ${esc(x.unit)}</div>` : ''}</td>
          <td>${x.year} ${esc(x.make)} ${esc(x.model)}</td>
        <td>${esc(x.engine)}<br><span style="color:var(--ink3)">${esc(x.transmission)}</span></td>
        <td>${esc(x.cabConfig)}</td><td class="num">${x.governedMph}</td>
        <td class="num">${num(x.serviceMiles)}</td>
        <td>${x.inGameGarage ? badge('ok', 'in garage') : badge('mute', 'backdrop')}</td>
        <td class="num">${x.inGameGarage ? badge(dmgBadge(x.damagePct), pct(x.damagePct)) : '<span style="color:var(--ink3)">—</span>'}</td>
        <td>${badge(x.status === 'InService' ? 'ok' : x.status === 'Reserve' ? 'mute' : 'bad', x.status)}</td>
        <td>${esc(x.assignedDriver || '—')}</td>
        <td><button class="btn tiny ghost" data-act="edit-truck" data-unit="${esc(x.unit)}">Edit</button></td></tr>`).join('')}</tbody></table></div>
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Trailers (${S.trailers.length})</h2>
      <span class="sub">${S.trailers.filter((t) => t.inGameGarage).length} in your ATS garage</span>
      <div class="spacer"></div>
      <button class="btn tiny primary" data-act="add-trailer">Add trailer</button></div>
    <div class="tablewrap"><table>
      <thead><tr><th>Unit</th><th>Type</th><th>Division</th><th>Make</th><th>Garage</th><th class="num">Damage</th>
        <th>Status</th><th>Location</th><th></th></tr></thead>
      <tbody>${S.trailers.map((x) => `<tr>
        <td><span class="unit">${esc(x.gameId || x.unit)}</span>${x.gameId
            ? `<div class="sub" style="font-size:10px">unit ${esc(x.unit)}</div>` : ''}</td>
          <td>${esc(x.length)} ${esc(x.type)}</td><td>${esc(x.division)}</td>
        <td>${x.year} ${esc(x.make)}</td>
        <td>${x.inGameGarage ? badge('ok', 'in garage') : badge('mute', 'backdrop')}</td>
        <td class="num">${x.inGameGarage ? badge(dmgBadge(x.damagePct), pct(x.damagePct)) : '<span style="color:var(--ink3)">—</span>'}</td>
        <td>${badge(x.status === 'InService' ? 'ok' : 'bad', x.status)}</td>
        <td>${esc(x.currentLocation || '—')}</td>
        <td><button class="btn tiny ghost" data-act="edit-trailer" data-unit="${esc(x.unit)}">Edit</button></td></tr>`).join('')}</tbody></table></div>
  </div>`;
}

function terminalsHtml() {
  const ts = S.company.terminals || [];
  const home = ts.find((t) => t.id === S.driver.homeTerminalId);
  const open = (S.driver.transfers || []).filter((t) => t.outcome === 'Conditional' || t.outcome === 'Deferred');
  const last = (S.driver.transfers || [])[0];

  return `<div class="panel">
    <div class="panel-head"><h2>Terminals (${ts.length})</h2>
      <span class="sub">${home ? 'domiciled at ' + esc(home.city) + ', ' + esc(home.state) : 'no home terminal set'}</span>
      <div class="spacer"></div>
      <button class="btn tiny primary" data-act="add-terminal">Open a yard</button></div>

    <div class="tablewrap"><table>
      <thead><tr><th>Yard</th><th>Level</th><th class="num">Capacity</th><th>Fuel</th><th>Shop</th>
        <th>Other services</th><th class="num">Monthly</th><th></th></tr></thead>
      <tbody>${ts.map((t) => {
        const svc = [];
        if (t.hasParking) svc.push('parking');
        if (t.hasTrailerDrop) svc.push('trailer drop');
        if (t.hasDriverFacilities) svc.push('driver facilities');
        return `<tr>
          <td><b>${esc(t.city)}, ${esc(t.state)}</b>
            ${t.isHeadquarters ? ' ' + badge('warn', 'HQ') : ''}
            ${t.id === S.driver.homeTerminalId ? ' ' + badge('info', 'home') : ''}</td>
          <td>${badge(t.level === 'Large' ? 'ok' : t.level === 'Medium' ? 'info' : 'mute', t.level)}</td>
          <td class="num">${t.truckCapacity}</td>
          <td>${t.hasFuel ? badge('ok', '$' + (+t.fuelPricePerGal).toFixed(2) + '/gal') : badge('mute', 'none')}</td>
          <td>${t.hasShop ? badge('ok', (t.shopLabourDiscount * 100).toFixed(0) + '% off labour') : badge('mute', 'none')}</td>
          <td>${esc(svc.join(', '))}</td>
          <td class="num">${money0(t.monthlyCost)}</td>
          <td><button class="btn tiny ghost" data-act="edit-terminal" data-id="${esc(t.id)}">Edit</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>

    <h3 class="sect">Home terminal</h3>
    <p class="hint">Your domicile is where home time starts and ends. Asking to move is a request —
      seniority, service record, whether the yard has a slot and whether the company wants a truck in
      that market all weigh on the answer. Asking again without anything changing gets the same answer.</p>
    <div class="grid3">
      <label>Request a move to
        <select id="tr-target">
          ${ts.filter((t) => t.id !== S.driver.homeTerminalId)
              .map((t) => `<option value="${esc(t.id)}">${esc(t.city)}, ${esc(t.state)} (${esc(t.level)})</option>`).join('')}
        </select></label>
      <label>Why<input id="tr-reason" placeholder="e.g. family is in Kansas City"></label>
      <label style="align-self:end"><button class="btn primary wide" data-act="request-transfer">Submit request</button></label>
    </div>

    ${last ? `<div class="callout ${last.outcome === 'Approved' ? 'go' : last.outcome === 'Denied' ? 'stop' : 'warn'}">
      <h4>${esc(last.outcome)} — ${esc(last.toTerminalName)}</h4>
      <p>${esc(last.decision)}</p>
      ${last.factors.length ? `<ul>${last.factors.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    </div>` : ''}

    ${open.map((t) => `<div class="row-actions">
      <button class="btn" data-act="settle-transfer" data-id="${esc(t.id)}">
        Check on the ${esc(t.toTerminalName)} request (${t.loadsRequired} loads asked)</button></div>`).join('')}

    <h3 class="sect">Home-time arrangement</h3>
    <p class="hint">What you agreed to when you signed on. Dispatch routes for it: as the date gets
      close, loads finishing near your home yard start outranking better-paying freight going the other
      way, and you are told when a load is your ride home.</p>
    ${S.views.probation?.on ? `<div class="callout warn">
      <p style="margin:0">While you are on probation this is overridden — you report to the yard every
        <b>${S.views.probation.intervalDays} days</b> for review whatever is set here. Your own arrangement
        takes over once probation is cleared.</p></div>` : ''}
    <div class="grid3">
      <label>Arrangement
        <select id="ht-pref">${(S.views.homeTimeOptions || []).map((o) =>
          `<option value="${esc(o.key)}" ${(S.application && S.application.homeTimePreference === o.key) ? 'selected' : ''}
            >${esc(o.label)}</option>`).join('')}</select></label>
      <label style="align-self:end"><button class="btn primary wide" data-act="save-home-time">Update arrangement</button></label>
      <div>${S.views.homeTime && S.views.homeTime.tracked
        ? `<p class="hint" style="margin-top:22px">${num(S.views.homeTime.daysOut, 1)} days out of
           ${S.views.homeTime.intervalDays}.</p>` : ''}</div>
    </div>

  </div>`;
}

/* ---- probation: fortnightly reviews at the yard, not a silent threshold ---- */
function probationHtml() {
  const p = S.views.probation;
  if (!p) return '';
  const reviews = p.reviews || [];
  if (!p.on && !reviews.length) return '';

  return `<h3 class="sect">Probation</h3>
    <div class="callout ${p.on ? 'warn' : 'go'}">
      <h4>${esc(p.standing)}</h4>
      ${p.on ? `<p>You report to the home terminal every <b>${p.intervalDays} days</b>. Each time you come in,
        operations goes through the period with you and writes it up. <b>${p.passesNeeded} good reviews in a
        row</b> ends it — a fail resets the run, which is what makes each one count.</p>
        <p class="hint" style="margin:0">A failed review is not discipline and never touches your safety
          record. It means the probation carries on.${p.thresholds
            ? ` You also still need the numbers: ${esc(p.thresholds)}` : ''}</p>` : ''}
    </div>
    ${reviews.map((r) => `<div class="loadcard ${r.verdict === 'Pass' ? 'auth' : 'reject'}">
      <div class="loadcard-head">
        <span class="lane">${esc(r.number)}</span>
        ${badge(r.verdict === 'Pass' ? 'ok' : 'bad', r.verdict)}
        <span class="sub">${gt(r.gameTime)} · ${num(r.daysCovered, 0)} days</span>
        <div class="spacer"></div>
        ${r.clearedProbation ? badge('ok', 'cleared probation') : ''}</div>
      <div class="kv">
        <span>loads <b>${r.loadsDelivered}</b></span>
        <span>on time <b>${num(r.onTimePct, 1)}%</b></span>
        <span>preventable <b>${r.preventableFaults}</b></span>
        <span>run <b>${r.passesInARow}/${p.passesNeeded}</b></span>
      </div>
      ${(r.strengths || []).length ? `<ul class="reasons good">${r.strengths.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${(r.concerns || []).length ? `<ul class="reasons bad">${r.concerns.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${r.nextStep ? `<p class="hint" style="margin:6px 0 0">${esc(r.nextStep)}</p>` : ''}
    </div>`).join('')}`;
}

/* ---- asking to go home ---- */
function askHomeHtml() {
  const rq = S.views.requests || {};
  const open = rq.home;
  const recent = (rq.recentHome || []).filter((r) => r.status !== 'Open');

  return `<h3 class="sect">Ask for home time</h3>
    <p class="hint">Put in for a trip home and operations answers it when you close your next load out —
      not on the spot, because a dispatcher does not drop what they are doing to answer a text mid-lane.
      How long you have been out is what decides it.</p>
    ${open ? `<div class="callout info">
        <h4>${esc(open.number)} is with operations</h4>
        <p>Asked ${gt(open.requestedGameTime)} after ${num(open.daysOutAtRequest, 1)} days out.
          ${open.reason ? `You said: ${esc(open.reason)}` : ''}</p>
        <p class="hint" style="margin:0">You will have an answer on your next trip summary.</p></div>`
      : `<div class="grid2">
          <label>Why, if you want to say<input id="hr-reason" placeholder="optional — it does not change the answer"></label>
          <label style="align-self:end"><button class="btn primary wide" data-act="ask-home">Request home time</button></label>
        </div>`}
    ${recent.map((r) => `<div class="callout ${r.status === 'Granted' ? 'go' : 'stop'}" style="margin-top:8px">
      <h4>${esc(r.number)} — ${esc(r.status)}</h4>
      <p style="margin:0">${esc(r.answer)}</p></div>`).join('')}`;
}

/* ---- asking for a different trailer ---- */
function askTrailerHtml() {
  const rq = S.views.requests || {};
  const types = rq.trailerTypes || [];
  const open = rq.trailer;
  const recent = (rq.recentTrailer || []).filter((r) => r.status !== 'Open');

  return `<h3 class="sect">Ask for a different trailer</h3>
    ${!rq.canRequestTrailer ? `<p class="hint">You are still on probation. Take what you are given until
      that is behind you, then you can ask.</p>`
    : `<p class="hint">You can ask to be re-rigged onto anything the company keeps at your yard. It can be
        turned down — the freight out of your terminal decides it, and the more you have behind you the
        better a hearing it gets. Granted, you swap at the house on your next home time.</p>
      ${open ? `<div class="callout info">
          <h4>${esc(open.number)} — asked for ${esc(open.requestedType)}</h4>
          <p class="hint" style="margin:0">Answer comes with your next close-out.</p></div>`
        : types.length ? `<div class="grid2">
            <label>Trailer type<select id="tr-type">${types.map((x) =>
              `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label>
            <label style="align-self:end"><button class="btn primary wide" data-act="ask-trailer">Request it</button></label>
          </div>`
          : `<p class="hint">There is nothing else based at your yard to put you on.</p>`}`}
    ${recent.map((r) => `<div class="callout ${r.status === 'Granted' ? 'go' : 'stop'}" style="margin-top:8px">
      <h4>${esc(r.number)} — ${esc(r.requestedType)} — ${esc(r.status)}</h4>
      <p style="margin:0">${esc(r.answer)}</p></div>`).join('')}`;
}

/* ---- endorsements: the driver telling the app about their own licence ---- */
function endorsementsHtml() {
  const e = S.views.endorsements || { held: [], all: [] };
  const held = e.held || [];

  return `<h3 class="sect">HazMat classes</h3>
    <p class="hint">ATS gates dangerous freight on <b>HazMat classes</b>, unlocked one at a time and in
      any order. Record what you have unlocked in game and dispatch stops refusing that freight straight
      away. The app never works this out for you.</p>
    ${e.needsChoosing ? `<div class="callout warn">
      <h4>Your classes need selecting</h4>
      <p style="margin:0">Your file says you have hazmat, but not which classes — earlier builds tracked
        a single blanket endorsement, which is not how the game works. Tick the ones you have actually
        unlocked. Nothing was assumed on your behalf, because getting it wrong would put you on freight
        you are not cleared for.</p></div>` : ''}
    <div class="tablewrap"><table>
      <thead><tr><th>Class</th><th>Status</th><th>Covers</th><th></th></tr></thead>
      <tbody>${(e.all || []).map((x) => {
        const has = held.includes(x.key);
        return `<tr>
          <td><b>${esc(x.label)}</b></td>
          <td>${badge(has ? 'ok' : 'mute', has ? 'cleared' : 'not cleared')}</td>
          <td class="sub">${esc(x.covers)}<br><span style="opacity:.7">${esc(x.examples)}</span></td>
          <td><button class="btn tiny ${has ? 'ghost' : 'primary'}" data-act="set-endorsement"
                data-kind="${esc(x.key)}" data-has="${has ? '' : '1'}">${has ? 'Remove' : 'I have this'}</button></td>
        </tr>`; }).join('')}</tbody></table></div>
    <p class="hint">There is no tanker or doubles endorsement in ATS. A tanker is a trailer — what gates
      it is what is inside, so a fuel tanker needs class 3 and a food-grade one needs nothing at all.</p>`;
}

/**
 * Equipment laid out the way ATS holds it — by garage. Each yard shows what it is holding against
 * what it can hold, so the player can set the app up to mirror their game.
 */
function equipmentByYardHtml() {
  const yards = S.company.terminals || [];
  if (!yards.length) return '';
  const homeId = S.driver.homeTerminalId;

  const card = (y) => {
    const trucks = S.trucks.filter((t) => t.homeTerminalId === y.id);
    const trailers = S.trailers.filter((t) => t.homeTerminalId === y.id);
    const used = trucks.filter((t) => t.status !== 'OutOfService').length;
    const full = used >= y.truckCapacity;

    const unitRow = (u, kind) => `<tr>
      <td><span class="unit">${esc(uref(u.unit))}</span>
        ${u.unit === S.driver.assignedTruckUnit || u.unit === S.driver.assignedTrailerUnit
          ? ' ' + badge('ok', 'yours') : ''}
        ${u.assignedDriver && u.assignedDriver !== S.driver.name ? ' ' + badge('info', esc(u.assignedDriver)) : ''}</td>
      <td>${kind === 'Truck'
        ? `${u.year} ${esc(u.make)} ${esc(u.model)}`
        : `${esc(u.length)} ${esc(u.type)}`}</td>
      <td>${u.inGameGarage ? badge('ok', 'in garage') : badge('mute', 'backdrop')}</td>
      <td class="num">${u.inGameGarage ? pct(u.damagePct) : '—'}</td>
      <td><select data-act="relocate" data-unit="${esc(u.unit)}" data-kind="${kind}"
            style="padding:3px 6px;font-size:12px">
          ${yards.map((z) => `<option value="${esc(z.id)}" ${z.id === y.id ? 'selected' : ''}>
            ${esc(z.city)}</option>`).join('')}
        </select></td></tr>`;

    return `<div class="panel" style="margin:0">
      <div class="panel-head" style="padding-bottom:7px">
        <h2>${esc(y.city)}, ${esc(y.state)}</h2>
        ${y.isHeadquarters ? badge('warn', 'HQ') : ''}
        ${y.id === homeId ? badge('info', 'your home') : ''}
        <div class="spacer"></div>
        ${badge(full ? 'bad' : 'ok', `${used}/${y.truckCapacity} tractors`)}
      </div>
      <p class="hint" style="margin:0 0 8px">${esc(y.level)} yard ·
        ${y.hasFuel ? `fuel $${(+y.fuelPricePerGal).toFixed(2)}/gal` : 'no fuel'} ·
        ${y.hasShop ? `shop ${(y.shopLabourDiscount * 100).toFixed(0)}% off labour` : 'no shop'}</p>
      ${trucks.length || trailers.length ? `<div class="tablewrap"><table>
        <thead><tr><th>Unit</th><th>Equipment</th><th>Garage</th><th class="num">Damage</th><th>Move to</th></tr></thead>
        <tbody>
          ${trucks.map((t) => unitRow(t, 'Truck')).join('')}
          ${trailers.map((t) => unitRow(t, 'Trailer')).join('')}
        </tbody></table></div>`
        : '<div class="empty" style="padding:12px">Nothing based here.</div>'}
    </div>`;
  };

  const unhomed = S.trucks.filter((t) => !yards.some((y) => y.id === t.homeTerminalId))
    .concat(S.trailers.filter((t) => !yards.some((y) => y.id === t.homeTerminalId)));

  return `<div class="panel">
    <div class="panel-head"><h2>Equipment by garage</h2>
      <span class="sub">ATS holds trucks in garages — mirror your game here</span></div>
    <div class="callout info">
      <p>Each yard holds what its tier allows: <b>Small 1</b>, <b>Medium 3</b>, <b>Large 5</b> tractors.
        Use the <b>Move to</b> dropdown to put each unit in the garage it actually sits in in ATS.</p>
      <p style="margin:0">When operations sends you to a yard for a better truck, the swap is a straight
        exchange: the unit you hand in becomes based there, and the one you take on comes onto your home
        yard's book. Neither garage changes headcount, and the app does that bookkeeping the moment you
        mark the order complete.</p>
    </div>
    ${unhomed.length ? `<div class="callout warn"><p><b>${unhomed.length} unit(s) not based anywhere:</b>
      ${esc(unhomed.map((u) => u.unit).join(', '))}. Assign them a garage below.</p></div>` : ''}
    <div class="cols">${yards.map(card).join('')}</div>
  </div>`;
}

/* ---- what the last fleet report left for you to decide
   Drivers leaving, seats standing empty and trucks past their time are all consequences of the
   period's numbers, so they surface together after the report is filed. */
function fleetDecisionsHtml() {
  const pending = FLEETOPS?.pendingTerminations || [];
  const retire = FLEETOPS?.retirements || [];
  const open = FLEETOPS?.openUnits || [];
  const probation = S.views.fleetOps?.onProbation || [];
  const risks = S.views.fleetOps?.flightRisks || [];
  const ask = S.views.fleetOps?.trailerRequest || null;
  const count = pending.length + retire.length + open.length + probation.length + (ask ? 1 : 0);
  if (!count && !risks.length) return '';

  return `<div class="panel">
    <div class="panel-head"><h2>Decisions from the last report</h2>
      ${count ? badge('warn', count + ' outstanding') : badge('mute', 'nothing outstanding')}</div>

    ${probation.map((pr) => `<div class="callout warn">
      <h4>${esc(pr.driverName)} is on probation${pr.attempt > 1 ? ` (time ${pr.attempt})` : ''}</h4>
      <p>${esc(pr.reason)}</p>
      <p><b>To clear it:</b> ${esc(pr.target)}</p>
      <p class="hint">Warned ${gt(pr.since)}. Nothing for you to do — if the next report comes in no
        better, operations will recommend letting them go. If it improves, they come off it.</p>
    </div>`).join('')}

    ${ask ? `<div class="callout ${ask.unaffordable ? 'warn' : 'info'}">
      <h4>${esc(ask.number)} — ${ask.kind === 'Add' ? 'another trailer' : 'trailer replacement'} for ${esc(ask.terminalLabel)}</h4>
      <p>${esc(ask.reason)}</p>
      <p><b>${esc(ask.instruction)}</b></p>
      ${ask.unaffordable ? '' : `<div class="grid2" style="margin-top:8px">
        <label>Unit number<input id="tq-unit" placeholder="e.g. T512"></label>
        <label>ID shown in ATS — optional<input id="tq-gameid" placeholder="what the game calls it"></label>
        <label>What you paid $<input id="tq-price" type="number" step="1" min="0" placeholder="from ATS"></label>
        ${dayTimeInput('tq-time', S.status.gameTime, 'Bought (game)')}
      </div>`}
      <div class="row-actions">
        ${ask.unaffordable ? '' : `<button class="btn go" data-act="trailer-bought" data-id="${esc(ask.id)}">I bought it</button>`}
        <button class="btn ghost" data-act="trailer-declined" data-id="${esc(ask.id)}">Not interested</button>
      </div></div>` : ''}

    ${pending.map((p) => `<div class="callout stop">
      <h4>${esc(p.headline)}</h4>
      <ul>${p.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
      <p class="hint">It is your company — Safety recommends, you decide.</p>
      <div class="row-actions">
        <button class="btn danger" data-act="terminate-driver" data-id="${esc(p.driverId)}"
          data-name="${esc(p.driverName)}">Terminate ${esc(p.driverName)}</button>
        <button class="btn ghost" data-act="keep-driver" data-name="${esc(p.driverName)}">Keep them on</button>
      </div></div>`).join('')}

    ${retire.map((r) => `<div class="callout warn">
      <h4>${esc(r.headline)}</h4>
      <ul>${r.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
      <div class="row-actions">
        <button class="btn" data-act="retire-unit" data-unit="${esc(r.unit)}"
          data-mine="${r.isPlayerUnit ? '1' : ''}">Trade unit ${esc(uref(r.unit))}</button>
      </div></div>`).join('')}

    ${open.length ? `<h3 class="sect">Trucks with nobody in them</h3>
      ${open.map((u) => `<div class="callout info">
        <h4>Unit ${esc(u.unit)} — ${esc(u.spec)}</h4>
        <p>${num(u.serviceMiles)} mi · ${pct(u.damagePct)} damage${u.yard ? ' · based ' + esc(u.yard) : ''}</p>
        <ul>
          <li><b>Hire someone.</b> ${esc(u.hireNote)}</li>
          <li><b>Take it yourself.</b> ${esc(u.takeNote)}</li>
          <li><b>Leave it parked.</b> ${esc(u.parkNote)}</li>
        </ul>
        <p class="hint">${esc(u.buyNote)}</p>
        <div class="row-actions">
          <button class="btn" data-act="add-hire">Hire a driver for it</button>
          ${u.betterThanYours ? `<button class="btn go" data-act="take-unit" data-unit="${esc(u.unit)}">Take it myself</button>` : ''}
        </div></div>`).join('')}` : ''}

    ${risks.length ? `<h3 class="sect">Worth knowing</h3>
      ${risks.map((r) => `<p class="hint" style="margin:4px 0">${esc(r)}</p>`).join('')}
      ${(S.views.fleetOps?.employerStars || 0) > 0 ? `<p class="hint" style="margin:8px 0 0">
        ${esc(S.company.name)} rates <b>${num(S.views.fleetOps.employerStars, 1)} stars</b> as an employer.
        Moving to a better carrier is how you keep good drivers, not just how you raise your own pay.</p>` : ''}` : ''}
  </div>`;
}

/* ---- hired drivers and their weekly production ---- */
function fleetOpsHtml() {
  const f = S.views.fleetOps || { driverCount: 0, unassignedUnits: [] };
  const drivers = FLEETOPS?.drivers || [];
  const reports = FLEETOPS?.reports || [];

  return `${fleetDecisionsHtml()}
  <div class="panel">
    <div class="panel-head"><h2>Hired drivers</h2>
      <span class="sub">${f.activeCount || 0} active · ${f.reportCount || 0} report(s) filed</span>
      <div class="spacer"></div>
      <button class="btn tiny ghost" data-act="load-fleetops">Refresh</button>
      <button class="btn tiny primary" data-act="add-hire">Hire a driver</button>
    </div>

    <div class="callout info">
      <p>Hire AI drivers in ATS, put them on company units, then file a report here with what each one
        actually earned and how beaten-up their truck is. Revenue lands in the company's books and funds
        the payroll and maintenance reserves. Nothing here is invented — the app only records what you
        read off the game, which for a driver you are not sitting next to means their level, rating,
        $/mile and $/day, and for their equipment a star rating rather than a damage percentage.</p>
      ${f.unassignedUnits?.length
        ? `<p><b>Units with nobody on them:</b> ${esc(f.unassignedUnits.join(', '))}. Buy a driver for them
           in ATS and add them here, or delete the units the company should not own.</p>` : ''}
    </div>

    ${FLEETOPS ? `
      <div class="meters">
        ${fkpi('Drivers', f.driverCount || 0)}
        ${fkpi('Fleet revenue', money0(f.lifetimeRevenue || 0))}
        ${fkpi('Fleet wages', money0(f.lifetimeWages || 0))}
        ${fkpi('Fleet miles', num(f.lifetimeMiles || 0))}
        ${fkpi('Last report', f.lastPeriodEnd ? gt(f.lastPeriodEnd) : '—')}
      </div>

      ${drivers.length ? `<div class="tablewrap" style="margin-top:14px"><table>
        <thead><tr><th>Driver</th><th>Unit</th><th class="num">Level</th><th class="num">Rating</th>
          <th class="num">$/day</th><th class="num">$/mi</th><th class="num">Truck &starf;</th>
          <th>Status</th><th class="num">Wage share</th>
          <th class="num">Lifetime revenue</th><th class="num">Reports</th><th></th></tr></thead>
        <tbody>${drivers.map((d) => {
          const last = (d.periods || [])[0];
          const tk = S.trucks.find((x) => x.unit === d.assignedTruckUnit);
          return `<tr>
          <td><b>${esc(d.name)}</b>${d.onProbation ? ' ' + badge('warn', 'probation') : ''}</td>
          <td><span class="unit">${esc(uref(d.assignedTruckUnit) || '—')}</span></td>
          <td class="num">${d.level ? d.level : '<span class="sub">—</span>'}</td>
          <td class="num">${d.rating ? num(d.rating, 1) : '<span class="sub">—</span>'}</td>
          <td class="num">${last?.perDay ? money0(last.perDay) : '<span class="sub">—</span>'}</td>
          <td class="num">${last?.perMile ? '$' + (+last.perMile).toFixed(2) : '<span class="sub">—</span>'}</td>
          <td class="num">${tk?.stars
              ? badge(tk.stars <= S.settings.maintenance.truckReplaceStars ? 'bad' : tk.stars <= 4 ? 'warn' : 'ok',
                      num(tk.stars, 1) + '\u2605')
              : '<span class="sub">—</span>'}</td>
          <td>${badge(d.status === 'Active' ? 'ok' : 'mute', d.status)}</td>
          <td class="num">${pct(d.wageShare * 100, 0)}</td>
          <td class="num">${money0(d.lifetimeRevenue)}</td>
          <td class="num">${d.reportsFiled}</td>
          <td><button class="btn tiny ghost" data-act="edit-hire" data-id="${esc(d.id)}">Edit</button></td>
        </tr>`; }).join('')}</tbody></table></div>

        <h3 class="sect">File a fleet report</h3>
        <p class="hint">Every ${f.due?.intervalDays ?? 15} game days, open the ATS company screen and copy
          down what it shows you: each driver's <b>level</b>, <b>rating</b>, <b>$/mile</b> and <b>$/day</b>,
          and for their equipment the <b>star rating</b> — plus the truck's odometer. Those are the numbers
          the game gives for people and units you are not sitting in, so those are the numbers operations
          judges on. Leave wages blank to use the driver's agreed share.</p>
        <p class="hint">There is no damage percentage to read for a hired driver's truck or trailer, so
          nothing here asks for one. Condition is stars: five is a fresh unit, and
          <b>${num(S.settings.maintenance.truckReplaceStars, 0)} stars or under</b> is where the company
          starts recommending you replace it.</p>
        ${f.due?.isDue ? `<div class="callout warn"><p>${esc(f.due.message)}</p></div>`
          : f.due?.nextDueGameTime ? `<p class="hint">Next report due ${gt(f.due.nextDueGameTime)}.</p>` : ''}
        <div class="grid2">
          ${dayTimeInput('fr-start', '', 'Period start (game)')}
          ${dayTimeInput('fr-end', S.status.gameTime, 'Period end (game)')}
        </div>
        <div class="tablewrap"><table>
          <thead><tr>
            <th>Driver</th><th>Unit</th>
            <th class="num" title="Driver level from the ATS company screen">Level</th>
            <th class="num" title="Driver rating, 0.0 to 10.0">Rating</th>
            <th class="num" title="Average income per mile, as ATS reports it">$/mi</th>
            <th class="num" title="Average income per day, as ATS reports it">$/day</th>
            <th class="num" title="Tractor condition in stars, 5 down to 1">Truck &starf;</th>
            <th class="num" title="Tractor odometer as shown in game">Odometer</th>
            <th class="num" title="Trailer condition in stars. Trailers have no odometer.">Trailer &starf;</th>
            <th title="Optional. If your company screen shows when they are back with the trailer, put it here — the app has no way to see it and will not guess.">Due back</th>
            <th title="Optional. If your company screen says when they are back with the trailer, put it here — the app cannot see it.">Due back</th>
            <th class="num">Revenue $</th><th class="num">Miles</th>
            <th class="num">Wages $ (blank = share)</th><th class="num">Repairs $</th></tr></thead>
          <tbody>${drivers.filter((d) => d.status === 'Active').map((d) => {
            const tk = S.trucks.find((t) => t.unit === d.assignedTruckUnit);
            const tl = S.trailers.find((t) => t.unit === d.assignedTrailerUnit);
            return `<tr>
            <td>${esc(d.name)}${d.onProbation ? ' ' + badge('warn', 'probation') : ''}</td>
            <td class="mono">${esc(d.assignedTruckUnit)}</td>
            <td><input id="fr-lvl-${esc(d.id)}" type="number" step="1" min="0" style="width:64px"
                  value="${d.level || ''}" placeholder="—"></td>
            <td><input id="fr-rate-${esc(d.id)}" type="number" step="0.1" min="0" max="10" style="width:70px"
                  value="${d.rating || ''}" placeholder="0.0"></td>
            <td><input id="fr-permi-${esc(d.id)}" type="number" step="0.01" min="0" style="width:78px" placeholder="—"></td>
            <td><input id="fr-perday-${esc(d.id)}" type="number" step="1" min="0" style="width:82px" placeholder="—"></td>
            <td><input id="fr-tstar-${esc(d.id)}" type="number" step="0.5" min="0" max="5" style="width:70px"
                  value="${tk?.stars || ''}" placeholder="—"></td>
            <td><input id="fr-odo-${esc(d.id)}" type="number" step="1" min="0" style="width:96px"
                  value="${tk ? Math.round(tk.atsOdometer) : ''}" placeholder="—"></td>
            <td><input id="fr-lstar-${esc(d.id)}" type="number" step="0.5" min="0" max="5" style="width:70px"
                  value="${tl?.stars || ''}" placeholder="—"></td>
            <td>${dayTimeInput('fr-due-' + d.id, d.trailerDueBackGameTime || '', '')}</td>
            <td><input id="fr-rev-${esc(d.id)}" type="number" step="1" min="0" value="0"></td>
            <td><input id="fr-mi-${esc(d.id)}" type="number" step="1" min="0" value="0"></td>
            <td><input id="fr-wage-${esc(d.id)}" type="number" step="0.01" min="0" placeholder="auto"></td>
            <td><input id="fr-rep-${esc(d.id)}" type="number" step="0.01" min="0" value="0"></td>
          </tr>`; }).join('')}</tbody></table></div>
        <label>Report note<input id="fr-note" placeholder="optional"></label>
        <div class="row-actions"><button class="btn go" data-act="file-report">File report &amp; post to the books</button></div>`
        : '<div class="empty">No hired drivers yet. Hire one in ATS, then add them here.</div>'}

      ${reports.length ? `<h3 class="sect">Fleet reports</h3>
        ${reports.map((r) => `<div class="loadcard ${r.netContribution >= 0 ? 'auth' : 'reject'}">
          <div class="loadcard-head"><span class="lane">${esc(r.number)}</span>
            <span class="sub">${gt(r.periodStartGame)} → ${gt(r.periodEndGame)}</span>
            <div class="spacer"></div>
            <b style="font-family:var(--mono)">net ${money(r.netContribution)}</b></div>
          <div class="kv">
            <span>revenue <b>${money(r.totalRevenue)}</b></span>
            <span>wages <b>${money(r.totalWages)}</b></span>
            <span>repairs <b>${money(r.totalRepairs)}</b></span>
            <span>miles <b>${num(r.totalMiles)}</b></span>
            <span>drivers <b>${r.lines.length}</b></span>
          </div>
          ${r.findings?.length ? `<ul class="reasons">${r.findings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${r.repairsNeeded?.length ? `<div class="callout stop" style="margin:8px 0 0">
            <h4>Sent for repair (${r.repairsNeeded.length})</h4>
            <ul>${r.repairsNeeded.map((f) => `<li><b>${esc(f.unitKind)} ${esc(f.unit)}</b> at ${pct(f.damagePct)} —
              work order ${esc(f.workOrderNumber)}${f.outOfService ? ' · ' + badge('bad', 'out of service') : ''}</li>`).join('')}</ul>
          </div>` : ''}
        </div>`).join('')}` : ''}
    ` : ''}
  </div>`;
}

function editHireModal(id) {
  const isNew = !id;
  const d = isNew
    ? { id: '', name: '', assignedTruckUnit: '', assignedTrailerUnit: '', skill: 'Competent',
        status: 'Active', wageShare: 0.30, homeTerminalId: '', notes: '' }
    : (FLEETOPS?.drivers || []).find((x) => x.id === id);
  if (!d) return;
  const taken = (FLEETOPS?.drivers || []).filter((x) => x.id !== d.id).map((x) => x.assignedTruckUnit);
  const avail = S.trucks.filter((t) => t.unit !== S.driver.assignedTruckUnit &&
    (!taken.includes(t.unit) || t.unit === d.assignedTruckUnit));

  modal(`<div class="panel-head"><h2>${isNew ? 'Hire a driver' : esc(d.name)}</h2><div class="spacer"></div>
      <button class="btn tiny ghost" data-act="close-modal">Close</button></div>
    <p class="hint">Add them here after you have hired them in ATS and put them on a truck, so the unit
      numbers match between the game and the app.</p>
    <div class="grid2">
      <label>Driver name<input id="hd-name" value="${esc(d.name)}"></label>
      <label>Tractor
        <select id="hd-truck"><option value="">(unassigned)</option>
          ${avail.map((t) => `<option value="${esc(t.unit)}" ${t.unit === d.assignedTruckUnit ? 'selected' : ''}>
            ${esc(t.unit)} — ${t.year} ${esc(t.make)} ${esc(t.model)}</option>`).join('')}
        </select></label>
      <label>Trailer
        <select id="hd-trailer"><option value="">(market trailers)</option>
          ${S.trailers.map((t) => `<option value="${esc(t.unit)}" ${t.unit === d.assignedTrailerUnit ? 'selected' : ''}>
            ${esc(t.unit)} — ${esc(t.length)} ${esc(t.type)}</option>`).join('')}
        </select></label>
      <label>Skill
        <select id="hd-skill">${['Trainee', 'Competent', 'Experienced', 'Veteran'].map((x) =>
          `<option ${d.skill === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Status
        <select id="hd-status">${['Active', 'OnLeave', 'Resigned', 'Terminated'].map((x) =>
          `<option ${d.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Wage share of revenue (0–0.9)<input id="hd-wage" type="number" step="0.05" min="0" max="0.9" value="${d.wageShare}"></label>
      <label>Home terminal
        <select id="hd-terminal"><option value="">(headquarters)</option>
          ${(S.company.terminals || []).map((t) => `<option value="${esc(t.id)}" ${t.id === d.homeTerminalId ? 'selected' : ''}>
            ${esc(t.city)}, ${esc(t.state)}</option>`).join('')}
        </select></label>
    </div>
    <label>Notes<input id="hd-notes" value="${esc(d.notes || '')}"></label>
    <div class="row-actions">
      ${isNew ? '' : `<button class="btn danger" data-act="del-hire" data-id="${esc(id)}">Remove from roster</button>`}
      <div style="flex:1"></div>
      <button class="btn primary" data-act="save-hire" data-id="${esc(id || '')}" data-new="${isNew ? '1' : ''}">
        ${isNew ? 'Add driver' : 'Save'}</button>
    </div>`);
}

function editTerminalModal(id) {
  const isNew = !id;
  const t = isNew
    ? { id: '', name: '', city: '', state: '', level: 'Small', truckCapacity: 1, isHeadquarters: false,
        hasFuel: true, hasShop: false, hasParking: true, hasTrailerDrop: true, hasDriverFacilities: false,
        fuelPricePerGal: 3.85, shopLabourDiscount: 0, monthlyCost: 1150, notes: '' }
    : (S.company.terminals || []).find((x) => x.id === id);
  if (!t) return;
  modal(`<div class="panel-head"><h2>${isNew ? 'Open a yard' : esc(t.city) + ', ' + esc(t.state)}</h2>
      <div class="spacer"></div><button class="btn tiny ghost" data-act="close-modal">Close</button></div>
    <div class="grid2">
      <label>City<input id="tm-city" value="${esc(t.city)}"></label>
      <label>State<input id="tm-state" class="up" maxlength="2" value="${esc(t.state)}"></label>
      <label>Yard level
        <select id="tm-level">${['Small', 'Medium', 'Large'].map((l) =>
          `<option ${t.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Tractor capacity<input id="tm-cap" type="number" step="1" min="1" value="${t.truckCapacity}"></label>
      <label>Contract fuel $/gal<input id="tm-fuel" type="number" step="0.01" value="${t.fuelPricePerGal}"></label>
      <label>Shop labour discount (0–1)<input id="tm-shopdisc" type="number" step="0.05" min="0" max="1" value="${t.shopLabourDiscount}"></label>
      <label>Monthly cost $<input id="tm-cost" type="number" step="50" value="${t.monthlyCost}"></label>
    </div>
    <fieldset><legend>Services</legend>
      <label class="chk"><input type="checkbox" id="tm-hasfuel" ${t.hasFuel ? 'checked' : ''}> Fuel island</label>
      <label class="chk"><input type="checkbox" id="tm-hasshop" ${t.hasShop ? 'checked' : ''}> Repair shop</label>
      <label class="chk"><input type="checkbox" id="tm-park" ${t.hasParking ? 'checked' : ''}> Truck parking</label>
      <label class="chk"><input type="checkbox" id="tm-drop" ${t.hasTrailerDrop ? 'checked' : ''}> Trailer drop</label>
      <label class="chk"><input type="checkbox" id="tm-fac" ${t.hasDriverFacilities ? 'checked' : ''}> Driver facilities</label>
      <p class="hint">Picking a level in the dropdown and saving resets these to that tier's defaults.
        Adjust them afterwards if your yard differs.</p>
    </fieldset>
    <label>Notes<input id="tm-notes" value="${esc(t.notes || '')}"></label>
    <div class="row-actions">
      ${isNew || t.isHeadquarters ? '' : `<button class="btn danger" data-act="del-terminal" data-id="${esc(id)}">Close this yard</button>`}
      ${isNew || t.isHeadquarters ? '' : `<button class="btn" data-act="make-hq" data-id="${esc(id)}">Make headquarters</button>`}
      <div style="flex:1"></div>
      <button class="btn primary" data-act="save-terminal" data-id="${esc(id || '')}" data-new="${isNew ? '1' : ''}">
        ${isNew ? 'Open yard' : 'Save yard'}</button>
    </div>`);
}

const dmgBadge = (d) => d >= S.settings.maintenance.outOfServicePct ? 'bad'
  : d >= S.settings.maintenance.mandatoryReviewPct ? 'warn'
    : d >= S.settings.maintenance.reportPct ? 'info' : 'ok';

/* ============================================================ PAYROLL */
/* A pay stub, laid out the way a real one is: earnings, what comes off before tax, what the
   government takes, and what actually reaches the bank. */
function stubTableHtml(st) {
  const b = st.stub;
  if (!b) return `<p class="hint">This settlement predates pay stubs — gross only, ${money(st.gross)}.</p>`;
  const row = (label, amount, cls) => `<tr><td>${label}</td>
    <td class="num" style="${cls || ''}">${money(amount)}</td></tr>`;

  return `<div class="tablewrap"><table><tbody>
    <tr><td colspan="2" style="padding-top:6px"><b>EARNINGS</b></td></tr>
    ${st.linehaulPay ? row(`Loaded miles ${num(st.loadedMiles)}`, st.linehaulPay) : ''}
    ${st.deadheadPay ? row(`Empty miles ${num(st.deadheadMiles)}`, st.deadheadPay) : ''}
    ${st.divisionPremium ? row('Division / endorsement premium', st.divisionPremium) : ''}
    ${st.accessorials ? row('Accessorials', st.accessorials) : ''}
    ${st.onTimeBonus ? row('On-time bonus', st.onTimeBonus) : ''}
    ${st.safetyBonus ? row('Safety bonus', st.safetyBonus) : ''}
    ${st.guaranteeMakeup ? row('Weekly guarantee make-up', st.guaranteeMakeup) : ''}
    ${st.chargebacks ? row('Chargebacks', -st.chargebacks, 'color:var(--red)') : ''}
    <tr><td><b>GROSS PAY</b></td><td class="num"><b>${money(b.gross)}</b></td></tr>

    <tr><td colspan="2" style="padding-top:8px"><b>PRE-TAX DEDUCTIONS</b></td></tr>
    ${row('Medical (single)', -b.medical, 'color:var(--amber2)')}
    <tr><td><b>TAXABLE WAGES</b></td><td class="num"><b>${money(b.taxableWages)}</b></td></tr>

    <tr><td colspan="2" style="padding-top:8px"><b>TAXES WITHHELD</b></td></tr>
    ${row('Federal income tax (single)', -b.federal, 'color:var(--amber2)')}
    ${row('Social Security 6.2%', -b.socialSecurity, 'color:var(--amber2)')}
    ${row('Medicare 1.45%', -b.medicare, 'color:var(--amber2)')}
    ${row(b.stateHasTax
        ? `State income tax (${esc(b.stateCode)} ${pct(b.stateRate * 100, 2)})`
        : `State income tax (${esc(b.stateCode || '—')} — no wage tax)`,
      -b.stateTax, 'color:var(--amber2)')}
    <tr><td><b>NET PAY</b></td>
      <td class="num" style="font-weight:700;color:var(--green)">${money(b.net)}</td></tr>

    <tr><td class="sub" style="padding-top:8px">Year to date, gross</td>
      <td class="num sub" style="padding-top:8px">${money(b.ytdGross)}</td></tr>
  </tbody></table></div>
  <p class="hint">Withholding is approximated: the period is annualised over ${b.periodsPerYear} pay
    periods and run through the current single-filer brackets. Close enough to feel real, not close
    enough to file a return from.</p>`;
}

function viewPayroll() {
  const unsettled = S.trips.filter((t) => !t.settlementNumber && (t.status === 'Delivered' || t.status === 'Cancelled') && t.pay.total !== 0);
  const total = unsettled.reduce((a, t) => a + t.pay.total, 0);
  const p = S.driver.pay;
  const pr = S.views.payroll || { nextPaydayDay: 0, daysToPayday: 0, healthPremium: 0, stateCode: '', stateRate: 0 };
  return `
  <div class="cols">
    <div class="panel">
      <div class="panel-head"><h2>Next payday</h2>
        ${badge(pr.daysToPayday <= 1 ? 'ok' : 'info', 'Day ' + pr.nextPaydayDay)}
        <div class="spacer"></div><span class="sub">${unsettled.length} trip(s) accrued</span></div>

      <div class="callout info">
        <p style="margin:0"><b>Payday is Friday.</b> There is nothing to press — a settlement runs
          itself the moment your reported clock crosses one, and again whenever you change employer.
          ${pr.daysToPayday <= 0 ? 'Report your clock to trigger it.'
            : `Next one is <b>Day ${pr.nextPaydayDay}</b>, ${num(pr.daysToPayday, 0)} day(s) away.`}</p>
      </div>

      ${unsettled.length ? `<div class="tablewrap"><table>
        <thead><tr><th>Trip</th><th>Lane</th><th class="num">Loaded</th><th class="num">Empty</th><th class="num">Pay</th></tr></thead>
        <tbody>${unsettled.map((t) => `<tr><td class="mono">${esc(t.number)}</td>
          <td>${esc(t.destCity)}, ${esc(t.destState)}</td>
          <td class="num">${num(t.pay.loadedMiles)}</td><td class="num">${num(t.pay.deadheadMiles)}</td>
          <td class="num">${money(t.pay.total)}</td></tr>`).join('')}
          <tr><td colspan="4"><b>Accrued, gross</b></td><td class="num"><b>${money(total)}</b></td></tr></tbody></table></div>`
        : '<div class="empty">Nothing accrued. Deliver a load first.</div>'}

      <p class="hint">Withholding comes off at settlement: federal at single rate, Social Security,
        Medicare, and ${pr.stateRate > 0 ? `${esc(pr.stateCode)} state tax at ${pct(pr.stateRate * 100, 2)}`
          : `no state tax — ${esc(pr.stateCode || 'your state')} does not tax wages`}.
        Medical of ${money(pr.healthPremium)} comes off before tax.</p>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Your pay plan</h2></div>
      <dl class="kvlist">
        <dt>Position</dt><dd>${esc(S.driver.rankTitle)}</dd>
        <dt>Loaded mile</dt><dd>$${p.loadedCpm.toFixed(3)}</dd>
        <dt>Empty mile</dt><dd>$${p.deadheadCpm.toFixed(3)}</dd>
        <dt>Reefer / hazmat / oversize</dt><dd>+$${p.reeferCpm.toFixed(3)} / +$${p.hazmatCpm.toFixed(3)} / +$${p.oversizeCpm.toFixed(3)}</dd>
        <dt>Detention</dt><dd>${money(p.detentionPerHour)}/h after ${hhmm(p.detentionFreeHours)} free</dd>
        <dt>Layover / breakdown</dt><dd>${money(p.layoverPerDay)} / ${money(p.breakdownPerDay)} per day</dd>
        <dt>Stop / tarp</dt><dd>${money(p.extraStopPay)} / ${money(p.tarpPay)}</dd>
        <dt>On-time bonus</dt><dd>$${p.onTimeBonusCpm.toFixed(3)}/loaded mi at 100% service</dd>
        <dt>Safety bonus</dt><dd>${money(p.safetyBonusPerSettlement)} per clean settlement</dd>
        <dt>Weekly guarantee</dt><dd>${p.weeklyGuarantee > 0 ? money(p.weeklyGuarantee) : 'none'}</dd>
        <dt>Lifetime earnings</dt><dd>${money(S.driver.lifetimeEarnings)}</dd>
      </dl>
      ${p.notes ? `<p class="hint">${esc(p.notes)}</p>` : ''}
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Settlement history</h2></div>
    ${S.settlements.length ? S.settlements.map((s) => `
      <div class="loadcard ${s.onTimePct >= 100 ? 'auth' : 'backup'}">
        <div class="loadcard-head"><span class="lane">${esc(s.number)}</span>
          ${badge(s.onTimePct >= 100 ? 'ok' : 'warn', pct(s.onTimePct) + ' on time')}
          ${s.trigger === 'JobChange' ? badge('violet', 'final settlement') : ''}
          <div class="spacer"></div>
          <b style="font-family:var(--mono)">${money(s.gross)}</b>
          ${s.stub ? `<span class="sub">gross</span>
            <b style="font-family:var(--mono);color:var(--green)">${money(s.stub.net)}</b>
            <span class="sub">net</span>` : ''}</div>
        <div class="kv"><span>trips <b>${s.tripNumbers.length}</b></span>
          <span>loaded <b>${num(s.loadedMiles)} mi</b></span><span>empty <b>${num(s.deadheadMiles)} mi</b></span>
          <span>linehaul <b>${money(s.linehaulPay)}</b></span><span>accessorials <b>${money(s.accessorials)}</b></span>
          <span>bonuses <b>${money(s.onTimeBonus + s.safetyBonus)}</b></span></div>
        <ul class="reasons">${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <p class="hint">Trips: ${esc(s.tripNumbers.join(', '))}</p>
        <div class="row-actions">
          <button class="btn ${s.stub ? '' : 'ghost'}" data-act="show-stub" data-num="${esc(s.number)}">
            ${s.stub ? 'Pay stub' : 'Details'}</button>
        </div>
      </div>`).join('') : '<div class="empty">No settlements issued yet. Payday is Friday.</div>'}
  </div>`;
}

/* ============================================================ FINANCE */
function viewFinance() {
  const f = S.views.finance;
  return `
  ${positionHtml()}

  <div class="cols3">
    ${f.accounts.filter((a) => a.key === 'operating' || a.kind === 'Liability').map((a) => `<div class="panel" style="margin:0">
      <div class="meter" style="border:0;background:none;padding:0">
        <div class="lbl">${esc(a.name)}</div>
        <div class="big" style="color:${a.balance < 0 ? (a.kind === 'Liability' ? 'var(--ink)' : 'var(--red)') : 'var(--green)'}">${money0(a.balance)}</div>
        <div class="of">opened at ${money0(a.opening)}</div>
      </div>
      ${a.notes ? `<p class="hint" style="margin-top:8px">${esc(a.notes)}</p>` : ''}
    </div>`).join('')}
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Operating performance</h2>
      <span class="sub">net position ${money(f.netPosition)}</span></div>
    <div class="meters">
      ${fkpi('Revenue booked', money0(f.revenue), f.revenue > 0 ? 'ok' : '')}
      ${fkpi('Operating income', money0(f.operatingIncome), f.operatingIncome < 0 ? 'bad' : 'ok')}
      ${fkpi('Operating ratio', f.operatingRatio ? f.operatingRatio.toFixed(3) : '—', f.operatingRatio > 1 ? 'bad' : f.operatingRatio > 0.95 ? 'warn' : '')}
      ${fkpi('Revenue / loaded mi', '$' + f.revenuePerLoadedMile.toFixed(3))}
      ${fkpi('Cost / mile', '$' + f.costPerMile.toFixed(3))}
      ${fkpi('Fuel', money0(f.fuel))}
      ${fkpi('Maintenance', money0(f.maintenanceSpend))}
      ${fkpi('Payroll', money0(f.payrollSpend))}
      ${fkpi('Overhead', money0(f.overheadSpend))}
      ${fkpi('Fines', money0(f.fineSpend), f.fineSpend > 0 ? 'warn' : '')}
      ${fkpi('Cancellations', money0(f.cancellationSpend), f.cancellationSpend > 0 ? 'warn' : '')}
      ${fkpi('Unsettled wages', money0(f.unsettledDriverPay))}
    </div>
  </div>

  ${costModelHtml()}

  <div class="cols">
    <div class="panel">
      <div class="panel-head"><h2>Post a manual entry</h2>
        <span class="sub">For anything the app did not book automatically.</span></div>
      <div class="grid2">
        <label>Account<select id="le-acct">${f.accounts.map((a) => `<option value="${esc(a.key)}">${esc(a.name)}</option>`).join('')}</select></label>
        <label>Category<select id="le-cat">${['FreightRevenue', 'Fuel', 'Repairs', 'Maintenance', 'Tolls', 'Payroll', 'Fines',
          'Cancellation', 'Equipment', 'Insurance', 'Overhead', 'Transfer', 'Adjustment'].map((c) => `<option>${c}</option>`).join('')}</select></label>
        <label>Amount $ (negative = spend)<input id="le-amt" type="number" step="0.01" value="0"></label>
        <label>Trip number (optional)<input id="le-trip"></label>
      </div>
      <label>Memo<input id="le-memo" placeholder="what this is for"></label>
      <div class="row-actions"><button class="btn primary" data-act="post-entry">Post entry</button></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Reconciliation</h2>
        <span class="sub">Checks the ledger against the trip records.</span></div>
      <div class="row-actions"><button class="btn" data-act="reconcile">Run reconciliation</button></div>
      ${RECON ? `<div class="callout ${RECON.balanced ? 'go' : 'warn'}" style="margin-top:12px">
        <h4>${esc(RECON.summary)}</h4>
        ${RECON.findings.length ? `<ul>${RECON.findings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>
        ${RECON.balanced ? '' : `
        <h3 class="sect">Adjusting entry</h3>
        <div class="grid2">
          <label>Account<select id="rc-acct"><option value="">(none)</option>
            ${f.accounts.map((a) => `<option value="${esc(a.key)}">${esc(a.name)}</option>`).join('')}</select></label>
          <label>Amount $<input id="rc-amt" type="number" step="0.01" value="0"></label>
        </div>
        <label>Memo<input id="rc-memo" value="Reconciliation adjustment"></label>
        ${RECON.suggestedUnsettledPay != null
          ? `<label class="chk"><input type="checkbox" id="rc-fixpay" checked> Correct unsettled driver pay to ${money(RECON.suggestedUnsettledPay)}</label>` : ''}
        <div class="row-actions"><button class="btn primary" data-act="apply-recon"
          data-pay="${RECON.suggestedUnsettledPay ?? ''}">Apply adjustment</button></div>`}` : ''}
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Ledger</h2><span class="sub">newest first</span></div>
    ${S.views.finance ? '' : ''}
    <div class="tablewrap"><table>
      <thead><tr><th>Game time</th><th>Account</th><th>Category</th><th>Memo</th><th>Trip</th><th class="num">Amount</th></tr></thead>
      <tbody id="ledger-body"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody></table></div>
  </div>`;
}
const fkpi = (k, v, cls = '') => `<div class="meter ${cls}"><div class="lbl">${esc(k)}</div><div class="big">${esc(v)}</div></div>`;

/**
 * The company's cash position, anchored on the ATS bank balance — plus the driver's own earnings,
 * shown separately because they exist only in this app.
 */
function positionHtml() {
  const p = S.views.position;
  if (!p) return '';
  const e = p.earnings || {};
  const row = (label, amount, cls, note) => `<tr>
    <td>${esc(label)}${note ? `<br><span class="hint">${esc(note)}</span>` : ''}</td>
    <td class="num" style="${cls || ''}">${money(amount)}</td></tr>`;

  return `<div class="panel">
    <div class="panel-head"><h2>Company position</h2>
      <span class="sub">${p.hasReportedBalance ? 'reconciled to your ATS bank balance' : 'no game balance reported yet'}</span>
      <div class="spacer"></div>
      ${p.hasReportedBalance && !p.inSync
        ? `<button class="btn tiny primary" data-act="true-up">True up to the game</button>` : ''}</div>

    <div class="callout ${p.inSync ? 'info' : 'warn'}">
      <p><b>Your ATS bank balance is the company's money.</b> The game already takes fuel, repairs,
        garages, trucks and hired-driver wages out of it, so the books reconcile to it rather than
        keeping a second pot of imaginary cash.</p>
      <p style="margin:0">${esc(p.note)}</p>
    </div>

    <div class="grid3" style="margin-top:10px;align-items:end">
      <label>Bank balance from your game $
        <input id="pos-bank" type="number" step="1"
          value="${p.hasReportedBalance ? Math.round(p.atsBankBalance) : ''}"
          placeholder="open ATS and read it off"></label>
      <div class="row-actions" style="margin:0">
        <button class="btn primary" data-act="set-balance">${p.hasReportedBalance ? 'Update balance' : 'Report balance'}</button>
        ${p.hasReportedBalance ? `<button class="btn ghost" data-act="clear-balance"
          title="Go back to treating it as unreported">Clear</button>` : ''}
      </div>
      <div class="sub">${p.hasReportedBalance
        ? `Last read ${gt(p.balanceReportedAt)}.`
        : 'Blank is not zero — until you report it, the books stand on their own and nothing is flagged as a mismatch.'}</div>
    </div>

    <div class="cols">
      <div>
        <h3 class="sect">What the company can actually spend</h3>
        <div class="tablewrap"><table>
          <tbody>
            ${row('ATS bank balance' + (p.balanceReportedAt ? ' (as of ' + gt(p.balanceReportedAt) + ')' : ''),
                  p.hasReportedBalance ? p.atsBankBalance : p.ledgerCash, 'font-weight:600')}
            ${row('less maintenance earmark', -p.maintenanceEarmark, 'color:var(--amber2)',
                  pct(S.settings.maintenanceReservePct * 100, 0) + ' of revenue, drawn down by repairs')}
            ${row('less payroll earmark', -p.payrollEarmark, 'color:var(--amber2)',
                  pct(S.settings.payrollReservePct * 100, 0) + ' of revenue, drawn down by settlements')}
            ${row('less wages owed to you', -p.wagesOwed, 'color:var(--amber2)', 'unsettled driver pay')}
            <tr><td><b>Spendable</b></td>
              <td class="num" style="font-weight:700;color:${p.spendable < 0 ? 'var(--red)' : 'var(--green)'}">
                ${money(p.spendable)}</td></tr>
          </tbody></table></div>
        ${p.warning ? `<div class="callout stop" style="margin-top:10px"><p>${esc(p.warning)}</p></div>` : ''}
        ${!p.inSync ? `<p class="hint">Books say ${money(p.ledgerCash)}, game says ${money(p.atsBankBalance)} —
          a ${money(Math.abs(p.variance))} gap. <b>True up</b> posts the difference as an explicit adjustment
          rather than quietly changing a number.</p>` : ''}
      </div>

      <div>
        <h3 class="sect">Your earnings — this app only</h3>
        <div class="meters">
          ${fkpi('Settled', money0(e.settled || 0))}
          ${fkpi('Unsettled', money0(e.unsettled || 0), (e.unsettled || 0) > 0 ? 'warn' : '')}
          ${fkpi('Earned to date', money0(e.totalEarned || 0))}
          ${fkpi('Settlements', e.settlements || 0)}
          ${fkpi('Paid loaded mi', num(e.loadedMiles || 0))}
          ${fkpi('Effective', '$' + (+(e.effectiveCpm || 0)).toFixed(3) + '/mi')}
        </div>
        <p class="hint" style="margin-top:10px">${esc(e.note || '')}</p>
      </div>
    </div>
  </div>`;
}

/** What it costs this company to turn a wheel, and whether the market pays for it. */
function costModelHtml() {
  const be = S.views.breakEven;
  if (!be) return '';
  const c = CALIB;
  const manual = S.settings.scoring.useManualThresholds;

  return `<div class="panel">
    <div class="panel-head"><h2>Cost model</h2>
      <span class="sub">${manual ? 'manual thresholds' : 'thresholds derived from your costs'}</span>
      <div class="spacer"></div>
      <button class="btn tiny primary" data-act="calibrate">Calibrate to my market</button></div>

    <div class="meters">
      ${fkpi('Fuel / mi', '$' + be.fuelPerMile.toFixed(3))}
      ${fkpi('Your pay / mi', '$' + be.driverPayPerMile.toFixed(3))}
      ${fkpi('Overhead / mi', '$' + be.overheadPerMile.toFixed(3), be.overheadDominates ? 'bad' : '')}
      ${fkpi('Break-even', '$' + (+be.breakEvenRpm).toFixed(2) + '/mi', 'warn')}
      ${fkpi('Target', '$' + (+be.targetRpm).toFixed(2) + '/mi')}
      ${fkpi('Over', num(be.loadedMiles) + ' mi')}
    </div>

    ${be.overheadDominates ? `<div class="callout stop" style="margin-top:14px">
      <h4>Overhead is distorting your economics</h4>
      <p>Fixed overhead is <b>$${be.overheadPerMile.toFixed(3)}/mi</b> — more than half your per-mile cost —
        purely because $${(+S.settings.overheadPerLoad).toFixed(0)} per load is spread across
        ${num(be.loadedMiles)} scaled ATS miles. On a scaled map this is the usual reason every load looks
        unprofitable. Lower <b>overhead per load</b> in Settings, or hit Calibrate for a specific number.</p>
    </div>` : ''}

    ${c ? `<div class="callout ${c.verdict === 'Healthy' ? 'go' : c.verdict === 'Marginal' ? 'warn' : 'stop'}" style="margin-top:14px">
      <h4>${esc(c.verdict)} — ${c.sampleCount} load(s) sampled</h4>
      <p>${esc(c.summary)}</p>
      ${c.sampleCount ? `<p class="hint" style="margin:0">Market $/mi: low $${(+c.lowRpm).toFixed(2)} ·
        median $${(+c.medianRpm).toFixed(2)} · high $${(+c.highRpm).toFixed(2)} over an average of
        ${num(c.medianLoadedMiles)} mi. Headroom over break-even: $${(+c.headroomPerMile).toFixed(2)}/mi.</p>` : ''}
    </div>
    ${c.recommendations.length ? `<h3 class="sect">What to change</h3>
      <ul class="reasons">${c.recommendations.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${c.sampleCount ? `<h3 class="sect">Apply</h3>
      <div class="grid3">
        <label>Overhead per load $<input id="cal-oh" type="number" step="1" min="0"
          value="${Math.max(5, Math.round((+S.settings.overheadPerLoad) * 0.25 / 5) * 5)}"></label>
        <label>Fuel $/gal (what your game charges)<input id="cal-fuel" type="number" step="0.01"
          value="${(+S.settings.fuelPricePerGal).toFixed(2)}"></label>
        <label>Margin goal over cost<input id="cal-margin" type="number" step="0.05" min="1" max="3"
          value="${(+(S.settings.marginGoal ?? 1.25)).toFixed(2)}"></label>
      </div>
      <label class="chk"><input type="checkbox" id="cal-manual" ${manual ? 'checked' : ''}>
        Use my fixed floor/target instead of deriving them from cost</label>
      <div class="row-actions"><button class="btn go" data-act="apply-calibration">Apply these numbers</button></div>`
      : ''}` : `<p class="hint" style="margin-top:12px">Hit <b>Calibrate to my market</b> and it will compare
        what your freight actually pays against what this company costs to run, then tell you plainly whether
        your settings are survivable.</p>`}
  </div>`;
}

/* ============================================================ MAINTENANCE */
/**
 * What the company wants done about the condition of the equipment, and what it costs in hours.
 * Sits at the top of Maintenance because when it is set, it is the only thing that matters.
 */
function shopOrderHtml() {
  const o = S.views.shopOrder;
  if (!o || o.kind === 'None') return '';

  const cls = o.kind === 'TotalLoss' ? 'stop' : o.kind === 'RunHome' ? 'info' : 'warn';
  const q = o.quote;
  return `<div class="panel">
    <div class="panel-head"><h2>Shop order</h2>
      ${badge(o.kind === 'TotalLoss' ? 'bad' : 'warn', o.kind === 'RunHome' ? 'run it home' : o.kind === 'TotalLoss' ? 'total loss' : 'nearest shop')}
      <div class="spacer"></div>
      <span class="sub">tractor ${num(o.truckDamagePct, 1)}% · trailer ${num(o.trailerDamagePct, 1)}%</span></div>

    <div class="callout ${cls}">
      <h4>${esc(o.headline)}</h4>
      ${o.instructions.map((x) => `<p>${esc(x)}</p>`).join('')}
      ${o.lateWarning ? `<p><b>${esc(o.lateWarning)}</b></p>` : ''}
    </div>

    ${q && !q.totalLoss && q.waitHours > 0 ? `<div class="meters">
      ${fkpi('Tractor', hhmm(q.truckHours))}
      ${fkpi('Trailer', hhmm(q.trailerHours))}
      ${fkpi('You wait', hhmm(q.waitHours), 'warn')}
      ${fkpi('Shop', q.atCompanyShop ? 'company yard' : 'roadside dealer')}
      ${fkpi('Written off at', num(o.totalLossAtPct, 1) + '%', 'bad')}
    </div>
    <p class="hint">They work both units at once, so the wait is the longer of the two, not the sum.
      It is on-duty-not-driving time — log it and it lands in your HOS like anything else.</p>` : ''}
  </div>`;
}

/** The write-off: only offered once a unit is actually past its own line. */
function writeOffHtml() {
  const lines = S.views.writeOffLines || [];
  const at = (unit) => lines.find((l) => l.unit === unit);
  const units = S.trucks.filter((t) => !t.retired && t.inGameGarage
    && at(t.unit) && t.damagePct >= at(t.unit).atPct);
  if (!units.length) return '';

  return `<div class="panel">
    <div class="panel-head"><h2>Total loss</h2>${badge('bad', `${units.length} unit(s)`)}</div>
    <p class="hint">The write-off line moves with the odometer. Nobody scraps a truck with 60,000 miles on it over
      damage they would happily fix, and nobody sinks that money into one with 600,000 — past a point the repair
      is worth more than the truck. Insurance settles against the unit's value less a deductible, and the
      deductible is heavier when the damage was the driver's doing.</p>
    ${units.map((t) => `<div class="callout stop">
      <h4>Unit ${esc(t.unit)} — ${t.year} ${esc(t.make)} ${esc(t.model)} at ${num(t.damagePct, 1)}%</h4>
      <p>${esc(at(t.unit).explain)}</p>
      <div class="grid3">
        <label>Scrap value $<input id="wo-scrap-${esc(t.unit)}" type="number" step="1" placeholder="what ATS paid"></label>
        <label class="chk" style="align-self:end"><input type="checkbox" id="wo-fault-${esc(t.unit)}"> Driver-fault damage</label>
        <label>Note<input id="wo-note-${esc(t.unit)}" placeholder="optional"></label>
      </div>
      <p class="hint">Sell the wreck for scrap in your game first and put what it actually fetched in the box.
        Leave it blank if you have not sold it yet — report it later and I will book the recovery then.</p>
      <div class="row-actions">
        <button class="btn danger" data-act="write-off" data-unit="${esc(t.unit)}">Write unit ${esc(t.unit)} off</button>
      </div>
    </div>`).join('')}
  </div>`;
}

function viewMaint() {
  const m = S.settings.maintenance;
  const open = S.workOrders.filter((w) => w.status === 'Open');
  const done = S.workOrders.filter((w) => w.status !== 'Open');
  return `
  ${shopOrderHtml()}
  ${writeOffHtml()}

  <div class="panel">
    <div class="panel-head"><h2>Company thresholds</h2></div>
    <div class="meters">
      ${fkpi('Report after delivery', pct(m.reportPct, 0) + '+')}
      ${fkpi('No more dispatches', pct(m.stopDispatchPct, 0) + '+', 'warn')}
      ${fkpi('Mandatory review', pct(m.mandatoryReviewPct, 0) + '+', 'warn')}
      ${fkpi('Out of service', pct(m.outOfServicePct, 0) + '+', 'bad')}
      ${fkpi('Total loss (fresh truck)', pct(m.totalLossPct, 0) + '+', 'bad')}
      ${fkpi('PM interval', num(m.preventiveIntervalMiles) + ' mi')}
    </div>
    ${(S.views.writeOffLines || []).length ? `<div class="tablewrap" style="margin-top:12px"><table>
      <thead><tr><th>Unit</th><th class="num">Odometer</th><th class="num">Written off at</th><th class="num">Now</th></tr></thead>
      <tbody>${S.views.writeOffLines.map((l) => {
        const t = S.trucks.find((x) => x.unit === l.unit);
        const dmg = t ? t.damagePct : 0;
        return `<tr><td>${esc(l.unit)}</td><td class="num">${num(l.miles)} mi</td>
          <td class="num"><b>${num(l.atPct, 1)}%</b></td>
          <td class="num" style="color:${dmg >= l.atPct ? 'var(--red)' : dmg >= m.stopDispatchPct ? 'var(--amber2)' : 'var(--ink3)'}">${num(dmg, 1)}%</td></tr>`;
      }).join('')}</tbody></table></div>
    <p class="hint">A fresh tractor is worth fixing to ${num(m.totalLossPct, 0)}%. That line falls as the miles go on,
      down to a floor of ${num(m.writeOffFloorPct, 0)}% — the odometer you report is what moves it.</p>` : ''}
    ${S.views.maintenanceAlerts.length ? `<div class="callout warn" style="margin-top:14px">
      <h4>Open attention items</h4><ul>${S.views.maintenanceAlerts.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>`
      : `<div class="callout go" style="margin-top:14px"><p>Fleet is inside every threshold. Nothing outstanding.</p></div>`}
  </div>

  <div class="cols">
    <div class="panel">
      <div class="panel-head"><h2>Open a work order</h2></div>
      <div class="grid2">
        <label>Unit kind<select id="wo-kind2"><option>Truck</option><option>Trailer</option></select></label>
        <label>Unit<input id="wo-unit" value="${esc(S.driver.assignedTruckUnit)}"></label>
        <label>Type<select id="wo-type">${['Repair', 'Preventive', 'Damage', 'Inspection', 'Tires', 'Recall'].map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label>Vendor<input id="wo-vendor" placeholder="e.g. TA Truck Service"></label>
        <label>City<input id="wo-city" value="${esc(S.status.locationCity)}"></label>
        <label>State<input id="wo-state" class="up" maxlength="2" value="${esc(S.status.locationState)}"></label>
        <label>Damage before %<input id="wo-dmgb" type="number" step="0.1" value="${S.status.truckDamagePct}"></label>
        <label>Odometer<input id="wo-odo" type="number" step="1" value="${Math.round(S.status.atsOdometer)}"></label>
      </div>
      <label>Description<input id="wo-desc" placeholder="what needs doing"></label>
      <label class="chk"><input type="checkbox" id="wo-open" checked> Leave it open — the work has not been done yet</label>
      <div class="grid2" style="margin-top:8px">
        <label>Cost $<input id="wo-cost" type="number" step="0.01" placeholder="0.00"></label>
        <label>Damage after %<input id="wo-dmga" type="number" step="0.1" placeholder="0"></label>
      </div>
      <label>Paid by<select id="wo-paid"><option>Company</option><option>Driver</option></select></label>
      <p class="hint">Leaving it open keeps the cost as a <b>quote</b> — nothing is posted to the books
        until the work is closed out, and the figure carries over to pre-fill the closing cost. Untick
        the box if the repair is already done and paid for, and it posts straight away.</p>
      <p class="hint">The company pays legitimate maintenance. Charge the driver only for unauthorized
        modifications, intentional abuse or clearly reckless conduct.</p>
      <div class="row-actions"><button class="btn primary" data-act="create-wo">Create work order</button></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Open work orders (${open.length})</h2></div>
      ${open.length ? open.map((w) => `
        <div class="loadcard reject">
          <div class="loadcard-head">${badge('warn', w.kind)}
            <span class="lane">${esc(w.number)} — ${esc(w.unitKind)} ${esc(w.unit)}</span></div>
          <p style="margin:0 0 9px">${esc(w.description)}</p>
          <div class="kv"><span>at <b>${esc(w.locationCity)}, ${esc(w.locationState)}</b></span>
            <span>damage <b>${pct(w.damageBefore)}</b></span><span>opened <b>${gt(w.gameTime)}</b></span>
            ${w.estimatedCost > 0 ? `<span>quoted <b>${money(w.estimatedCost)}</b></span>` : ''}</div>
          <div class="grid3">
            <label>Cost $<input id="cw-cost-${esc(w.number)}" type="number" step="0.01"
              value="${w.estimatedCost > 0 ? w.estimatedCost : ''}" placeholder="what it actually cost"></label>
            <label>Damage after %<input id="cw-dmg-${esc(w.number)}" type="number" step="0.1" value="0"
              title="ATS repairs to 0%. Change it if the shop only did part of the work."></label>
            <label>Vendor<input id="cw-vend-${esc(w.number)}" value="${esc(w.vendor)}"></label>
          </div>
          <label>Paid by<select id="cw-paid-${esc(w.number)}"><option>Company</option><option>Driver</option></select></label>
          <div class="row-actions"><button class="btn go" data-act="close-wo" data-num="${esc(w.number)}">Close work order</button></div>
        </div>`).join('') : '<div class="empty">No open work orders.</div>'}
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Maintenance history</h2></div>
    ${done.length ? `<div class="tablewrap"><table>
      <thead><tr><th>WO</th><th>Unit</th><th>Type</th><th>Description</th><th>Vendor</th>
        <th class="num">Damage</th><th class="num">Cost</th><th>Paid by</th></tr></thead>
      <tbody>${done.map((w) => `<tr><td class="mono">${esc(w.number)}</td>
        <td class="mono">${esc(uref(w.unit))}</td><td>${esc(w.kind)}</td><td>${esc(w.description)}</td>
        <td>${esc(w.vendor || '—')}</td><td class="num">${pct(w.damageBefore)} → ${pct(w.damageAfter)}</td>
        <td class="num">${money(w.cost)}</td>
        <td>${badge(w.paidBy === 'Company' ? 'info' : 'warn', w.paidBy)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No completed work orders.</div>'}
  </div>`;
}

/* ---- what still counts against you
   An incident is on the record for ever, but it should not bar you from a carrier for ever. This is
   the difference between the two, and how much clean work is left before it stops counting. */
function standingHtml() {
  const rows = S.views.faultStanding || [];
  if (!rows.length) return '';
  const counting = rows.filter((r) => r.counting).length;

  return `<div class="panel">
    <div class="panel-head"><h2>Preventable standing</h2>
      ${badge(counting ? 'bad' : 'ok', counting ? counting + ' still counting' : 'nothing counting')}
      <div class="spacer"></div>
      <span class="sub">what carriers screen on</span></div>
    <p class="hint">Carriers screen on preventable driver-fault incidents. These stay on your record
      permanently, but they stop <em>counting against hiring</em> once you have put enough clean work
      behind them — a mistake in your first week should not end the career.</p>
    <div class="tablewrap"><table>
      <thead><tr><th>Incident</th><th>What</th><th>Severity</th><th>Status</th><th>Clean loads to clear</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td class="mono">${esc(r.number)}</td>
        <td>${esc(r.kind)} — ${esc((r.description || '').slice(0, 60))}</td>
        <td>${esc(r.severity)}</td>
        <td>${r.forgiven ? badge('ok', 'cleared') : r.counting ? badge('bad', 'counting') : badge('mute', 'aged off')}</td>
        <td class="num">${r.forgiven || !r.counting ? '—' : `${r.loadsToClear} of ${r.agesOffAfterLoads}`}</td>
        <td>${r.counting && !r.forgiven
          ? `<button class="btn tiny ghost" data-act="forgive-incident" data-num="${esc(r.number)}">Request review</button>`
          : r.forgiven ? `<span class="sub">${esc(r.forgivenReason || '')}</span>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>
  </div>`;
}

/* ============================================================ SAFETY */
function viewSafety() {
  const sr = S.views.career.safety;
  const pending = S.views.unacknowledged || [];
  return `
  <div class="panel">
    <div class="panel-head"><h2>Safety record</h2>
      ${badge(sr.currentLevel === 'Clear' ? 'ok' : 'warn', sr.currentLevel)}</div>
    <div class="meters">
      ${fkpi('Total incidents', sr.totalIncidents)}
      ${fkpi('Driver fault', sr.driverFault, sr.driverFault > 0 ? 'bad' : 'ok')}
      ${fkpi('Dispatcher fault', sr.dispatcherFault)}
      ${fkpi('Mechanical', sr.mechanical)}
      ${fkpi('Unavoidable', sr.unavoidable)}
      ${fkpi('Game limitation', sr.gameLimitation)}
      ${fkpi('Preventable collisions', sr.preventableCollisions, sr.preventableCollisions > 0 ? 'bad' : 'ok')}
    </div>
    <div class="callout ${sr.currentLevel === 'Clear' ? 'go' : 'warn'}" style="margin-top:14px">
      <p>Progressive discipline: Coaching → Written warning → Final warning → Suspension → Termination.
        Only <b>driver-fault preventable</b> incidents advance the ladder. Dispatcher errors, mechanical
        failures, unavoidable delays and game limitations never do.</p>
      <p>Next step if a preventable incident occurs: <b>${esc(sr.nextStepIfPreventable)}</b>.</p>
    </div>
    ${S.driver.status === 'Suspended' ? `<h3 class="sect">Reinstatement</h3>
      <label>Reinstatement note<input id="ri-note" placeholder="e.g. completed defensive driving review"></label>
      <div class="row-actions"><button class="btn go" data-act="reinstate">Reinstate driver</button></div>` : ''}
  </div>

  <div class="cols">
    <div class="panel">
      <div class="panel-head"><h2>Record an incident</h2></div>
      <div class="grid2">
        <label>Type<select id="in-kind">${['Collision', 'Late', 'Damage', 'Citation', 'Fatigue', 'Fuel', 'Overweight', 'Other'].map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label>Severity<select id="in-sev">${['Minor', 'Moderate', 'Serious', 'Major'].map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label>Fault<select id="in-fault">${['Driver', 'Dispatcher', 'Unavoidable', 'Mechanical', 'GameLimitation'].map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label>Cost $<input id="in-cost" type="number" step="0.01" value="0"></label>
        <label>Trip number<input id="in-trip" value="${esc(S.views.activeTrip?.number || '')}"></label>
        <label class="chk" style="margin-top:26px"><input type="checkbox" id="in-prevent" checked> Preventable</label>
      </div>
      <label>What happened<textarea id="in-desc" placeholder="be specific — Safety decides fault and consequence from this"></textarea></label>
      <p class="hint">You report it; Safety decides what follows and tells you. You do not choose your
        own outcome.</p>
      <div class="row-actions"><button class="btn primary" data-act="record-incident">File incident</button></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Safety's decision</h2>
        ${pending.length ? badge('bad', pending.length + ' to acknowledge') : badge('ok', 'nothing outstanding')}</div>
      ${pending.length ? pending.map((a) => `
        <div class="callout ${a.level === 'Termination' || a.level === 'Suspension' ? 'stop' : 'warn'}">
          <h4>${esc(a.number)} — ${esc(a.level.replace(/([a-z])([A-Z])/g, '$1 $2'))}</h4>
          <p><b>${esc(a.reason)}</b></p>
          <p>${esc(a.correctiveAction)}</p>
          <p class="hint" style="margin:0">Issued ${gt(a.gameTime)}${a.incidentNumber ? ' on ' + esc(a.incidentNumber) : ''}
            by ${esc(a.issuedBy)}${a.expiresAfterLoads > 0 ? ` · ages off after ${a.expiresAfterLoads} clean loads` : ' · does not age off'}.</p>
          <div class="row-actions">
            <button class="btn go" data-act="ack-discipline" data-num="${esc(a.number)}">Acknowledge</button>
          </div>
        </div>`).join('')
        : `<div class="callout go"><p>No action awaiting your signature. File an incident above and
             Safety will tell you what happens next.</p></div>`}

      <details class="score" style="margin-top:12px">
        <summary>Management override — issue an action manually</summary>
        <p class="hint">You are also playing the safety manager, so you can overrule the ladder. It is
          logged as an override, which is the honest way to record overruling your own process.</p>
        <div class="grid2">
          <label>Level<select id="da-level">${['Coaching', 'WrittenWarning', 'FinalWarning', 'EquipmentDowngrade', 'Suspension', 'Termination', 'Commendation']
            .map((x) => `<option ${x === sr.nextStepIfPreventable ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label>Ages off after N loads<input id="da-expire" type="number" step="1" value="20"></label>
        </div>
        <label>Linked incident<select id="da-inc"><option value="">(none)</option>
          ${S.incidents.filter((i) => !i.disciplineNumber).map((i) => `<option value="${esc(i.number)}">${esc(i.number)} — ${esc(i.kind)} (${esc(i.faultAttribution)})</option>`).join('')}</select></label>
        <label>Reason<input id="da-reason" placeholder="what the action is for"></label>
        <label>Corrective action<input id="da-corrective" placeholder="what changes going forward"></label>
        <div class="row-actions"><button class="btn danger" data-act="issue-discipline">Issue as override</button></div>
      </details>
    </div>
  </div>

  ${standingHtml()}

  <div class="panel">
    <div class="panel-head"><h2>Incident log</h2></div>
    ${S.incidents.length ? `<div class="tablewrap"><table>
      <thead><tr><th>No.</th><th>Game time</th><th>Type</th><th>Trip</th><th>Description</th>
        <th>Fault</th><th>Severity</th><th class="num">Cost</th><th>Action</th></tr></thead>
      <tbody>${S.incidents.map((i) => `<tr><td class="mono">${esc(i.number)}</td><td>${gt(i.gameTime)}</td>
        <td>${esc(i.kind)}</td><td class="mono">${esc(i.tripNumber || '—')}</td><td>${esc(i.description)}</td>
        <td>${badge(i.faultAttribution === 'Driver' ? 'bad' : 'info', i.faultAttribution)}</td>
        <td>${esc(i.severity)}</td><td class="num">${money(i.cost)}</td>
        <td class="mono">${esc(i.disciplineNumber || '—')}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Clean record — no incidents on file.</div>'}
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Discipline file</h2></div>
    ${S.discipline.length ? S.discipline.map((d) => `<div class="loadcard ${d.level === 'Commendation' ? 'auth' : 'reject'}">
      <div class="loadcard-head">${badge(d.level === 'Commendation' ? 'ok' : d.level === 'Coaching' ? 'info' : 'bad', d.level)}
        <span class="lane">${esc(d.number)}</span><div class="spacer"></div>
        <span class="sub">${gt(d.gameTime)}</span></div>
      <p style="margin:0 0 6px"><b>Reason:</b> ${esc(d.reason)}</p>
      ${d.correctiveAction ? `<p style="margin:0 0 6px"><b>Corrective action:</b> ${esc(d.correctiveAction)}</p>` : ''}
      <p class="hint">Issued by ${esc(d.issuedBy)}${d.incidentNumber ? ` · incident ${esc(d.incidentNumber)}` : ''}
        · ages off ${d.expiresAfterLoads} loads after issue (at ${d.loadCountAtIssue} loads)</p>
    </div>`).join('') : '<div class="empty">No disciplinary actions on file.</div>'}
  </div>`;
}

/* ============================================================ CAREER */
/* ---- dedicated: one customer, their freight only
   The customer is named by the player, because the app cannot see which shippers exist in their
   install or their map mods — and filtering a board against an invented company would be useless. */
function dedicatedHtml() {
  const d = S.views.dedicated;
  if (!d || !d.carrierRuns) return '';

  return `<div class="panel">
    <div class="panel-head"><h2>Dedicated</h2>
      ${d.onDedicated
        ? (d.awaitingAccount ? badge('warn', 'customer not set') : badge('ok', esc(d.dedicatedAccount)))
        : badge('mute', 'open board')}
      <div class="spacer"></div>
      <span class="sub">${esc(S.company.name)} runs dedicated freight</span></div>

    <div class="callout ${d.awaitingAccount ? 'warn' : 'info'}">
      <p><b>Dedicated means one customer.</b> You are assigned to a single account and haul their
        freight only. Other companies' loads still show on the board — they are simply not yours.
        In exchange the work is steadier and home time is more predictable, usually at a slightly
        lower rate than open board.</p>
      ${d.note ? `<p style="margin:0">${esc(d.note)}</p>` : ''}
    </div>

    <div class="grid2" style="align-items:end">
      <label>Customer, exactly as it appears on your ATS board
        <input id="ded-account" value="${esc(d.dedicatedAccount || '')}"
          placeholder="e.g. Walmart, Sunny Fields, Trameri"></label>
      <div class="row-actions" style="margin:0">
        ${d.onDedicated
          ? `<button class="btn primary" data-act="set-dedicated" data-on="1">${d.dedicatedAccount ? 'Change customer' : 'Set customer'}</button>
             <button class="btn ghost" data-act="set-dedicated" data-on="">Come off dedicated</button>`
          : `<button class="btn primary" data-act="set-dedicated" data-on="1">Go on a dedicated account</button>`}
      </div>
    </div>
    <p class="hint">I cannot see your game, so I do not know which companies your board offers —
      especially with map mods. Type the customer's name and I will match it against the shipper,
      receiver or market on each load.</p>
    ${d.offAccountLoads > 0 ? `<p class="hint"><b>${d.offAccountLoads}</b> load(s) run off-account by
      exception. That only happens when your account has nothing on the board.</p>` : ''}
  </div>`;
}

function viewCareer() {
  const c = S.views.career, st = c.stats;
  // Judge incidents against the allowance in force, so the tile agrees with the requirement below it.
  const faultMax = c.probationActive ? S.driver.probation.maxDriverFaultIncidents : 0;
  const prog = (rows) => rows.map((r) => `<div class="progress-row">
    <span class="pl">${esc(r.label)}</span>
    <span class="pb ${r.met ? 'done' : ''}"><i style="width:${r.pct}%"></i></span>
    <span class="pv">${esc(r.current)} / ${esc(r.required)} ${r.met ? '✓' : ''}</span></div>`).join('');

  return `
  ${dedicatedHtml()}
  <div class="panel">
    <div class="panel-head"><h2>${esc(S.driver.name)} — ${esc(c.rankTitle)}</h2>
      ${badge(S.driver.status === 'Active' ? 'ok' : S.driver.status === 'Probation' ? 'warn' : 'bad', S.driver.status)}
      <div class="spacer"></div><span class="sub">employee ${esc(S.driver.employeeId)} · hired ${gt(S.driver.hiredGameDate)}</span></div>
    <div class="meters">
      ${fkpi('Loads delivered', st.loadsDelivered)}
      ${fkpi('On-time service', pct(st.onTimePct), st.onTimePct < 95 ? 'warn' : 'ok')}
      ${fkpi('Total miles', num(st.totalMiles))}
      ${fkpi('Loaded miles', num(st.loadedMiles))}
      ${fkpi('Avg damage / trip', num(st.avgDamagePerTrip, 2),
        st.avgDamagePerTrip > S.driver.probation.maxAvgDamagePct ? 'warn' : 'ok')}
      ${fkpi('Driver-fault incidents', st.driverFaultIncidents,
        st.driverFaultIncidents > faultMax ? 'bad' : st.driverFaultIncidents > 0 ? 'warn' : 'ok')}
      ${fkpi('Cancellations', st.cancellations, st.cancellations > 0 ? 'warn' : 'ok')}
      ${fkpi('Lifetime earnings', money0(st.driverEarnings))}
      ${fkpi('Revenue generated', money0(st.companyRevenue))}
      ${fkpi('Days employed', st.daysEmployed)}
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Ask operations</h2>
      <div class="spacer"></div>
      <span class="sub">answers come back when you close your next load out</span></div>
    ${askHomeHtml()}
    ${askTrailerHtml()}
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Your licence</h2></div>
    ${endorsementsHtml()}
  </div>

  ${probationHtml() ? `<div class="panel">${probationHtml()}</div>` : ''}

  ${c.probationActive ? `<div class="panel">
    <div class="panel-head"><h2>Probation requirements</h2>
      ${badge(c.probationMet ? 'ok' : 'warn', c.probationMet ? 'requirements met' : 'in progress')}
      <div class="spacer"></div><span class="sub">${S.driver.probation.durationDays}-day period · ${esc(S.driver.probation.notes)}</span></div>
    ${prog(c.probationProgress)}
    ${c.probationMet ? `<div class="row-actions" style="margin-top:12px">
      <button class="btn go" data-act="clear-probation">Clear probation &amp; move to Company Driver scale</button></div>`
      : `<div class="row-actions" style="margin-top:12px">
      <button class="btn ghost" data-act="clear-probation" data-force="1">Clear early (management override)</button></div>`}
  </div>` : ''}

  ${c.nextRank ? `<div class="panel">
    <div class="panel-head"><h2>Toward ${esc(c.nextRankTitle)}</h2>
      ${badge(c.nextRankMet ? 'ok' : 'mute', c.nextRankMet ? 'eligible' : 'not yet')}</div>
    ${prog(c.nextRankProgress)}
    <div class="row-actions" style="margin-top:12px">
      <button class="btn ${c.nextRankMet ? 'go' : 'ghost'}" data-act="promote" ${c.nextRankMet ? '' : 'data-force="1"'}>
        ${c.nextRankMet ? 'Promote to ' + esc(c.nextRankTitle) : 'Promote early (override)'}</button></div>
  </div>` : ''}

  <div class="cols">
    <div class="panel">
      <div class="panel-head"><h2>Review notes</h2></div>
      ${c.findings.length ? `<ul class="reasons">${c.findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
        : '<div class="empty">Nothing to note.</div>'}
      <h3 class="sect">Qualifications</h3>
      <p>${S.driver.qualifications.map((q) => badge('info', q)).join(' ') || '—'}</p>
      <h3 class="sect">Restrictions</h3>
      <p>${S.driver.restrictions.length ? S.driver.restrictions.map((q) => badge('warn', q)).join(' ') : badge('ok', 'none')}</p>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Adjust pay</h2><span class="sub">Management action</span></div>
      <div class="grid2">
        <label>Loaded $/mi<input id="cp-loaded" type="number" step="0.005" value="${S.driver.pay.loadedCpm}"></label>
        <label>Empty $/mi<input id="cp-empty" type="number" step="0.005" value="${S.driver.pay.deadheadCpm}"></label>
      </div>
      <label>Reason<input id="cp-reason" placeholder="why the rate is changing"></label>
      <div class="row-actions"><button class="btn primary" data-act="adjust-pay">Apply new rate</button></div>
      <p class="hint">Progression should come from performance. Use this for negotiated raises or corrections,
        not to skip the ladder.</p>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Company activity log</h2></div>
    <div class="log">${S.events.map((e) => `<div><span class="ch">${esc(e.channel)}</span>
      <span>${esc(e.message)}${e.ref ? ` <span style="color:var(--ink3)">(${esc(e.ref)})</span>` : ''}</span></div>`).join('')
      || '<div class="empty">No activity yet.</div>'}</div>
  </div>`;
}

/* ============================================================ JOB MARKET */
let MARKET = null;
let FLEETOPS = null;
let CALIB = null;

function viewJobMarket() {
  const hist = S.driver.employmentHistory || [];
  const stats = S.views.career.stats;
  const totalLoads = stats.loadsDelivered + (S.driver.priorLoads || 0);

  return `
  <div class="panel">
    <div class="panel-head"><h2>Where you stand</h2>
      <span class="sub">carriers screen on your whole record, not just this job</span></div>
    <div class="meters">
      ${fkpi('Loads at ' + S.company.code, stats.loadsDelivered)}
      ${fkpi('Loads before this', S.driver.priorLoads || 0)}
      ${fkpi('Verifiable total', totalLoads)}
      ${fkpi('On-time', pct(stats.onTimePct))}
      ${fkpi('Driver-fault', stats.driverFaultIncidents + (S.driver.priorFaultIncidents || 0),
        (stats.driverFaultIncidents + (S.driver.priorFaultIncidents || 0)) > 0 ? 'bad' : '')}
      ${fkpi('Declared', num(S.application?.experienceYears || 0, 1) + ' yr')}
      ${fkpi('Credited', num(MARKET?.[0]?.creditedExperienceYears ?? 0, 1) + ' yr')}
    </div>
    <p class="hint">Carriers judge you on <b>credited</b> experience — what you declared, plus time
      served, plus freight you have actually hauled here. Every ${Math.round(30)} loads counts as
      another year, so the way to reach the specialists is to run freight.</p>
    <div class="callout ${S.driver.probation.active ? 'warn' : 'info'}" style="margin-top:14px">
      ${S.driver.probation.active
        ? `<p><b>You are on probation at ${esc(S.company.name)}.</b> You can still look, and you can still
           apply — but leaving inside probation means starting a fresh probation somewhere else with
           nothing to show for the time you put in here.</p>`
        : `<p>You are off probation at ${esc(S.company.name)} as a ${esc(S.driver.rankTitle)}. Moving now
           carries your record with you: loads, service percentage and safety all follow you. The
           company's books do not — a new employer means new equipment and a new ledger.</p>`}
      <p>Resigning requires no open load and no unsettled pay. Settle up on the Payroll tab first.</p>
    </div>
    <div class="row-actions">
      <button class="btn primary" data-act="load-market">${MARKET ? 'Refresh the market' : 'See who is hiring'}</button>
    </div>
  </div>

  ${MARKET ? renderMarket(MARKET, { onboarding: false }) : ''}

  ${hist.length ? `<div class="panel">
    <div class="panel-head"><h2>Employment history</h2></div>
    <div class="tablewrap"><table>
      <thead><tr><th>Carrier</th><th>From</th><th>To</th><th>Rank at exit</th>
        <th class="num">Loads</th><th class="num">Miles</th><th class="num">On-time</th>
        <th class="num">Faults</th><th class="num">Earned</th><th>Left because</th></tr></thead>
      <tbody>${hist.map((e) => `<tr>
        <td><b>${esc(e.carrierName)}</b> <span class="mono" style="color:var(--ink3)">${esc(e.carrierCode)}</span></td>
        <td>${gt(e.startedGameDate)}</td><td>${gt(e.endedGameDate)}</td>
        <td>${esc(e.rankAtExit)}</td>
        <td class="num">${num(e.loadsDelivered)}</td><td class="num">${num(e.miles)}</td>
        <td class="num">${pct(e.onTimePct)}</td><td class="num">${e.driverFaultIncidents}</td>
        <td class="num">${money0(e.earnings)}</td>
        <td>${badge(e.separation === 'Resigned' ? 'info' : 'bad', e.separation)}
          ${e.reason ? '<br><span class="hint">' + esc(e.reason) + '</span>' : ''}</td>
      </tr>`).join('')}</tbody></table></div>
  </div>` : ''}`;
}

/* ============================================================ PACKET */
function viewPacket() {
  return `
  <div class="panel">
    <div class="panel-head"><h2>Dispatch Packet</h2>
      <span class="sub">Everything Claude needs to resume the roleplay with full continuity.</span></div>
    <div class="callout info">
      <p>Copy this and paste it into a chat. It carries the carrier, your file, the equipment, the clocks,
        the money, the safety record and the trip history — so nothing drifts between sessions.</p>
    </div>
    <div class="row-actions">
      <button class="btn primary" data-act="packet" data-mode="full">Full packet</button>
      <button class="btn" data-act="packet" data-mode="brief">Short dispatch request</button>
      <button class="btn ghost" data-act="packet" data-mode="state">State only (no rules)</button>
      ${PACKET ? `<button class="btn go" data-act="copy-packet">Copy to clipboard</button>` : ''}
    </div>
    ${PACKET ? `<pre class="packet" id="packet-text">${esc(PACKET)}</pre>` : ''}
  </div>

  <div class="panel">
    <div class="panel-head"><h2>In-app dispatcher</h2>
      ${badge(S.views.aiConfigured ? 'ok' : 'mute', S.views.aiConfigured ? 'connected' : 'not configured')}</div>
    ${S.views.aiConfigured ? `
      <label>Message to operations (optional — the packet is always attached)
        <textarea id="ai-msg" placeholder="e.g. what do you want me to do with this board?"></textarea></label>
      <div class="row-actions"><button class="btn primary" data-act="ai-send">Ask operations</button></div>
      ${AI_REPLY ? (AI_REPLY.ok
        ? `<h3 class="sect">Reply — ${esc(AI_REPLY.model)} (${AI_REPLY.outputTokens} output tokens)</h3>
           <pre class="reply">${esc(AI_REPLY.text)}</pre>`
        : `<div class="callout stop" style="margin-top:12px"><h4>Could not get a reply</h4><p>${esc(AI_REPLY.error)}</p></div>`) : ''}`
      : `<div class="callout mute">
        <p>The app is fully offline and every feature works without this. If you would rather it write the
          dispatch messages itself, add an API key in <b>Settings → In-app dispatcher</b>.</p>
        <p>Get a key at <b>console.anthropic.com → API Keys</b>. That is pay-per-token billing, separate
          from any Claude subscription.</p></div>`}
  </div>`;
}

/* ---- what a dock actually costs, per trailer type
   One global figure could not serve a reefer that takes four hours and a flatbed that takes one, so
   the app measures instead of assuming. These converge as loads are delivered. */
function facilityTimesHtml() {
  const rows = S.views.facilityTimes || [];
  if (!rows.length) return '';

  return `<details class="score" style="margin-top:10px">
    <summary>Dock time by trailer — learned from your loads</summary>
    <p class="hint">The planner uses the figure for whatever is hooked. Measured close-outs train it;
      a hand-typed fallback never does. Set one yourself and it stops moving until you release it.</p>
    <div class="tablewrap"><table>
      <thead><tr><th>Trailer</th><th class="num">Load</th><th class="num">Unload</th>
        <th class="num">Loads</th><th>Source</th><th></th></tr></thead>
      <tbody>${rows.map((f, i) => `<tr>
        <td>${esc(f.trailerType)}</td>
        <td><input id="ftl-${i}" inputmode="numeric" style="width:74px" value="${hhmm(f.loadingHours)}"></td>
        <td><input id="ftu-${i}" inputmode="numeric" style="width:74px" value="${hhmm(f.unloadingHours)}"></td>
        <td class="num">${f.samples}</td>
        <td>${f.manual ? badge('warn', 'yours') : f.learned ? badge('ok', 'measured') : badge('mute', 'estimate')}</td>
        <td>${f.manual
          ? `<button class="btn tiny ghost" data-act="facility-release" data-type="${esc(f.trailerType)}"
               title="Go back to learning from your loads">Release</button>`
          : `<button class="btn tiny ghost" data-act="facility-set" data-type="${esc(f.trailerType)}" data-i="${i}"
               title="Fix these figures">Set</button>`}</td>
      </tr>`).join('')}</tbody></table></div>
  </details>`;
}

/* ============================================================ SETTINGS */
function viewSettings() {
  const s = S.settings, h = s.hos, m = s.maintenance, w = s.scoring;
  return `
  <div class="cols">
    <div class="panel">
      <div class="panel-head"><h2>Game environment</h2></div>
      <label>ATS version<input id="se-ver" value="${esc(s.atsVersion)}" placeholder="e.g. 1.57"></label>
      <label>Map mods (comma separated)<input id="se-mapmods" value="${esc(s.mapMods.join(', '))}"></label>
      <label>Other mods<input id="se-mods" value="${esc(s.mods.join(', '))}"></label>
      <label class="chk"><input type="checkbox" id="se-hosmod" ${s.usesHosMod ? 'checked' : ''}> I use an HOS mod</label>
      <label>HOS mod name<input id="se-hosmodname" value="${esc(s.hosModName)}"></label>
      <label class="chk"><input type="checkbox" id="se-econmod" ${s.usesEconomyMod ? 'checked' : ''}> I use an economy / realistic-jobs mod</label>

      <h3 class="sect">Carrier roster</h3>
      <label>Which carriers appear in the job market
        <select id="se-roster">
          <option value="Real" ${s.carrierRoster !== 'Fictional' ? 'selected' : ''}>Real US carriers</option>
          <option value="Fictional" ${s.carrierRoster === 'Fictional' ? 'selected' : ''}>Invented carriers</option>
        </select></label>
      <p class="hint">Real carriers use actual company names, headquarters and freight specialities —
        those parts are factual. Their <b>pay rates and hiring standards here are made up for the
        game</b> and are not real terms of employment. Switch to invented carriers if you would rather
        not work for a real name. Changing this does not affect who you already work for.</p>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>HOS rule set</h2>
        <span class="sub">Your mod wins — type its numbers here.</span></div>
      <div class="grid2">
        <label>Drive limit<input id="hr-drive" inputmode="numeric" value="${hhmm(h.driveLimit)}"></label>
        <label>Shift window<input id="hr-shift" inputmode="numeric" value="${hhmm(h.shiftLimit)}"></label>
        <label>Driving before break<input id="hr-beforebreak" inputmode="numeric" value="${hhmm(h.drivingBeforeBreak)}"></label>
        <label>Break length<input id="hr-breaklen" inputmode="numeric" value="${hhmm(h.breakLength)}"></label>
        <label>Cycle limit<input id="hr-cycle" inputmode="numeric" value="${hhmm(h.cycleLimit)}"></label>
        <label>Cycle days<input id="hr-cycledays" type="number" step="1" value="${h.cycleDays}"></label>
        <label>Off-duty reset<input id="hr-reset" inputmode="numeric" value="${hhmm(h.offDutyReset)}"></label>
        <label>Cycle restart<input id="hr-restart" inputmode="numeric" value="${hhmm(h.cycleRestartHours)}"></label>
      </div>
      <label class="chk"><input type="checkbox" id="hr-requirebreak" ${h.requireBreak ? 'checked' : ''}> Enforce the ${(h.breakLength * 60).toFixed(0)}-minute break</label>
      <p class="hint">ATS runs on compressed time, which makes a short mandatory break awkward to
        actually sit. Untick this and dispatch stops planning breaks and stops tracking the break
        clock — the ${num(h.shiftLimit, 0)}-hour window becomes your binding stop.</p>
      <label class="chk"><input type="checkbox" id="hr-breakshift" ${h.breakConsumesShift ? 'checked' : ''}> The break consumes the shift window</label>
      <label class="chk"><input type="checkbox" id="hr-split" ${h.sleeperSplitAllowed ? 'checked' : ''}> Sleeper-berth split allowed</label>
      <p class="hint">Vanilla ATS has no real HOS system, so these numbers are the roleplay layer. If your mod
        uses a different restart duration, change it here and the planner uses yours.</p>
    </div>
  </div>

  <div class="cols">
    <div class="panel">
      <div class="panel-head"><h2>Operational assumptions</h2></div>
      <div class="grid2">
        <label>Governed mph<input id="op-gov" type="number" step="1" value="${s.governedMph}"></label>
        <label>Speed factor<input id="op-factor" type="number" step="0.01" min="0.3" max="1" value="${s.speedFactor}"></label>
        <label>Safety buffer<input id="op-buffer" inputmode="numeric" value="${hhmm(s.safetyBufferHours)}"></label>
        <label>Parking buffer<input id="op-park" inputmode="numeric" value="${hhmm(s.parkingBufferHours)}"></label>
        <label>Window left when empty<input id="op-strand" inputmode="numeric" value="${hhmm(s.strandedMarginHours)}"></label>
        <label>Pre-trip<input id="op-pre" inputmode="numeric" value="${hhmm(s.preTripHours)}"></label>
        <label>Post-trip<input id="op-post" inputmode="numeric" value="${hhmm(s.postTripHours)}"></label>
        <label>Fallback loading<input id="op-load" inputmode="numeric" value="${hhmm(s.defaultLoadingHours)}"></label>
        <label>Fallback unloading<input id="op-unload" inputmode="numeric" value="${hhmm(s.defaultUnloadingHours)}"></label>
        <label>Fuel stop<input id="op-fuelstop" inputmode="numeric" value="${hhmm(s.fuelStopHours)}"></label>
        <label>Planned fuel range mi<input id="op-range" type="number" step="10" value="${s.fuelRangeMiles}"></label>
        <label>Fuel price $/gal<input id="op-fuelprice" type="number" step="0.01" value="${s.fuelPricePerGal}"></label>
      </div>
      ${facilityTimesHtml()}
      <p class="hint">Effective planning speed is governed mph × speed factor — currently
        <b>${num(s.governedMph * s.speedFactor, 1)} mph</b>.</p>
      <p class="hint"><b>Window left when empty</b> is a different risk from the safety buffer. That one is about
        missing an appointment; this one is about a dock holding you until your 14 runs out — at which point
        finishing the work is legal but moving the truck is not, and you are parked on their property for a
        ${num(s.hos.offDutyReset, 0)}. A load that delivers with less than this in hand gets flagged before you take it.</p>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Economics &amp; realism bridges</h2></div>
      <div class="grid2">
        <label>Revenue factor<input id="ec-revfactor" type="number" step="0.05" min="0.05" max="3" value="${s.revenueFactor}"></label>
        <label>Pay-mile multiplier<input id="ec-paymult" type="number" step="0.1" min="0.1" max="20" value="${s.payMileMultiplier}"></label>
        <label>Maintenance reserve %<input id="ec-maintpct" type="number" step="0.01" min="0" max="0.5" value="${s.maintenanceReservePct}"></label>
        <label>Payroll reserve %<input id="ec-paypct" type="number" step="0.01" min="0" max="0.8" value="${s.payrollReservePct}"></label>
        <label>Overhead per load $<input id="ec-overhead" type="number" step="1" value="${s.overheadPerLoad}"></label>
        <label>Cancellation penalty $<input id="ec-cancel" type="number" step="1" value="${s.cancellationPenalty}"></label>
        <label>Settlement period days<input id="ec-period" type="number" step="1" value="${s.settlementPeriodDays}"></label>
        <label>Medical $/period (pre-tax)<input id="ec-health" type="number" step="5" min="0" value="${s.healthPremiumPerPeriod}"></label>
      </div>
      <p class="hint"><b>Revenue factor:</b> vanilla ATS payouts are inflated against real linehaul rates.
        A factor below 1 discounts them before the company books revenue. With an economy mod, leave it at 1.00.<br>
        <b>Pay-mile multiplier:</b> ATS runs a scaled map, so a "500 mile" run is short in real terms.
        Raise this if settlements feel too small. It affects driver pay only, never HOS or fuel math.</p>
    </div>
  </div>

  <div class="cols">
    <div class="panel">
      <div class="panel-head"><h2>Maintenance thresholds</h2></div>
      <div class="grid2">
        <label>Report after delivery %<input id="mt-report" type="number" step="1" value="${m.reportPct}"></label>
        <label>No more dispatches %<input id="mt-stop" type="number" step="1" value="${m.stopDispatchPct}"></label>
        <label>Mandatory review %<input id="mt-review" type="number" step="1" value="${m.mandatoryReviewPct}"></label>
        <label>Out of service %<input id="mt-oos" type="number" step="1" value="${m.outOfServicePct}"></label>
        <label>Total loss, fresh truck %<input id="mt-total" type="number" step="1" value="${m.totalLossPct}"></label>
        <label>PM interval mi<input id="mt-pm" type="number" step="500" value="${m.preventiveIntervalMiles}"></label>
      </div>
      <p class="hint">The write-off line falls with the odometer — a worn-out tractor is scrapped over damage a new
        one would be repaired from, because past a point the repair is worth more than the truck.</p>
      <div class="grid3">
        <label>Fully worn at mi<input id="mt-life" type="number" step="25000" value="${m.writeOffLifeMiles}"></label>
        <label>Wear takes ×<input id="mt-wear" type="number" step="0.05" min="0" max="1" value="${m.writeOffWearFactor}"></label>
        <label>Never below %<input id="mt-floor" type="number" step="1" value="${m.writeOffFloorPct}"></label>
      </div>
      <p class="hint">At the dispatch line the truck goes to a shop. If home is close and the damage is light
        it goes home instead — cheaper labour, and the repair counts as home time.</p>
      <div class="grid2">
        <label>Run home under %<input id="mt-runhome-pct" type="number" step="1" value="${m.runHomeMaxDamagePct}"></label>
        <label>Run home within<input id="mt-runhome-h" inputmode="numeric" value="${hhmm(m.runHomeMaxHours)}"></label>
        <label>Repair time per point<input id="mt-perpoint" inputmode="numeric" value="${hhmm(m.repairHoursPerPoint)}"></label>
        <label>Trailer rate ×<input id="mt-trfactor" type="number" step="0.05" min="0.1" max="1" value="${m.trailerRepairFactor}"></label>
        <label>Company shop ×<input id="mt-shopfactor" type="number" step="0.05" min="0.1" max="1" value="${m.companyShopFactor}"></label>
        <label>Total-loss deductible $<input id="mt-deduct" type="number" step="100" value="${m.totalLossDeductible}"></label>
      </div>
      <p class="hint">A driver-fault write-off pays double the deductible. Insurance settles at
        ${pct(m.totalLossPayoutFactor * 100, 0)} of the unit's book value — nobody is made whole on a write-off.</p>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Load scoring</h2>
        <span class="sub">How operations weighs freight.</span></div>
      <div class="grid2">
        <label>Target all-in $/mi<input id="sc-target" type="number" step="0.05" value="${w.targetAllInRpm}"></label>
        <label>Floor all-in $/mi<input id="sc-floor" type="number" step="0.05" value="${w.floorAllInRpm}"></label>
        <label>Max deadhead ratio<input id="sc-dh" type="number" step="0.05" min="0" max="1" value="${w.maxDeadheadRatio}"></label>
        <label>Reset watch at cycle h<input id="sc-resetwatch" type="number" step="1" value="${w.resetWatchCycleHours}"></label>
        <label>Weight: RPM<input id="sc-wrpm" type="number" step="0.1" value="${w.allInRpm}"></label>
        <label>Weight: total revenue<input id="sc-wrev" type="number" step="0.05" value="${w.totalRevenue}"></label>
        <label>Weight: deadhead penalty<input id="sc-wdh" type="number" step="0.1" value="${w.deadheadPenalty}"></label>
        <label>Weight: positioning<input id="sc-wpos" type="number" step="0.1" value="${w.positioning}"></label>
        <label>Weight: reset positioning<input id="sc-wreset" type="number" step="0.1" value="${w.resetPositioning}"></label>
        <label>Weight: HOS slack<input id="sc-wslack" type="number" step="0.1" value="${w.hosSlack}"></label>
        <label>Weight: division fit<input id="sc-wdiv" type="number" step="0.1" value="${w.divisionFit}"></label>
        <label>Weight: trip-length fit<input id="sc-wutil" type="number" step="0.1" value="${w.utilizationFit}"></label>
      </div>
    </div>
  </div>

  <div class="cols">
    <div class="panel">
      <div class="panel-head"><h2>Trip numbering</h2></div>
      <div class="grid2">
        <label>Freight prefix<input id="nu-freight" value="${esc(s.freightPrefix)}"></label>
        <label>Digits<input id="nu-pad" type="number" step="1" min="2" max="6" value="${s.numberPadding}"></label>
        <label>Empty move tag<input id="nu-mt" value="${esc(s.emptyMovePrefix)}"></label>
        <label>Maintenance tag<input id="nu-mx" value="${esc(s.maintenancePrefix)}"></label>
        <label>Cancelled tag<input id="nu-cx" value="${esc(s.cancelPrefix)}"></label>
      </div>
      <p class="hint">Next available: freight <b>${esc(S.views.nextNumbers.freight)}</b>,
        empty <b>${esc(S.views.nextNumbers.emptyMove)}</b>,
        maintenance <b>${esc(S.views.nextNumbers.maintenance)}</b>,
        cancelled <b>${esc(S.views.nextNumbers.cancelled)}</b>. Counters only move forward, so numbers are never reused.</p>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>In-app dispatcher (optional)</h2></div>
      <label class="chk"><input type="checkbox" id="ai-enabled" ${s.aiEnabled ? 'checked' : ''}> Let the app write dispatch messages itself</label>
      <label>Anthropic API key<input id="ai-key" type="password" placeholder="${s.anthropicApiKey ? 'a key is saved — leave blank to keep it' : 'sk-ant-…'}"></label>
      <label>Model<input id="ai-model" value="${esc(s.anthropicModel)}"></label>
      <p class="hint">Leave the key blank and the app stays completely offline — it makes no network calls at all
        and every feature still works through the Dispatch Packet. Keys come from
        <b>console.anthropic.com → API Keys</b> and bill per token, separately from a Claude subscription.
        The key is stored in your local career file and is never sent to the browser.</p>
    </div>
  </div>

  <div class="row-actions"><button class="btn primary" data-act="save-settings">Save all settings</button></div>

  <div class="panel">
    <div class="panel-head"><h2>Data</h2><span class="sub">Everything lives in one JSON file next to the exe.</span></div>
    <div class="row-actions">
      <button class="btn" data-act="snapshot">Take a snapshot</button>
      <button class="btn" data-act="export">Download career file</button>
      <button class="btn" data-act="list-backups">List backups</button>
      <button class="btn danger" data-act="reset">Start a new career</button>
    </div>
    <div id="backup-list"></div>
  </div>`;
}

/* ============================================================ modals */
function moveModal() {
  modal(`<div class="panel-head"><h2>Non-revenue move</h2><div class="spacer"></div>
      <button class="btn tiny ghost" data-act="close-modal">Close</button></div>
    <p class="hint">Empty repositioning and maintenance moves get their own number series so freight
      numbers stay a clean sequence.</p>
    <div class="grid2">
      <label>Kind<select id="mv-kind"><option value="EmptyMove">Empty repositioning</option>
        <option value="Maintenance">Maintenance move</option></select></label>
      <label>Miles<input id="mv-miles" type="number" step="1" value="0"></label>
      <label>Destination city<input id="mv-city"></label>
      <label>Destination state<input id="mv-state" class="up" maxlength="2"></label>
    </div>
    <label>Why<input id="mv-reason" placeholder="e.g. no outbound freight here — repositioning to a tier-1 market"></label>
    <div class="row-actions end"><button class="btn primary" data-act="create-move">Authorize move</button></div>`);
}

function cancelModal(id) {
  const t = S.trips.find((x) => x.id === id);
  modal(`<div class="panel-head"><h2>Cancel ${esc(t?.number || '')}</h2><div class="spacer"></div>
      <button class="btn tiny ghost" data-act="close-modal">Close</button></div>
    <div class="callout warn"><p>Once freight is loaded the company is committed. Cancelling costs a penalty and
      goes on the record with a fault attribution. Only do this for a genuine emergency.</p></div>
    <label>Reason<textarea id="cx-reason" placeholder="what makes this unavoidable"></textarea></label>
    <label>Fault<select id="cx-fault">${['Dispatcher', 'Driver', 'Mechanical', 'Unavoidable', 'GameLimitation']
      .map((x) => `<option>${x}</option>`).join('')}</select></label>
    <label class="chk"><input type="checkbox" id="cx-charge" checked>
      Charge the company the ${money(S.settings.cancellationPenalty)} cancellation penalty</label>
    <div class="row-actions end"><button class="btn danger" data-act="do-cancel" data-id="${esc(id)}">Cancel the load</button></div>`);
}

const BLANK_TRUCK = {
  unit: '', make: '', model: '', year: new Date().getFullYear(), engine: '', horsepower: 0,
  transmission: '', transmissionType: 'manual', cabConfig: 'Sleeper', wheelbase: '265"',
  governedMph: 65, fuelCapacityGal: 250, avgMpg: 6.5, assignedFreightTypes: [],
  inGameGarage: true, serviceMiles: 0, atsOdometer: 0, damagePct: 0, assignedDriver: '',
  status: 'InService', homeTerminal: '', lastServiceMiles: 0, serviceIntervalMiles: 25000,
  purchasePrice: 0, monthlyPayment: 0, notes: '',
};
const BLANK_TRAILER = {
  unit: '', type: 'Dry Van', subtype: '', division: 'Dry Van', year: new Date().getFullYear(), make: '',
  length: "53'", axles: 'Tandem', inGameGarage: true, damagePct: 0, serviceMiles: 0,
  status: 'InService', homeTerminal: '', currentLocation: '', assignedTruckUnit: '',
  isCompanyOwned: true, notes: '',
};

function editTruckModal(unit) {
  const isNew = !unit;
  const t = isNew ? { ...BLANK_TRUCK } : S.trucks.find((x) => x.unit === unit);
  if (!t) return;
  modal(`<div class="panel-head"><h2>${isNew ? 'Add a tractor' : 'Unit ' + esc(t.unit)}</h2><div class="spacer"></div>
      <button class="btn tiny ghost" data-act="close-modal">Close</button></div>
    ${isNew ? `<label>Unit number<input id="et-unit" placeholder="e.g. 119"></label>` : ''}
    <label>ID shown in ATS — optional
      <input id="et-gameid" value="${esc(t.gameId || '')}" placeholder="what the game calls this truck"></label>
    <p class="hint">Enter what ATS shows for this unit and the app will use it everywhere instead of
      ${isNew ? 'the number above' : 'unit ' + esc(t.unit)}. Leave it blank and nothing changes. The assigned
      number stays what work orders and trips are filed against either way.</p>
    <fieldset><legend>Does ATS know about this unit?</legend>
      <label class="chk"><input type="checkbox" id="et-garage" ${t.inGameGarage ? 'checked' : ''}>
        This unit exists in my ATS garage</label>
      <p class="hint">Tick this only for equipment you have actually bought in the game. Ticked units
        have their damage and odometer tracked from what you report and can trigger shop directives.
        Unticked units are company backdrop — no invented damage, no directives.</p>
    </fieldset>
    <div class="grid2">
      <label>Make<input id="et-make" value="${esc(t.make)}"></label>
      <label>Model<input id="et-model" value="${esc(t.model)}"></label>
      <label>Year<input id="et-year" type="number" step="1" value="${t.year}"></label>
      <label>Engine<input id="et-engine" value="${esc(t.engine)}"></label>
      <label>Transmission<input id="et-trans" value="${esc(t.transmission)}"></label>
      <label>Transmission type<select id="et-ttype">
        <option value="manual" ${t.transmissionType === 'manual' ? 'selected' : ''}>manual</option>
        <option value="automatic" ${t.transmissionType === 'automatic' ? 'selected' : ''}>automatic</option></select></label>
      <label>Cab<select id="et-cab"><option ${t.cabConfig === 'Sleeper' ? 'selected' : ''}>Sleeper</option>
        <option ${t.cabConfig === 'Day Cab' ? 'selected' : ''}>Day Cab</option></select></label>
      <label>Governed mph<input id="et-gov" type="number" step="1" value="${t.governedMph}"></label>
      <label>Fuel gal<input id="et-fuel" type="number" step="1" value="${t.fuelCapacityGal}"></label>
      <label>Avg mpg<input id="et-mpg" type="number" step="0.1" value="${t.avgMpg}"></label>
      <label>Damage %<input id="et-dmg" type="number" step="0.1" value="${t.damagePct}"></label>
      <label>Status<select id="et-status">${['InService', 'Shop', 'OutOfService', 'Reserve']
        .map((x) => `<option ${t.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Based at yard
        <select id="et-yard">
          ${(S.company.terminals || []).map((y) => {
            const based = S.trucks.filter((x) => x.homeTerminalId === y.id && x.unit !== t.unit).length;
            const full = based >= y.truckCapacity;
            return `<option value="${esc(y.id)}" ${y.id === t.homeTerminalId ? 'selected' : ''} ${full && y.id !== t.homeTerminalId ? 'disabled' : ''}>
              ${esc(y.city)}, ${esc(y.state)} — ${based}/${y.truckCapacity}${full && y.id !== t.homeTerminalId ? ' (full)' : ''}</option>`;
          }).join('')}
        </select></label>
      <label>Company service mi<input id="et-svc" type="number" step="1" value="${Math.round(t.serviceMiles)}"></label>
      <label>ATS odometer<input id="et-odo" type="number" step="1" value="${Math.round(t.atsOdometer)}"></label>
      <label>Last PM at mi<input id="et-lastpm" type="number" step="1" value="${Math.round(t.lastServiceMiles)}"></label>
      <label>PM interval mi<input id="et-pm" type="number" step="500" value="${Math.round(t.serviceIntervalMiles)}"></label>
    </div>
    <label>Notes<input id="et-notes" value="${esc(t.notes)}"></label>
    <div class="row-actions">
      ${isNew ? '' : `<button class="btn danger" data-act="del-truck" data-unit="${esc(unit)}">Remove from fleet</button>`}
      <div style="flex:1"></div>
      <button class="btn primary" data-act="save-truck" data-unit="${esc(unit || '')}" data-new="${isNew ? '1' : ''}">
        ${isNew ? 'Add tractor' : 'Save unit'}</button>
    </div>`);
}

/* Bulk-fill a yard. Starting at one truck is what a fresh profile can afford — it is not a ceiling.
   Upgrade the garage in ATS, re-tier it here, and put a real fleet in it. */
function stockYardModal() {
  const yards = S.company.terminals || [];
  if (!yards.length) return toast('No yards yet — open one on the Terminals tab first.', 'bad');
  const rows = yards.map((y) => {
    const based = S.trucks.filter((t) => t.homeTerminalId === y.id && t.status !== 'OutOfService').length;
    return { ...y, based, room: y.truckCapacity - based };
  });
  const first = rows.find((r) => r.room > 0) || rows[0];

  modal(`<div class="panel-head"><h2>Stock a yard</h2><div class="spacer"></div>
      <button class="btn tiny ghost" data-act="close-modal">Close</button></div>
    <p class="hint">Adds tractors in one step instead of one spec form at a time. A yard holds what its
      tier allows — Small 1, Medium 3, Large 5. Upgrade the garage in ATS, re-tier it on the Terminals
      tab, and it will take more.</p>
    <div class="tablewrap"><table>
      <thead><tr><th>Yard</th><th>Tier</th><th class="num">Based</th><th class="num">Room</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${esc(r.city)}${r.state ? ', ' + esc(r.state) : ''}${r.isHeadquarters ? ' ' + badge('info', 'HQ') : ''}</td>
        <td>${esc(r.level)}</td><td class="num">${r.based}/${r.truckCapacity}</td>
        <td class="num">${r.room > 0 ? r.room : badge('warn', 'full')}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="grid2" style="margin-top:12px">
      <label>Yard<select id="sk-yard">${rows.map((r) =>
        `<option value="${esc(r.id)}" ${r.id === first.id ? 'selected' : ''}>${esc(r.city)} — ${esc(r.level)}, ${r.room} free</option>`).join('')}</select></label>
      <label>How many tractors<input id="sk-count" type="number" min="1" max="5" step="1" value="${Math.max(1, first.room)}"></label>
      <label>Transmission<select id="sk-trans">
        <option value="either">Mixed fleet</option>
        <option value="automatic">All automated</option>
        <option value="manual">All manual</option></select></label>
      <label class="chk" style="margin-top:26px"><input type="checkbox" id="sk-trailers" checked> Add a matching trailer for each</label>
    </div>
    <fieldset><legend>Have you bought these in ATS?</legend>
      <label class="chk"><input type="checkbox" id="sk-bought"> Yes — these units exist in my garage</label>
      <p class="hint">Tick this only for equipment you actually own in game. Ticked units get their damage
        and odometer tracked against ATS; unticked ones sit on the book as company backdrop and never
        get invented damage or a shop directive you could not act on. You can tick them individually
        later as you buy them.</p>
    </fieldset>
    <div class="row-actions">
      <div style="flex:1"></div>
      <button class="btn primary" data-act="do-stock">Stock the yard</button>
    </div>`);
}

function editTrailerModal(unit) {
  const isNew = !unit;
  const t = isNew ? { ...BLANK_TRAILER } : S.trailers.find((x) => x.unit === unit);
  if (!t) return;
  modal(`<div class="panel-head"><h2>${isNew ? 'Add a trailer' : 'Trailer ' + esc(t.unit)}</h2><div class="spacer"></div>
      <button class="btn tiny ghost" data-act="close-modal">Close</button></div>
    ${isNew ? `<label>Unit number<input id="er-unit" placeholder="e.g. T521"></label>` : ''}
    <label>ID shown in ATS — optional
      <input id="er-gameid" value="${esc(t.gameId || '')}" placeholder="what the game calls this trailer"></label>
    <p class="hint">Enter what ATS shows for this trailer and the app uses it everywhere. Blank keeps the
      assigned number, which is what everything is filed against regardless.</p>
    <fieldset><legend>Does ATS know about this trailer?</legend>
      <label class="chk"><input type="checkbox" id="er-garage" ${t.inGameGarage ? 'checked' : ''}>
        This trailer exists in my ATS garage</label>
    </fieldset>
    <div class="grid2">
      <label>Type<input id="er-type" value="${esc(t.type)}"></label>
      <label>If a tanker, which kind
        <select id="er-subtype"><option value="">(not a tanker)</option>
          ${['Fuel', 'Chemical', 'Food Grade', 'Dry Bulk', 'Gas'].map((x) =>
            `<option value="${x}" ${t.subtype === x ? 'selected' : ''}>${x}</option>`).join('')}
        </select></label>
      <label>Division<input id="er-div" value="${esc(t.division)}"></label>
      <label>Make<input id="er-make" value="${esc(t.make)}"></label>
      <label>Year<input id="er-year" type="number" step="1" value="${t.year}"></label>
      <label>Length<input id="er-len" value="${esc(t.length)}"></label>
      <label>Axles<input id="er-axles" value="${esc(t.axles)}"></label>
      <label>Damage %<input id="er-dmg" type="number" step="0.1" value="${t.damagePct}"></label>
      <label>Status<select id="er-status">${['InService', 'Shop', 'OutOfService', 'Reserve']
        .map((x) => `<option ${t.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Service mi<input id="er-svc" type="number" step="1" value="${Math.round(t.serviceMiles)}"></label>
      <label>Location<input id="er-loc" value="${esc(t.currentLocation)}"></label>
    </div>
    <label>Notes<input id="er-notes" value="${esc(t.notes)}"></label>
    <div class="row-actions">
      ${isNew ? '' : `<button class="btn danger" data-act="del-trailer" data-unit="${esc(unit)}">Remove from fleet</button>`}
      <div style="flex:1"></div>
      <button class="btn primary" data-act="save-trailer" data-unit="${esc(unit || '')}" data-new="${isNew ? '1' : ''}">
        ${isNew ? 'Add trailer' : 'Save trailer'}</button>
    </div>`);
}

/* ============================================================ actions */
async function handleAction(act, d, ev) {
  switch (act) {
    case 'tab':
      TAB = d.tab;
      if (location.hash.replace('#', '') !== TAB) location.hash = TAB;
      render();
      if (TAB === 'finance') loadLedger();
      // The hired roster is not in the main snapshot, so fetch it on arrival. It used to sit behind a
      // "Load roster" button, which also hid "Hire a driver" — a primary action nobody could find.
      if (TAB === 'fleet' && !FLEETOPS) loadFleetOps();
      return;
    case 'close-modal': return closeModal();
    case 'clear-audit': TRIP_AUDIT = null; return render();

    /* ---- status & HOS */
    case 'save-status': return run(async () => {
      const r = absorb(await api('/status', 'POST', {
        locationCity: sv('st-city'), locationState: sv('st-state'), locationKind: sv('st-kind'),
        locationDetail: sv('st-detail'), gameTime: readDayTime('st-time'), fuelPct: fv('st-fuel'),
        truckDamagePct: fv('st-tdmg'), trailerDamagePct: fv('st-trdmg'), atsOdometer: fv('st-odo'),
        // Blank means "not reported", not "zero". Sending 0 for an untouched box made the app
        // believe the game held nothing and warn about a mismatch against its own correct figure.
        dutyStatus: sv('st-duty'), atsBankBalance: fvn('st-bank'),
      }));
      DISCOVERY = r.discovery || null;
      afterStatus(r);
      return r;
    });

    /* Nothing has moved since the last close-out, so re-post what is already on screen. Cheaper for
       the driver than retyping six fields that the delivery report already told us. */
    case 'confirm-status': return run(async () => {
      const r = absorb(await api('/status', 'POST', {
        locationCity: S.status.locationCity, locationState: S.status.locationState,
        locationKind: S.status.locationKind, locationDetail: S.status.locationDetail,
        gameTime: S.status.gameTime, fuelPct: S.status.fuelPct,
        truckDamagePct: S.status.truckDamagePct, trailerDamagePct: S.status.trailerDamagePct,
        atsOdometer: S.status.atsOdometer, dutyStatus: S.status.dutyStatus,
        atsBankBalance: S.status.atsBankBalance,
      }));
      DISCOVERY = r.discovery || null;
      afterStatus(r, 'Confirmed.');
      return r;
    });

    case 'ask-home': return run(async () => {
      const r = await api('/career/request-home', 'POST', { reason: sv('hr-reason') });
      absorb(r);
      toast(r.message, 'ok');
    });
    case 'ask-trailer': return run(async () => {
      const r = await api('/career/request-trailer', 'POST', { trailerType: sv('tr-type') });
      absorb(r);
      toast(r.message, 'ok');
    });
    case 'set-endorsement': return run(async () => {
      const r = await api('/career/endorsement', 'POST',
        { kind: d.kind, has: d.has === '1', gameTime: S.status.gameTime });
      absorb(r);
      toast(r.message, 'ok');
    });
    case 'save-home-time': return run(async () => absorb(await api('/career/home-time', 'POST',
      { preference: sv('ht-pref') })), 'Home-time arrangement updated.');

    /* ---- city discovery */
    case 'decline-garage': return run(async () => {
      absorb(await api('/discovery/decline', 'POST', { city: d.city, state: d.state }));
      DISCOVERY = null;
    }, 'Noted — I will stop suggesting it.');

    case 'save-hos': {
      // "8:30 in 1" and "8.5 in 1" both mean the same thing to a driver, so both are read.
      const recap = sv('h-recap').split(',').map((p) => {
        const m = p.match(/(\d+)\s*:\s*(\d+)\s*in\s*(\d+)/i);
        if (m) return { hours: (+m[1]) + (+m[2]) / 60, inDays: parseInt(m[3], 10) };
        const dec = p.match(/([\d.]+)\s*in\s*(\d+)/i);
        return dec ? { hours: parseFloat(dec[1]), inDays: parseInt(dec[2], 10) } : null;
      }).filter(Boolean);
      const breakLeft = S.views.hos.breakEnforced ? hv('h-break') : S.settings.hos.drivingBeforeBreak;
      return run(async () => {
        absorb(await api('/hos', 'POST', {
          driveRemaining: hv('h-drive'), shiftRemaining: hv('h-shift'),
          breakRemaining: breakLeft, cycleRemaining: hv('h-cycle'),
          recap, source: sv('h-source'), notes: sv('h-notes'), asOfGameTime: readDayTime('st-time') || S.status.gameTime,
        }));
        // A hand correction supersedes the screenshot receipt, and its undo no longer applies.
        HOSREAD = null; HOSWAS = null;
      }, 'Clocks recorded.');
    }

    /* ---- board */
    case 'board-stage': BOARD_STAGE = d.stage; return render();
    case 'board-add': {
      const load = {
        cargo: sv('b-cargo') || 'Freight', trailerType: sv('b-trailer'),
        atLocation: BOARD_STAGE === 'local',
        originCity: sv('b-ocity'), originState: sv('b-ostate'),
        destCity: sv('b-dcity'), destState: sv('b-dstate'),
        loadedMiles: fv('b-miles'), deadheadMiles: fv('b-dh'),
        gameRevenue: fv('b-rev'), deadlineHours: hv('b-deadline'),
        appointmentOpensHours: hv('b-opens'),
        weightLbs: fv('b-weight'), navEstimateHours: hvn('b-nav'),
        hazmatClass: sv('b-hazclass'),
        shipper: sv('b-shipper'), receiver: sv('b-receiver'),
        extraStops: fv('b-stops'), broker: sv('b-broker'),
        isUrgent: bv('b-urgent'), isFragile: bv('b-fragile'), isHazmat: bv('b-hazmat'),
        isOversize: bv('b-oversize'), requiresTarp: bv('b-tarp'),
      };
      if (!load.destCity) return toast('Destination city is required.', 'bad');
      return run(async () => {
        DECISION = await api('/board/add', 'POST', load);
        absorb(await api('/bootstrap'));
      }, 'Load added to the board.');
    }
    case 'board-del': return run(async () => {
      DECISION = await api('/board/' + d.id, 'DELETE');
      absorb(await api('/bootstrap'));
    });
    case 'board-clear': return run(async () => {
      DECISION = await api('/board/clear', 'POST', {});
      absorb(await api('/bootstrap'));
    }, 'Board cleared.');
    case 'board-eval': return run(async () => { DECISION = await api('/board/evaluate'); });

    /* ---- screenshot import */
    case 'shot-del': SHOTS.splice(+d.i, 1); return render();
    case 'shots-clear': SHOTS = []; EXTRACT = null; return render();
    case 'hosread-drop': HOSREAD = null; HOSWAS = null; return render();

    case 'hosread-undo':
      if (!HOSWAS) return;
      return run(async () => {
        absorb(await api('/hos/undo', 'POST', HOSWAS));
        HOSREAD = null; HOSWAS = null;
      }, 'Previous clocks are back on file.');

    case 'extract-hos': {
      if (!SHOTS.length) return toast('Paste your GDC Companion recap page first.', 'bad');
      BUSY = 'hosread'; render();
      toast('Reading your recap page — this takes a few seconds.');
      try {
        const res = await api('/hos/extract', 'POST', {
          images: SHOTS.map((s) => ({ mediaType: s.mediaType, dataBase64: s.dataBase64 })),
        });
        if (!res.reading?.ok) { HOSREAD = null; HOSWAS = null; toast(res.reading?.error || 'Could not read that.', 'bad'); return; }
        HOSREAD = res.reading;
        HOSWAS = res.previous;
        SHOTS = [];
        absorb(res);
        const kept = (res.reading.kept || []).length;
        toast(kept
          ? `Clocks entered, but ${kept} could not be read — check the boxes below.`
          : 'Clocks and recap entered from your recap page.', kept ? 'bad' : 'ok');
      } catch (e) {
        HOSREAD = null; HOSWAS = null;
        toast(e.message, 'bad');
      } finally {
        BUSY = ''; render();
      }
      return;
    }

    case 'extract': {
      if (!SHOTS.length) return toast('Stage a screenshot first.', 'bad');
      BUSY = 'extract'; render();
      toast('Reading the board — this takes a few seconds.');
      try {
        EXTRACT = await api('/board/extract', 'POST', {
          images: SHOTS.map((s) => ({ mediaType: s.mediaType, dataBase64: s.dataBase64 })),
        });
        if (EXTRACT.ok) toast(`Read ${EXTRACT.loads.length} row(s) — check them before they go on the board.`, 'ok');
        else toast(EXTRACT.error, 'bad');
      } catch (e) {
        EXTRACT = { ok: false, error: e.message, loads: [] };
        toast(e.message, 'bad');
      } finally {
        BUSY = ''; render();
      }
      return;
    }

    case 'extract-cancel': EXTRACT = null; return render();

    case 'extract-commit': {
      const rows = EXTRACT?.loads || [];
      const chosen = [];
      const rejected = [];
      rows.forEach((l, i) => {
        if (!bv(`x-use-${i}`)) return;
        const load = {
          cargo: sv(`x-cargo-${i}`) || 'Freight',
          originCity: sv(`x-ocity-${i}`), originState: sv(`x-ostate-${i}`),
          destCity: sv(`x-dcity-${i}`), destState: sv(`x-dstate-${i}`),
          loadedMiles: fv(`x-miles-${i}`), gameRevenue: fv(`x-rev-${i}`),
          deadlineHours: hv(`x-dl-${i}`), weightLbs: fv(`x-wt-${i}`),
          hazmatClass: l.hazmatClass || '',
          trailerType: sv(`x-trailer-${i}`),
          shipper: l.shipper || '', receiver: l.receiver || '',
          deadheadMiles: 0, extraStops: 0,
          isUrgent: !!l.isUrgent, isFragile: !!l.isFragile, isHazmat: !!l.isHazmat,
          notes: 'Imported from screenshot',
        };
        // Refuse to stage a load the engine cannot evaluate — a silent 0 would read as free freight.
        if (!load.destCity || load.loadedMiles <= 0 || load.gameRevenue <= 0 || load.deadlineHours <= 0) {
          rejected.push(`row ${i + 1} (${load.cargo || 'unnamed'})`);
          return;
        }
        chosen.push(load);
      });

      if (!chosen.length) {
        return toast(rejected.length
          ? `Nothing added — ${rejected.length} row(s) are still missing destination, miles, revenue or the delivery window.`
          : 'No rows ticked.', 'bad');
      }

      return run(async () => {
        for (const load of chosen) DECISION = await api('/board/add', 'POST', load);
        absorb(await api('/bootstrap'));
        EXTRACT = null; SHOTS = [];
        toast(rejected.length
          ? `${chosen.length} load(s) added. Skipped ${rejected.join(', ')} — incomplete.`
          : `${chosen.length} load(s) added to the board.`, 'ok');
      });
    }

    case 'authorize': return run(async () => {
      const r = absorb(await api('/dispatch/authorize', 'POST',
        { loadId: d.id, rationale: null, overrideTight: d.force === '1' }));
      DECISION = null; TAB = 'active';
      toast(`${r.trip.number} authorized.`, 'ok');
    });

    case 'request-alt': {
      const e = DECISION?.evaluations.find((x) => x.load.id === d.id);
      if (!e) return;
      const why = prompt(`Ask dispatch for the ${e.load.cargo} to ${e.load.destCity}, ${e.load.destState} instead.\n\nWhy do you want it?`);
      if (why === null) return;
      return run(async () => {
        const r = absorb(await api('/dispatch/request-alternate', 'POST', { loadId: d.id, reason: why }));
        toast(r.message, '');
      });
    }

    case 'reject-all': return run(async () => {
      absorb(await api('/dispatch/reject-all', 'POST', { reason: DECISION?.rationale || 'Nothing operationally sensible on the board.' }));
      DECISION = null;
    }, 'Board rejected and logged.');

    /* ---- moves */
    case 'show-move': return moveModal();
    case 'create-move': {
      if (!sv('mv-city')) return toast('Where am I going?', 'bad');
      const body = { kind: sv('mv-kind'), destCity: sv('mv-city'), destState: sv('mv-state'), miles: fv('mv-miles'), reason: sv('mv-reason') };
      return run(async () => {
        const r = absorb(await api('/moves', 'POST', body));
        closeModal(); TAB = 'active';
        toast(`${r.trip.number} authorized.`, 'ok');
      });
    }

    /* ---- trips */
    case 'trip-detail': return tripDetailModal(d.id);
    case 'log-event': {
      const gal = fv('ev-gal'), price = fv('ev-price');
      return run(async () => {
        const r = absorb(await api(`/trips/${d.id}/event`, 'POST', {
          gameTime: readDayTime('ev-time'), kind: sv('ev-kind'),
          // The event type and time are the record; a detail is only worth having when there is one.
          detail: sv('ev-detail') || (gal > 0 ? `Fuelled ${num(gal, 1)} gal` : sv('ev-kind')),
          city: sv('ev-city'), state: sv('ev-state'),
          gallons: gal, pricePerGal: price, cost: 0,
        }));
        toast(gal > 0 && sv('ev-kind') === 'Fuel'
          ? `Logged — ${gal} gal added to the close-out.` : 'Logged.', 'ok');
        return r;
      });
    }

    /* Fuel stops: harvest what is typed before changing the row count, or the other rows blank out. */
    case 'add-fuel-row': {
      harvestFuel();
      FUEL.rows.push({ gallons: 0, pricePerGal: 0, city: S.status.locationCity, state: S.status.locationState });
      return render();
    }
    case 'del-fuel-row': {
      harvestFuel();
      FUEL.rows.splice(+d.i, 1);
      return render();
    }

    case 'complete-trip': return run(async () => {
      const r = await api(`/trips/${d.id}/complete`, 'POST', {
        deliveredGameTime: readDayTime('c-time'), deliveredLate: bv('c-late') ? true : null,
        actualMiles: fv('c-miles'), endOdometer: fv('c-odo'), actualRevenue: fv('c-rev') || null,
        fuelStops: harvestFuel(), tolls: fv('c-tolls'),
        repairCost: fv('c-repair'), fines: fv('c-fines'), otherExpense: fv('c-other'),
        truckDamageAfter: fv('c-tdmg'), trailerDamageAfter: fv('c-trdmg'), cargoDamagePct: fv('c-cargo'),
        loadingHours: hv('c-load'), unloadingHours: hv('c-unload'), detentionHours: hv('c-det'),
        layoverDays: fv('c-lay'), breakdownDays: fv('c-bd'), extraStops: fv('c-stops'), tarpsUsed: fv('c-tarps'),
        delayReason: sv('c-delay'), damageCause: sv('c-dmgcause'), notes: sv('c-notes'),
        locationKind: 'Receiver', fuelPct: fv('c-fuelpct'), gameTime: readDayTime('c-time'),
        hosDriveRemaining: hvn('c-hdrive'), hosShiftRemaining: hvn('c-hshift'),
        hosBreakRemaining: hvn('c-hbreak'), hosCycleRemaining: hvn('c-hcycle'),
      });
      absorb(r); TRIP_AUDIT = r.audit;
      FUEL = { tripId: null, seeded: 0, rows: [] };
      // New dock, new starting point: show me what is going out from here before the whole city.
      BOARD_STAGE = 'local';
      // The audit belongs in front of the driver the moment the load closes, not sitting on a tab
      // until they have already taken the next one.
      auditModal(r.audit);
    });
    case 'show-cancel': return cancelModal(d.id);
    case 'do-cancel': return run(async () => {
      absorb(await api(`/trips/${d.id}/cancel`, 'POST',
        { reason: sv('cx-reason'), fault: sv('cx-fault'), chargeCompany: bv('cx-charge') }));
      closeModal();
    }, 'Load cancelled.');

    /* ---- fleet */
    case 'trim-fleet': {
      const yards = d.yards === '1';
      if (!confirm(yards
        ? 'Remove on-paper equipment AND close yards in cities you have not reached?\n\nA snapshot is kept in backups.'
        : 'Remove equipment that is not in your ATS garage?\n\nA snapshot is kept in backups.')) return;
      return run(async () => {
        const r = absorb(await api('/fleet/trim', 'POST', { includeYards: yards }));
        toast((r.notes || ['Trimmed.']).join(' '), 'ok');
      });
    }
    case 'assign': return run(async () => absorb(await api('/fleet/assign', 'POST',
      { truckUnit: sv('as-truck'), trailerUnit: sv('as-trailer'), force: false })), 'Equipment assigned.');
    /* ---- equipment orders & swaps */
    case 'complete-eq': return run(async () => {
      const r = absorb(await api(`/equipment/orders/${encodeURIComponent(d.num)}/complete`, 'POST', {}));
      toast(r.message || 'Equipment order closed.', 'ok');
    });
    case 'decline-eq': return run(async () => {
      const why = prompt('Why are you not taking this equipment change?') ?? '';
      const r = absorb(await api(`/equipment/orders/${encodeURIComponent(d.num)}/decline`, 'POST', { notes: why }));
      toast(r.message, '');
    });
    case 'swap-trailer': return run(async () => {
      const r = absorb(await api('/equipment/swap', 'POST', { trailerUnit: d.unit, force: false }));
      DECISION = await api('/board/evaluate');
      toast(r.message, 'ok');
    });
    case 'equip-move': {
      const miles = prompt(`How many miles to ${d.where} to collect trailer ${d.unit}?`, '0');
      if (miles === null) return;
      return run(async () => {
        const r = absorb(await api('/equipment/move', 'POST',
          { trailerUnit: d.unit, miles: parseFloat(miles) || 0, reason: '' }));
        DECISION = null; TAB = 'active';
        toast(`${r.trip.number} authorized — collect ${d.unit} at ${d.where}.`, 'ok');
      });
    }

    case 'true-up': return run(async () => {
      const r = absorb(await api('/finance/true-up', 'POST', { notes: '' }));
      loadLedger();
      toast(r.message, 'ok');
    });

    /* ---- cost model */
    case 'calibrate': return run(async () => { CALIB = await api('/economics/calibrate'); });
    case 'apply-calibration': return run(async () => {
      const r = absorb(await api('/economics/apply', 'POST', {
        overheadPerLoad: fv('cal-oh'), fuelPricePerGal: fv('cal-fuel'),
        marginGoal: fv('cal-margin'), useManualThresholds: bv('cal-manual'),
      }));
      CALIB = r.calibration;
      toast(`Break-even $${(+r.before.breakEvenRpm).toFixed(2)} → $${(+r.after.breakEvenRpm).toFixed(2)}/mi.`, 'ok');
    });

    /* ---- hired fleet */
    case 'goto-fleet': TAB = 'fleet';
      return run(async () => { FLEETOPS = await api('/fleetops'); });
    case 'load-fleetops': return run(async () => { FLEETOPS = await api('/fleetops'); });
    case 'terminate-driver': {
      const why = prompt(`Terminate ${d.name}?\n\nWhat goes on the file?`, 'Sustained poor performance.');
      if (why === null) return;
      return run(async () => {
        const r = absorb(await api('/fleetops/terminate', 'POST', { driverId: d.id, reason: why }));
        FLEETOPS = await api('/fleetops');
        toast(`${d.name} terminated. Unit ${r.change.truckUnit || ''} is open.`, 'ok');
      });
    }
    case 'keep-driver': return toast(`${d.name} stays on. It will come up again if the numbers do not improve.`, '');
    case 'retire-unit': {
      const mine = d.mine === '1';
      const rep = prompt(mine
        ? `Trade unit ${d.unit}.\n\nLeave blank and the company puts you in the best spare on the property.\nOr type the unit number of a replacement you have bought and added on the Fleet tab.`
        : `Trade unit ${d.unit}.\n\nLeave blank to retire it with nobody moving.\nOr type the unit number of its replacement.`, '');
      if (rep === null) return;
      return run(async () => {
        const r = absorb(await api('/fleetops/retire', 'POST', { unit: d.unit, replacementUnit: rep.trim() }));
        FLEETOPS = await api('/fleetops');
        toast(r.message, 'ok');
      });
    }
    case 'take-unit': return run(async () => {
      absorb(await api('/fleet/assign', 'POST', { truckUnit: d.unit, trailerUnit: null, force: false }));
      FLEETOPS = await api('/fleetops');
    }, 'You are in that unit now.');
    case 'add-hire': return editHireModal('');
    case 'edit-hire': return editHireModal(d.id);
    case 'save-hire': {
      const isNew = d.new === '1';
      if (!sv('hd-name')) return toast('The driver needs a name.', 'bad');
      const base = isNew ? {} : (FLEETOPS?.drivers || []).find((x) => x.id === d.id) || {};
      return run(async () => {
        absorb(await api('/fleetops/drivers', 'POST', {
          ...base, id: d.id || '', name: sv('hd-name'),
          assignedTruckUnit: sv('hd-truck'), assignedTrailerUnit: sv('hd-trailer'),
          skill: sv('hd-skill'), status: sv('hd-status'), wageShare: fv('hd-wage'),
          homeTerminalId: sv('hd-terminal'), notes: sv('hd-notes'),
        }));
        FLEETOPS = await api('/fleetops');
        closeModal();
      }, isNew ? 'Driver added to the roster.' : 'Driver saved.');
    }
    case 'del-hire': {
      if (!confirm('Remove this driver from the roster? Their filed reports stay on the books.')) return;
      return run(async () => {
        absorb(await api('/fleetops/drivers/' + encodeURIComponent(d.id), 'DELETE'));
        FLEETOPS = await api('/fleetops');
        closeModal();
      }, 'Driver removed.');
    }
    case 'ask-better-unit': {
      return run(async () => {
        const r = await api('/equipment/ask-better-unit', 'POST', {});
        absorb(r);
        toast(r.message, r.granted ? 'ok' : 'bad');
        closeModal();
      });
    }
    case 'restart-arrived': {
      return run(async () => absorb(await api('/restart/arrived', 'POST', {
        gameTime: readDayTime('rs-arr'), city: sv('rs-city'), state: sv('rs-state'),
      })), 'Clock started on the restart.');
    }
    case 'restart-complete': {
      return run(async () => {
        const r = await api('/restart/complete', 'POST', { gameTime: readDayTime('rs-done') });
        absorb(r);
        toast(r.message, r.accepted ? 'ok' : 'bad');
      });
    }
    case 'reached-page': {
      REACHED_PAGE = Math.max(1, +d.page || 1);
      return render();
    }
    case 'fix-window': {
      const hrs = hv('wf-hours');
      if (hrs <= 0) return toast('Give me the time to deliver from the ATS job screen.', 'bad');
      return run(async () => absorb(await api(`/trips/${d.id}/window`, 'POST', {
        deadlineHours: hrs, note: sv('wf-note'),
      })), 'Window corrected.');
    }
    case 'trailer-bought': {
      const unit = sv('tq-unit').trim();
      if (!unit) return toast('Give the trailer a unit number.', 'bad');
      return run(async () => {
        absorb(await api('/fleetops/trailer-request/confirm', 'POST', {
          requestId: d.id, unit, gameId: sv('tq-gameid'),
          paidPrice: fv('tq-price'), gameTime: readDayTime('tq-time'),
        }));
        FLEETOPS = await api('/fleetops');
      }, `Trailer ${unit} added to the fleet.`);
    }
    case 'trailer-declined': {
      return run(async () => {
        absorb(await api('/fleetops/trailer-request/decline', 'POST', { requestId: d.id }));
        FLEETOPS = await api('/fleetops');
      }, 'Noted — I will not ask about that one again.');
    }
    case 'file-report': {
      const active = (FLEETOPS?.drivers || []).filter((x) => x.status === 'Active');
      const lines = active.map((x) => ({
        driverId: x.id, truckUnit: x.assignedTruckUnit, trailerUnit: x.assignedTrailerUnit,
        // What the game shows for a driver we are not sitting next to.
        level: fv('fr-lvl-' + x.id), rating: fv('fr-rate-' + x.id),
        perMile: fv('fr-permi-' + x.id), perDay: fv('fr-perday-' + x.id),
        // And for the equipment: stars, plus an odometer on the tractor only.
        truckStars: fv('fr-tstar-' + x.id), truckOdometer: fv('fr-odo-' + x.id),
        trailerStars: fv('fr-lstar-' + x.id),
        trailerDueBackGameTime: readDayTime('fr-due-' + x.id),
        revenue: fv('fr-rev-' + x.id), miles: fv('fr-mi-' + x.id),
        wages: fv('fr-wage-' + x.id), repairs: fv('fr-rep-' + x.id),
      })).filter((l) => l.revenue > 0 || l.miles > 0 || l.repairs > 0
                        || l.perDay > 0 || l.perMile > 0 || l.truckStars > 0);
      if (!lines.length) return toast('Nothing to report — enter at least the $/day or $/mile for one driver.', 'bad');
      return run(async () => {
        const r = absorb(await api('/fleetops/report', 'POST', {
          periodStartGame: readDayTime('fr-start'), periodEndGame: readDayTime('fr-end'),
          notes: sv('fr-note'), lines,
        }));
        FLEETOPS = await api('/fleetops');
        toast(`${r.report.number} filed — net ${money(r.report.netContribution)}.`, 'ok');
      });
    }

    /* ---- job market */
    case 'load-market': return run(async () => { MARKET = (await api('/market')).market; });
    case 'apply-move': {
      const c = (MARKET || []).find((x) => x.code === d.code);
      const name = c ? c.name : d.code;
      const reason = prompt(`Resign from ${S.company.name} and apply to ${name}?\n\n` +
        `Your record follows you. The company's books, equipment and trip history do not — ` +
        `you start a fresh probation there.\n\nReason for leaving (optional):`);
      if (reason === null) return;
      return run(async () => {
        const r = await api('/market/apply', 'POST', { code: d.code, reason });
        if (!r.hired) {
          MARKET = (await api('/market')).market;
          toast(`${name} declined your application.`, 'bad');
          return;
        }
        absorb(r); MARKET = null; TAB = 'career';
        toast(`Hired at ${S.company.name}. Fresh probation, new equipment.`, 'ok');
        modal(`<div class="panel-head"><h2>Welcome to ${esc(S.company.name)}</h2><div class="spacer"></div>
            <button class="btn tiny ghost" data-act="close-modal">Close</button></div>
          <div class="callout go"><h4>${esc(r.decision.decision)}</h4>
            ${r.decision.reasons.map((x) => `<p>${esc(x)}</p>`).join('')}
            ${r.decision.conditions.length ? `<ul>${r.decision.conditions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>
          ${setupChecklistHtml(r.setup)}`);
      });
    }

    /* ---- terminals */
    case 'add-terminal': return editTerminalModal('');
    case 'edit-terminal': return editTerminalModal(d.id);
    case 'save-terminal': {
      const isNew = d.new === '1';
      const base = isNew ? {} : (S.company.terminals || []).find((x) => x.id === d.id) || {};
      if (!sv('tm-city')) return toast('A yard needs a city.', 'bad');
      const levelChanged = !isNew && base.level !== sv('tm-level');
      return run(async () => {
        const saved = absorb(await api('/terminals', 'POST', {
          ...base, id: d.id || '', city: sv('tm-city'), state: sv('tm-state'), level: sv('tm-level'),
          truckCapacity: fv('tm-cap'), fuelPricePerGal: fv('tm-fuel'),
          shopLabourDiscount: fv('tm-shopdisc'), monthlyCost: fv('tm-cost'),
          hasFuel: bv('tm-hasfuel'), hasShop: bv('tm-hasshop'), hasParking: bv('tm-park'),
          hasTrailerDrop: bv('tm-drop'), hasDriverFacilities: bv('tm-fac'), notes: sv('tm-notes'),
        }));
        // Re-tiering resets services to that tier's defaults, which is the point of a tier.
        if (levelChanged || isNew) {
          const id = d.id || (S.company.terminals.find((x) => x.city === sv('tm-city'))?.id);
          if (id && levelChanged) absorb(await api(`/terminals/${id}/level`, 'POST', { level: sv('tm-level') }));
        }
        closeModal();
        // A yard in a city the driver has not driven to will not see cargo — say so, but allow it.
        if (saved && saved.warning) toast(saved.warning, 'bad');
        else toast(isNew ? 'Yard opened.' : 'Yard saved.', 'ok');
      });
    }
    case 'del-terminal': {
      if (!confirm('Close this yard? Trucks based there keep their history.')) return;
      return run(async () => { absorb(await api('/terminals/' + encodeURIComponent(d.id), 'DELETE')); closeModal(); }, 'Yard closed.');
    }
    case 'make-hq': return run(async () => {
      absorb(await api(`/terminals/${encodeURIComponent(d.id)}/headquarters`, 'POST', {}));
      closeModal();
    }, 'Headquarters moved.');

    case 'request-transfer': return run(async () => {
      const r = absorb(await api('/terminals/transfer', 'POST',
        { terminalId: sv('tr-target'), reason: sv('tr-reason') }));
      toast(`${r.request.outcome}: ${r.request.decision}`,
        r.request.outcome === 'Approved' ? 'ok' : r.request.outcome === 'Denied' ? 'bad' : '');
    });
    case 'settle-transfer': return run(async () => {
      const r = absorb(await api(`/terminals/transfer/${encodeURIComponent(d.id)}/settle`, 'POST', {}));
      toast(r.message, '');
    });

    case 'edit-truck': return editTruckModal(d.unit);
    case 'edit-trailer': return editTrailerModal(d.unit);
    case 'add-truck': return editTruckModal('');
    case 'add-trailer': return editTrailerModal('');
    case 'stock-yard': return stockYardModal();
    case 'do-stock': return run(async () => {
      const r = absorb(await api('/fleet/stock', 'POST', {
        terminalId: sv('sk-yard'), count: fv('sk-count'), alreadyBought: bv('sk-bought'),
        transmissionPreference: sv('sk-trans'), addTrailers: bv('sk-trailers'),
      }));
      closeModal();
      toast(r.result.message, 'ok');
    });

    case 'save-truck': {
      const isNew = d.new === '1';
      const unit = isNew ? sv('et-unit') : d.unit;
      if (!unit) return toast('A tractor needs a unit number.', 'bad');
      if (isNew && S.trucks.some((x) => x.unit.toLowerCase() === unit.toLowerCase()))
        return toast(`Unit ${unit} is already in the fleet.`, 'bad');
      const base = isNew ? { ...BLANK_TRUCK, homeTerminal: `${S.company.terminalCity}, ${S.company.terminalState}` }
        : S.trucks.find((x) => x.unit === d.unit);
      return run(async () => {
        absorb(await api('/fleet/truck', 'POST', {
          ...base, unit,
          make: sv('et-make'), model: sv('et-model'), year: fv('et-year'),
          engine: sv('et-engine'), transmission: sv('et-trans'), transmissionType: sv('et-ttype'),
          cabConfig: sv('et-cab'), governedMph: fv('et-gov'), fuelCapacityGal: fv('et-fuel'),
          avgMpg: fv('et-mpg'), damagePct: fv('et-dmg'), status: sv('et-status'),
          inGameGarage: bv('et-garage'), homeTerminalId: sv('et-yard'),
          gameId: sv('et-gameid'),
          serviceMiles: fv('et-svc'), atsOdometer: fv('et-odo'),
          lastServiceMiles: fv('et-lastpm'), serviceIntervalMiles: fv('et-pm'), notes: sv('et-notes'),
        }));
        closeModal();
      }, isNew ? `Unit ${unit} added to the fleet.` : 'Unit saved.');
    }

    case 'save-trailer': {
      const isNew = d.new === '1';
      const unit = isNew ? sv('er-unit') : d.unit;
      if (!unit) return toast('A trailer needs a unit number.', 'bad');
      if (isNew && S.trailers.some((x) => x.unit.toLowerCase() === unit.toLowerCase()))
        return toast(`Trailer ${unit} is already in the fleet.`, 'bad');
      const base = isNew ? { ...BLANK_TRAILER, homeTerminal: `${S.company.terminalCity}, ${S.company.terminalState}` }
        : S.trailers.find((x) => x.unit === d.unit);
      return run(async () => {
        absorb(await api('/fleet/trailer', 'POST', {
          ...base, unit,
          type: sv('er-type'), subtype: sv('er-subtype'), division: sv('er-div'),
          make: sv('er-make'), year: fv('er-year'),
          length: sv('er-len'), axles: sv('er-axles'), damagePct: fv('er-dmg'), status: sv('er-status'),
          inGameGarage: bv('er-garage'),
          gameId: sv('er-gameid'),
          serviceMiles: fv('er-svc'), currentLocation: sv('er-loc'), notes: sv('er-notes'),
        }));
        closeModal();
      }, isNew ? `Trailer ${unit} added to the fleet.` : 'Trailer saved.');
    }

    case 'del-truck': {
      if (!confirm(`Remove unit ${d.unit} from the fleet? Trip history keeps referencing it.`)) return;
      return run(async () => { absorb(await api('/fleet/truck/' + encodeURIComponent(d.unit), 'DELETE')); closeModal(); },
        `Unit ${d.unit} removed.`);
    }
    case 'del-trailer': {
      if (!confirm(`Remove trailer ${d.unit} from the fleet? Trip history keeps referencing it.`)) return;
      return run(async () => { absorb(await api('/fleet/trailer/' + encodeURIComponent(d.unit), 'DELETE')); closeModal(); },
        `Trailer ${d.unit} removed.`);
    }

    /* ---- payroll & money */
    case 'show-stub': {
      const st = S.settlements.find((x) => x.number === d.num);
      if (!st) return;
      return modal(`<div class="panel-head"><h2>Pay stub — ${esc(st.number)}</h2>
          ${st.trigger === 'JobChange' ? badge('violet', 'final settlement') : badge('ok', 'payday')}
          <div class="spacer"></div>
          <button class="btn tiny ghost" data-act="close-modal">Close</button></div>
        <p class="sub">${esc(S.driver.name)} · ${esc(S.driver.rankTitle)} · period ${gt(st.periodStartGame)}
          to ${gt(st.periodEndGame)}${st.notes ? ' · ' + esc(st.notes) : ''}</p>
        ${stubTableHtml(st)}
        <div class="row-actions"><div style="flex:1"></div>
          <button class="btn primary" data-act="close-modal">Close</button></div>`);
    }
    case 'post-entry': {
      if (!fv('le-amt')) return toast('Amount cannot be zero.', 'bad');
      return run(async () => { absorb(await api('/finance/entry', 'POST', {
        accountKey: sv('le-acct'), amount: fv('le-amt'), category: sv('le-cat'),
        memo: sv('le-memo'), tripNumber: sv('le-trip'),
      })); loadLedger(); }, 'Entry posted.');
    }
    case 'reconcile': return run(async () => { RECON = await api('/finance/reconcile'); });
    case 'apply-recon': return run(async () => {
      RECON = (await api('/finance/reconcile/apply', 'POST', {
        account: sv('rc-acct'), amount: fv('rc-amt'), memo: sv('rc-memo'),
        fixUnsettledPay: bv('rc-fixpay') && d.pay !== '' ? parseFloat(d.pay) : null,
        fixFreightCounter: null,
      }).then((r) => { absorb(r); return r.reconciliation; }));
      loadLedger();
    }, 'Adjustment applied.');

    case 'set-balance': {
      const v = fvn('pos-bank');
      if (v === null) return toast('Type the balance your game shows.', 'bad');
      return run(async () => {
        absorb(await api('/finance/balance', 'POST', { balance: v, gameTime: null }));
        loadLedger();
      }, 'Balance recorded.');
    }
    case 'clear-balance': return run(async () => {
      absorb(await api('/finance/balance', 'POST', { balance: null, gameTime: null }));
      loadLedger();
    }, 'Balance cleared — treated as unreported.');

    /* ---- maintenance */
    case 'report-loaded': {
      return run(async () => {
        const r = absorb(await api(`/trips/${d.id}/loaded`, 'POST', {
          weightLbs: fvn('ld-weight'),
          trailerDamagePct: fvn('ld-trdmg'),
          odometer: fvn('ld-odo'),
        }));
        toast((r.notes || []).join(' ') || 'Reported.', 'ok');
      });
    }
    case 'write-off': {
      const u = d.unit;
      if (!confirm(`Write unit ${u} off? It leaves the fleet permanently and the insurance claim is filed. `
        + `Your career is snapshotted on every save, so this is recoverable — but it is meant to be final.`)) return;
      return run(async () => {
        const r = absorb(await api('/maintenance/writeoff', 'POST', {
          unit: u,
          driverFault: bv(`wo-fault-${u}`),
          scrapRecovery: fv(`wo-scrap-${u}`),
          notes: sv(`wo-note-${u}`),
        }));
        const w = r.writeOff;
        modal(`<div class="panel-head"><h2>Unit ${esc(w.unit)} written off</h2>
            <div class="spacer"></div>
            <button class="btn tiny ghost" data-act="close-modal">Close</button></div>
          <div class="callout stop">
            ${w.instructions.map((x) => `<p>${esc(x)}</p>`).join('')}
          </div>
          <div class="meters">
            ${fkpi('Insurance', money(w.insurancePayout))}
            ${fkpi('Deductible', money(-w.deductible), w.driverFault ? 'bad' : '')}
            ${fkpi('Scrap', money(w.scrapRecovery))}
            ${fkpi('Net recovery', money(w.netRecovery), w.netRecovery >= 0 ? 'ok' : 'bad')}
          </div>`);
      });
    }
    case 'create-wo': {
      if (!sv('wo-desc')) return toast('Describe what needs doing.', 'bad');
      const leaveOpen = bv('wo-open');
      // Send the cost either way. The server keeps it as an estimate on an open order rather than
      // throwing it away, so what was typed is never silently lost.
      return run(async () => {
        const r = absorb(await api('/maintenance/workorder', 'POST', {
          unit: sv('wo-unit'), unitKind: sv('wo-kind2'), kind: sv('wo-type'),
          description: sv('wo-desc'), vendor: sv('wo-vendor'),
          locationCity: sv('wo-city'), locationState: sv('wo-state'),
          cost: fv('wo-cost'), damageBefore: fv('wo-dmgb'),
          damageAfter: leaveOpen ? fv('wo-dmgb') : fv('wo-dmga'),
          odometerAtService: fv('wo-odo'), paidBy: sv('wo-paid'),
          status: leaveOpen ? 'Open' : 'Completed',
        }));
        const w = r.workOrder;
        toast(leaveOpen
          ? `${w.number} opened${w.estimatedCost > 0 ? ` — ${money(w.estimatedCost)} quoted, not yet posted` : ''}.`
          : `${w.number} closed — ${money(w.cost)} posted.`, 'ok');
      });
    }
    case 'close-wo': {
      const cost = fv('cw-cost-' + d.num);
      if (cost <= 0 && !confirm('Close this work order with no cost?\n\nNothing will be posted to the books '
        + 'and the repair will read as free. Cancel and enter what it cost if that is not right.')) return;
      return run(async () => absorb(await api(`/maintenance/workorder/${encodeURIComponent(d.num)}/complete`, 'POST', {
        cost, damageAfter: fv('cw-dmg-' + d.num),
        vendor: sv('cw-vend-' + d.num), paidBy: sv('cw-paid-' + d.num), notes: '',
      })), 'Work order closed.');
    }

    /* ---- safety */
    case 'record-incident': {
      if (!sv('in-desc')) return toast('Describe what happened.', 'bad');
      return run(async () => {
        const r = absorb(await api('/incidents', 'POST', {
          kind: sv('in-kind'), severity: sv('in-sev'), faultAttribution: sv('in-fault'),
          preventable: bv('in-prevent'), cost: fv('in-cost'), tripNumber: sv('in-trip'),
          description: sv('in-desc'), locationCity: S.status.locationCity, locationState: S.status.locationState,
        }));
        toast(r.action
          ? `${r.incident.number} filed. Safety has issued ${r.action.level} — acknowledge it below.`
          : `${r.incident.number} filed. No discipline attaches.`, r.action ? 'bad' : 'ok');
      });
    }
    case 'forgive-incident': {
      const why = prompt('Ask Safety to review this incident early.\n\n'
        + 'They will want to know what has changed — remedial training, a re-examination of what happened,\n'
        + 'or a stretch of clean work behind it.\n\nWhat is the case?');
      if (why === null) return;
      return run(async () => {
        try {
          absorb(await api(`/incidents/${encodeURIComponent(d.num)}/forgive`, 'POST', { reason: why, force: false }));
          toast('Safety has cleared it. It stays on your record but no longer counts against hiring.', 'ok');
        } catch (e) {
          // Not enough clean work yet — say so, and let management overrule if they insist.
          if (!/clean loads before Safety/.test(e.message)) throw e;
          if (!confirm(`${e.message}\n\nClear it anyway as a management decision?`)) return;
          absorb(await api(`/incidents/${encodeURIComponent(d.num)}/forgive`, 'POST',
            { reason: (why || 'Management decision') + ' (cleared early by management)', force: true }));
          toast('Cleared early by management decision.', 'ok');
        }
      });
    }
    case 'ack-discipline': return run(async () =>
      absorb(await api(`/discipline/${encodeURIComponent(d.num)}/acknowledge`, 'POST', {})),
      'Acknowledged.');
    case 'issue-discipline': {
      if (!sv('da-reason')) return toast('A disciplinary action needs a reason.', 'bad');
      if (!confirm('Issue this manually, overruling the safety ladder?\n\nIt will be logged as a management override.')) return;
      return run(async () => absorb(await api('/discipline', 'POST', {
        level: sv('da-level'), reason: sv('da-reason'), correctiveAction: sv('da-corrective'),
        incidentNumber: sv('da-inc'), expiresAfterLoads: fv('da-expire'),
      })), 'Override issued.');
    }
    case 'reinstate': return run(async () => absorb(await api('/discipline/reinstate', 'POST',
      { notes: sv('ri-note') })), 'Driver reinstated.');

    /* ---- career */
    case 'set-dedicated': {
      const on = d.on === '1';
      if (on && !sv('ded-account'))
        return toast('Type the customer name as it appears on your ATS board.', 'bad');
      if (!on && !confirm('Come off the dedicated account and back on the open board?')) return;
      return run(async () => {
        const r = absorb(await api('/career/dedicated', 'POST',
          { onDedicated: on, account: on ? sv('ded-account') : '' }));
        toast(r.message, 'ok');
      });
    }
    case 'clear-probation': return run(async () => {
      const r = absorb(await api('/career/clear-probation', 'POST',
        { force: d.force === '1', note: 'Probation review' }));
      toast(r.message, 'ok');
    });
    case 'promote': return run(async () => {
      const r = absorb(await api('/career/promote', 'POST',
        { rank: null, note: 'Performance review', force: d.force === '1' }));
      toast(r.message, 'ok');
    });
    case 'adjust-pay': return run(async () => {
      const r = absorb(await api('/career/pay', 'POST',
        { loadedCpm: fv('cp-loaded'), deadheadCpm: fv('cp-empty'), reason: sv('cp-reason') }));
      toast(r.message, 'ok');
    });

    /* ---- packet & AI */
    case 'packet': return run(async () => { PACKET = (await api('/packet?mode=' + d.mode)).text; });
    case 'copy-packet': return copyText(PACKET, 'Dispatch packet copied — paste it into your chat.');
    case 'ai-send': {
      toast('Asking operations…');
      return run(async () => { AI_REPLY = await api('/ai/dispatch', 'POST', { message: sv('ai-msg') }); });
    }

    /* ---- settings & data */
    case 'facility-set': return run(async () => absorb(await api('/settings/facility-time', 'POST', {
      trailerType: d.type, loadingHours: hv(`ftl-${d.i}`), unloadingHours: hv(`ftu-${d.i}`), manual: true,
    })), `${d.type} dock time fixed — it will not move on its own now.`);
    case 'facility-release': return run(async () => absorb(await api('/settings/facility-time', 'POST', {
      trailerType: d.type, loadingHours: 0, unloadingHours: 0, manual: false,
    })), `${d.type} back to learning from your loads.`);
    case 'save-settings': return run(async () => absorb(await api('/settings', 'POST', collectSettings())), 'Settings saved.');
    case 'snapshot': return run(async () => {
      const r = await api('/backups/snapshot', 'POST', { notes: 'manual' });
      toast('Snapshot saved: ' + r.path.split(/[\\/]/).pop(), 'ok');
    });
    case 'export': {
      const res = await fetch('/api/export');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${S.company.code || 'career'}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(a.href);
      return toast('Career file downloaded.', 'ok');
    }
    case 'list-backups': return run(async () => {
      const r = await api('/backups');
      $('backup-list').innerHTML = `<h3 class="sect">Career file</h3>
        <p class="mono sub">${esc(r.stateFile)}</p>
        <p class="hint">Running TruckSim Dispatcher <b>${esc(S.views.versionDisplay || '')}</b>${
          r.careerVersion && r.careerVersion !== S.views.version
            ? ` · this career was last written by v${esc(r.careerVersion)}` : ''}</p>
        ${(r.otherCareers || []).length ? `<div class="callout warn">
          <h4>Another career file exists on this machine</h4>
          <p>Probably left by an earlier copy of the app. Adopting one replaces what is loaded now —
            your current career is snapshotted first.</p>
          ${r.otherCareers.map((o) => `<div class="row-actions">
            <span class="mono sub">${esc(o.path)} · ${o.sizeKb} KB · ${esc(o.modified)}</span>
            <button class="btn tiny ghost" data-act="adopt-career" data-path="${esc(o.path)}">Load this one</button>
          </div>`).join('')}</div>` : ''}
        <h3 class="sect">Backups in ${esc(r.dataDir)}</h3>
        <div class="log">${r.files.map((f) => `<div><span class="ch">file</span><span>${esc(f)}
          <button class="btn tiny ghost" data-act="restore" data-file="${esc(f)}">Restore</button></span></div>`).join('')
          || '<div class="empty">No backups yet.</div>'}</div>`;
    });
    case 'restore': {
      if (!confirm(`Restore ${d.file}? Your current state is snapshotted first.`)) return;
      return run(async () => absorb(await api('/backups/restore', 'POST', { file: d.file })), 'Backup restored.');
    }
    case 'adopt-career': {
      if (!confirm(`Load the career at\n\n${d.path}\n\nYour current one is snapshotted first.`)) return;
      return run(async () => {
        absorb(await api('/data/adopt', 'POST', { path: d.path }));
        location.reload();
      });
    }
    case 'reset': {
      const c = prompt('This starts a brand-new career. Your current file is snapshotted first.\n\n'
        + 'Your settings are kept — API key, HOS rules, mods and cost assumptions describe your game, '
        + 'not the career.\n\nType RESET to confirm:');
      if (c !== 'RESET') return;
      // Factory-reset of settings is a separate, deliberate second answer.
      const wipe = confirm('Also reset SETTINGS to factory defaults?\n\n'
        + 'OK = wipe settings too (clears your API key and HOS preferences).\n'
        + 'Cancel = keep my settings (recommended).');
      return run(async () => {
        absorb(await api('/reset', 'POST', { confirm: 'RESET', resetSettings: wipe }));
        location.reload();
      });
    }
  }
}

function collectSettings() {
  const s = S.settings;
  return {
    ...s,
    atsVersion: sv('se-ver'),
    mapMods: list('se-mapmods'), mods: list('se-mods'),
    usesHosMod: bv('se-hosmod'), hosModName: sv('se-hosmodname'), usesEconomyMod: bv('se-econmod'),
    carrierRoster: sv('se-roster') || s.carrierRoster,
    hos: {
      ...s.hos,
      driveLimit: hv('hr-drive'), shiftLimit: hv('hr-shift'),
      drivingBeforeBreak: hv('hr-beforebreak'), breakLength: hv('hr-breaklen'),
      cycleLimit: hv('hr-cycle'), cycleDays: fv('hr-cycledays'),
      offDutyReset: hv('hr-reset'), cycleRestartHours: hv('hr-restart'),
      requireBreak: bv('hr-requirebreak'),
      breakConsumesShift: bv('hr-breakshift'), sleeperSplitAllowed: bv('hr-split'),
    },
    governedMph: fv('op-gov'), speedFactor: fv('op-factor'),
    safetyBufferHours: hv('op-buffer'), parkingBufferHours: hv('op-park'),
    strandedMarginHours: hv('op-strand'),
    preTripHours: hv('op-pre'), postTripHours: hv('op-post'),
    defaultLoadingHours: hv('op-load'), defaultUnloadingHours: hv('op-unload'),
    fuelStopHours: hv('op-fuelstop'), fuelRangeMiles: fv('op-range'), fuelPricePerGal: fv('op-fuelprice'),
    revenueFactor: fv('ec-revfactor'), payMileMultiplier: fv('ec-paymult'),
    maintenanceReservePct: fv('ec-maintpct'), payrollReservePct: fv('ec-paypct'),
    overheadPerLoad: fv('ec-overhead'), cancellationPenalty: fv('ec-cancel'),
    settlementPeriodDays: fv('ec-period'),
    healthPremiumPerPeriod: fv('ec-health'),
    maintenance: {
      ...s.maintenance,
      monitorPct: fv('mt-report'), reportPct: fv('mt-report'),
      stopDispatchPct: fv('mt-stop'),
      mandatoryReviewPct: fv('mt-review'), outOfServicePct: fv('mt-oos'),
      totalLossPct: fv('mt-total'),
      writeOffLifeMiles: fv('mt-life'), writeOffWearFactor: fv('mt-wear'),
      writeOffFloorPct: fv('mt-floor'),
      preventiveIntervalMiles: fv('mt-pm'),
      runHomeMaxDamagePct: fv('mt-runhome-pct'), runHomeMaxHours: hv('mt-runhome-h'),
      repairHoursPerPoint: hv('mt-perpoint'), trailerRepairFactor: fv('mt-trfactor'),
      companyShopFactor: fv('mt-shopfactor'), totalLossDeductible: fv('mt-deduct'),
    },
    scoring: {
      ...s.scoring,
      targetAllInRpm: fv('sc-target'), floorAllInRpm: fv('sc-floor'),
      maxDeadheadRatio: fv('sc-dh'), resetWatchCycleHours: fv('sc-resetwatch'),
      allInRpm: fv('sc-wrpm'), totalRevenue: fv('sc-wrev'), deadheadPenalty: fv('sc-wdh'),
      positioning: fv('sc-wpos'), resetPositioning: fv('sc-wreset'), hosSlack: fv('sc-wslack'),
      divisionFit: fv('sc-wdiv'), utilizationFit: fv('sc-wutil'),
    },
    freightPrefix: sv('nu-freight'), numberPadding: fv('nu-pad'),
    emptyMovePrefix: sv('nu-mt'), maintenancePrefix: sv('nu-mx'), cancelPrefix: sv('nu-cx'),
    aiEnabled: bv('ai-enabled'), anthropicApiKey: sv('ai-key'), anthropicModel: sv('ai-model'),
  };
}

/* The hired roster lives outside the main snapshot, so it is fetched when the Fleet tab opens.
   Failure is quiet: the rest of the tab is useful without it, and hiring still works. */
async function loadFleetOps() {
  try {
    FLEETOPS = await api('/fleetops');
    render();
  } catch { /* leave the panel empty rather than blocking the tab */ }
}

async function loadLedger() {
  const body = $('ledger-body');
  if (!body) return;
  try {
    const rows = await api('/ledger?take=250');
    body.innerHTML = rows.length ? rows.map((e) => `<tr>
      <td>${gt(e.gameTime)}</td><td>${esc(e.accountName)}</td>
      <td>${esc(e.category)}${e.isAdjustment ? ' ' + badge('warn', 'adj') : ''}</td>
      <td>${esc(e.memo)}</td><td class="mono">${esc(e.tripNumber || '')}</td>
      <td class="num" style="color:${e.amount < 0 ? 'var(--red)' : 'var(--green)'}">${money(e.amount)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No ledger entries yet.</td></tr>';
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" class="empty">Could not load the ledger: ${esc(e.message)}</td></tr>`;
  }
}
