#!/usr/bin/env python3
"""서버 성능·운영 시험. 부하를 단계적으로 올린다.

  perf.py laya_matrix <out> <threads>  Laya 입력 길이(128~1024) × 질문 수(1·4·10), 스레드 1 또는 2 (작업 하나 15분 이내)
  perf.py gemma_len <out> <tag>   (llama-server 가 떠 있을 때) 입력 512토큰, 출력 짧음·100·300
  perf.py coexist <out>           (llama-server 가 떠 있을 때) Laya multilingual 상주 → 단독/동시 추론 비교
메모리 여유(MemAvailable)가 1.5GB 아래로 내려가면 다음 단계로 가지 않고 멈춘다.
"""
import json
import statistics
import sys
import threading
import time
import urllib.request
from pathlib import Path

MODE, OUT = sys.argv[1], Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
REV = "7b928d828b7b"
TEXT = ("서울시가 내년부터 시내버스 전 노선에 수요응답형 심야 연장 운행을 단계적으로 도입한다. We are hiring a backend engineer "
        "with Python and Kubernetes experience; 신입 지원 가능, 마감은 채용 시. ") * 200


def mem_avail_mb():
    for l in open("/proc/meminfo"):
        if l.startswith("MemAvailable"):
            return int(l.split()[1]) // 1024
    return -1


def rss_mb():
    for l in open("/proc/self/status"):
        if l.startswith("VmRSS"):
            return int(l.split()[1]) // 1024
    return -1


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


def laya_agent():
    import laya
    a = time.perf_counter()
    ag = laya.load("convaiinnovations/laya", subfolder="multilingual", device="cpu", revision=REV)
    return ag, round(time.perf_counter() - a, 2)


def tok_trim(tok, n):
    ids = tok(TEXT, add_special_tokens=False)["input_ids"][:n]
    return tok.decode(ids)


def questions(k):
    return {f"q{i}": {"type": "noul", "instructions": f"이 글은 {i}번 조건에 해당한다: 백엔드 개발 신입 공고다."} for i in range(k)}


if MODE == "laya_matrix":
    import torch
    rec = {"mem_before_mb": mem_avail_mb()}
    ag, cold = laya_agent()
    rec["cold_load_s"], rec["rss_after_load_mb"] = cold, rss_mb()
    a = time.perf_counter()
    ag.predict("예열", questions(1))
    rec["first_call_s"] = round(time.perf_counter() - a, 3)
    tok = ag.tok if hasattr(ag, "tok") else ag.tokenizer
    rows = []
    for threads in (int(sys.argv[3]) if len(sys.argv) > 3 else 2,):
        torch.set_num_threads(threads)
        for n in (128, 256, 512, 1024):
            st = tok_trim(tok, n)
            for k in (1, 4, 10):
                reps = 5 if n * k <= 2048 else 3
                lat = []
                for _ in range(reps):
                    a = time.perf_counter()
                    out = ag.predict(st, questions(k), max_len=max(1024, n + 300))
                    lat.append(time.perf_counter() - a)
                rows.append({"threads": threads, "in_tok": n, "questions": k, "reps": reps, "p50_s": round(statistics.median(lat), 3),
                             "p95_s": round(pct(lat, 95), 3), "usage_tok": out.get("usage", {}).get("input_tokens"), "rss_mb": rss_mb()})
                print(rows[-1], flush=True)
                if mem_avail_mb() < 1500:
                    rec["stopped"] = "low memory"
                    break
    rec["rows"] = rows
    rec["mem_after_mb"] = mem_avail_mb()
    (OUT / f"perf_laya_matrix_t{threads}.json").write_text(json.dumps(rec, indent=1))

elif MODE in ("gemma_len", "coexist"):
    URL = "http://127.0.0.1:8080"

    def chat(prompt, max_tokens, ignore_eos=False):
        body = {"messages": [{"role": "user", "content": prompt}], "max_tokens": max_tokens, "temperature": 0, "cache_prompt": False,
                "chat_template_kwargs": {"enable_thinking": False}}
        if ignore_eos:
            body["ignore_eos"] = True
        req = urllib.request.Request(URL + "/v1/chat/completions", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        a = time.perf_counter()
        with urllib.request.urlopen(req, timeout=3600) as r:
            resp = json.loads(r.read())
        tm = resp["timings"]
        return {"wall_s": round(time.perf_counter() - a, 2), "prompt_n": tm["prompt_n"], "pp_tps": round(tm["prompt_n"] / tm["prompt_ms"] * 1000, 2),
                "pred_n": tm["predicted_n"], "tg_tps": round(tm["predicted_n"] / max(1e-9, tm["predicted_ms"]) * 1000, 2)}

    def tokenize(text):
        req = urllib.request.Request(URL + "/tokenize", data=json.dumps({"content": text}).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())["tokens"]

    def detok(ids):
        req = urllib.request.Request(URL + "/detokenize", data=json.dumps({"tokens": ids}).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())["content"]

    p512 = detok(tokenize(TEXT)[:512]) + "\n\n위 글을 요약하라."

    if MODE == "gemma_len":
        tag = sys.argv[3]
        reps = int(sys.argv[4]) if len(sys.argv) > 4 else 3
        rows = []
        for label, mt, ie in (("short", 10, False), ("gen100", 100, True), ("gen300", 300, True)):
            for r in range(reps):
                rows.append({"tag": tag, "out": label, "rep": r, **chat(p512, mt, ie), "mem_avail_mb": mem_avail_mb()})
                print(rows[-1], flush=True)
        (OUT / f"perf_gemma_{tag}.json").write_text(json.dumps(rows, indent=1))

    else:  # coexist
        res = {"mem_avail_gemma_only_mb": mem_avail_mb()}
        ag, cold = laya_agent()
        res["laya_cold_load_s"], res["mem_avail_both_resident_mb"] = cold, mem_avail_mb()
        tok = ag.tok if hasattr(ag, "tok") else ag.tokenizer
        st = tok_trim(tok, 512)
        ag.predict("예열", questions(1))

        def laya_burst(n):
            lat = []
            for _ in range(n):
                a = time.perf_counter()
                ag.predict(st, questions(1))
                lat.append(time.perf_counter() - a)
            return lat

        solo = laya_burst(8)
        res["laya_solo"] = {"p50_s": round(statistics.median(solo), 3), "p95_s": round(pct(solo, 95), 3)}
        res["gemma_solo"] = chat(p512, 300, True)
        # 동시 추론: Gemma 가 300토큰을 만드는 동안 Laya 를 계속 부른다
        box = {}
        th = threading.Thread(target=lambda: box.update(g=chat(p512, 300, True)))
        a = time.perf_counter()
        th.start()
        conc, mins = [], []
        while th.is_alive():
            conc += laya_burst(1)
            mins.append(mem_avail_mb())
        th.join()
        res["concurrent"] = {"laya_calls": len(conc), "laya_p50_s": round(statistics.median(conc), 3), "laya_p95_s": round(pct(conc, 95), 3),
                             "gemma": box["g"], "total_s": round(time.perf_counter() - a, 1), "min_mem_avail_mb": min(mins)}
        res["swap_note"] = open("/proc/meminfo").read().split("SwapTotal:")[1].split("\n")[0].strip()
        print(json.dumps(res, ensure_ascii=False), flush=True)
        (OUT / "perf_coexist.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))
