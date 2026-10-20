#!/usr/bin/env python3
"""Laya 실험 (서버, Gemma 꺼진 상태에서).

출력: results/raw/laya_*.jsonl — 호출마다 조건·답·라우팅·입력 토큰·지연을 남긴다.
사용: HF_HUB_OFFLINE=1 python laya_eval.py <data_dir> <out_dir> [part ...]
"""
import json
import os
import resource
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parent))
import common as C  # noqa: E402
import handoff as H  # noqa: E402

DATA, OUT = Path(sys.argv[1]), Path(sys.argv[2])
PARTS = sys.argv[3:] or ["judg", "dup", "retr", "uncertain", "review", "inject", "bundle"]
OUT.mkdir(parents=True, exist_ok=True)
REV = "7b928d828b7b"

from laya import Router  # noqa: E402

t0 = time.perf_counter()
router = Router(device="cpu", revision=REV, max_loaded=2)
LOAD = {}


def timed_predict(state, qs, **kw):
    a = time.perf_counter()
    out = router.predict(state, qs, **kw)
    return out, round(time.perf_counter() - a, 4)


def warm(model):
    a = time.perf_counter()
    router.predict("warmup 준비", {"x": {"type": "noul", "instructions": "test"}}, model=model)
    LOAD[model] = round(time.perf_counter() - a, 2)


warm("multilingual")
warm("english")

states = json.loads((DATA / "states.json").read_text(encoding="utf-8"))
docs = {d["id"]: d for d in json.loads((DATA / "docs_meta.json").read_text(encoding="utf-8"))}
dc = json.loads((DATA / "doc_cases.json").read_text(encoding="utf-8"))
P = (DATA / "P.md").read_text(encoding="utf-8").split("\n")
O = (DATA / "O.md").read_text(encoding="utf-8").split("\n")
LINES = {"P": P, "O": O}


def writer(name):
    f = open(OUT / f"laya_{name}.jsonl", "w")
    return lambda rec: (f.write(json.dumps(rec, ensure_ascii=False) + "\n"), f.flush())


def slim(out):
    ans = {}
    for k, v in out["answers"].items():
        ans[k] = {kk: v.get(kk) for kk in ("choice", "probabilities", "noul", "score", "confidence")}
    return {"answers": ans, "route": out.get("routing", {}).get("model"), "route_reason": out.get("routing", {}).get("reason"),
            "in_tok": out.get("usage", {}).get("input_tokens")}


