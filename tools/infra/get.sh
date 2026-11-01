#!/usr/bin/env bash
# 접속 값 꺼내기 — Secret Manager(llmwiki-minsu)의 infra-* 시크릿을 읽는다. 규칙: docs/infra/secrets.md
#   bash tools/infra/get.sh list              시크릿 목록(라벨 llmwiki-note=infra)
#   bash tools/infra/get.sh <대상>            JSON 값
#   bash tools/infra/get.sh <대상> --ssh      ~/.ssh/config 에 붙일 Host 블록(파일은 고치지 않는다)
set -euo pipefail
PROJECT="${LLMWIKI_INFRA_PROJECT:-llmwiki-minsu}"
target="${1:-}"
[ -n "$target" ] || { sed -n '3,5p' "$0" | sed 's/^# //'; exit 2; }

if [ "$target" = list ]; then
  gcloud secrets list --project "$PROJECT" --filter='labels.llmwiki-note=infra' --format='value(name.basename())' 2>/dev/null | sed 's/^infra-//'
  exit
fi

value="$(gcloud secrets versions access latest --secret="infra-$target" --project "$PROJECT" 2>/dev/null)" \
  || { echo "infra-$target 를 읽지 못했다 — 'gcloud auth list' 와 'npm run infra -- list' 로 확인" >&2; exit 1; }

if [ "${2:-}" = --ssh ]; then
  printf '%s' "$value" | node -e '
    const v = JSON.parse(require("fs").readFileSync(0, "utf8"));
    if (!v.host) { console.error("host 가 비어 있다 — docs/infra/secrets.md 새 버전 넣기"); process.exit(1); }
    const names = [process.argv[1], ...(v.aliases ?? [])].filter((x, i, a) => a.indexOf(x) === i);
    console.log(`Host ${names.join(" ")}\n  HostName ${v.host}` + (v.user ? `\n  User ${v.user}` : "")
      + (v.ssh_key ? `\n  IdentityFile ${v.ssh_key}\n  IdentitiesOnly yes` : "") + "\n  ServerAliveInterval 30");
  ' "$target"
else
  printf '%s\n' "$value"
fi
