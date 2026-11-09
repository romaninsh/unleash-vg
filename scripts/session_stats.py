"""Measure how this app was built, from the agent's session log, for the splash screen's
numbers (web/flags/src/about.ts).

Run: python3 -I scripts/session_stats.py <session.jsonl>
     (Claude Code keeps it under ~/.claude/projects/<project>/<session id>.jsonl)

Prints: first and last entry, wall-clock span, active time (gaps between log entries summed,
pauses over 10 minutes left out), the person's prompts, model turns, tool calls, token usage
(output; input split into fresh, cache-written and cache-read) and the models that answered.
Reads only counts, timestamps and model names; prints no content.
"""
import json
import sys
from collections import Counter
from datetime import datetime

PAUSE = 10 * 60  # a gap longer than this is someone away, not work

path = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
stamps, usage, models, seen = [], Counter(), Counter(), set()
turns = tools = prompts = 0
for line in open(path):
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get("timestamp"):
        stamps.append(datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00")))
    m = e.get("message") or {}
    if e.get("type") == "assistant":
        if m.get("id") not in seen:  # a reply streamed in parts shares one id and one usage
            seen.add(m.get("id"))
            turns += 1
            models[m.get("model")] += 1
            usage.update({k: v for k, v in (m.get("usage") or {}).items() if isinstance(v, int)})
        tools += sum(1 for c in m.get("content") or [] if isinstance(c, dict) and c.get("type") == "tool_use")
    if e.get("type") == "user" and not e.get("isMeta"):
        c = m.get("content")
        text = c if isinstance(c, str) else " ".join(
            x.get("text", "") for x in c or [] if isinstance(x, dict) and x.get("type") == "text")
        if text.strip() and not text.lstrip().startswith("<") and "tool_use_id" not in str(c)[:200]:
            prompts += 1

stamps.sort()
active = sum(g for g in ((b - a).total_seconds() for a, b in zip(stamps, stamps[1:])) if g <= PAUSE)
inp = usage["input_tokens"] + usage["cache_creation_input_tokens"] + usage["cache_read_input_tokens"]
print(json.dumps({
    "first": stamps[0].isoformat(), "last": stamps[-1].isoformat(),
    "wallHours": round((stamps[-1] - stamps[0]).total_seconds() / 3600, 1),
    "activeHours": round(active / 3600, 1),
    "prompts": prompts, "modelTurns": turns, "toolCalls": tools,
    "outputTokens": usage["output_tokens"], "inputTokens": inp,
    "cacheReadShare": round(usage["cache_read_input_tokens"] / inp, 3) if inp else 0,
    "models": dict(models),
}, indent=1))
