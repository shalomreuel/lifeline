"""Live opportunity sources. Each adapter returns normalized jobs or raises."""
import re
import httpx

INTERN_WORDS = ("intern", "internship", "trainee", "apprentice", "working student", "placement")


def _strip_html(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:1200]


def _is_intern(title: str) -> bool:
    t = (title or "").lower()
    return any(w in t for w in INTERN_WORDS)


def scan_remotive(limit: int = 60) -> list:
    r = httpx.get("https://remotive.com/api/remote-jobs",
                  params={"search": "intern", "limit": limit}, timeout=14)
    r.raise_for_status()
    out = []
    for j in r.json().get("jobs", []):
        if not _is_intern(j.get("title", "")):
            continue
        out.append(dict(
            source="remotive", external_id=str(j.get("id")),
            title=j.get("title", "").strip(), company=j.get("company_name", "Unknown"),
            location=j.get("candidate_required_location", "Remote"), remote=1,
            url=j.get("url", ""), apply_url=j.get("url", ""),
            posted_at=(j.get("publication_date") or "")[:10], deadline="",
            stipend=j.get("salary") or "", tags=j.get("tags") or [],
            description=_strip_html(j.get("description", "")),
        ))
    return out


def scan_arbeitnow(limit: int = 30) -> list:
    r = httpx.get("https://www.arbeitnow.com/api/job-board-api", timeout=14)
    r.raise_for_status()
    out = []
    for j in r.json().get("data", [])[:limit * 2]:
        if not _is_intern(j.get("title", "")):
            continue
        out.append(dict(
            source="arbeitnow", external_id=j.get("slug", "")[:120],
            title=j.get("title", "").strip(), company=j.get("company_name", "Unknown"),
            location=j.get("location", ""), remote=1 if j.get("remote") else 0,
            url=j.get("url", ""), apply_url=j.get("url", ""),
            posted_at="", deadline="", stipend="", tags=j.get("tags") or [],
            description=_strip_html(j.get("description", "")),
        ))
        if len(out) >= limit:
            break
    return out


SCANNERS = {"remotive": scan_remotive, "arbeitnow": scan_arbeitnow}
