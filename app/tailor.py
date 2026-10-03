"""Lifeline's local resume-tailoring + matching engine.

Works fully offline. If the user adds an OpenAI-compatible API key in
Settings, the LLM path takes over for higher-quality rewrites.
"""
import re
import json
import httpx

# skill -> aliases (all lowercase)
SKILLS = {
    "python": ["python", "py"],
    "java": ["java"],
    "javascript": ["javascript", "js", "ecmascript"],
    "typescript": ["typescript", "ts"],
    "c++": ["c++", "cpp"],
    "c#": ["c#", "csharp"],
    "go": ["golang", " go "],
    "rust": ["rust"],
    "kotlin": ["kotlin"],
    "swift": ["swift"],
    "ruby": ["ruby", "rails"],
    "sql": ["sql", "mysql", "postgres", "postgresql"],
    "react": ["react", "react.js", "reactjs"],
    "node.js": ["node.js", "nodejs", "node"],
    "flask": ["flask"],
    "django": ["django"],
    "spring boot": ["spring boot", "spring"],
    "docker": ["docker"],
    "kubernetes": ["kubernetes", "k8s"],
    "aws": ["aws", "amazon web services"],
    "gcp": ["gcp", "google cloud"],
    "azure": ["azure"],
    "linux": ["linux", "unix"],
    "git": ["git", "github", "gitlab"],
    "machine learning": ["machine learning", " ml ", "scikit-learn", "sklearn"],
    "deep learning": ["deep learning", "pytorch", "tensorflow", "transformers"],
    "data analysis": ["pandas", "numpy", "data analysis"],
    "statistics": ["statistics", "statistical", "probability"],
    "nlp": ["nlp", "natural language"],
    "computer vision": ["computer vision", "opencv"],
    "llm": ["llm", "large language model", "generative ai", "genai"],
    "spark": ["spark", "pyspark"],
    "kafka": ["kafka"],
    "microservices": ["microservices", "micro-services"],
    "rest apis": ["rest api", "rest apis", "api design", "graphql"],
    "distributed systems": ["distributed systems", "distributed"],
    "data structures": ["data structures", "algorithms", "dsa"],
    "system design": ["system design", "scalable", "scalability", "low-latency"],
    "frontend": ["frontend", "front-end", "html", "css", "ui"],
    "mobile": ["android", "ios", "mobile", "flutter", "react native"],
    "devops": ["devops", "ci/cd", "terraform", "jenkins"],
    "testing": ["testing", "test automation", "qa"],
    "product": ["product management", "product sense", "roadmap"],
    "analytics": ["analytics", "dashboards", "tableau", "power bi", "looker"],
    "quant": ["quant", "quantitative", "derivatives", "market microstructure", "alpha"],
    "finance": ["finance", "fintech", "trading", "payments", "risk", "banking"],
    "security": ["security", "cyber security", "infosec"],
    "communication": ["communication", "written communication", "storytelling"],
    "leadership": ["leadership", "led a team", "ownership"],
}


def _norm(text: str) -> str:
    return " " + re.sub(r"[^a-z0-9+#./-]", " ", (text or "").lower()) + " "


def extract_skills(text: str) -> set:
    t = _norm(text)
    found = set()
    for skill, aliases in SKILLS.items():
        for a in aliases:
            if a.strip() and a in t:
                found.add(skill)
                break
    return found


def title_fit(profile: dict, job: dict) -> float:
    """0..1 — how well target roles match the job title."""
    targets = [r.lower() for r in profile.get("target_roles", []) if r]
    if not targets:
        return 0.5
    title = job.get("title", "").lower()
    score = 0.0
    for t in targets:
        words = [w for w in re.split(r"[^a-z]+", t) if len(w) > 3]
        hits = sum(1 for w in words if w in title)
        if words:
            score = max(score, hits / len(words))
    return min(1.0, score)


def score_job(profile: dict, job: dict) -> dict:
    """Return {score, matched, missing} for a job vs the profile."""
    p_skills = {s.lower() for s in profile.get("skills", [])}
    jd_text = f"{job.get('title','')} {job.get('description','')} {' '.join(job.get('tags') or [])}"
    jd_skills = extract_skills(jd_text)
    matched = sorted(p_skills & jd_skills)
    missing = sorted(jd_skills - p_skills)
    if jd_skills:
        coverage = len(matched) / len(jd_skills)
    else:
        coverage = 0.35
    score = round(20 + 58 * coverage + 18 * title_fit(profile, job))
    score = max(12, min(97, score))
    return {"score": score, "matched": matched, "missing": missing, "jd_skills": sorted(jd_skills)}


# ---------------------------------------------------------------- tailoring

def _summary(profile: dict, job: dict, matched: list) -> str:
    name = profile.get("name", "Candidate").split()[0]
    deg = profile.get("degree", "engineering")
    uni = profile.get("university", "university")
    gy = profile.get("grad_year", "")
    skills = ", ".join(matched[:6]) if matched else ", ".join(profile.get("skills", [])[:6])
    return (
        f"{deg} student at {uni} (Class of {gy}) targeting {job.get('title','this role')} at "
        f"{job.get('company','the company')}. Hands-on with {skills}. "
        f"Known for shipping projects end-to-end and learning new stacks fast — "
        f"looking to contribute from week one."
    )


