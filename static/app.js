/* Lifeline frontend — vanilla JS SPA */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = { boot: null, jobs: [], jobsFilter: { status: "", q: "", sort: "score" } };
let BACKEND = null; // 'server' (FastAPI) or 'local' (browser engine, GitHub Pages)

async function detectBackend() {
  try {
    const r = await fetch("/api/bootstrap");
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) { BACKEND = "server"; return; }
  } catch { /* static host — fall through */ }
  BACKEND = "local";
}

/* ------------------------------------------------------------- helpers */

function api(path, opts = {}) {
  if (BACKEND === "local") return window.localApi(path, opts);
  return fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || r.status);
    return data;
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(msg, err = false) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  $("#toast-root").appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function openModal(html, wide = false) {
  closeModal();
  const root = $("#modal-root");
  root.innerHTML = `<div class="overlay"><div class="modal ${wide ? "wide" : ""}">${html}</div></div>`;
  $(".overlay", root).addEventListener("mousedown", e => { if (e.target.classList.contains("overlay")) closeModal(); });
  document.addEventListener("keydown", escClose);
}
function escClose(e) { if (e.key === "Escape") closeModal(); }
function closeModal() { $("#modal-root").innerHTML = ""; document.removeEventListener("keydown", escClose); }

function scoreRing(v, size = 44) {
  const cls = v >= 70 ? "hi" : v >= 45 ? "md" : "lo";
  const C = 2 * Math.PI * 18.5;
  return `<span class="score ${cls}" title="match ${v}%">
    <svg viewBox="0 0 44 44"><circle class="bgc" cx="22" cy="22" r="18.5"/>
    <circle class="fgc" cx="22" cy="22" r="18.5" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - v / 100)}" stroke-linecap="round"/></svg>
    ${v}</span>`;
}

function bigRing(v) {
  const C = 2 * Math.PI * 46;
  return `<div class="ring"><svg width="104" height="104" viewBox="0 0 104 104">
    <circle cx="52" cy="52" r="46" fill="none" stroke="#1b2740" stroke-width="9"/>
    <circle cx="52" cy="52" r="46" fill="none" stroke="url(#ringg)" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - v / 100)}"/>
    <defs><linearGradient id="ringg"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs>
  </svg><div class="num">${v}<small>ready</small></div></div>`;
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d + (d.length === 10 ? "T00:00" : ""));
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function daysLeft(d) {
  if (!d) return null;
  return Math.ceil((new Date(d + "T23:59") - new Date()) / 86400000);
}
function deadlineHtml(d) {
  if (!d) return "";
  const n = daysLeft(d);
  if (n < 0) return `<span class="dl-dead">closed ${fmtDate(d)}</span>`;
  if (n <= 7) return `<span class="dl-warn">⏰ ${fmtDate(d)} · ${n}d left</span>`;
  return `<span class="dim">${fmtDate(d)}</span>`;
}

function pill(status) { return `<span class="pill ${esc(status)}">${esc(status.replace("_", " "))}</span>`; }

async function copyText(txt, label = "Copied to clipboard") {
  try { await navigator.clipboard.writeText(txt); toast(label); }
  catch { toast("Copy failed — select manually", true); }
}

/* Safe hand-off of big strings into inline onclick handlers (avoids quote/apostrophe breakage). */
const stash = (() => { const m = {}; let n = 0;
  return { put(v) { const k = "s" + (++n); m[k] = v; return k; },
           get(k) { return m[k] ?? ""; } };
})();
window.copyStash = (k, label) => copyText(stash.get(k), label);

/* ------------------------------------------------------------- router */

const ROUTES = ["dashboard", "radar", "applications", "resume", "referrals", "prep", "tracker", "settings"];

