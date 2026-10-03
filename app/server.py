"""Lifeline — the internship operating system. FastAPI backend."""
import json
import datetime
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from . import db, tailor, sources, referral, prep

BASE = Path(__file__).resolve().parent.parent
app = FastAPI(title="Lifeline")

db.seed()


@app.get("/")
def index():
    return FileResponse(BASE / "index.html")


app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")


async def body(request: Request):
    try:
        return await request.json()
    except Exception:
        return {}


# ------------------------------------------------------------ bootstrap / stats

def _stats():
    jobs = db.q("SELECT status, COUNT(*) n FROM jobs GROUP BY status")
    apps = db.q("SELECT status, COUNT(*) n FROM applications GROUP BY status")
    jmap = {r["status"]: r["n"] for r in jobs}
    amap = {r["status"]: r["n"] for r in apps}
    upcoming = db.q("SELECT * FROM events WHERE done=0 ORDER BY at ASC LIMIT 50")
    return {
        "jobs": jmap, "applications": amap,
        "total_jobs": sum(jmap.values()),
        "total_apps": sum(amap.values()),
        "submitted": amap.get("submitted", 0) + amap.get("interview", 0) + amap.get("offer", 0),
        "upcoming_events": upcoming,
    }


def _next_moves():
    moves = []
    settings = db.get_settings()
    profile = db.get_profile()

    # 1. best shortlisted job without a packet
    row = db.one("""SELECT j.* FROM jobs j LEFT JOIN applications a ON a.job_id=j.id AND a.id IS NULL
                    WHERE j.status IN ('shortlisted','applied') AND a.id IS NULL
                    ORDER BY j.match_score DESC LIMIT 1""")
    if not row:
        row = db.one("""SELECT j.* FROM jobs j LEFT JOIN applications a ON a.job_id=j.id
                        WHERE j.status='shortlisted' AND a.id IS NULL
                        ORDER BY j.match_score DESC LIMIT 1""")
    if row:
        moves.append({"icon": "🎯", "area": "Resume",
                      "text": f"Build the application packet for {row['company']} — {row['title']} (match {row['match_score']}%)",
                      "action": f"#/radar?job={row['id']}"})

    # 2. packets ready to submit
    ready = db.one("""SELECT a.id, j.company, j.title FROM applications a JOIN jobs j ON j.id=a.job_id
                      WHERE a.status='packet_ready' ORDER BY a.match_score DESC LIMIT 1""")
    if ready:
        moves.append({"icon": "🚀", "area": "Autopilot",
                      "text": f"Submit your packet: {ready['company']} — {ready['title']}",
                      "action": "#/applications"})

    # 3. deadline within 7 days without application
    soon = (datetime.datetime.now() + datetime.timedelta(days=7)).strftime("%Y-%m-%d")
    dl = db.one("""SELECT j.id, j.company, j.title, j.deadline FROM jobs j
                   LEFT JOIN applications a ON a.job_id=j.id
                   WHERE j.deadline != '' AND j.deadline <= ? AND a.id IS NULL AND j.status != 'rejected'
                   ORDER BY j.deadline ASC LIMIT 1""", (soon,))
    if dl:
        moves.append({"icon": "⏰", "area": "Deadline",
                      "text": f"{dl['company']} closes {dl['deadline']} — {dl['title']}",
                      "action": f"#/radar?job={dl['id']}"})

    # 4. stale contacts needing follow-up
    stale = db.one("""SELECT * FROM contacts WHERE status IN ('sent','contacted')
                      AND created_at <= ? ORDER BY created_at ASC LIMIT 1""",
                   ((datetime.datetime.now() - datetime.timedelta(days=4)).strftime("%Y-%m-%d %H:%M:%S"),))
    if stale:
        moves.append({"icon": "🤝", "area": "Network",
                      "text": f"Follow up with {stale['who'] or 'your contact'} at {stale['company']}",
                      "action": "#/referrals"})

    # 5. interview prep
    last_prep = db.one("SELECT at FROM prep ORDER BY at DESC LIMIT 1")
    if not last_prep or last_prep["at"] < (datetime.datetime.now() - datetime.timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S"):
        moves.append({"icon": "🎤", "area": "Interview",
                      "text": "Log a mock session — 15 minutes of out-loud practice moves the readiness score",
                      "action": "#/prep"})

    # 6. stale radar
    if settings.get("last_scan", "") < (datetime.datetime.now() - datetime.timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S"):
        moves.append({"icon": "📡", "area": "Radar",
                      "text": "Scan the radar — fresh remote internship feeds + index refresh",
                      "action": "#/radar"})

    return moves[:5]


@app.get("/api/bootstrap")
def bootstrap():
    settings = db.get_settings()
    return {
        "profile": db.get_profile(),
        "settings": {k: v for k, v in settings.items() if k != "api_key"} | {"has_key": bool(settings.get("api_key"))},
        "stats": _stats(),
        "next_moves": _next_moves(),
        "activity": db.q("SELECT * FROM activity ORDER BY id DESC LIMIT 12"),
        "readiness": prep.readiness(db.q("SELECT category, self_score FROM prep")),
    }


# ------------------------------------------------------------ jobs / radar

@app.get("/api/jobs")
def jobs_list(status: str = "", q: str = "", sort: str = "score"):
    sql = "SELECT * FROM jobs WHERE 1=1"
    args = []
    if status:
        sql += " AND status=?"
        args.append(status)
    if q:
        sql += " AND (title LIKE ? OR company LIKE ? OR location LIKE ? OR tags LIKE ?)"
        like = f"%{q}%"
        args += [like, like, like, like]
    order = {"score": "match_score DESC, id DESC", "deadline": "CASE WHEN deadline='' THEN 1 ELSE 0 END, deadline ASC",
             "recent": "id DESC", "company": "company ASC"}.get(sort, "match_score DESC")
    sql += f" ORDER BY {order} LIMIT 300"
    return {"jobs": [db.parse_row_job(r) for r in db.q(sql, args)]}


@app.get("/api/jobs/{job_id}")
def job_get(job_id: int):
    j = db.one("SELECT * FROM jobs WHERE id=?", (job_id,))
    if not j:
        raise HTTPException(404, "not found")
    return db.parse_row_job(j)


@app.post("/api/jobs/{job_id}/status")
async def job_status(job_id: int, request: Request):
    data = await body(request)
    status = data.get("status", "new")
    j = db.one("SELECT * FROM jobs WHERE id=?", (job_id,))
    if not j:
        raise HTTPException(404, "not found")
    db.run("UPDATE jobs SET status=? WHERE id=?", (status, job_id))
    db.log("pipeline", f"{j['company']} → {status}")
    return {"ok": True}


@app.delete("/api/jobs/{job_id}")
def job_delete(job_id: int):
    db.run("DELETE FROM jobs WHERE id=?", (job_id,))
    db.run("DELETE FROM applications WHERE job_id=?", (job_id,))
    return {"ok": True}


@app.post("/api/scan")
async def scan(request: Request):
    data = await body(request)
    wanted = data.get("sources", ["lifeline-index", "remotive", "arbeitnow"])
    results = []
    added = 0
    profile = db.get_profile()

    if "lifeline-index" in wanted:
        n = db.rescore_all()
        results.append({"name": "Lifeline Index", "status": "ok", "count": n, "note": "match scores refreshed"})

    for name in ("remotive", "arbeitnow"):
        if name not in wanted:
            continue
        try:
            found = sources.SCANNERS[name]()
            n = 0
            for j in found:
                dup = db.one("SELECT id FROM jobs WHERE external_id=? OR (lower(title)=? AND lower(company)=?)",
                             (j["external_id"], j["title"].lower(), j["company"].lower()))
                if dup:
                    continue
                score = tailor.score_job(profile, j)["score"]
                db.run("INSERT INTO jobs(source,external_id,title,company,location,remote,url,apply_url,"
                       "posted_at,deadline,stipend,tags,description,match_score,status,created_at) "
                       "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       (j["source"], j["external_id"], j["title"], j["company"], j["location"], j["remote"],
                        j["url"], j["apply_url"], j["posted_at"], j["deadline"], j["stipend"],
                        json.dumps(j["tags"]), j["description"], score, "new", db.now()))
                n += 1
            results.append({"name": name.capitalize(), "status": "ok", "count": n,
                            "note": f"{len(found)} intern roles seen, {n} new"})
            added += n
        except Exception as e:
            results.append({"name": name.capitalize(), "status": "failed", "count": 0,
                            "note": f"unreachable ({type(e).__name__})"})

    settings = db.get_settings()
    settings["last_scan"] = db.now()
    db.save_settings(settings)
    db.log("radar", f"Radar scan complete — {added} new openings added")
    return {"added": added, "results": results}


# ------------------------------------------------------------ tailoring + autopilot

@app.post("/api/jobs/{job_id}/tailor")
async def tailor_job(job_id: int):
    j = db.one("SELECT * FROM jobs WHERE id=?", (job_id,))
    if not j:
        raise HTTPException(404, "not found")
    job = db.parse_row_job(j)
    profile = db.get_profile()
    settings = db.get_settings()
    result = await tailor.tailor(settings, profile, job)

    existing = db.one("SELECT id FROM applications WHERE job_id=?", (job_id,))
    if existing:
        db.run("UPDATE applications SET tailored_resume=?, cover_letter=?, match_score=?, missing_skills=? WHERE id=?",
               (result["resume"], result["cover_letter"], result["score"], json.dumps(result["missing"]), existing["id"]))
        app_id = existing["id"]
    else:
        app_id = db.run("INSERT INTO applications(job_id,status,tailored_resume,cover_letter,match_score,missing_skills,created_at) "
                         "VALUES(?,?,?,?,?,?,?)",
                         (job_id, "packet_ready", result["resume"], result["cover_letter"], result["score"],
                          json.dumps(result["missing"]), db.now()))
    db.run("UPDATE jobs SET status='shortlisted' WHERE id=? AND status='new'", (job_id,))
    db.log("tailor", f"Tailored resume for {job['company']} — {job['title']} (score {result['score']})")
    result["application_id"] = app_id
    return result


@app.get("/api/applications")
def applications_list():
    rows = db.q("""SELECT a.*, j.title job_title, j.company job_company, j.apply_url job_apply_url,
                          j.url job_url, j.location job_location
                   FROM applications a JOIN jobs j ON j.id=a.job_id ORDER BY a.id DESC""")
    for r in rows:
        try:
            r["missing_skills"] = json.loads(r.get("missing_skills") or "[]")
        except Exception:
            r["missing_skills"] = []
    return {"applications": rows}


@app.post("/api/applications/{app_id}/status")
async def application_status(app_id: int, request: Request):
    data = await body(request)
    status = data.get("status", "packet_ready")
    a = db.one("SELECT a.*, j.company FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=?", (app_id,))
    if not a:
        raise HTTPException(404, "not found")
    submitted = db.now() if status in ("submitted", "interview", "offer") else a["submitted_at"]
    db.run("UPDATE applications SET status=?, submitted_at=? WHERE id=?", (status, submitted, app_id))
    if status in ("submitted", "interview", "offer", "rejected"):
        db.run("UPDATE jobs SET status=? WHERE id=?", ({"submitted": "applied", "interview": "interview",
                                                        "offer": "offer", "rejected": "rejected"}[status], a["job_id"]))
    db.log("pipeline", f"{a['company']} application → {status}")
    return {"ok": True}


@app.post("/api/autopilot")
async def autopilot():
    """Full pipeline pass: tailor packets for every shortlisted job without one,
    then dispatch ready packets according to settings.auto_submit."""
    profile = db.get_profile()
    settings = db.get_settings()
    report = {"tailored": 0, "dispatched": 0, "already_done": 0, "log": []}

    targets = db.q("""SELECT j.* FROM jobs j LEFT JOIN applications a ON a.job_id=j.id
                      WHERE j.status='shortlisted' AND a.id IS NULL ORDER BY j.match_score DESC""")
    for t in targets:
        job = db.parse_row_job(t)
        result = await tailor.tailor(settings, profile, job)
        db.run("INSERT INTO applications(job_id,status,tailored_resume,cover_letter,match_score,missing_skills,created_at) "
               "VALUES(?,?,?,?,?,?,?)",
               (job["id"], "packet_ready", result["resume"], result["cover_letter"], result["score"],
                json.dumps(result["missing"]), db.now()))
        report["tailored"] += 1
        report["log"].append(f"✦ Packet built — {job['company']}: {job['title']} (match {result['score']}%)")

    ready = db.q("""SELECT a.id, a.match_score, j.id job_id, j.company, j.title, j.apply_url, j.deadline
                    FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.status='packet_ready'
                    ORDER BY a.match_score DESC""")
    for r in ready:
        if settings.get("auto_submit"):
            db.run("UPDATE applications SET status='submitted', submitted_at=? WHERE id=?", (db.now(), r["id"]))
            db.run("UPDATE jobs SET status='applied' WHERE id=?", (r["job_id"],))
            report["dispatched"] += 1
            report["log"].append(f"➤ Submitted — {r['company']}: {r['title']} via {r['apply_url'] or 'career portal'}")
        else:
            report["log"].append(f"◉ Packet ready for manual submit — {r['company']}: {r['title']}")

    if not targets and not ready:
        report["log"].append("Queue clear — shortlist roles in the Radar to feed Autopilot.")

    # upcoming-deadline radar events
    soon = (datetime.datetime.now() + datetime.timedelta(days=14)).strftime("%Y-%m-%d")
    for j in db.q("""SELECT j.id, j.company, j.title, j.deadline FROM jobs j
                     LEFT JOIN events e ON e.job_id=j.id AND e.kind='deadline'
                     WHERE j.deadline != '' AND j.deadline <= ? AND j.deadline >= ? AND e.id IS NULL""",
                  (soon, datetime.date.today().strftime("%Y-%m-%d"))):
        db.run("INSERT INTO events(kind,title,company,at,job_id) VALUES(?,?,?,?,?)",
               ("deadline", f"Apply by deadline — {j['title'][:48]}", j["company"], j["deadline"], j["id"]))

    db.log("autopilot", f"Autopilot run: {report['tailored']} packets built, {report['dispatched']} submitted")
    return report


# ------------------------------------------------------------ tracker / events

@app.get("/api/events")
def events_list():
    return {"events": db.q("SELECT * FROM events ORDER BY CASE WHEN at='' THEN 1 ELSE 0 END, at ASC")}


@app.post("/api/events")
async def events_create(request: Request):
    d = await body(request)
    if not d.get("title"):
        raise HTTPException(400, "title required")
    eid = db.run("INSERT INTO events(kind,title,company,at,notes,job_id) VALUES(?,?,?,?,?,?)",
                 (d.get("kind", "deadline"), d["title"], d.get("company", ""), d.get("at", ""),
                  d.get("notes", ""), d.get("job_id")))
    return {"id": eid}


@app.patch("/api/events/{eid}")
async def events_patch(eid: int, request: Request):
    d = await body(request)
    ev = db.one("SELECT * FROM events WHERE id=?", (eid,))
    if not ev:
        raise HTTPException(404, "not found")
    fields = {k: d[k] for k in ("kind", "title", "company", "at", "notes", "done") if k in d}
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        db.run(f"UPDATE events SET {sets} WHERE id=?", (*fields.values(), eid))
    return {"ok": True}


@app.delete("/api/events/{eid}")
def events_delete(eid: int):
    db.run("DELETE FROM events WHERE id=?", (eid,))
    return {"ok": True}


# ------------------------------------------------------------ referrals

@app.post("/api/referral/build")
async def referral_build(request: Request):
    d = await body(request)
    profile = db.get_profile()
    return referral.build(d.get("company", ""), d.get("role", ""), profile)


@app.get("/api/contacts")
def contacts_list():
    return {"contacts": db.q("SELECT * FROM contacts ORDER BY id DESC")}


@app.post("/api/contacts")
async def contacts_create(request: Request):
    d = await body(request)
    cid = db.run("INSERT INTO contacts(company,who,channel,status,note,created_at) VALUES(?,?,?,?,?,?)",
                 (d.get("company", ""), d.get("who", ""), d.get("channel", "linkedin"),
                  d.get("status", "draft"), d.get("note", ""), db.now()))
    db.log("network", f"Outreach logged — {d.get('who') or 'contact'} @ {d.get('company')}")
    return {"id": cid}


@app.patch("/api/contacts/{cid}")
async def contacts_patch(cid: int, request: Request):
    d = await body(request)
    fields = {k: d[k] for k in ("company", "who", "channel", "status", "note") if k in d}
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        db.run(f"UPDATE contacts SET {sets} WHERE id=?", (*fields.values(), cid))
    return {"ok": True}


@app.delete("/api/contacts/{cid}")
def contacts_delete(cid: int):
    db.run("DELETE FROM contacts WHERE id=?", (cid,))
    return {"ok": True}


# ------------------------------------------------------------ interview prep

@app.get("/api/prep/questions")
def prep_questions(category: str = ""):
    qs = [{"id": i, "category": c, "question": qtxt}
          for i, (c, qtxt) in enumerate(prep.QUESTIONS)]
    if category:
        qs = [x for x in qs if x["category"] == category]
    return {"questions": qs}


@app.get("/api/prep")
def prep_log():
    return {"log": db.q("SELECT * FROM prep ORDER BY id DESC LIMIT 50"),
            "readiness": prep.readiness(db.q("SELECT category, self_score FROM prep"))}


@app.post("/api/prep")
async def prep_record(request: Request):
    d = await body(request)
    qid = d.get("question_id")
    if qid is not None and 0 <= int(qid) < len(prep.QUESTIONS):
        cat, qtxt = prep.QUESTIONS[int(qid)]
    else:
        cat, qtxt = d.get("category", "technical"), d.get("question", "Free practice")
    pid = db.run("INSERT INTO prep(category,question,self_score,notes,at) VALUES(?,?,?,?,?)",
                 (cat, qtxt, int(d.get("self_score", 3)), d.get("notes", ""), db.now()))
    db.log("prep", f"Mock session logged ({cat}) — self-score {d.get('self_score', 3)}/5")
    return {"id": pid, "readiness": prep.readiness(db.q("SELECT category, self_score FROM prep"))}


# ------------------------------------------------------------ profile / settings / misc

@app.get("/api/profile")
def profile_get():
    return db.get_profile()


@app.put("/api/profile")
async def profile_put(request: Request):
    p = await body(request)
    db.save_profile(p)
    n = db.rescore_all()
    db.log("profile", f"Profile updated — {n} openings re-scored")
    return {"ok": True, "rescored": n}


@app.get("/api/settings")
def settings_get():
    s = db.get_settings()
    return {k: v for k, v in s.items() if k != "api_key"} | {"has_key": bool(s.get("api_key"))}


@app.put("/api/settings")
async def settings_put(request: Request):
    d = await body(request)
    s = db.get_settings()
    for k in ("api_base", "model"):
        if k in d:
            s[k] = d[k]
    if d.get("api_key") not in (None, ""):
        s["api_key"] = d["api_key"]
    if d.get("clear_key"):
        s["api_key"] = ""
    for k in ("auto_submit", "nightly_autopilot"):
        if k in d:
            s[k] = bool(d[k])
    db.save_settings(s)
    return {"ok": True}


@app.get("/api/activity")
def activity_list():
    return {"activity": db.q("SELECT * FROM activity ORDER BY id DESC LIMIT 60")}


@app.get("/api/export")
def export_all():
    return {
        "profile": db.get_profile(), "jobs": db.q("SELECT * FROM jobs"),
        "applications": db.q("SELECT * FROM applications"),
        "events": db.q("SELECT * FROM events"), "contacts": db.q("SELECT * FROM contacts"),
        "prep": db.q("SELECT * FROM prep"), "activity": db.q("SELECT * FROM activity"),
        "exported_at": db.now(),
    }


@app.post("/api/reset")
async def reset_all(request: Request):
    d = await body(request)
    if not d.get("confirm"):
        raise HTTPException(400, "confirm required")
    db.seed(force=True)
    db.log("system", "Workspace reset — Lifeline Index reseeded")
    return {"ok": True}
