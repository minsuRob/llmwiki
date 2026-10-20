#!/usr/bin/env python3
"""취준 자료(인디스워크 공고 + 그룹바이 진행현황)로 평가 사례를 만든다.

정답 원칙
- 판단 과제 라벨은 사이트가 붙인 메타데이터(posts.json)에서만 가져온다 → label_src="source_meta", 상태 "잠정".
- 모델(Gemma·Laya) 출력은 정답에 쓰지 않는다.
- 같은 공고(정확히 같은 본문 포함)는 같은 묶음(group)으로 묶고, 묶음 단위로 tune/test 를 나눈다.
원본 파일은 읽기만 한다.

사용: build_cases.py <구직 폴더> <out_dir>
"""
import hashlib
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
DATA = SRC / "인디스워크" / ".data"
rnd = random.Random(20261020)

posts = json.loads((DATA / "posts.json").read_text(encoding="utf-8"))
DATE_RE = re.compile(r"\d{4}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}")


def lang_bucket(text):
    hang = len(re.findall(r"[가-힣]", text))
    lat = len(re.findall(r"[A-Za-z]", text))
    r = hang / max(1, hang + lat)
    if r < 0.10:
        return "en", r
    if r < 0.50:
        return "mixed_doc", r          # 한·영 문장이 함께 있는 문서
    if r < 0.85:
        return "ko_terms", r           # 영어 기술명·직무명이 섞인 한국어
    return "ko", r


def features(text):
    return {
        "has_url": bool(re.search(r"https?://", text)),
        "has_table": bool(re.search(r"^\|.*\|\s*$", text, re.M)),
        "has_code": "```" in text or bool(re.search(r"[{};]\s*$", text, re.M)),
        "has_date": bool(DATE_RE.search(text)),
        "has_negation": bool(re.search(r"(불가|제외|아닌|않|없음|not |no |n't)", text)),
    }


docs, groups = {}, {}
md5_groups = defaultdict(list)
for p in posts:
    p = {**p, "id": str(p["id"])}
    if p["short"]:
        continue
    f = DATA / "text" / f"{p['id']}.txt"
    if not f.exists():
        continue
    body = f.read_text(encoding="utf-8").strip()
    if len(body) < 200:
        continue
    state = f"회사: {p['company']}\n공고: {p['pos']}\n\n{body}"
    lb, ratio = lang_bucket(state)
    h = hashlib.md5(body.encode()).hexdigest()
    md5_groups[h].append(p["id"])
    docs[p["id"]] = {"id": p["id"], "company": p["company"], "title": p["pos"], "lang": lb, "ko_ratio": round(ratio, 3),
                     "chars": len(state), "md5": h, **features(state), "meta": {k: p[k] for k in ("career", "it", "ai", "aititle", "tool", "due", "jobs", "startup")}}
for h, ids in md5_groups.items():
    for i in ids:
        groups[i] = "g_" + h[:10]

# ---------------- 판단 과제 표본: 언어 묶음별 층화 ----------------
by_lang = defaultdict(list)
for d in docs.values():
    by_lang[d["lang"]].append(d)
