#!/usr/bin/env python3
"""서버 작업 큐 — 오래 걸리는 실험을 하나씩(10~15분 단위) 돌린다. 표준 라이브러리만.

  jobd.py kinds                  실행할 수 있는 작업 종류(정해진 것만, 임의 명령 없음)
  jobd.py submit <kind>          큐에 넣기 → {"id": ...}
  jobd.py status [id]            대기·실행·완료 목록 또는 한 건
  jobd.py result <id>            완료 기록 + 로그 끝부분
  jobd.py cancel <id>            대기 중이면 빼고, 실행 중이면 멈춘다
  jobd.py worker                 작업자(하나만). 큐를 FIFO 로 꺼내 실행한다

작업자는 작업 종류에 맞춰 Gemma(llama-server)를 켜고 끈다: Laya 작업 전에는 끄고(메모리), Gemma 작업 전에는 켠다.
작업마다 걸린 시간 · 최대 RSS(/usr/bin/time) · 최저 MemAvailable · 스왑을 기록한다.
"""
import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from pathlib import Path

HOME = Path.home()
LWE = HOME / "lwe"
Q = LWE / "jobs"
for d in ("queue", "running", "done", "logs"):
    (Q / d).mkdir(parents=True, exist_ok=True)
PY_VENV = str(HOME / "venv/bin/python")
GEMMA = [str(HOME / "llama.cpp/build/bin/llama-server"), "-m", str(HOME / "models/gemma4/gemma-4-E4B_q4_0-it.gguf"),
         "-t", "2", "-c", "8192", "-np", "1", "--jinja", "--port", "8080", "--host", "127.0.0.1"]

L = lambda *parts: [PY_VENV, "src/laya_eval.py", "data", "results/raw", *parts]
G = lambda *parts: [["python3", "src/gemma_eval.py", "data", "results/raw", p] for p in parts]
KINDS = {
    # 챕터 → (Gemma 필요 여부, 예상 분, 명령 목록)
    "env_probe":            ("any",  1,  [["bash", "src/env_probe.sh"]]),
    "laya_judg_main":       ("off", 12,  [L("judg_A")]),
    "laya_judg_lang":       ("off", 12,  [L("judg_B")]),
    "laya_judg_stability":  ("off", 14,  [L("judg_S")]),
    "laya_judg_snippet":    ("off",  5,  [L("judg_H")]),
    "laya_perf":            ("off", 12,  [[PY_VENV, "src/perf.py", "laya_matrix", "results/raw", "2"]]),
    "gemma_doc":            ("on",  14,  G("qa_full", "summary", "next", "uncertain")),
    "gemma_qa_retrieval":   ("on",  14,  G("qa_bm25_a")),
    "gemma_judg_inject":    ("on",  15,  G("judg_a", "inject_a")),
    "gemma_struct_review":  ("on",  15,  G("struct_a", "struct_b", "review")),
    "gemma_translate_q":    ("on",   3,  G("translate_q")),
    "laya_judg_snippet_gq": ("off",  3,  [L("judg_T")]),
    "perf_gemma_coexist":   ("on",  14,  [["python3", "src/perf.py", "gemma_len", "results/raw", "t2", "2"],
                                          [PY_VENV, "src/perf.py", "coexist", "results/raw"]]),
}


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def jdump(o):
    print(json.dumps(o, ensure_ascii=False, indent=1))


def read(p):
    return json.loads(p.read_text())


def find(jid):
    for d in ("queue", "running", "done"):
        p = Q / d / f"{jid}.json"
        if p.exists():
            return d, p
    return None, None


# ----------------------------------------------------------------------------- Gemma 켜고 끄기
def gemma_up():
    try:
        urllib.request.urlopen("http://127.0.0.1:8080/health", timeout=2)
        return True
    except Exception:  # noqa: BLE001
        return False


def gemma_pids():
    out = subprocess.run(["pgrep", "-f", "llama-server -m"], capture_output=True, text=True).stdout.split()
    return [int(x) for x in out]


def ensure_gemma(want, log):
    if want == "on" and not gemma_up():
        a = time.time()
        subprocess.Popen(GEMMA, cwd=LWE, stdout=open(LWE / "results/raw/gemma_server.log", "a"), stderr=subprocess.STDOUT, start_new_session=True)
        while not gemma_up():
            time.sleep(1)
        log(f"gemma started cold_ready_s={time.time() - a:.1f}")
    elif want == "off":
        for pid in gemma_pids():
            os.kill(pid, signal.SIGTERM)
            log(f"gemma stopped pid={pid}")
        while gemma_pids():
            time.sleep(1)


def mem_avail_mb():
    for l in open("/proc/meminfo"):
        if l.startswith("MemAvailable"):
            return int(l.split()[1]) // 1024
    return -1


def swap_used_mb():
    m = {l.split(":")[0]: int(l.split()[1]) for l in open("/proc/meminfo") if l.startswith(("SwapTotal", "SwapFree"))}
    return (m.get("SwapTotal", 0) - m.get("SwapFree", 0)) // 1024