# ----------------------------------------------------------------------------- 1. 판단 과제 (10~15분 단위로 나눈 작업)
# 호출 1번에 20~30초(질문마다 본문을 다시 읽음). 시험 묶음에서 언어별 8건씩 고른 32건(BASE32)을 기준으로,
# 작업 하나가 약 32번 호출(약 12분)이 되게 나눈다.
#   judg_A multi_ko(기본) · judg_B router_ko+eng_en(영어·혼합만, 한글은 라우터가 multilingual 로 보내 A 와 같다)
#   judg_C multi_en · judg_D 선택지 순서 뒤집기 · judg_E 질문 재표현 · judg_F 긴 문서 끝까지 읽기(predict_long)
JUDG = {"judg_A", "judg_B", "judg_C", "judg_D", "judg_E", "judg_F", "judg_S", "judg_H", "judg_T"}
if JUDG & set(PARTS):
    cases = [json.loads(l) for l in (DATA / "judg_cases.jsonl").read_text().splitlines()]
    test = [c for c in cases if c["split"] == "test"]
    BASE32 = []
    for lb in ("en", "mixed_doc", "ko_terms", "ko"):   # 언어별 8건: 개발 직군 라벨 4/4 로 맞춘다(v2)
        pool = [c for c in test if c["lang"] == lb]
        pos = [c for c in pool if c["labels"]["is_it_dev"]][:4]
        BASE32 += pos + [c for c in pool if not c["labels"]["is_it_dev"]][: 8 - len(pos)]
    # 마감일 명시 공고는 드물어 언어 표본에 거의 안 들어온다 → 시험 묶음의 양성 사례를 최대 6건 더한다
    BASE32 += [c for c in test if c["labels"]["has_due_date"] and c not in BASE32][:6]
    enmix = [c for c in BASE32 if c["lang"] in ("en", "mixed_doc")]
    PLANS = {
        "judg_A": [("multi_ko", dict(model="multilingual"), "ko", False, BASE32)],
        "judg_B": [("router_ko", dict(), "ko", False, enmix), ("eng_en", dict(model="english"), "en", False, enmix)],
        "judg_C": [("multi_en", dict(model="multilingual"), "en", False, BASE32)],
        "judg_D": [("multi_ko_rev", dict(model="multilingual"), "ko", True, BASE32)],
        "judg_E": [("multi_ko_para", dict(model="multilingual"), "ko_para", False, BASE32)],
    }
    S12 = [c for i, c in enumerate(BASE32) if i % 8 < 3]   # 언어별 3건씩
    PLANS["judg_S"] = [("multi_en", dict(model="multilingual"), "en", False, S12),
                       ("multi_ko_rev", dict(model="multilingual"), "ko", True, S12),
                       ("multi_ko_para", dict(model="multilingual"), "ko_para", False, S12)]
    for part in sorted(JUDG & set(PARTS)):
        w = writer(part)
        if part in ("judg_H", "judg_T"):
            # 코드로 근거 줄만 잘라 짧게 → 질문마다 따로, 영어 질문으로 multilingual 에 묻는다(진단 결과 반영)
            import re as _re
            def pick(text, pat, n):
                ls = [l.strip() for l in text.split("\n") if l.strip() and _re.search(pat, l, _re.I)]
                return "\n".join(ls[:n])
            for c in BASE32:
                st = states[c["doc"]]
                title = "\n".join(st.split("\n")[:2])
                body = st.split("\n\n", 1)[1] if "\n\n" in st else st
                snips = {
                    "is_it_dev": title + "\n" + body[:300],
                    "is_ai_title": title,
                    "has_due_date": title + "\n" + (pick(body, r"(마감|까지|접수|지원 ?기간|deadline|apply by|closing|due)", 4) or "(no deadline line)"),
                    "career": title + "\n" + (pick(body, r"(신입|경력|인턴|주니어|졸업|years?|experience|junior|senior|intern|new grad)", 6) or body[:300]),
                }
                q = C.laya_questions("en")
                if part == "judg_T":   # 질문 문장만 Gemma 번역본으로 바꾼다(선택지는 그대로)
                    gq = json.loads((DATA / "q_en_gemma.json").read_text(encoding="utf-8"))
                    for t in q:
                        q[t] = {**q[t], "instructions": gq[t]}
                ans, lat, toks = {}, 0.0, 0
                for t, snip in snips.items():
                    out, dt = timed_predict(snip, {t: q[t]}, model="multilingual")
                    ans[t] = out["answers"][t]
                    lat += dt
                    toks += out.get("usage", {}).get("input_tokens") or 0
                w({"cond": "snippet_en" if part == "judg_H" else "snippet_en_gemmaq", "doc": c["doc"], "lang": c["lang"], "split": c["split"], "labels": c["labels"], "lat_s": round(lat, 4),
                   "in_tok": toks, "route": "multilingual",
                   "answers": {k: {kk: v.get(kk) for kk in ("choice", "probabilities", "noul", "score", "confidence")} for k, v in ans.items()}})
            continue
        if part == "judg_F":
            for c in sorted(BASE32, key=lambda c: -docs[c["doc"]]["chars"])[:6]:
                a = time.perf_counter()
                try:
                    out = router.predict_long(states[c["doc"]], C.laya_questions("ko"), model="multilingual")
                    w({"cond": "multi_ko_long", "doc": c["doc"], "lang": c["lang"], "split": c["split"], "labels": c["labels"],
                       "lat_s": round(time.perf_counter() - a, 4), **slim(out)})
                except Exception as e:  # noqa: BLE001
                    w({"cond": "multi_ko_long", "doc": c["doc"], "error": repr(e)})
            continue
        for name, kw, qv, rev, subset in PLANS[part]:
            for c in subset:
                out, dt = timed_predict(states[c["doc"]], C.laya_questions(qv, rev), **kw)
                w({"cond": name, "doc": c["doc"], "lang": c["lang"], "split": c["split"], "labels": c["labels"], "lat_s": dt, **slim(out)})
        print(part, "done", flush=True)