PER_LANG = {"en": 45, "mixed_doc": 45, "ko_terms": 45, "ko": 45}
picked = []
for lb, n in PER_LANG.items():
    pool = by_lang[lb][:]
    rnd.shuffle(pool)
    # it True/False 가 한쪽으로 쏠리지 않게 절반씩
    pos = [d for d in pool if d["meta"]["it"]][: n // 2 + 1]
    neg = [d for d in pool if not d["meta"]["it"]][: n - len(pos)]
    picked += pos + neg
# 마감일이 날짜로 적힌 공고는 드물어서 전부 넣는다
picked_ids = {d["id"] for d in picked}
for d in docs.values():
    if DATE_RE.search(d["meta"]["due"] or "") and d["id"] not in picked_ids:
        picked.append(d)
        picked_ids.add(d["id"])

CAREER = {"신입/인턴": "entry_only", "신입/인턴·주니어경력": "entry_or_junior", "주니어경력": "junior_only"}
judg = []
for d in picked:
    m = d["meta"]
    due = m["due"] or ""
    due_label = True if DATE_RE.search(due) else (False if due in ("채용시 마감", "상시채용") else None)
    judg.append({"doc": d["id"], "group": groups[d["id"]], "lang": d["lang"], "labels": {
        "is_it_dev": m["it"],
        "is_ai_title": m["aititle"],
        "career": CAREER.get(m["career"]),
        "has_due_date": due_label,        # None = 판단 불가(라벨 없음, '본문 확인' 등)
    }, "label_src": "source_meta", "label_status": "잠정"})

# tune/test 분리: 묶음 단위
gids = sorted({c["group"] for c in judg})
rnd.shuffle(gids)
tune_g = set(gids[: int(len(gids) * 0.3)])
for c in judg:
    c["split"] = "tune" if c["group"] in tune_g else "test"

# ---------------- 중복 판단 쌍 ----------------
pairs = []
dup_groups = [ids for ids in md5_groups.values() if len(ids) > 1]
for ids in dup_groups:
    pairs.append({"a": ids[0], "b": ids[1], "label": True, "kind": "identical_body"})
by_company = defaultdict(list)
for d in docs.values():
    by_company[d["company"]].append(d["id"])
hard = [(v[0], v[1]) for v in by_company.values() if len(v) > 1 and docs[v[0]]["md5"] != docs[v[1]]["md5"]]
rnd.shuffle(hard)
for a, b in hard[:28]:
    pairs.append({"a": a, "b": b, "label": False, "kind": "same_company_diff_post"})
all_ids = list(docs)
for _ in range(14):
    a, b = rnd.sample(all_ids, 2)
    if docs[a]["md5"] != docs[b]["md5"]:
        pairs.append({"a": a, "b": b, "label": False, "kind": "random"})
for p in pairs:
    p.update({"label_src": "source_text_md5", "label_status": "잠정"})

# ---------------- 추천(검색) 질의: 정답은 메타데이터 조건 ----------------
def jobs_has(d, k):
    return k in (d["meta"]["jobs"] or [])

QUERIES = [
    {"id": "q_data", "ko": "데이터분석 직무 공고", "en": "data analyst job postings", "rel": lambda d: jobs_has(d, "데이터분석")},
    {"id": "q_design", "ko": "디자인 직무 공고", "en": "design job postings", "rel": lambda d: jobs_has(d, "디자인")},
    {"id": "q_mkt", "ko": "마케팅·홍보 직무 공고", "en": "marketing and PR job postings", "rel": lambda d: jobs_has(d, "마케팅홍보")},
    {"id": "q_sales", "ko": "영업 직무 공고", "en": "sales job postings", "rel": lambda d: jobs_has(d, "영업")},
    {"id": "q_semi", "ko": "반도체 분야 공고", "en": "semiconductor industry job postings", "rel": lambda d: jobs_has(d, "반도체")},
    {"id": "q_game", "ko": "게임 분야 공고", "en": "game industry job postings", "rel": lambda d: jobs_has(d, "게임")},
    {"id": "q_foreign", "ko": "외국계 기업 공고", "en": "jobs at foreign (multinational) companies", "rel": lambda d: jobs_has(d, "외국계")},
    {"id": "q_ai", "ko": "AI 직무 공고", "en": "AI engineering job postings", "rel": lambda d: d["meta"]["aititle"]},
    {"id": "q_aitool", "ko": "업무에 AI 도구 활용을 언급한 공고", "en": "postings that mention using AI tools at work", "rel": lambda d: d["meta"]["tool"]},
    {"id": "q_junior", "ko": "주니어 경력자만 뽑는 공고", "en": "postings for junior experienced hires only", "rel": lambda d: d["meta"]["career"] == "주니어경력"},
]
queries = []
for q in QUERIES:
    rel = sorted(i for i, d in docs.items() if q["rel"](d))
    queries.append({"id": q["id"], "ko": q["ko"], "en": q["en"], "relevant": rel, "n_relevant": len(rel),
                    "label_src": "source_meta", "label_status": "잠정"})

# ---------------- 저장: 원문은 서버 전송용 states 에만, 보고용 파일에는 본문 없음 ----------------
states = {i: f"회사: {d['company']}\n공고: {d['title']}\n\n" + (DATA / 'text' / f'{i}.txt').read_text(encoding='utf-8').strip() for i, d in docs.items()}
(OUT / "states.json").write_text(json.dumps(states, ensure_ascii=False))
(OUT / "docs_meta.json").write_text(json.dumps(list(docs.values()), ensure_ascii=False, indent=0))
(OUT / "judg_cases.jsonl").write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in judg))
(OUT / "dup_pairs.jsonl").write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in pairs))
(OUT / "queries.json").write_text(json.dumps(queries, ensure_ascii=False, indent=1))

summary = {
    "posts_total": len(posts), "usable_docs": len(docs),
    "lang_dist_all": dict(Counter(d["lang"] for d in docs.values())),
    "judg_cases": len(judg), "judg_split": dict(Counter(c["split"] for c in judg)),
    "judg_lang": dict(Counter(c["lang"] for c in judg)),
    "label_balance": {k: dict(Counter(str(c["labels"][k]) for c in judg)) for k in judg[0]["labels"]},
    "dup_pairs": dict(Counter(p["kind"] for p in pairs)), "exact_dup_groups": len(dup_groups),
    "queries": {q["id"]: q["n_relevant"] for q in queries},
    "features_in_judg": {k: sum(1 for c in judg if docs[c["doc"]][k]) for k in ("has_url", "has_table", "has_code", "has_date", "has_negation")},
    "chars_p50_p90_max": sorted(d["chars"] for d in docs.values())[len(docs) // 2],
}
(OUT / "cases_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
print(json.dumps(summary, ensure_ascii=False, indent=1))
