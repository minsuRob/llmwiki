#!/bin/bash
# 환경·모델·설정 목록 (서버에서 실행)
echo "## host"; hostname; uname -srm; lscpu | grep -E "Model name|^CPU\(s\)|Flags" | sed 's/Flags:/Flags(일부):/' | cut -c1-200
echo "## memory/disk"; free -m | head -2; df -h / | tail -1
echo "## processes(top rss)"; ps -eo rss,comm --sort=-rss | head -6
echo "## llama.cpp"; (cd ~/llama.cpp && git rev-parse HEAD && git log -1 --format=%cd --date=short); ~/llama.cpp/build/bin/llama-server --version 2>&1 | tail -2
echo "## gemma gguf"; ls -l ~/models/gemma4/*.gguf; sha256sum ~/models/gemma4/*.gguf
~/venv/bin/python - <<'PY'
import json, torch, transformers, laya, glob, os
from gguf import GGUFReader
r = GGUFReader(glob.glob(os.path.expanduser("~/models/gemma4/*.gguf"))[0])
def f(k):
    v = r.fields.get(k)
    if not v: return None
    x = v.parts[v.data[0]]
    try: return bytes(x).decode()
    except Exception: return x.tolist()
print("## gemma meta", {k: f(k) for k in ["general.name","general.architecture","general.file_type","gemma4.context_length","general.quantization_version"]})
print("## python libs", {"torch": torch.__version__, "transformers": transformers.__version__, "laya": getattr(laya, "__version__", "0.4.12")})
snap = glob.glob(os.path.expanduser("~/.cache/huggingface/hub/models--convaiinnovations--laya/snapshots/*"))[0]
print("## laya snapshot", snap.split("/")[-1])
for sub in ["", "multilingual", "typed-decisions"]:
    c = json.load(open(os.path.join(snap, sub, "rl_agent_config.json")))
    print("  ", sub or "english(root)", {k: c.get(k) for k in ("encoder", "max_len", "head_max_len", "amp_dtype")})
ag = laya.load("convaiinnovations/laya", subfolder="multilingual", device="cpu", revision="7b928d828b7b")
print("## laya multilingual runtime dtype", next(ag.model.parameters()).dtype, "params", sum(p.numel() for p in ag.model.parameters()))
print("## torch threads", torch.get_num_threads())
PY
