"""Referral Engine — search links + outreach drafts.

Lifeline never auto-sends messages to strangers. It builds precise searches
and drafts the user personalizes and approves.
"""
from urllib.parse import quote_plus

DOMAIN_MAP = {
    "goldman sachs": "gs.com", "jp morgan": "jpmorgan.com", "j.p. morgan": "jpmorgan.com",
    "jane street": "janestreet.com", "deutsche bank": "db.com", "wells fargo": "wellsfargo.com",
    "tower research capital": "tower-research.com", "worldquant": "worldquant.com",
    "cred": "cred.club", "atlassian": "atlassian.com", "meta": "meta.com",
}


def guess_domain(company: str) -> str:
    c = company.strip().lower()
    if c in DOMAIN_MAP:
        return DOMAIN_MAP[c]
    slug = "".join(ch for ch in c if ch.isalnum())
    return f"{slug}.com"


def build(company: str, role: str, profile: dict) -> dict:
    company = company.strip() or "the company"
    role = (role or "Software Engineering Intern").strip()
    uni = profile.get("university", "my university")
    degree = profile.get("degree", "my degree")
    domain = guess_domain(company)
    first = (profile.get("name") or "Your Name").split()[0]

    uni_short = uni.split("—")[0].strip()
    xray_role = 'site:linkedin.com/in "' + company + '" "' + role + '"'
    xray_alumni = 'site:linkedin.com/in "' + company + '" "' + uni_short + '"'
    email_hunt = '"@' + domain + '" ("' + role + '" OR engineer OR analyst)'
    links = [
        {"label": f"LinkedIn people @ {company} ({role})",
         "url": "https://www.linkedin.com/search/results/people/?keywords=" + quote_plus(company + " " + role) + "&origin=GLOBAL_SEARCH"},
        {"label": "Google X-ray: LinkedIn profiles in this role",
         "url": "https://www.google.com/search?q=" + quote_plus(xray_role)},
        {"label": f"Alumni angle: {uni} → {company}",
         "url": "https://www.google.com/search?q=" + quote_plus(xray_alumni)},
        {"label": f"Email hunt @ {domain}",
         "url": "https://www.google.com/search?q=" + quote_plus(email_hunt)},
        {"label": f"{company} careers page",
         "url": "https://www.google.com/search?q=" + quote_plus(company + " careers " + role)},
    ]

    email_guess = f"{first.lower()}.lastname@{domain} (verify with a checker before sending)"

    linkedin_note = (
        f"Hi {{First name}} — {degree} student at {uni}, applying for the {role} role at {company}. "
        f"Your path is exactly what I'm working toward. Open to a quick chat, or a referral if my profile fits? "
        f"I'll make it easy — resume + role link ready to go."
    )

    cold_email = f"""Subject: {role} @ {company} — quick referral ask from a {uni.split('—')[0].strip()} student

Hi {{First name}},

I'm {profile.get('name', 'Your Name')}, a {degree} student at {uni} graduating in {profile.get('grad_year', '2028')}. I'm applying for the {role} position at {company} and found you through {{how you found them — team, post, alumni group}}.

One line on why I'm credible for this role: {{your single strongest proof point — a project, metric, or competition result relevant to their team}}.

Would you be open to referring me for this role? To make it zero-effort: I've attached my tailored resume, the role link is {{link}}, and I can share a 3-line blurb you can paste directly into the referral form.

If a referral isn't appropriate, even 10 minutes of advice on how {company} screens candidates would mean a lot. Either way — thank you for reading.

Best,
{profile.get('name', 'Your Name')}
{profile.get('email', '')} | {profile.get('phone', '')}
{(profile.get('links') or {}).get('linkedin', '')}"""

    followup = (
        f"Hi {{First name}} — gently floating this back up. If referring isn't a fit, no worries at all; "
        f"happy to just take one piece of advice on breaking into {company}. Thanks again!"
    )

    return {
        "company": company, "role": role, "domain": domain, "links": links,
        "email_guess": email_guess, "linkedin_note": linkedin_note,
        "cold_email": cold_email, "followup": followup,
        "rules": [
            "Personalize the {braces} — templated blasts get ignored (and burn bridges).",
            "One message per person, one follow-up max, 4–6 days later. Then move on.",
            "Prioritize alumni, then people in the exact team, then recent hires.",
            "Send Tue–Thu, 9–11am in their timezone for the best reply rates.",
        ],
    }
