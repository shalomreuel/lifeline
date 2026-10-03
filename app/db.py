"""SQLite persistence layer (stdlib only)."""
import json
import sqlite3
import datetime
from pathlib import Path

from . import seed_jobs, tailor

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
DB_PATH = DATA / "lifeline.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT DEFAULT 'lifeline-index',
  external_id TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT DEFAULT '',
  remote INTEGER DEFAULT 0,
  url TEXT DEFAULT '',
  apply_url TEXT DEFAULT '',
  posted_at TEXT DEFAULT '',
  deadline TEXT DEFAULT '',
  stipend TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  description TEXT DEFAULT '',
  match_score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'new',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS applications(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER,
  status TEXT DEFAULT 'packet_ready',
  cover_letter TEXT DEFAULT '',
  tailored_resume TEXT DEFAULT '',
  match_score INTEGER DEFAULT 0,
  missing_skills TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  submitted_at TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT DEFAULT 'deadline',
  title TEXT NOT NULL,
  company TEXT DEFAULT '',
  at TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  job_id INTEGER,
  done INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contacts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT DEFAULT '',
  who TEXT DEFAULT '',
  channel TEXT DEFAULT 'linkedin',
  status TEXT DEFAULT 'draft',
  note TEXT DEFAULT '',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS prep(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT DEFAULT 'technical',
  question TEXT DEFAULT '',
  self_score INTEGER DEFAULT 3,
  notes TEXT DEFAULT '',
  at TEXT
);
CREATE TABLE IF NOT EXISTS activity(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT,
  kind TEXT,
  message TEXT
);
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT);
"""

DEFAULT_PROFILE = {
    "name": "Aarav Subramanian",
    "email": "aarav.subramanian@example.com",
    "phone": "+91 98840 12345",
    "location": "Chennai, India",
    "university": "Anna University (CEG), Chennai",
    "degree": "B.E. Computer Science",
    "grad_year": "2028",
    "target_roles": ["Software Engineering Intern", "Data Science Intern", "Quant Intern"],
    "skills": ["Python", "Java", "SQL", "React", "Node.js", "Git", "Machine Learning",
               "Flask", "Docker", "Linux", "Data Structures", "Statistics"],
    "links": {"linkedin": "https://linkedin.com/in/your-handle",
              "github": "https://github.com/your-handle"},
    "experience": [
        "Built a Flask + React campus events app used by 400+ students; cut sign-up time 60% with an SQL-backed recommendation feed",
        "Trained a scikit-learn churn model on 50k rows (Kaggle-style dataset), reaching 0.86 AUC; wrote the full evaluation notebook",
        "Led a 4-person hackathon team to a top-10 finish out of 120 with a Node.js realtime chat prototype in 24 hours",
        "Automated college attendance reports with Python + pandas, saving the department ~5 hours/week",
    ],
    "summary": "",
}

DEFAULT_SETTINGS = {
    "api_key": "",
    # Free-tier defaults — Groq's free plan needs no card. Leave api_key empty
    # to run purely on Lifeline's built-in engine (also free).
    "api_base": "https://api.groq.com/openai/v1",
    "model": "llama-3.3-70b-versatile",
    "auto_submit": True,
    "nightly_autopilot": True,
    "last_scan": "",
}


def conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def q(sql, args=()):
    with conn() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def one(sql, args=()):
    rows = q(sql, args)
    return rows[0] if rows else None


def run(sql, args=()):
    with conn() as c:
        cur = c.execute(sql, args)
        return cur.lastrowid


def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today():
    return datetime.datetime.now().strftime("%Y-%m-%d")


# ------------------------------------------------------------- kv helpers

def kv_get(key, default):
    row = one("SELECT value FROM kv WHERE key=?", (key,))
    if not row:
        return default
    try:
        return json.loads(row["value"])
    except Exception:
        return default


def kv_set(key, value):
    with conn() as c:
        c.execute("INSERT INTO kv(key,value) VALUES(?,?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  (key, json.dumps(value, ensure_ascii=False)))


def get_profile():
    return kv_get("profile", DEFAULT_PROFILE)


def save_profile(p):
    kv_set("profile", p)


def get_settings():
    s = dict(DEFAULT_SETTINGS)
    s.update(kv_get("settings", {}))
    return s


def save_settings(s):
    kv_set("settings", s)


def log(kind, message):
    run("INSERT INTO activity(ts,kind,message) VALUES(?,?,?)", (now(), kind, message))


def parse_row_job(r):
    j = dict(r)
    try:
        j["tags"] = json.loads(j.get("tags") or "[]")
    except Exception:
        j["tags"] = []
    return j


# ------------------------------------------------------------- seeding

def _job_exists(external_id):
    return one("SELECT id FROM jobs WHERE external_id=?", (external_id,)) is not None


def _seed_deadline_events():
    d = datetime.datetime.now()
    horizon = (d + datetime.timedelta(days=45)).strftime("%Y-%m-%d")
    for j in q("SELECT id, company, title, deadline FROM jobs WHERE deadline != '' AND deadline <= ?", (horizon,)):
        exists = one("SELECT id FROM events WHERE kind='deadline' AND job_id=?", (j["id"],))
        if not exists:
            run("INSERT INTO events(kind,title,company,at,job_id) VALUES(?,?,?,?,?)",
                ("deadline", f"Apply by deadline — {j['title'][:48]}", j["company"], j["deadline"], j["id"]))


def seed(force=False):
    with conn() as c:
        c.executescript(SCHEMA)
    if force:
        with conn() as c:
            for t in ("jobs", "applications", "events", "contacts", "prep", "activity", "kv"):
                c.execute(f"DELETE FROM {t}")
    if not one("SELECT id FROM jobs LIMIT 1"):
        profile = get_profile()
        with conn() as c:
            for j in seed_jobs.JOBS:
                score = tailor.score_job(profile, j)["score"]
                c.execute(
                    "INSERT INTO jobs(source,external_id,title,company,location,remote,url,apply_url,"
                    "posted_at,deadline,stipend,tags,description,match_score,status,created_at) "
                    "VALUES('lifeline-index',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (j["external_id"], j["title"], j["company"], j["location"], j["remote"],
                     j["url"], j["apply_url"], j.get("posted_at", ""), j.get("deadline", ""),
                     j.get("stipend", ""), json.dumps(j.get("tags", [])), j.get("description", ""),
                     score, "new", now()))
        log("radar", f"Lifeline Index loaded: {len(seed_jobs.JOBS)} curated openings")
        _seed_deadline_events()


def rescore_all():
    profile = get_profile()
    n = 0
    for j in q("SELECT * FROM jobs"):
        job = parse_row_job(j)
        s = tailor.score_job(profile, job)["score"]
        run("UPDATE jobs SET match_score=? WHERE id=?", (s, j["id"]))
        n += 1
    return n
