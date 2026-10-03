"""Interview prep bank + readiness scoring."""

QUESTIONS = [
    # Technical
    ("technical", "Walk me through a project you built end-to-end. What was the hardest bug and how did you find it?"),
    ("technical", "Explain the difference between a process and a thread. When would you pick async instead of threads?"),
    ("technical", "How would you design a URL shortener that handles 100M requests/day?"),
    ("technical", "Reverse a linked list. Now do it iteratively and state the complexity of each approach."),
    ("technical", "A SQL query is slow on a 50M-row table. Walk me through how you'd diagnose and fix it."),
    ("technical", "What happens between typing a URL and the page rendering? Be specific about DNS, TCP, TLS."),
    ("technical", "Explain one machine-learning model you've used as if I were a smart non-engineer."),
    ("technical", "Two-sum, three-sum, then: how do you find the k most frequent elements in a stream?"),
    ("technical", "Your service's p99 latency spiked after a deploy. What do you check, in what order?"),
    ("technical", "Explain idempotency. Give a real example of where you needed it."),
    # Behavioral
    ("behavioral", "Tell me about a time you failed. What did you change afterwards?"),
    ("behavioral", "Describe a conflict with a teammate. How did you resolve it and what did you learn?"),
    ("behavioral", "Tell me about a time you had to learn something completely new under a deadline."),
    ("behavioral", "When did you take ownership beyond your assigned scope?"),
    ("behavioral", "Tell me about a time you received hard feedback. What did you do with it?"),
    ("behavioral", "Describe your most impressive achievement in one minute. Go."),
    ("behavioral", "Tell me about a time you disagreed with a decision. How did you handle it?"),
    ("behavioral", "What's something you've taught someone else?"),
    # Firm fit
    ("firm", "Why this company specifically — and why now, at this point in your degree?"),
    ("firm", "What do you know about how this company actually makes money?"),
    ("firm", "Which of our products would you improve first, and how would you test the change?"),
    ("firm", "Where do you see this industry in 5 years, and where do you fit in it?"),
    ("firm", "If you intern here and get a return offer, what would make you say yes?"),
    # Quant / brain teasers
    ("quant", "You roll two dice. Expected number of rolls to get two sixes in a row?"),
    ("quant", "A coin pays ₹10 for heads, ₹0 for tails. You can play up to 3 times and stop anytime. What's it worth?"),
    ("quant", "Estimate the number of dosas sold in Chennai every day. Show your decomposition."),
    ("quant", "3 blue, 5 red marbles: draw two without replacement. P(both same color)?"),
    ("quant", "Mental math: 17 × 24, then 15% of 480. Out loud, fast."),
    ("quant", "You have 8 identical-looking balls, one heavier. Minimum weighings on a balance scale? Prove it."),
]


def readiness(log: list) -> dict:
    """log rows: {category, self_score}."""
    cats = {}
    for row in log:
        c = row.get("category", "technical")
        entry = cats.setdefault(c, {"sessions": 0, "avg": 0, "score": 0})
        entry["sessions"] += 1
        entry["avg"] = (entry["avg"] * (entry["sessions"] - 1) + int(row.get("self_score", 3))) / entry["sessions"]
    for c, e in cats.items():
        e["avg"] = round(e["avg"], 1)
        e["score"] = min(95, round(35 + e["sessions"] * 6 + e["avg"] * 4))
    total = sum(e["sessions"] for e in cats.values())
    overall = min(95, round(38 + total * 4 + (len(cats) * 3)))
    return {"overall": overall, "categories": cats, "sessions": total}