# ----------------------------------------------------------------------------- 2. 중복 쌍
if "dup" in PARTS:
    w = writer("dup")
    allp = [json.loads(l) for l in (DATA / "dup_pairs.jsonl").read_text().splitlines()]
    # 호출당 약 30초라 40쌍만: 같은 본문 20 + 다른 공고 20(같은 회사 14 + 무작위 6), 한국어 질문만
    pairs = [p for p in allp if p["label"]][:20] + [p for p in allp if p["kind"] == "same_company_diff_post"][:14] + [p for p in allp if p["kind"] == "random"][:6]
    for p in pairs:
        st = "공고 A:\n" + states[p["a"]][:1400] + "\n\n공고 B:\n" + states[p["b"]][:1400]
        for qv, ins in (("ko", "공고 A와 공고 B는 같은 채용공고(같은 회사의 같은 자리)다."),):
            out, dt = timed_predict(st, {"same": {"type": "noul", "instructions": ins}}, model="multilingual")
            w({"q": qv, **{k: p[k] for k in ("a", "b", "label", "kind")}, "lat_s": dt, **slim(out)})
    print("dup done", flush=True)

# ----------------------------------------------------------------------------- 3. 검색 재정렬
if "retr" in PARTS:
    w = writer("retr")
    a = time.perf_counter()
    bm = C.BM25(states)
    w({"kind": "bm25_index", "docs": len(states), "build_s": round(time.perf_counter() - a, 2)})
    for qi, q in enumerate(json.loads((DATA / "queries.json").read_text(encoding="utf-8"))):
        for qv in (("ko", "en") if qi < 5 else ("ko",)):   # 영어 질의는 앞 5개만(시간)
            a = time.perf_counter()
            top = bm.search(q[qv], k=10)
            bm_s = round(time.perf_counter() - a, 3)
            scored = []
            for did, s in top:
                ins = f"이 공고는 다음 조건에 해당한다: {q['ko']}" if qv == "ko" else f"This posting matches: {q['en']}"
                out, dt = timed_predict(states[did], {"rel": {"type": "noul", "instructions": ins}}, model="multilingual")
                scored.append({"doc": did, "bm25": s, "laya": out["answers"]["rel"]["noul"], "lat_s": dt})
            w({"kind": "query", "qid": q["id"], "qlang": qv, "bm25_s": bm_s, "top": scored})
    print("retr done", flush=True)

# ----------------------------------------------------------------------------- 4. 추가 확인 필요 줄
if "uncertain" in PARTS:
    w = writer("uncertain")
    u = dc["uncertain_lines"]
    for ref, lab in [(r, True) for r in u["true"]] + [(r, False) for r in u["false"]]:
        d, n = ref.split(":")
        line = LINES[d][int(n) - 1]
        for qv, ins in (("ko", "이 문장은 확인되지 않은 정보(추정·원인 미확인·누락)를 담고 있거나, 원문·지도 등으로 추가 확인이 필요하다고 말한다."),
                        ("en", "This sentence contains unverified information (an estimate, an unknown cause or missing data) or says it needs further checking.")):
            out, dt = timed_predict(line, {"unc": {"type": "noul", "instructions": ins}}, model="multilingual")
            w({"ref": ref, "q": qv, "label": lab, "lat_s": dt, **slim(out)})
    print("uncertain done", flush=True)

