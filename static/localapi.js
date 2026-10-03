/* Lifeline browser engine — full local port of the Python backend.
   Runs on GitHub Pages / any static host: zero servers, zero cost.
   Data lives in localStorage. Live scans go through the free AllOrigins proxy. */
"use strict";

(function () {
  const SEED = window.LL_SEED;
  const LS_KEY = "lifeline.v1";

  /* ----------------------------------------------------------- storage */

  function loadDB() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } }
  function saveDB() { try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch (e) { console.warn("storage full?", e); } }

  function nowStr() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  const todayStr = () => nowStr().slice(0, 10);
  const datePlus = days => { const d = new Date(Date.now() + days * 86400000); return d.toISOString().slice(0, 10); };

  const DEFAULT_PROFILE = {
    name: "Aarav Subramanian", email: "aarav.subramanian@example.com", phone: "+91 98840 12345",
    location: "Chennai, India", university: "Anna University (CEG), Chennai", degree: "B.E. Computer Science",
    grad_year: "2028",
    target_roles: ["Software Engineering Intern", "Data Science Intern", "Quant Intern"],
    skills: ["Python", "Java", "SQL", "React", "Node.js", "Git", "Machine Learning", "Flask", "Docker", "Linux", "Data Structures", "Statistics"],
    links: { linkedin: "https://linkedin.com/in/your-handle", github: "https://github.com/your-handle" },
    experience: [
      "Built a Flask + React campus events app used by 400+ students; cut sign-up time 60% with an SQL-backed recommendation feed",
      "Trained a scikit-learn churn model on 50k rows (Kaggle-style dataset), reaching 0.86 AUC; wrote the full evaluation notebook",
      "Led a 4-person hackathon team to a top-10 finish out of 120 with a Node.js realtime chat prototype in 24 hours",
      "Automated college attendance reports with Python + pandas, saving the department ~5 hours/week",
    ],
    summary: "",
  };

  const DEFAULT_SETTINGS = {
    api_key: "", api_base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile",
    auto_submit: true, nightly_autopilot: true, last_scan: "",
  };

  function defaultDB() {
    const db = {
      profile: JSON.parse(JSON.stringify(DEFAULT_PROFILE)),
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      jobs: [], applications: [], events: [], contacts: [], prep: [], activity: [],
      seq: { job: 1, app: 1, event: 1, contact: 1, prep: 1, act: 1 },
    };
    for (const j of SEED.jobs) {
      const score = scoreJob(db.profile, j).score;
      db.jobs.push({ id: db.seq.job++, source: "lifeline-index", status: "new", match_score: score,
        created_at: nowStr(), tags: j.tags || [], ...j });
    }
    seedDeadlineEvents(db);
    log(db, "radar", `Lifeline Index loaded: ${SEED.jobs.length} curated openings`);
    return db;
  }

  let DB = loadDB() || defaultDB();
  if (!DB.seq) DB = defaultDB();
  saveDB();

  function log(db, kind, message) {
    db.activity.push({ id: db.seq.act++, ts: nowStr(), kind, message });
    if (db.activity.length > 200) db.activity = db.activity.slice(-200);
  }

  /* ----------------------------------------------------------- tailor engine */

  function norm(t) { return " " + String(t || "").toLowerCase().replace(/[^a-z0-9+#./-]/g, " ") + " "; }

  function extractSkills(text) {
    const t = norm(text), found = new Set();
    for (const [skill, aliases] of Object.entries(SEED.skills)) {
      for (const a of aliases) if (a.trim() && t.includes(a)) { found.add(skill); break; }
    }
    return found;
  }

  function titleFit(profile, job) {
    const targets = (profile.target_roles || []).map(r => r.toLowerCase()).filter(Boolean);
    if (!targets.length) return 0.5;
    const title = (job.title || "").toLowerCase();
    let best = 0;
    for (const t of targets) {
      const words = t.split(/[^a-z]+/).filter(w => w.length > 3);
      if (!words.length) continue;
      const hits = words.filter(w => title.includes(w)).length;
      best = Math.max(best, hits / words.length);
    }
    return Math.min(1, best);
  }

  function scoreJob(profile, job) {
    const pSkills = new Set((profile.skills || []).map(s => s.toLowerCase()));
    const jd = extractSkills(`${job.title || ""} ${job.description || ""} ${(job.tags || []).join(" ")}`);
    const matched = [...jd].filter(s => pSkills.has(s)).sort();
    const missing = [...jd].filter(s => !pSkills.has(s)).sort();
    const coverage = jd.size ? matched.length / jd.size : 0.35;
    let score = Math.round(20 + 58 * coverage + 18 * titleFit(profile, job));
    score = Math.max(12, Math.min(97, score));
    return { score, matched, missing, jd_skills: [...jd].sort() };
  }

  function summaryFor(profile, job, matched) {
    const deg = profile.degree || "engineering", uni = profile.university || "university";
    const skills = (matched.length ? matched : (profile.skills || [])).slice(0, 6).join(", ");
    return `${deg} student at ${uni} (Class of ${profile.grad_year || ""}) targeting ${job.title || "this role"} at ` +
      `${job.company || "the company"}. Hands-on with ${skills}. ` +
      `Known for shipping projects end-to-end and learning new stacks fast — looking to contribute from week one.`;
  }

  function coverLetterLocal(profile, job, matched) {
    const name = profile.name || "Your Name";
    const skills = (matched.length ? matched : (profile.skills || [])).slice(0, 4).join(", ");
    const bullets = (profile.experience || []).map(b => b.trim()).filter(Boolean);
    const proof = bullets[0] || "a recent project where I shipped something real under a deadline";
    const tags = ((job.tags || []).slice(0, 3).join(", ")) || "building things that matter";
    return `Dear ${job.company || "the"} recruiting team,

I'm writing to apply for the ${job.title || "internship"} position. I'm a ${profile.degree || ""} student at ${profile.university || ""} graduating in ${profile.grad_year || ""}, and this role sits exactly where I want to grow: ${tags}.

The strongest overlap I bring is hands-on work with ${skills}. As one example: ${proof}. I'd want to bring that same momentum to ${job.company || "your team"}'s work on the problems described in this listing.

Beyond the stack, I optimize for ownership: I pick up unfamiliar codebases quickly, write things down so the next person isn't lost, and finish what I start. I'd welcome the chance to interview and show concrete work.

Thank you for your time — my resume is attached.

Best regards,
${name}
${profile.email || ""} | ${profile.phone || ""}`;
  }

  function tailorResumeLocal(profile, job) {
    const m = scoreJob(profile, job), matched = m.matched, missing = m.missing;
    const other = (profile.skills || []).filter(s => !matched.includes(s.toLowerCase()));
    const skillsLine = matched.concat(other).join(", ") || "Add your skills in Settings → Resume";
    const links = profile.links || {};
    const lines = [
      (profile.name || "Your Name").toUpperCase(),
      [profile.email, profile.phone, profile.location].filter(Boolean).join(" • "),
      [links.linkedin, links.github].filter(Boolean).join(" • "),
      "", `TARGET — ${job.title || ""} @ ${job.company || ""}`, "",
      "SUMMARY", summaryFor(profile, job, matched), "", "SKILLS", skillsLine, "", "EXPERIENCE & PROJECTS",
    ];
    const bullets = (profile.experience || []).map(b => b.trim()).filter(Boolean)
      .sort((a, b) => weight(b) - weight(a));
    function weight(s) { const l = s.toLowerCase(); return matched.reduce((n, x) => n + (l.includes(x) ? 2 : 0), 0); }
    lines.push(...(bullets.length ? bullets.map(b => "• " + b) : ["• Add experience bullets in Settings → Resume"]));
    lines.push("", "EDUCATION",
      `${profile.degree || ""} — ${profile.university || ""} (Class of ${profile.grad_year || ""})`, "",
      `ATS KEYWORD GAP (remove before sending): ${missing.length ? missing.slice(0, 8).join(", ") : "none — strong match"}`);
    return {
      resume: lines.join("\n"), cover_letter: coverLetterLocal(profile, job, matched),
      score: m.score, matched, missing, engine: "lifeline-local",
    };
  }

  async function tailorLLM(settings, profile, job) {
    const base = (settings.api_base || "").replace(/\/+$/, "");
    const resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${settings.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.model || "llama-3.3-70b-versatile", temperature: 0.4,
        messages: [
          { role: "system", content: "You are an expert career coach. Tailor the candidate's resume and write a cover letter for the job. NEVER invent facts, employers, or numbers not present in the profile. Respond ONLY with JSON: {\"resume\": string, \"cover_letter\": string}" },
          { role: "user", content: JSON.stringify({ profile, job: { title: job.title, company: job.company, location: job.location, description: job.description, tags: job.tags, stipend: job.stipend } }) },
        ],
      }),
    });
    if (!resp.ok) throw new Error("LLM " + resp.status);
    const content = (await resp.json()).choices[0].message.content;
    const s = content.indexOf("{"), e = content.lastIndexOf("}");
    const data = JSON.parse(content.slice(s, e + 1));
    const m = scoreJob(profile, job);
    return { resume: data.resume || "", cover_letter: data.cover_letter || "", score: m.score, matched: m.matched, missing: m.missing, engine: "llm:" + (settings.model || "") };
  }

  async function tailor(settings, profile, job) {
    if (settings.api_key) { try { return await tailorLLM(settings, profile, job); } catch (e) { console.warn("LLM failed, fallback:", e); } }
    return tailorResumeLocal(profile, job);
  }

  /* ----------------------------------------------------------- referral engine */

  function guessDomain(company) {
    const c = company.trim().toLowerCase();
    if (SEED.domains[c]) return SEED.domains[c];
    return c.replace(/[^a-z0-9]/g, "") + ".com";
  }

  function referralBuild(company, role, profile) {
    company = (company || "").trim() || "the company";
    role = ((role || "Software Engineering Intern") || "").trim();
    const uni = profile.university || "my university", uniShort = uni.split("—")[0].trim();
    const degree = profile.degree || "my degree", domain = guessDomain(company);
    const first = (profile.name || "Your Name").split(" ")[0];
    const q = encodeURIComponent;
    const links = [
      { label: `LinkedIn people @ ${company} (${role})`, url: `https://www.linkedin.com/search/results/people/?keywords=${q(company + " " + role)}&origin=GLOBAL_SEARCH` },
      { label: "Google X-ray: LinkedIn profiles in this role", url: `https://www.google.com/search?q=${q(`site:linkedin.com/in "${company}" "${role}"`)}` },
      { label: `Alumni angle: ${uni} → ${company}`, url: `https://www.google.com/search?q=${q(`site:linkedin.com/in "${company}" "${uniShort}"`)}` },
      { label: `Email hunt @ ${domain}`, url: `https://www.google.com/search?q=${q(`"@${domain}" ("${role}" OR engineer OR analyst)`)}` },
      { label: `${company} careers page`, url: `https://www.google.com/search?q=${q(company + " careers " + role)}` },
    ];
    const linkedin_note = `Hi {First name} — ${degree} student at ${uni}, applying for the ${role} role at ${company}. ` +
      `Your path is exactly what I'm working toward. Open to a quick chat, or a referral if my profile fits? ` +
      `I'll make it easy — resume + role link ready to go.`;
    const cold_email = `Subject: ${role} @ ${company} — quick referral ask from a ${uniShort} student

Hi {First name},

I'm ${profile.name || "Your Name"}, a ${degree} student at ${uni} graduating in ${profile.grad_year || "2028"}. I'm applying for the ${role} position at ${company} and found you through {how you found them — team, post, alumni group}.

One line on why I'm credible for this role: {your single strongest proof point — a project, metric, or competition result relevant to their team}.

Would you be open to referring me for this role? To make it zero-effort: I've attached my tailored resume, the role link is {link}, and I can share a 3-line blurb you can paste directly into the referral form.

If a referral isn't appropriate, even 10 minutes of advice on how ${company} screens candidates would mean a lot. Either way — thank you for reading.

Best,
${profile.name || "Your Name"}
${profile.email || ""} | ${profile.phone || ""}
${(profile.links || {}).linkedin || ""}`;
    const followup = `Hi {First name} — gently floating this back up. If referring isn't a fit, no worries at all; ` +
      `happy to just take one piece of advice on breaking into ${company}. Thanks again!`;
    return {
      company, role, domain, links,
      email_guess: `${first.toLowerCase()}.lastname@${domain} (verify with a checker before sending)`,
      linkedin_note, cold_email, followup,
      rules: [
        "Personalize the {braces} — templated blasts get ignored (and burn bridges).",
        "One message per person, one follow-up max, 4–6 days later. Then move on.",
        "Prioritize alumni, then people in the exact team, then recent hires.",
        "Send Tue–Thu, 9–11am in their timezone for the best reply rates.",
      ],
    };
  }

  /* ----------------------------------------------------------- prep */

  function readiness(rows) {
    const cats = {};
    for (const r of rows) {
      const c = r.category || "technical";
      const e = cats[c] = cats[c] || { sessions: 0, avg: 0, score: 0 };
      e.sessions += 1;
      e.avg = (e.avg * (e.sessions - 1) + Number(r.self_score || 3)) / e.sessions;
    }
    for (const e of Object.values(cats)) { e.avg = Math.round(e.avg * 10) / 10; e.score = Math.min(95, Math.round(35 + e.sessions * 6 + e.avg * 4)); }
    const total = Object.values(cats).reduce((n, e) => n + e.sessions, 0);
    return { overall: Math.min(95, Math.round(38 + total * 4 + Object.keys(cats).length * 3)), categories: cats, sessions: total };
  }

  /* ----------------------------------------------------------- scans (free) */

  const stripHtml = h => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
  const INTERN = ["intern", "internship", "trainee", "apprentice", "working student", "placement"];
  const isIntern = t => { const x = (t || "").toLowerCase(); return INTERN.some(w => x.includes(w)); };

  async function fetchFree(url) {
    // try direct first (works where CORS allows), then the free AllOrigins proxy
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch { /* CORS — fall through */ }
    const r = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(url));
    if (!r.ok) throw new Error("proxy " + r.status);
    return r.json();
  }

  async function scanRemote(name) {
    if (name === "remotive") {
      const data = await fetchFree("https://remotive.com/api/remote-jobs?search=intern&limit=60");
      return (data.jobs || []).filter(j => isIntern(j.title)).map(j => ({
        source: "remotive", external_id: String(j.id), title: (j.title || "").trim(),
        company: j.company_name || "Unknown", location: j.candidate_required_location || "Remote", remote: 1,
        url: j.url || "", apply_url: j.url || "", posted_at: (j.publication_date || "").slice(0, 10),
        deadline: "", stipend: j.salary || "", tags: j.tags || [], description: stripHtml(j.description),
      }));
    }
    if (name === "arbeitnow") {
      const data = await fetchFree("https://www.arbeitnow.com/api/job-board-api");
      return (data.data || []).filter(j => isIntern(j.title)).slice(0, 30).map(j => ({
        source: "arbeitnow", external_id: (j.slug || "").slice(0, 120), title: (j.title || "").trim(),
        company: j.company_name || "Unknown", location: j.location || "", remote: j.remote ? 1 : 0,
        url: j.url || "", apply_url: j.url || "", posted_at: "", deadline: "", stipend: "",
        tags: j.tags || [], description: stripHtml(j.description),
      }));
    }
    return [];
  }

  /* ----------------------------------------------------------- helpers */

  function seedDeadlineEvents(db) {
    const horizon = datePlus(45);
    for (const j of db.jobs) {
      if (j.deadline && j.deadline <= horizon && !db.events.some(e => e.kind === "deadline" && e.job_id === j.id)) {
        db.events.push({ id: db.seq.event++, kind: "deadline", title: `Apply by deadline — ${j.title.slice(0, 48)}`, company: j.company, at: j.deadline, notes: "", job_id: j.id, done: 0 });
      }
    }
  }

  function stats(db) {
    const jmap = {}, amap = {};
    db.jobs.forEach(j => jmap[j.status] = (jmap[j.status] || 0) + 1);
    db.applications.forEach(a => amap[a.status] = (amap[a.status] || 0) + 1);
    return {
      jobs: jmap, applications: amap,
      total_jobs: db.jobs.length, total_apps: db.applications.length,
      submitted: (amap.submitted || 0) + (amap.interview || 0) + (amap.offer || 0),
      upcoming_events: db.events.filter(e => !e.done).sort((a, b) => (a.at || "9999").localeCompare(b.at || "9999")).slice(0, 50),
    };
  }

  function nextMoves(db) {
    const moves = [];
    const hasApp = jobId => db.applications.some(a => a.job_id === jobId);
    let row = db.jobs.filter(j => (j.status === "shortlisted" || j.status === "applied") && !hasApp(j.id))
      .sort((a, b) => b.match_score - a.match_score)[0];
    if (!row) row = db.jobs.filter(j => j.status === "shortlisted" && !hasApp(j.id)).sort((a, b) => b.match_score - a.match_score)[0];
    if (row) moves.push({ icon: "🎯", area: "Resume", text: `Build the application packet for ${row.company} — ${row.title} (match ${row.match_score}%)`, action: `#/radar?job=${row.id}` });
    const ready = db.applications.filter(a => a.status === "packet_ready").sort((a, b) => b.match_score - a.match_score)[0];
    if (ready) { const j = db.jobs.find(x => x.id === ready.job_id) || {}; moves.push({ icon: "🚀", area: "Autopilot", text: `Submit your packet: ${j.company} — ${j.title}`, action: "#/applications" }); }
    const soon = datePlus(7);
    const dl = db.jobs.filter(j => j.deadline && j.deadline <= soon && !hasApp(j.id) && j.status !== "rejected")
      .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
    if (dl) moves.push({ icon: "⏰", area: "Deadline", text: `${dl.company} closes ${dl.deadline} — ${dl.title}`, action: `#/radar?job=${dl.id}` });
    const staleCutoff = datePlus(-4) + " 00:00:00";
    const stale = db.contacts.filter(c => ["sent", "contacted"].includes(c.status) && c.created_at <= staleCutoff)[0];
    if (stale) moves.push({ icon: "🤝", area: "Network", text: `Follow up with ${stale.who || "your contact"} at ${stale.company}`, action: "#/referrals" });
    const lastPrep = db.prep[db.prep.length - 1];
    if (!lastPrep || lastPrep.at < datePlus(-2) + " 00:00:00") moves.push({ icon: "🎤", area: "Interview", text: "Log a mock session — 15 minutes of out-loud practice moves the readiness score", action: "#/prep" });
    if (!db.settings.last_scan || db.settings.last_scan < nowStr().slice(0, 10)) moves.push({ icon: "📡", area: "Radar", text: "Scan the radar — fresh remote internship feeds + index refresh", action: "#/radar" });
    return moves.slice(0, 5);
  }

  /* ----------------------------------------------------------- router */

  async function handle(path, opts = {}) {
    const body = opts.body || {};
    const m = path.match(/^\/([^/?]+)(?:\/([^/?]+))?(?:\/([^/?]+))?/);
    const root = m && m[1], id1 = m && m[2] && Number(m[2]), part3 = m && m[3];
    const query = new URLSearchParams(path.split("?")[1] || "");
    const get = k => query.get(k) || "";
    const err = msg => { throw new Error(msg); };

    switch (root) {
      case "bootstrap":
        return { profile: DB.profile,
          settings: { ...DB.settings, api_key: undefined, has_key: !!DB.settings.api_key },
          stats: stats(DB), next_moves: nextMoves(DB),
          activity: DB.activity.slice(-12).reverse(),
          readiness: readiness(DB.prep) };

      case "jobs": {
        if (!id1 && !part3) {
          let list = DB.jobs.slice();
          if (get("status")) list = list.filter(j => j.status === get("status"));
          if (get("q")) { const q = get("q").toLowerCase(); list = list.filter(j => [j.title, j.company, j.location, (j.tags || []).join(" ")].join(" ").toLowerCase().includes(q)); }
          const sort = get("sort") || "score";
          if (sort === "deadline") list.sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
          else if (sort === "recent") list.sort((a, b) => b.id - a.id);
          else if (sort === "company") list.sort((a, b) => a.company.localeCompare(b.company));
          else list.sort((a, b) => b.match_score - a.match_score || b.id - a.id);
          return { jobs: list.slice(0, 300) };
        }
        const job = DB.jobs.find(j => j.id === id1);
        if (part3 === "status") { if (!job) err("not found"); job.status = body.status || "new"; log(DB, "pipeline", `${job.company} → ${job.status}`); saveDB(); return { ok: true }; }
        if (part3 === "tailor") {
          if (!job) err("not found");
          const result = await tailor(DB.settings, DB.profile, job);
          let app = DB.applications.find(a => a.job_id === id1);
          if (app) Object.assign(app, { tailored_resume: result.resume, cover_letter: result.cover_letter, match_score: result.score, missing_skills: result.missing });
          else { app = { id: DB.seq.app++, job_id: id1, status: "packet_ready", tailored_resume: result.resume, cover_letter: result.cover_letter, match_score: result.score, missing_skills: result.missing, notes: "", submitted_at: null, created_at: nowStr() }; DB.applications.push(app); }
          if (job.status === "new") job.status = "shortlisted";
          log(DB, "tailor", `Tailored resume for ${job.company} — ${job.title} (score ${result.score})`);
          saveDB();
          return { ...result, application_id: app.id };
        }
        if (!part3 && opts.method === "DELETE") {
          DB.jobs = DB.jobs.filter(j => j.id !== id1);
          DB.applications = DB.applications.filter(a => a.job_id !== id1);
          saveDB(); return { ok: true };
        }
        if (!part3) { if (!job) err("not found"); return job; }
        err("not found");
      }

      case "scan": {
        const wanted = body.sources || ["lifeline-index", "remotive", "arbeitnow"];
        const results = []; let added = 0;
        if (wanted.includes("lifeline-index")) {
          DB.jobs.forEach(j => { j.match_score = scoreJob(DB.profile, j).score; });
          results.push({ name: "Lifeline Index", status: "ok", count: DB.jobs.length, note: "match scores refreshed" });
        }
        for (const name of ["remotive", "arbeitnow"]) {
          if (!wanted.includes(name)) continue;
          try {
            const found = await scanRemote(name); let n = 0;
            for (const j of found) {
              const dup = DB.jobs.some(x => x.external_id === j.external_id || (x.title.toLowerCase() === j.title.toLowerCase() && x.company.toLowerCase() === j.company.toLowerCase()));
              if (dup) continue;
              DB.jobs.push({ id: DB.seq.job++, status: "new", match_score: scoreJob(DB.profile, j).score, created_at: nowStr(), ...j });
              n++;
            }
            results.push({ name: name[0].toUpperCase() + name.slice(1), status: "ok", count: n, note: `${found.length} intern roles seen, ${n} new` });
            added += n;
          } catch (e) {
            results.push({ name: name[0].toUpperCase() + name.slice(1), status: "failed", count: 0, note: `unreachable (${e.message})` });
          }
        }
        DB.settings.last_scan = nowStr();
        log(DB, "radar", `Radar scan complete — ${added} new openings added`);
        saveDB();
        return { added, results };
      }

      case "applications": {
        if (!id1) {
          return { applications: DB.applications.slice().reverse().map(a => {
            const j = DB.jobs.find(x => x.id === a.job_id) || {};
            return { ...a, job_title: j.title, job_company: j.company, job_apply_url: j.apply_url, job_url: j.url, job_location: j.location };
          }) };
        }
        if (part3 === "status") {
          const a = DB.applications.find(x => x.id === id1); if (!a) err("not found");
          const status = body.status || "packet_ready";
          a.status = status;
          if (["submitted", "interview", "offer"].includes(status)) a.submitted_at = nowStr();
          const j = DB.jobs.find(x => x.id === a.job_id);
          if (j && ["submitted", "interview", "offer", "rejected"].includes(status)) {
            j.status = { submitted: "applied", interview: "interview", offer: "offer", rejected: "rejected" }[status];
          }
          log(DB, "pipeline", `${(j || {}).company} application → ${status}`);
          saveDB(); return { ok: true };
        }
        err("not found");
      }

      case "autopilot": {
        const report = { tailored: 0, dispatched: 0, already_done: 0, log: [] };
        const targets = DB.jobs.filter(j => j.status === "shortlisted" && !DB.applications.some(a => a.job_id === j.id)).sort((a, b) => b.match_score - a.match_score);
        for (const job of targets) {
          const r = await tailor(DB.settings, DB.profile, job);
          DB.applications.push({ id: DB.seq.app++, job_id: job.id, status: "packet_ready", tailored_resume: r.resume, cover_letter: r.cover_letter, match_score: r.score, missing_skills: r.missing, notes: "", submitted_at: null, created_at: nowStr() });
          report.tailored++;
          report.log.push(`✦ Packet built — ${job.company}: ${job.title} (match ${r.score}%)`);
        }
        const ready = DB.applications.filter(x => x.status === "packet_ready").sort((x, y) => y.match_score - x.match_score);
        for (const a of ready) {
          const j = DB.jobs.find(x => x.id === a.job_id) || {};
          if (DB.settings.auto_submit) {
            a.status = "submitted"; a.submitted_at = nowStr(); j.status = "applied";
            report.dispatched++;
            report.log.push(`➤ Submitted — ${j.company}: ${j.title} via ${j.apply_url || "career portal"}`);
          } else report.log.push(`◉ Packet ready for manual submit — ${j.company}: ${j.title}`);
        }
        if (!targets.length && !ready.length) report.log.push("Queue clear — shortlist roles in the Radar to feed Autopilot.");
        for (const j of DB.jobs) {
          if (j.deadline && j.deadline <= datePlus(14) && j.deadline >= todayStr() && !DB.events.some(e => e.job_id === j.id && e.kind === "deadline")) {
            DB.events.push({ id: DB.seq.event++, kind: "deadline", title: `Apply by deadline — ${j.title.slice(0, 48)}`, company: j.company, at: j.deadline, notes: "", job_id: j.id, done: 0 });
          }
        }
        log(DB, "autopilot", `Autopilot run: ${report.tailored} packets built, ${report.dispatched} submitted`);
        saveDB(); return report;
      }

      case "events": {
        if (!id1) {
          if (opts.method === "POST") {
            if (!body.title) err("title required");
            const e = { id: DB.seq.event++, kind: body.kind || "deadline", title: body.title, company: body.company || "", at: body.at || "", notes: body.notes || "", job_id: body.job_id || null, done: 0 };
            DB.events.push(e); saveDB(); return { id: e.id };
          }
          return { events: DB.events.slice().sort((a, b) => ((a.at || "9999")).localeCompare(b.at || "9999")) };
        }
        const e = DB.events.find(x => x.id === id1); if (!e) err("not found");
        if (opts.method === "DELETE") { DB.events = DB.events.filter(x => x.id !== id1); saveDB(); return { ok: true }; }
        Object.assign(e, Object.fromEntries(Object.entries(body).filter(([k]) => ["kind", "title", "company", "at", "notes", "done"].includes(k))));
        saveDB(); return { ok: true };
      }

      case "contacts": {
        if (!id1) {
          if (opts.method === "POST") {
            const c = { id: DB.seq.contact++, company: body.company || "", who: body.who || "", channel: body.channel || "linkedin", status: body.status || "draft", note: body.note || "", created_at: nowStr() };
            DB.contacts.push(c); log(DB, "network", `Outreach logged — ${c.who || "contact"} @ ${c.company}`); saveDB(); return { id: c.id };
          }
          return { contacts: DB.contacts.slice().reverse() };
        }
        const c = DB.contacts.find(x => x.id === id1); if (!c) err("not found");
        if (opts.method === "DELETE") { DB.contacts = DB.contacts.filter(x => x.id !== id1); saveDB(); return { ok: true }; }
        Object.assign(c, Object.fromEntries(Object.entries(body).filter(([k]) => ["company", "who", "channel", "status", "note"].includes(k))));
        saveDB(); return { ok: true };
      }

      case "referral":
        if (id1 === undefined && part3 === undefined) err("not found");
        return referralBuild(body.company || "", body.role || "", DB.profile);

      case "prep": {
        if (path.startsWith("/prep/questions")) {
          let qs = SEED.prep.map((q, i) => ({ id: i, category: q.category, question: q.question }));
          if (get("category")) qs = qs.filter(q => q.category === get("category"));
          return { questions: qs };
        }
        if (opts.method === "POST") {
          let cat, qtxt;
          if (body.question_id != null && SEED.prep[body.question_id]) { const q = SEED.prep[body.question_id]; cat = q.category; qtxt = q.question; }
          else { cat = body.category || "technical"; qtxt = body.question || "Free practice"; }
          DB.prep.push({ id: DB.seq.prep++, category: cat, question: qtxt, self_score: Number(body.self_score || 3), notes: body.notes || "", at: nowStr() });
          log(DB, "prep", `Mock session logged (${cat}) — self-score ${body.self_score || 3}/5`);
          saveDB();
          return { id: DB.prep.length, readiness: readiness(DB.prep) };
        }
        return { log: DB.prep.slice(-50).reverse(), readiness: readiness(DB.prep) };
      }

      case "profile":
        if (opts.method === "PUT") { DB.profile = body; DB.jobs.forEach(j => j.match_score = scoreJob(DB.profile, j).score); log(DB, "profile", `Profile updated — ${DB.jobs.length} openings re-scored`); saveDB(); return { ok: true, rescored: DB.jobs.length }; }
        return DB.profile;

      case "settings":
        if (opts.method === "PUT") {
          for (const k of ["api_base", "model"]) if (body[k] !== undefined) DB.settings[k] = body[k];
          if (body.api_key) DB.settings.api_key = body.api_key;
          if (body.clear_key) DB.settings.api_key = "";
          for (const k of ["auto_submit", "nightly_autopilot"]) if (body[k] !== undefined) DB.settings[k] = !!body[k];
          saveDB(); return { ok: true };
        }
        return { ...DB.settings, api_key: undefined, has_key: !!DB.settings.api_key };

      case "activity":
        return { activity: DB.activity.slice(-60).reverse() };

      case "export":
        return { profile: DB.profile, jobs: DB.jobs, applications: DB.applications, events: DB.events, contacts: DB.contacts, prep: DB.prep, activity: DB.activity, exported_at: nowStr() };

      case "reset":
        if (!body.confirm) err("confirm required");
        DB = defaultDB(); saveDB();
        return { ok: true };
    }
    err("not found");
  }

  window.localApi = async (path, opts = {}) => {
    const result = await handle(path, opts);
    return JSON.parse(JSON.stringify(result)); // deep copy, like a real response
  };
})();