function currentRoute() {
  const h = location.hash.replace(/^#\//, "") || "dashboard";
  const [route, query] = h.split("?");
  return { route: ROUTES.includes(route) ? route : "dashboard", query: new URLSearchParams(query || "") };
}

async function render() {
  const { route, query } = currentRoute();
  $$("#nav a").forEach(a => a.classList.toggle("on", a.dataset.route === route));
  const view = $("#view");
  view.innerHTML = `<div class="empty">Loading…</div>`;
  try {
    state.boot = await api("/bootstrap");
    updateBadges();
    const fn = { dashboard: renderDashboard, radar: renderRadar, applications: renderApplications,
      resume: renderResume, referrals: renderReferrals, prep: renderPrep,
      tracker: renderTracker, settings: renderSettings }[route];
    await fn(view, query);
  } catch (e) {
    view.innerHTML = `<div class="empty">Something broke: ${esc(e.message)}</div>`;
  }
}

function updateBadges() {
  const b = state.boot;
  const newJobs = (b.stats.jobs.new || 0) + (b.stats.jobs.shortlisted || 0);
  $("#b-radar").textContent = newJobs || "";
  const ready = b.stats.applications.packet_ready || 0;
  $("#b-apps").textContent = ready || "";
  $("#ready-mini").textContent = `readiness ${b.readiness.overall}/100`;
}

window.addEventListener("hashchange", render);
window.addEventListener("load", async () => {
  if (!location.hash) location.hash = "#/dashboard";
  await detectBackend();
  if (BACKEND === "local") document.body.classList.add("local-mode");
  render();
});

/* ------------------------------------------------------------- dashboard */

async function renderDashboard(view) {
  const b = state.boot;
  const s = b.stats;
  const shortlisted = s.jobs.shortlisted || 0, applied = (s.jobs.applied || 0) + (s.jobs.interview || 0);
  view.innerHTML = `
  <div class="view-head">
    <div><h1>Mission Control</h1><div class="view-sub">Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${esc((b.profile.name || "").split(" ")[0] || "operator")} — one move at a time.${BACKEND === "local" ? ` <span class="pill muted">browser mode · data saved in this browser</span>` : ""}</div></div>
    <button class="btn primary" onclick="runAutopilot(this)">⚡ Run Autopilot</button>
  </div>
  <div class="grid g4">
    <div class="card"><div class="stat-num">${s.total_jobs}</div><div class="stat-lbl">openings tracked</div></div>
    <div class="card"><div class="stat-num">${shortlisted}</div><div class="stat-lbl">shortlisted</div></div>
    <div class="card"><div class="stat-num">${s.total_apps}</div><div class="stat-lbl">packets built</div></div>
    <div class="card"><div class="stat-num">${s.submitted}</div><div class="stat-lbl">submitted +</div></div>
  </div>
  <div class="grid g3 mt">
    <div class="card tinted" style="grid-row:span 2">
      <h3 class="mb">Your next moves</h3>
      ${b.next_moves.length ? b.next_moves.map(m => `
        <div class="move"><div class="move-ico">${m.icon}</div>
          <div style="flex:1"><div class="move-area">${esc(m.area)}</div>
          <div class="move-txt">${esc(m.text)}</div>
          <a class="btn sm ghost" href="${esc(m.action)}">Open →</a></div></div>`).join("")
        : `<div class="empty">All clear. Scan the radar or shortlist roles.</div>`}
    </div>
    <div class="card">
      <div class="ring-wrap">${bigRing(b.readiness.overall)}
        <div><h3>Interview readiness</h3>
        <div class="mut" style="font-size:12.5px">${b.readiness.sessions} mock session${b.readiness.sessions === 1 ? "" : "s"} logged</div>
        <a href="#/prep" class="btn sm ghost mt" style="margin-top:8px">Practice →</a></div></div>
      <div class="mt">${Object.entries(b.readiness.categories).map(([c, e]) => `
        <div class="bar-row"><div class="lbl"><span>${esc(c)}</span><span>${e.score}</span></div>
        <div class="bar"><i style="width:${e.score}%"></i></div></div>`).join("") || `<div class="hint">No sessions yet — log one in Interview Prep.</div>`}</div>
    </div>
    <div class="card">
      <h3 class="mb">Coming up</h3>
      ${s.upcoming_events.slice(0, 4).map(ev => `
        <div class="ev-row"><div class="ev-date">${fmtDate(ev.at).split(",")[0]}<small>${(ev.at || "").slice(0, 4)}</small></div>
        <div class="ev-main"><b style="font-size:13px">${esc(ev.title)}</b><div class="dim" style="font-size:11.5px">${esc(ev.company)}</div></div>
        ${pill(ev.kind)}</div>`).join("") || `<div class="hint">No deadlines or interviews on the board.</div>`}
      <a href="#/tracker" class="btn sm ghost mt">Open tracker →</a>
    </div>
  </div>
  <div class="card mt">
    <div class="row spread mb"><h3 style="margin:0"><span class="pulse-dot"></span>&nbsp; Autopilot feed</h3>
      <span class="dim" style="font-size:12px">every action the pipeline takes is logged here</span></div>
    ${b.activity.map(a => `<div class="act"><span class="ts">${esc((a.ts || "").slice(5, 16))}</span><span class="k">${esc(a.kind)}</span><span>${esc(a.message)}</span></div>`).join("") || `<div class="hint">No activity yet.</div>`}
  </div>`;
}

/* ------------------------------------------------------------- radar */

async function renderRadar(view, query) {
  const f = state.jobsFilter;
  if (query.get("job")) {
    const id = +query.get("job");
    history.replaceState(null, "", "#/radar"); // don't reopen the modal on re-render
    openJobModal(id);
  }
  view.innerHTML = `
  <div class="view-head">
    <div><h1>Radar</h1><div class="view-sub">Live internship scanning — curated index + public feeds, scored against your profile.</div></div>
    <button class="btn primary" onclick="runScan(this)">📡 Scan sources</button>
  </div>
  <div class="toolbar">
    <input type="text" id="rq" placeholder="Search title, company, location…" value="${esc(f.q)}">
    <select id="rs-status">
      <option value="">All statuses</option>
      ${["new", "shortlisted", "applied", "interview", "offer", "rejected"].map(x => `<option ${f.status === x ? "selected" : ""}>${x}</option>`).join("")}
    </select>
    <select id="rs-sort">
      <option value="score" ${f.sort === "score" ? "selected" : ""}>Sort: best match</option>
      <option value="deadline" ${f.sort === "deadline" ? "selected" : ""}>Sort: deadline</option>
      <option value="recent" ${f.sort === "recent" ? "selected" : ""}>Sort: newest</option>
      <option value="company" ${f.sort === "company" ? "selected" : ""}>Sort: company</option>
    </select>
    <div class="checkbox-line" id="scan-sources" style="margin-left:auto">
      <span class="dim">sources:</span>
      <label><input type="checkbox" value="lifeline-index" checked> Lifeline Index</label>
      <label><input type="checkbox" value="remotive" checked> Remotive</label>
      <label><input type="checkbox" value="arbeitnow" checked> Arbeitnow</label>
    </div>
  </div>
  <div id="job-list"></div>`;

  const refresh = async () => {
    f.q = $("#rq").value; f.status = $("#rs-status").value; f.sort = $("#rs-sort").value;
    const data = await api(`/jobs?status=${encodeURIComponent(f.status)}&q=${encodeURIComponent(f.q)}&sort=${f.sort}`);
    state.jobs = data.jobs;
    $("#job-list").innerHTML = data.jobs.length ? data.jobs.map(jobRow).join("") :
      `<div class="empty">No openings match. Try another filter, or hit Scan sources.</div>`;
  };
  $("#rq").addEventListener("input", debounce(refresh, 250));
  $("#rs-status").addEventListener("change", refresh);
  $("#rs-sort").addEventListener("change", refresh);
  await refresh();
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function jobRow(j) {
  return `<div class="job-row" onclick="openJobModal(${j.id})">
    ${scoreRing(j.match_score || 0)}
    <div class="job-main">
      <div class="job-title">${esc(j.title)}${j.remote ? `<span class="remote-tag">REMOTE</span>` : ""}</div>
      <div class="job-meta"><span><b>${esc(j.company)}</b></span><span>${esc(j.location)}</span>
        ${j.stipend ? `<span>💸 ${esc(j.stipend)}</span>` : ""}<span class="dim">${esc(j.source)}</span></div>
    </div>
    <div class="job-side">${deadlineHtml(j.deadline)} ${pill(j.status)}
      <button class="btn sm" onclick="event.stopPropagation(); quickShortlist(${j.id}, this)">${j.status === "shortlisted" ? "✓ Listed" : "+ Shortlist"}</button>
    </div></div>`;
}

window.quickShortlist = async (id, btn) => {
  const j = state.jobs.find(x => x.id === id);
  const target = j && j.status === "shortlisted" ? "new" : "shortlisted";
  await api(`/jobs/${id}/status`, { method: "POST", body: { status: target } });
  render();
};

window.runScan = async (btn) => {
  btn.disabled = true; btn.textContent = "Scanning…";
  try {
    const sources = $$("#scan-sources input:checked").map(i => i.value);
    const r = await api("/scan", { method: "POST", body: { sources } });
    toast(`Scan done — ${r.added} new openings. ${r.results.map(x => `${x.name}: ${x.status === "ok" ? x.count + " new" : x.note}`).join(" · ")}`);
    render();
  } catch (e) { toast("Scan failed: " + e.message, true); btn.disabled = false; btn.textContent = "📡 Scan sources"; }
};

window.openJobModal = async (id) => {
  const j = await api(`/jobs/${id}`);
  openModal(`
    <div class="modal-head">
      <div><div class="move-area">${esc(j.company)}</div>
      <h2 style="margin-top:2px">${esc(j.title)}</h2>
      <div class="mut" style="font-size:12.5px">${esc(j.location)} ${j.remote ? "· Remote-friendly" : ""} ${j.stipend ? "· " + esc(j.stipend) : ""}</div></div>
      <button class="modal-x" onclick="closeModal()">✕</button>
    </div>
    <div class="row" style="margin:10px 0">${scoreRing(j.match_score || 0)}
      ${pill(j.status)} ${j.deadline ? `<span>Deadline: ${deadlineHtml(j.deadline)}</span>` : ""}</div>
    <div>${(j.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
    <p class="mt" style="color:#c2cfe3">${esc(j.description || "No description provided by this source.")}</p>
    <div class="row mt">
      <button class="btn sm" onclick="quickShortlist(${j.id}, this)">${j.status === "shortlisted" ? "Un-shortlist" : "+ Shortlist"}</button>
      <button class="btn sm primary" onclick="tailorNow(${j.id}, this)">✦ Tailor my resume for this</button>
      <button class="btn sm ghost" onclick="referralFor('${esc(j.company)}', '${esc(j.title)}')">🤝 Referral hunt</button>
      ${j.url ? `<a class="btn sm ghost" href="${esc(j.url)}" target="_blank" rel="noopener">Opening ↗</a>` : ""}
      <button class="btn sm danger" onclick="removeJob(${j.id})">Remove</button>
    </div>`, true);
};

window.removeJob = async (id) => {
  await api(`/jobs/${id}`, { method: "DELETE" });
  closeModal(); toast("Removed from radar"); render();
};

window.tailorNow = async (id, btn) => {
  btn.disabled = true; btn.textContent = "Tailoring…";
  try {
    const r = await api(`/jobs/${id}/tailor`, { method: "POST" });
    const kR = stash.put(r.resume), kC = stash.put(r.cover_letter);
    openModal(`
      <div class="modal-head"><div><h2>Application packet ready</h2>
      <div class="mut" style="font-size:12.5px">engine: ${esc(r.engine)} · match score ${r.score}</div></div>
      <button class="modal-x" onclick="closeModal()">✕</button></div>
      <div class="mb">${r.matched.map(m => `<span class="chip hot">${esc(m)}</span>`).join("")}
        ${r.missing.slice(0, 6).map(m => `<span class="chip miss">gap: ${esc(m)}</span>`).join("")}</div>
      <label>Tailored resume</label><pre class="doc">${esc(r.resume)}</pre>
      <div class="row" style="margin-top:8px"><button class="btn sm" onclick="copyStash('${kR}','Resume copied')">Copy resume</button></div>
      <label>Cover letter</label><pre class="doc">${esc(r.cover_letter)}</pre>
      <div class="row" style="margin-top:8px"><button class="btn sm" onclick="copyStash('${kC}','Cover letter copied')">Copy cover letter</button>
      <a class="btn sm primary" href="#/applications" onclick="closeModal()">Review in Applications →</a></div>`, true);
    toast(`Packet built — match ${r.score}/100`);
  } catch (e) { toast("Tailor failed: " + e.message, true); btn.disabled = false; btn.textContent = "✦ Tailor my resume for this"; }
};

/* ------------------------------------------------------------- applications / autopilot */

async function renderApplications(view) {
  const data = await api("/applications");
  const apps = data.applications;
  const settings = state.boot.settings;
  view.innerHTML = `
  <div class="view-head">
    <div><h1>Applications</h1><div class="view-sub">Every packet Autopilot built — review, submit, and move through the funnel.</div></div>
  </div>
  <div class="autopilot-hero mb">
    <div class="row spread">
      <div>
        <h3 style="font-size:16px">⚡ Autopilot</h3>
        <div class="mut" style="font-size:13px; max-width:560px; margin-top:4px">
          One pass: builds a tailored resume + cover letter for every shortlisted role, then
          ${settings.auto_submit ? `<b style="color:var(--gr)">auto-submits</b> each packet through the role's application link.` :
          `stages packets for your one-click review (auto-submit is OFF in Settings).`}
          Deadlines inside 14 days are pinned to your Tracker.
        </div>
      </div>
      <div class="row">
        <span class="pill ${settings.nightly_autopilot ? "offer" : "muted"}">${settings.nightly_autopilot ? "nightly schedule on" : "nightly off"}</span>
        <button class="btn primary big" onclick="runAutopilot(this)">Run Autopilot now</button>
      </div>
    </div>
  </div>
  <div id="app-list">
  ${apps.length ? apps.map(appRow).join("") : `<div class="empty">No packets yet — shortlist roles in the Radar, then run Autopilot.</div>`}
  </div>`;
}

function appRow(a) {
  const k = stash.put(a);
  return `<div class="job-row">
    ${scoreRing(a.match_score || 0)}
    <div class="job-main">
      <div class="job-title">${esc(a.job_title)}</div>
      <div class="job-meta"><b>${esc(a.job_company)}</b><span>${esc(a.job_location || "")}</span>
        ${a.submitted_at ? `<span>submitted ${esc(a.submitted_at.slice(0, 10))}</span>` : ""}</div>
    </div>
    <div class="job-side">
      ${pill(a.status)}
      <button class="btn sm ghost" onclick="openPacket('${k}')">View packet</button>
      <select onchange="moveApp(${a.id}, this.value, this)" style="width:auto">
        <option value="">move to…</option>
        ${["packet_ready", "submitted", "interview", "offer", "rejected"].filter(s => s !== a.status).map(s => `<option>${s}</option>`).join("")}
      </select>
    </div></div>`;
}

window.openPacket = (key) => {
  const a = stash.get(key);
  if (!a) return;
  const kR = stash.put(a.tailored_resume || ""), kC = stash.put(a.cover_letter || "");
  openModal(`
    <div class="modal-head"><div><h2>${esc(a.job_title)}</h2>
    <div class="mut" style="font-size:12.5px">${esc(a.job_company)} · match ${a.match_score} · built ${esc((a.created_at || "").slice(0, 10))}</div></div>
    <button class="modal-x" onclick="closeModal()">✕</button></div>
    <label>Tailored resume</label><pre class="doc">${esc(a.tailored_resume || "(not generated yet)")}</pre>
    <div class="row" style="margin-top:8px"><button class="btn sm" onclick="copyStash('${kR}','Resume copied')">Copy resume</button>
    <button class="btn sm" onclick="copyStash('${kC}','Cover letter copied')">Copy cover letter</button>
    ${a.job_apply_url ? `<a class="btn sm primary" href="${esc(a.job_apply_url)}" target="_blank" rel="noopener">Open application portal ↗</a>` : ""}</div>
    <label>Cover letter</label><pre class="doc">${esc(a.cover_letter || "(none)")}</pre>
    ${a.missing_skills?.length ? `<label>Keyword gaps to fix manually</label><div>${a.missing_skills.map(m => `<span class="chip miss">${esc(m)}</span>`).join("")}</div>` : ""}`, true);
};

window.moveApp = async (id, status, sel) => {
  if (!status) return;
  await api(`/applications/${id}/status`, { method: "POST", body: { status } });
  toast(`Application → ${status}`); render();
};

window.runAutopilot = async (btn) => {
  btn.disabled = true; const old = btn.textContent; btn.textContent = "Autopilot running…";
  try {
    const r = await api("/autopilot", { method: "POST" });
    openModal(`
      <div class="modal-head"><div><h2>⚡ Autopilot report</h2>
      <div class="mut" style="font-size:12.5px">${r.tailored} packets built · ${r.dispatched} dispatched</div></div>
      <button class="modal-x" onclick="closeModal()">✕</button></div>
      <div>${r.log.map(l => `<div class="act"><span class="k" style="width:20px">•</span><span>${esc(l)}</span></div>`).join("")}</div>
      <div class="row mt"><a class="btn primary" href="#/applications" onclick="closeModal()">Review applications →</a>
      <button class="btn ghost" onclick="closeModal()">Close</button></div>`);
    render();
  } catch (e) { toast("Autopilot error: " + e.message, true); btn.disabled = false; btn.textContent = old; }
};

/* ------------------------------------------------------------- resume vault */

async function renderResume(view) {
  const p = await api("/profile");
  view.innerHTML = `
  <div class="view-head">
    <div><h1>Resume Vault</h1><div class="view-sub">Your master profile. Every tailored resume is rebuilt from this — nothing is invented.</div></div>
    <button class="btn primary" id="save-profile">Save profile</button>
  </div>
  <div class="grid g2">
    <div class="card">
      <label>Full name</label><input id="p-name" value="${esc(p.name)}">
      <label>Email</label><input id="p-email" value="${esc(p.email)}">
      <label>Phone</label><input id="p-phone" value="${esc(p.phone)}">
      <label>Location</label><input id="p-loc" value="${esc(p.location)}">
      <label>University</label><input id="p-uni" value="${esc(p.university)}">
      <div class="row" style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
        <div><label>Degree</label><input id="p-deg" value="${esc(p.degree)}"></div>
        <div><label>Grad year</label><input id="p-gy" value="${esc(p.grad_year)}"></div>
      </div>
      <label>LinkedIn URL</label><input id="p-li" value="${esc((p.links || {}).linkedin || "")}">
      <label>GitHub URL</label><input id="p-gh" value="${esc((p.links || {}).github || "")}">
    </div>
    <div class="card">
      <label>Target roles (comma-separated)</label>
      <input id="p-roles" value="${esc((p.target_roles || []).join(", "))}">
      <label>Skills (comma-separated — match scoring runs on these)</label>
      <textarea id="p-skills" style="min-height:70px">${esc((p.skills || []).join(", "))}</textarea>
      <label>Experience & project bullets (one per line — lead with impact + numbers)</label>
      <textarea id="p-exp" style="min-height:190px">${esc((p.experience || []).join("\n"))}</textarea>
      <div class="hint">Tip: bullets structured as <span class="mono">"Built X with Y, achieving Z"</span> tailor best. Save re-scores every opening on the radar.</div>
    </div>
  </div>`;
  $("#save-profile").onclick = async () => {
    const prof = {
      name: $("#p-name").value, email: $("#p-email").value, phone: $("#p-phone").value,
      location: $("#p-loc").value, university: $("#p-uni").value, degree: $("#p-deg").value,
      grad_year: $("#p-gy").value,
      links: { linkedin: $("#p-li").value, github: $("#p-gh").value },
      target_roles: $("#p-roles").value.split(",").map(s => s.trim()).filter(Boolean),
      skills: $("#p-skills").value.split(",").map(s => s.trim()).filter(Boolean),
      experience: $("#p-exp").value.split("\n").map(s => s.trim()).filter(Boolean),
      summary: p.summary || "",
    };
    const r = await api("/profile", { method: "PUT", body: prof });
    toast(`Profile saved — ${r.rescored} openings re-scored`); render();
  };
}

/* ------------------------------------------------------------- referrals */

async function renderReferrals(view) {
  const { contacts } = await api("/contacts");
  view.innerHTML = `
  <div class="view-head">
    <div><h1>Referral Engine</h1><div class="view-sub">Find the right person, send one sharp message, log it, follow up once. Lifeline drafts — you approve.</div></div>
  </div>
  <div class="grid g2">
    <div class="card">
      <h3 class="mb">Build an outreach kit</h3>
      <div class="row" style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
        <div><label>Company</label><input id="rf-company" placeholder="e.g. Goldman Sachs"></div>
        <div><label>Target role</label><input id="rf-role" placeholder="e.g. Engineering Intern"></div>
      </div>
      <button class="btn primary mt" id="rf-build">🤝 Generate search links + drafts</button>
      <div id="rf-out" class="mt"></div>
    </div>
    <div class="card">
      <h3 class="mb">Outreach log</h3>
      <div class="row mb" style="display:grid; grid-template-columns:1fr 1fr auto auto; gap:8px">
        <input id="ct-who" placeholder="Who (name/title)">
        <input id="ct-co" placeholder="Company">
        <select id="ct-ch" style="width:auto"><option>linkedin</option><option>email</option><option>alumni</option></select>
        <button class="btn sm" id="ct-add">+ Log</button>
      </div>
      <div id="ct-list">
        ${contacts.length ? contacts.map(c => `
          <div class="ev-row"><div class="ev-main"><b style="font-size:13px">${esc(c.who || "contact")}</b>
            <div class="dim" style="font-size:11.5px">${esc(c.company)} · via ${esc(c.channel)} · ${esc((c.created_at || "").slice(0, 10))}</div></div>
          <select onchange="moveContact(${c.id}, this.value, this)" style="width:auto">
            ${["draft", "sent", "contacted", "replied", "referral given", "no reply"].map(s => `<option ${c.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
          <button class="btn sm ghost" onclick="delContact(${c.id})">✕</button></div>`).join("")
        : `<div class="hint">Log everyone you message so follow-ups never go cold.</div>`}
      </div>
    </div>
  </div>`;
  $("#rf-build").onclick = async () => {
    const r = await api("/referral/build", { method: "POST", body: { company: $("#rf-company").value, role: $("#rf-role").value } });
    const kN = stash.put(r.linkedin_note), kE = stash.put(r.cold_email), kF = stash.put(r.followup);
    $("#rf-out").innerHTML = `
      <label>Search links</label>
      <div class="link-list">${r.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">🔎 ${esc(l.label)} ↗</a>`).join("")}</div>
      <label>Likely email pattern</label><div class="mono" style="color:#a8c7ee">${esc(r.email_guess)}</div>
      <label>LinkedIn connection note (&lt;300 chars)</label>
      <pre class="doc">${esc(r.linkedin_note)}</pre>
      <button class="btn sm" onclick="copyStash('${kN}','Note copied')">Copy note</button>
      <label>Cold email</label><pre class="doc">${esc(r.cold_email)}</pre>
      <button class="btn sm" onclick="copyStash('${kE}','Email copied')">Copy email</button>
      <label>Follow-up (send once, 4–6 days later)</label><pre class="doc">${esc(r.followup)}</pre>
      <button class="btn sm" onclick="copyStash('${kF}','Follow-up copied')">Copy follow-up</button>
      <label>The rules</label>
      <div>${r.rules.map(x => `<div style="font-size:12.5px; color:var(--mut); padding:2px 0">• ${esc(x)}</div>`).join("")}</div>`;
  };
  $("#ct-add").onclick = async () => {
    await api("/contacts", { method: "POST", body: { who: $("#ct-who").value, company: $("#ct-co").value, channel: $("#ct-ch").value, status: "sent" } });
    render();
  };
}

window.moveContact = async (id, status, sel) => { await api(`/contacts/${id}`, { method: "PATCH", body: { status } }); toast(`Contact → ${status}`); };
window.delContact = async (id) => { await api(`/contacts/${id}`, { method: "DELETE" }); render(); };

window.referralFor = (company, role) => {
  closeModal(); location.hash = "#/referrals";
  setTimeout(() => {
    const c = $("#rf-company"), r = $("#rf-role");
    if (c && r) { c.value = company; r.value = role; const b = $("#rf-build"); if (b) b.click(); }
  }, 350);
};

/* ------------------------------------------------------------- interview prep */

async function renderPrep(view) {
  const [{ questions }, log] = await Promise.all([api("/prep/questions"), api("/prep")]);
  const rd = log.readiness;
  view.innerHTML = `
  <div class="view-head">
    <div><h1>Interview Prep</h1><div class="view-sub">Drill out loud, self-score honestly, watch readiness climb. 15 focused minutes beats 3 hours of passive reading.</div></div>
  </div>
  <div class="grid g3">
    <div class="card tinted">
      <div class="ring-wrap">${bigRing(rd.overall)}
      <div><h3>Interview readiness</h3><div class="mut" style="font-size:12.5px">${rd.sessions} sessions logged</div></div></div>
      <div class="mt">${Object.entries(rd.categories).map(([c, e]) => `
        <div class="bar-row"><div class="lbl"><span>${esc(c)}</span><span>${e.score} · ${e.sessions}s</span></div>
        <div class="bar"><i style="width:${e.score}%"></i></div></div>`).join("") || `<div class="hint">Log your first session to unlock category scores.</div>`}</div>
    </div>
    <div class="card" style="grid-column:span 2">
      <div class="row spread mb"><h3 style="margin:0">Question bank</h3>
        <select id="prep-cat" style="width:auto"><option value="">all categories</option>
        ${["technical", "behavioral", "firm", "quant"].map(c => `<option>${c}</option>`).join("")}</select></div>
      <div id="q-list"></div>
    </div>
  </div>
  <div class="card mt">
    <h3 class="mb">Recent sessions</h3>
    ${log.log.length ? log.log.map(s => `<div class="act"><span class="ts">${esc((s.at || "").slice(5, 16))}</span>
      <span class="k">${esc(s.category)}</span><span>${esc(s.question)} — self-score <b>${s.self_score}/5</b>${s.notes ? ` · ${esc(s.notes)}` : ""}</span></div>`).join("")
    : `<div class="hint">Nothing yet.</div>`}
  </div>`;

  const paint = (cat) => {
    const list = cat ? questions.filter(q => q.category === cat) : questions;
    $("#q-list").innerHTML = list.map(q => `
      <div class="qcard"><span class="qcat ${esc(q.category)}">${esc(q.category)}</span>
      <div class="qtxt">${esc(q.question)}</div>
      <button class="btn sm" onclick="practiceQ(${q.id})">Practice</button></div>`).join("");
  };
  paint("");
  $("#prep-cat").onchange = e => paint(e.target.value);
  window._qs = questions;
}

window.practiceQ = (qid) => {
  const q = (window._qs || [])[qid];
  if (!q) return;
  openModal(`
    <div class="modal-head"><div><span class="qcat ${esc(q.category)}">${esc(q.category)}</span>
    <h2 style="margin-top:8px">${esc(q.question)}</h2></div>
    <button class="modal-x" onclick="closeModal()">✕</button></div>
    <div class="hint mb">Answer out loud, timer-free. Then rate how it actually went.</div>
    <label>Self-score (1 = froze, 5 = nailed it)</label>
    <div class="row">${[1, 2, 3, 4, 5].map(n => `<button class="btn" id="ss-${n}" onclick="pickScore(${n})">${n}</button>`).join("")}</div>
    <label>Notes — what would you improve?</label>
    <textarea id="prep-notes" placeholder="e.g. rambled on the impact; need a crisper number"></textarea>
    <div class="row mt"><button class="btn primary" id="prep-save">Log session</button></div>`);
  window._picked = 3; pickScore(3);
  $("#prep-save").onclick = async () => {
    const r = await api("/prep", { method: "POST", body: { question_id: qid, self_score: window._picked, notes: $("#prep-notes").value } });
    toast(`Session logged — readiness now ${r.readiness.overall}/100`); closeModal(); render();
  };
};
window.pickScore = (n) => { window._picked = n; [1, 2, 3, 4, 5].forEach(i => { const b = $("#ss-" + i); if (b) b.classList.toggle("primary", i === n); }); };

/* ------------------------------------------------------------- tracker */

async function renderTracker(view) {
  const { events } = await api("/events");
  view.innerHTML = `
  <div class="view-head">
    <div><h1>Tracker</h1><div class="view-sub">Deadlines, interviews, follow-ups — one timeline, nothing slips.</div></div>
  </div>
  <div class="card mb">
    <div class="row" style="display:grid; grid-template-columns:130px 2fr 1.2fr 130px auto; gap:8px">
      <select id="ev-kind"><option>deadline</option><option>interview</option><option>follow-up</option><option>task</option></select>
      <input id="ev-title" placeholder="Title — e.g. OA round @ Goldman">
      <input id="ev-co" placeholder="Company">
      <input id="ev-at" type="date">
      <button class="btn primary" id="ev-add">+ Add</button>
    </div>
  </div>
  <div class="card">
    ${events.length ? events.map(ev => {
      const dl = daysLeft(ev.at), today = new Date().toDateString();
      const cls = ev.done ? "done" : (dl !== null && dl < 0 ? "overdue" : dl !== null && dl <= 7 ? "soon" : "");
      return `<div class="ev-row ${cls}">
        <input type="checkbox" style="width:auto" ${ev.done ? "checked" : ""} onchange="toggleEvent(${ev.id}, this.checked)">
        <div class="ev-date">${ev.at ? fmtDate(ev.at).split(",")[0] : "—"}<small>${ev.at ? (ev.at || "").slice(0, 4) : ""}</small></div>
        <div class="ev-main"><b style="font-size:13.5px">${esc(ev.title)}</b>
          <div class="dim" style="font-size:11.5px">${esc(ev.company)}${ev.notes ? " · " + esc(ev.notes) : ""}</div></div>
        ${pill(ev.kind)}
        ${!ev.done && dl !== null && dl >= 0 && dl <= 7 ? `<span class="dl-warn">${dl}d</span>` : ""}
        ${!ev.done && dl !== null && dl < 0 ? `<span class="dl-dead">overdue</span>` : ""}
        <button class="btn sm ghost" onclick="delEvent(${ev.id})">✕</button></div>`;
    }).join("") : `<div class="empty">Nothing scheduled. Autopilot pins deadlines automatically; add interviews and follow-ups here.</div>`}
  </div>`;
  $("#ev-add").onclick = async () => {
    if (!$("#ev-title").value) return toast("Give the event a title", true);
    await api("/events", { method: "POST", body: { kind: $("#ev-kind").value, title: $("#ev-title").value, company: $("#ev-co").value, at: $("#ev-at").value } });
    render();
  };
}
window.toggleEvent = async (id, done) => { await api(`/events/${id}`, { method: "PATCH", body: { done: done ? 1 : 0 } }); render(); };
window.delEvent = async (id) => { await api(`/events/${id}`, { method: "DELETE" }); render(); };

/* ------------------------------------------------------------- settings */

async function renderSettings(view) {
  const s = state.boot.settings;
  view.innerHTML = `
  <div class="view-head"><div><h1>Settings</h1><div class="view-sub">Autopilot behaviour + optional LLM upgrade for resume tailoring.</div></div></div>
  <div class="grid g2">
    <div class="card">
      <h3 class="mb">⚡ Autopilot</h3>
      <div class="switchline"><input type="checkbox" id="st-auto" style="width:auto" ${s.auto_submit ? "checked" : ""}>
        <div><b>Auto-submit packets</b><div class="hint">Autopilot marks ready packets as submitted through each role's application link. Turn off to review every packet first.</div></div></div>
      <div class="switchline"><input type="checkbox" id="st-nightly" style="width:auto" ${s.nightly_autopilot ? "checked" : ""}>
        <div><b>Nightly run reminder</b><div class="hint">Mission Control nudges you to run Autopilot when the queue has pending work.</div></div></div>
      <button class="btn mt" id="st-save">Save behaviour</button>
    </div>
    <div class="card">
      <h3 class="mb">🧠 AI tailoring — 100% optional, 100% free</h3>
      <div class="hint" style="margin-bottom:10px">Lifeline works fully on its built-in engine — <b style="color:var(--gr)">no key, no signup, $0 forever</b>.
      If you want deeper AI rewrites, plug in a key from a <b>free tier</b> (they cost nothing):</div>
      <div class="row mb">
        <button class="btn sm ghost" onclick='llmPreset("https://api.groq.com/openai/v1","llama-3.3-70b-versatile","Groq")'>Groq — free & fast</button>
        <button class="btn sm ghost" onclick='llmPreset("https://openrouter.ai/api/v1","meta-llama/llama-3.3-70b-instruct:free","OpenRouter")'>OpenRouter — free models</button>
        <button class="btn sm ghost" onclick='llmPreset("http://localhost:11434/v1","llama3.2","Ollama")'>Ollama — local, no key</button>
      </div>
      <div class="hint" id="preset-hint" style="margin-bottom:8px"></div>
      <label>API key <span class="dim">(free tier — leave blank to use the built-in engine)</span></label>
      <input type="password" id="st-key" placeholder="${s.has_key ? "•••••• (key stored — paste new to replace)" : "paste a free-tier key, or leave empty"}">
      ${s.has_key ? `<button class="btn sm danger mt" id="st-clear">Remove stored key</button>` : ""}
      <label>API base</label><input id="st-base" value="${esc(s.api_base)}">
      <label>Model</label><input id="st-model" value="${esc(s.model)}">
      <button class="btn mt" id="st-save-llm">Save AI settings</button>
      ${BACKEND === "local" ? `<div class="hint mt">You're in browser mode: LLM calls go straight from your browser to the provider. Groq & OpenRouter allow this; the local Ollama option needs the page opened from your own machine.</div>` : ""}
    </div>
    <div class="card">
      <h3 class="mb">💾 Data</h3>
      <div class="row">
        <a class="btn" href="/api/export" target="_blank">Export everything (JSON)</a>
        <button class="btn danger" id="st-reset">Reset workspace</button>
      </div>
      <div class="hint mt">Reset reseeds the Lifeline Index and clears your profile, packets, events, and logs. Export first if you want a backup.</div>
    </div>
    <div class="card">
      <h3 class="mb">About Lifeline</h3>
      <div class="mut" style="font-size:13px">An open, local-first internship operating system: radar scanning, resume tailoring, an autopilot pipeline, referral outreach kits, interview drills, and one timeline for every deadline. <b style="color:var(--gr)">Free forever — no paywall, no account, no paid APIs.</b>${BACKEND === "local" ? " <b>Browser mode:</b> your data lives in this browser's localStorage — use Export below to back it up." : ""}</div>
    </div>
  </div>`;
  $("#st-save").onclick = async () => {
    await api("/settings", { method: "PUT", body: { auto_submit: $("#st-auto").checked, nightly_autopilot: $("#st-nightly").checked } });
    toast("Autopilot behaviour saved");
  };
  $("#st-save-llm").onclick = async () => {
    await api("/settings", { method: "PUT", body: { api_key: $("#st-key").value, api_base: $("#st-base").value, model: $("#st-model").value } });
    toast("LLM settings saved"); render();
  };
  const clearBtn = $("#st-clear");
  if (clearBtn) clearBtn.onclick = async () => { await api("/settings", { method: "PUT", body: { clear_key: true } }); toast("Key removed"); render(); };
  window.llmPreset = (base, model, name) => {
    $("#st-base").value = base; $("#st-model").value = model;
    $("#preset-hint").textContent = {
      Groq: "Groq: get a free key at console.groq.com → API Keys (no card needed).",
      OpenRouter: "OpenRouter: free key at openrouter.ai/keys — pick any ':free' model.",
      Ollama: "Ollama: run `ollama serve` + `ollama pull llama3.2` on your machine. No key needed.",
    }[name] || "";
    toast(name + " preset loaded — add the free key and save");
  };
  $("#st-reset").onclick = async () => {
    if (!confirm("Reset the whole workspace? This clears your profile, packets, events and logs.")) return;
    await api("/reset", { method: "POST", body: { confirm: true } });
    toast("Workspace reset"); location.hash = "#/dashboard"; render();
  };
}