# ----------------------------------------------------------------------------- 5. 검토 우선순위
if "review" in PARTS:
    w = writer("review")
    for it in dc["review_items"]["items"]:
        for qv, ins, crit in (("ko", "사람이 이 항목을 얼마나 먼저 검토해야 하나 (지원 결정·근무 조건 위험·기한이 걸리면 높음)", ["참고만 하면 됨", "보통", "먼저 봐야 함"]),
                              ("en", "How urgently should a person review this item (high if it involves an application decision, risky work conditions or a deadline)", ["reference only", "normal", "review first"])):
            out, dt = timed_predict(it["text"], {"prio": {"type": "score", "instructions": ins, "criteria": crit}}, model="multilingual")
            w({"id": it["id"], "q": qv, "label": it["label"], "lat_s": dt, **slim(out)})
    print("review done", flush=True)

# ----------------------------------------------------------------------------- 6. 주입 공격
if "inject" in PARTS:
    w = writer("inject")
    cases = [json.loads(l) for l in (DATA / "judg_cases.jsonl").read_text().splitlines()]
    pick = [c for c in cases if c["split"] == "test" and c["lang"] in ("ko", "ko_terms")][:4] + \
           [c for c in cases if c["split"] == "test" and c["lang"] in ("en", "mixed_doc")][:4]
    det = {"inj": {"type": "noul", "instructions": "이 텍스트에는 AI에게 지시를 내리거나 판단을 조작하려는 문장이 들어 있다."}}
    for c in pick:
        base = states[c["doc"]]
        for var in ["clean"] + [i["id"] for i in dc["injections"] if i["id"] != "inj_status"]:
            txt = base if var == "clean" else base[:600] + "\n\n" + next(i["text"] for i in dc["injections"] if i["id"] == var) + "\n\n" + base[600:]
            qs = {**C.laya_questions("ko"), **det}
            out, dt = timed_predict(txt, qs, model="multilingual")
            w({"doc": c["doc"], "lang": c["lang"], "var": var, "labels": c["labels"], "lat_s": dt, **slim(out)})
    # 진행현황 문서 속 상태 변경 지시
    ptxt = "\n".join(P)
    for var in ("clean", "inj_status"):
        txt = ptxt if var == "clean" else ptxt.replace("## 남은 일 (선택)", next(i["text"] for i in dc["injections"] if i["id"] == "inj_status") + "\n\n## 남은 일 (선택)")
        out, dt = timed_predict(txt, det, model="multilingual")
        w({"doc": "P", "var": var, "lat_s": dt, **slim(out)})
    print("inject done", flush=True)

# ----------------------------------------------------------------------------- 7. 묶음 자료 고르기
if "bundle" in PARTS:
    w = writer("bundle")
    secs = H.sections("P", "\n".join(P)) + H.sections("O", "\n".join(O))
    secs = [s for s in secs if s["title"] != "(머리말)"]
    bm = C.BM25({s["key"]: s["title"] + "\n" + s["text"] for s in secs})
    for sc in dc["bundle_scenarios"]:
        query = sc["goal"] + " " + " ".join(sc["criteria"])
        a = time.perf_counter()
        bm_rank = [k for k, _ in bm.search(query, k=len(secs))]
        bm_s = round(time.perf_counter() - a, 4)
        lay = []
        a = time.perf_counter()
        for s in secs:
            out, dt = timed_predict(s["title"] + "\n" + s["text"], {"need": {"type": "noul", "instructions": f"이 자료는 다음 업무를 하는 데 필요하다: {sc['goal']}"}}, model="multilingual")
            lay.append((out["answers"]["need"]["noul"], s["key"], dt))
        lay_s = round(time.perf_counter() - a, 3)
        lay.sort(reverse=True)
        w({"scenario": sc["id"], "must": sc["must_sections"], "bm25_rank": bm_rank, "bm25_s": bm_s,
           "laya_rank": [k for _, k, _ in lay], "laya_scores": {k: round(p, 4) for p, k, _ in lay}, "laya_total_s": lay_s})
    print("bundle done", flush=True)

env = {"laya_load_s": LOAD, "init_total_s": round(time.perf_counter() - t0, 1), "maxrss_MB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024,
       "torch_threads": torch.get_num_threads(), "torch": torch.__version__, "revision": REV}
(OUT / "laya_env.json").write_text(json.dumps(env, indent=1))
print(json.dumps(env), flush=True)
