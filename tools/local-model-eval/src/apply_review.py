#!/usr/bin/env python3
"""검토 화면에서 저장된 사람 판단을 잠정 정답에 반영하고, 확정된 문항만으로도 따로 채점한다.

입력: review/decisions.json (ArtifactData list 결과의 문서 배열: [{"id","data":{set,item,verdict,value,note}}])
출력: data/doc_cases_reviewed.json, results/metrics_reviewed.json
사용: python3 -I src/apply_review.py data results review/decisions.json
- verdict ok     → 잠정 정답을 '확정'으로
- verdict fix    → 질의응답: value(고친 답)를 사람 정답으로 저장(자동 채점 키는 사람이 다시 정해야 하므로 '고침-재채점 필요'로 표시)
                   추가 확인 줄: 라벨 반대로 · 우선순위: value(0/1/2)로 교체
- verdict unsure → '판단 어려움'으로 채점에서 뺀다
"""
import json
import re
import sys
from pathlib import Path

DATA, RES, DEC = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
dc = json.loads((DATA / "doc_cases.json").read_text(encoding="utf-8"))
raw = json.loads(DEC.read_text(encoding="utf-8"))
dec = {d["id"]: d["data"] for d in raw}

status = {}  # key -> confirmed | fixed | unsure
for q in dc["qa"]:
    d = dec.get(f"qa--{q['id']}")
    if not d or not d.get("verdict"):
        continue
    status[f"qa--{q['id']}"] = {"ok": "confirmed", "fix": "fixed", "unsure": "unsure"}[d["verdict"]]
    if d["verdict"] == "fix":
        q["human_answer"] = d.get("value") or ""
    q["label_status"] = status[f"qa--{q['id']}"]

u = dc["uncertain_lines"]
for lab in ("true", "false"):
    for ref in list(u[lab]):
        d = dec.get(f"unc--{ref}")
        if not d or not d.get("verdict"):
            continue
        status[f"unc--{ref}"] = {"ok": "confirmed", "fix": "fixed", "unsure": "unsure"}[d["verdict"]]
        if d["verdict"] == "fix":
            u[lab].remove(ref)
            u["false" if lab == "true" else "true"].append(ref)
        elif d["verdict"] == "unsure":
            u[lab].remove(ref)
            u.setdefault("unsure", []).append(ref)

for it in dc["review_items"]["items"]:
    d = dec.get(f"rev--{it['id']}")
    if not d or not d.get("verdict"):
        continue
    status[f"rev--{it['id']}"] = {"ok": "confirmed", "fix": "fixed", "unsure": "unsure"}[d["verdict"]]
    if d["verdict"] == "fix" and d.get("value") is not None:
        it["label"] = int(d["value"])
    it["label_status"] = status[f"rev--{it['id']}"]

(DATA / "doc_cases_reviewed.json").write_text(json.dumps(dc, ensure_ascii=False, indent=1))

# ----------------------------------------------------------------------------- 확정 문항만 채점(질의응답)
def load(name):
    f = RES / "raw" / name
    return [json.loads(l) for l in f.read_text().splitlines() if l.strip()] if f.exists() else []

qa = {q["id"]: q for q in dc["qa"]}
out = {"reviewed": len(status), "by_status": {}, "qa_confirmed_only": {}}
for s in status.values():
    out["by_status"][s] = out["by_status"].get(s, 0) + 1
for cond, rows in (("qa_full", load("gemma_qa_full.jsonl")), ("qa_bm25", [r for f in sorted((RES / "raw").glob("gemma_qa_bm25*.jsonl")) for r in load(f.name)])):
    conf = [r for r in rows if qa[r["id"]].get("label_status") == "confirmed"]
    correct = 0
    for r in conf:
        q, p = qa[r["id"]], r.get("parsed") or {}
        if q["type"] == "unanswerable":
            correct += bool(p.get("abstain"))
        else:
            correct += (not p.get("abstain")) and all(re.search(k, str(p.get("answer", ""))) for k in q["answer_keys"])
    out["qa_confirmed_only"][cond] = {"confirmed_items": len(conf), "correct": correct, "ids": [r["id"] for r in conf]}
fixed = [k for k, s in status.items() if s == "fixed"]
out["needs_rescore_key"] = [k for k in fixed if k.startswith("qa--")]
out["label_changes"] = fixed
(RES / "metrics_reviewed.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
print(json.dumps(out, ensure_ascii=False, indent=1))