def _ordered_bullets(profile: dict, matched: list) -> list:
    bullets = [b.strip() for b in (profile.get("experience") or []) if b.strip()]
    m = [s.lower() for s in matched]

    def weight(b):
        bl = b.lower()
        return sum(2 for s in m if s in bl)

    return sorted(bullets, key=weight, reverse=True)


def tailor_resume_local(profile: dict, job: dict) -> dict:
    m = score_job(profile, job)
    matched, missing = m["matched"], m["missing"]
    p_skills = [s for s in profile.get("skills", [])]
    other = [s for s in p_skills if s.lower() not in matched]
    skills_line = ", ".join(matched + other) if (matched or other) else "Add your skills in Settings → Resume"
    links = profile.get("links", {})
    lines = [
        (profile.get("name") or "Your Name").upper(),
        " • ".join(x for x in [profile.get("email", ""), profile.get("phone", ""), profile.get("location", "")] if x),
        " • ".join(x for x in [links.get("linkedin", ""), links.get("github", "")] if x),
        "",
        f"TARGET — {job.get('title','')} @ {job.get('company','')}",
        "",
        "SUMMARY",
        _summary(profile, job, matched),
        "",
        "SKILLS",
        skills_line,
        "",
        "EXPERIENCE & PROJECTS",
    ]
    bullets = _ordered_bullets(profile, matched)
    lines += [f"• {b}" for b in bullets] or ["• Add experience bullets in Settings → Resume"]
    lines += [
        "",
        "EDUCATION",
        f"{profile.get('degree','')} — {profile.get('university','')} (Class of {profile.get('grad_year','')})",
        "",
        f"ATS KEYWORD GAP (remove before sending): {', '.join(missing[:8]) if missing else 'none — strong match'}",
    ]
    return {
        "resume": "\n".join(lines),
        "cover_letter": cover_letter_local(profile, job, matched),
        "score": m["score"],
        "matched": matched,
        "missing": missing,
        "engine": "lifeline-local",
    }


def cover_letter_local(profile: dict, job: dict, matched: list) -> str:
    name = profile.get("name", "Your Name")
    skills = ", ".join(matched[:4]) or ", ".join(profile.get("skills", [])[:4])
    bullets = [b.strip() for b in (profile.get("experience") or []) if b.strip()]
    proof = bullets[0] if bullets else "a recent project where I shipped something real under a deadline"
    return f"""Dear {job.get('company','the')} recruiting team,

I'm writing to apply for the {job.get('title','internship')} position. I'm a {profile.get('degree','')} student at {profile.get('university','')} graduating in {profile.get('grad_year','')}, and this role sits exactly where I want to grow: {', '.join((job.get('tags') or [])[:3]) or 'building things that matter'}.

The strongest overlap I bring is hands-on work with {skills}. As one example: {proof}. I'd want to bring that same momentum to {job.get('company','your team')}'s work on the problems described in this listing.

Beyond the stack, I optimize for ownership: I pick up unfamiliar codebases quickly, write things down so the next person isn't lost, and finish what I start. I'd welcome the chance to interview and show concrete work.

Thank you for your time — my resume is attached.

Best regards,
{name}
{profile.get('email','')} | {profile.get('phone','')}"""


# ---------------------------------------------------------------- LLM path

async def tailor_resume_llm(settings: dict, profile: dict, job: dict) -> dict:
    key = settings.get("api_key", "").strip()
    base = (settings.get("api_base") or "https://api.openai.com/v1").rstrip("/")
    model = settings.get("model") or "gpt-4o-mini"
    system = (
        "You are an expert career coach. Tailor the candidate's resume and write a cover letter for the job. "
        "NEVER invent facts, employers, or numbers not present in the profile. Respond ONLY with JSON: "
        '{"resume": string, "cover_letter": string}'
    )
    user = json.dumps({"profile": profile, "job": {k: job.get(k, "") for k in
        ("title", "company", "location", "description", "tags", "stipend")}}, ensure_ascii=False)
    resp = httpx.post(
        f"{base}/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": model, "temperature": 0.4,
              "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
        timeout=60,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    start, end = content.find("{"), content.rfind("}")
    data = json.loads(content[start:end + 1])
    m = score_job(profile, job)
    return {
        "resume": data.get("resume", ""),
        "cover_letter": data.get("cover_letter", ""),
        "score": m["score"], "matched": m["matched"], "missing": m["missing"],
        "engine": f"llm:{model}",
    }


async def tailor(settings: dict, profile: dict, job: dict) -> dict:
    if settings.get("api_key"):
        try:
            return await tailor_resume_llm(settings, profile, job)
        except Exception:
            pass  # graceful fallback
    return tailor_resume_local(profile, job)
