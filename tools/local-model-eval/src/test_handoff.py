"""handoff.py 검증 테스트 — 손으로 만든 정상/오류 결과 블록 20건 + 맥락 묶음 불변식.

실행: python3 -I src/test_handoff.py data   (결과는 results/raw/handoff_unit.json)
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import handoff as H  # noqa: E402

DATA = Path(sys.argv[1] if len(sys.argv) > 1 else "data")
P = (DATA / "P.md").read_text(encoding="utf-8")
O = (DATA / "O.md").read_text(encoding="utf-8")
CTX = {"run_id": "run-001", "task_id": "task-b1", "context_version": 3,
       "line_counts": {"P": len(P.split("\n")), "O": len(O.split("\n"))},
       "source_lines": {"P": P.split("\n"), "O": O.split("\n")}, "post_ids": {"406905", "406899"}}


def blk(obj):
    return "```llmwiki-result\n" + (obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)) + "\n```"


base = {"run_id": "run-001", "task_id": "task-b1", "context_version": 3,
        "artifacts": [{"title": "재수집 계획", "summary": "5분 간격 유지", "source_refs": ["P:107"]}],
        "decision_proposals": [{"text": "ids2.txt 기준 신규만", "reason": "중복 방지", "source_refs": ["P:123"]}],
        "todo_proposals": [{"text": "A사 지원 여부 결정", "due": "2026-11-06", "source_refs": ["P:96"]}],
        "unverified": [{"text": "1개 차이 원인", "why": "원문에 원인 없음"}]}


def mod(**kw):
    o = json.loads(json.dumps(base))
    for k, v in kw.items():
        if v is None:
            o.pop(k, None)
        else:
            o[k] = v
    return o


CASES = [
    ("ok_full", blk(base), dict(parse_ok=True, schema_ok=True, content_ok=True, warn=0)),
    ("ok_no_fence_json_only", json.dumps(base, ensure_ascii=False), dict(parse_ok=True, schema_ok=True, content_ok=True)),
    ("ok_wrapped", blk({"llmwiki_result": base}), dict(parse_ok=True, schema_ok=True, content_ok=True)),
    ("bad_json_trailing_comma", blk('{"run_id": "run-001",}'), dict(parse_ok=False)),
    ("no_block", "작업을 완료했습니다. 결과는 위와 같습니다.", dict(parse_ok=False)),
    ("forbidden_status_top", blk(mod(status="done")), dict(parse_ok=True, schema_ok=False)),
    ("forbidden_confirmed_in_item", blk(mod(decision_proposals=[{"text": "x", "confirmed": True, "source_refs": []}])), dict(schema_ok=False)),
    ("unknown_top_field", blk(mod(notes="hello")), dict(schema_ok=False)),
    ("missing_run_id", blk(mod(run_id=None)), dict(schema_ok=False)),
    ("version_string", blk(mod(context_version="3")), dict(schema_ok=False)),
    ("items_not_list", blk(mod(todo_proposals={"text": "x"})), dict(schema_ok=False)),
    ("item_missing_text", blk(mod(artifacts=[{"title": "t", "source_refs": []}])), dict(schema_ok=False)),
    ("wrong_run_id", blk(mod(run_id="run-999")), dict(schema_ok=True, content_ok=False)),
    ("stale_context_version", blk(mod(context_version=2)), dict(schema_ok=True, content_ok=False)),
    ("ref_line_out_of_range", blk(mod(artifacts=[{"title": "t", "summary": "s", "source_refs": ["P:9999"]}])), dict(content_ok=False)),
    ("ref_bad_format", blk(mod(artifacts=[{"title": "t", "summary": "s", "source_refs": ["그룹바이 문서"]}])), dict(content_ok=False)),
    ("ref_unknown_post", blk(mod(artifacts=[{"title": "t", "summary": "s", "source_refs": ["post:1"]}])), dict(content_ok=False)),
    ("due_invalid_date", blk(mod(todo_proposals=[{"text": "x", "due": "2026-13-40", "source_refs": ["P:96"]}])), dict(content_ok=False)),
    ("due_not_in_source", blk(mod(todo_proposals=[{"text": "재수집", "due": "2026-10-25", "source_refs": ["P:123"]}])), dict(content_ok=True, warn=1)),
    ("no_refs_warning", blk(mod(decision_proposals=[{"text": "x", "reason": "y", "source_refs": []}])), dict(content_ok=True, warn=1)),
]


def run():
    out, fails = [], 0
    for name, text, exp in CASES:
        r = H.validate(text, CTX)
        ok = all(r[k] == v for k, v in exp.items() if k != "warn") and ("warn" not in exp or len(r["warnings"]) == exp["warn"])
        ok = ok and r["accepted_as"] == "proposal"
        fails += not ok
        out.append({"case": name, "pass": ok, "expected": exp, "got": {k: r[k] for k in ("parse_ok", "schema_ok", "content_ok")},
                    "errors": r["errors"], "warnings": r["warnings"]})
    # 묶음 불변식: 예산이 아무리 작아도 목표·기준·결정·한계·형식은 남는다
    secs = H.sections("P", P) + H.sections("O", O)
    sc = json.loads((DATA / "doc_cases.json").read_text(encoding="utf-8"))["bundle_scenarios"][0]
    tok = lambda s: max(1, int(len(s) / 1.6))  # 테스트용 근사(실측 토크나이저는 서버 실험에서 사용)
    inv = []
    for budget in (300, 1500, 100000):
        b = H.build_bundle("run-001", "task-b1", 3, sc, secs, tok, budget)
        must = all(x in b["text"] for x in [sc["goal"], *sc["criteria"], *sc["decisions"], H.ACCESS_LIMITS[0], "```llmwiki-result"])
        inv.append({"budget": budget, "tokens": b["tokens"], "included": len(b["included"]), "dropped": len(b["dropped"]), "fixed_blocks_present": must,
                    "within_budget_or_fixed_only": b["tokens"] <= budget or not b["included"]})
        fails += not must
    return {"result_cases": out, "bundle_invariants": inv, "fails": fails, "n": len(CASES)}


if __name__ == "__main__":
    rep = run()
    (DATA / "result_cases.json").write_text(json.dumps(
        {"ctx": {k: (sorted(v) if isinstance(v, set) else v) for k, v in CTX.items() if k != "source_lines"},
         "cases": [{"name": n, "text": t, "expected": e} for n, t, e in CASES]}, ensure_ascii=False, indent=1))
    outp = Path("results/raw")
    outp.mkdir(parents=True, exist_ok=True)
    (outp / "handoff_unit.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1))
    for c in rep["result_cases"]:
        print(("PASS " if c["pass"] else "FAIL ") + c["case"], c["got"], c["errors"][:1], c["warnings"][:1])
    print(json.dumps(rep["bundle_invariants"], ensure_ascii=False))
    print("fails", rep["fails"], "/", rep["n"] + 3)
    sys.exit(1 if rep["fails"] else 0)