# ----------------------------------------------------------------------------- 작업자
def worker():
    lock = Q / "worker.pid"
    if lock.exists():
        try:
            os.kill(int(lock.read_text()), 0)
            print("worker already running")
            return
        except (OSError, ValueError):
            pass
    lock.write_text(str(os.getpid()))
    while True:
        items = sorted((Q / "queue").glob("*.json"), key=lambda p: read(p)["created"])
        if not items:
            time.sleep(5)
            continue
        qp = items[0]
        job = read(qp)
        rp = Q / "running" / qp.name
        qp.rename(rp)
        logf = Q / "logs" / f"{job['id']}.log"
        lf = open(logf, "a")
        log = lambda m: (lf.write(f"[{time.strftime('%H:%M:%S')}] {m}\n"), lf.flush())
        need, est, cmds = KINDS[job["kind"]]
        job.update(status="running", started=now(), est_min=est)
        rp.write_text(json.dumps(job, ensure_ascii=False))
        ensure_gemma(need, log)
        mins = [mem_avail_mb()]
        stop = threading.Event()
        def sample():
            while not stop.is_set():
                mins.append(mem_avail_mb())
                time.sleep(5)

        threading.Thread(target=sample, daemon=True).start()
        a, rc, steps = time.time(), 0, []
        for cmd in cmds:
            s = time.time()
            p = subprocess.Popen(["/usr/bin/time", "-v", *cmd], cwd=LWE, stdout=lf, stderr=subprocess.PIPE, text=True, start_new_session=True)
            (Q / "running" / f"{job['id']}.pid").write_text(str(p.pid))
            _, err = p.communicate()
            lf.write(err[-3000:])
            rss = next((int(l.split(":")[1]) // 1024 for l in err.splitlines() if "Maximum resident set size" in l), None)
            steps.append({"cmd": " ".join(cmd[1:4]), "rc": p.returncode, "wall_s": round(time.time() - s, 1), "max_rss_mb": rss})
            rc = rc or p.returncode
            if p.returncode:
                break
        stop.set()
        job.update(status="done" if rc == 0 else "failed", ended=now(), wall_s=round(time.time() - a, 1), steps=steps,
                   min_mem_avail_mb=min(mins), swap_used_mb=swap_used_mb(), gemma_resident=gemma_up())
        (Q / "done" / qp.name).write_text(json.dumps(job, ensure_ascii=False, indent=1))
        rp.unlink(missing_ok=True)
        (Q / "running" / f"{job['id']}.pid").unlink(missing_ok=True)
        log(f"{job['status']} wall_s={job['wall_s']}")
        lf.close()


# ----------------------------------------------------------------------------- 명령
def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "kinds":
        jdump({k: {"gemma": v[0], "est_min": v[1]} for k, v in KINDS.items()})
    elif cmd == "submit":
        kind = sys.argv[2]
        if kind not in KINDS:
            jdump({"error": f"모르는 작업 종류: {kind}", "kinds": list(KINDS)})
            sys.exit(2)
        jid = time.strftime("%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
        job = {"id": jid, "kind": kind, "created": now(), "status": "queued", "est_min": KINDS[kind][1]}
        (Q / "queue" / f"{jid}.json").write_text(json.dumps(job, ensure_ascii=False))
        ahead = len(list((Q / "queue").glob("*.json"))) - 1 + len(list((Q / "running").glob("*.json")))
        jdump({**job, "jobs_ahead": ahead})
    elif cmd == "status":
        if len(sys.argv) > 2:
            d, p = find(sys.argv[2])
            jdump(read(p) if p else {"error": "없음"})
        else:
            jdump({d: [{k: j.get(k) for k in ("id", "kind", "status", "created", "started", "ended", "wall_s", "est_min")}
                       for j in sorted((read(p) for p in (Q / d).glob("*.json")), key=lambda j: j["created"])][-10:]
                   for d in ("queue", "running", "done")} | {"gemma_up": gemma_up(), "mem_avail_mb": mem_avail_mb()})
    elif cmd == "result":
        d, p = find(sys.argv[2])
        logf = Q / "logs" / f"{sys.argv[2]}.log"
        tail = logf.read_text().splitlines()[-25:] if logf.exists() else []
        jdump({"job": read(p) if p else None, "log_tail": [l for l in tail if "Command being timed" not in l][-15:]})
    elif cmd == "cancel":
        d, p = find(sys.argv[2])
        if d == "queue":
            p.unlink()
            jdump({"cancelled": sys.argv[2]})
        elif d == "running":
            pid = int((Q / "running" / f"{sys.argv[2]}.pid").read_text())
            os.killpg(pid, signal.SIGTERM)
            jdump({"stopped": sys.argv[2]})
        else:
            jdump({"error": "대기·실행 중인 작업이 아님"})
    elif cmd == "worker":
        worker()


if __name__ == "__main__":
    main()
