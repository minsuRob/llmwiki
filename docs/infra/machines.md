# 개발 기기 · 원격

> 2026-11-01 정리. 색인: [INFRA.md](../../INFRA.md). 주소 · 계정은 시크릿에만 둔다 — [secrets.md](secrets.md)

| 기기 | 쓰임 | 접속 | 시크릿 |
|---|---|---|---|
| 이 맥(개발 맥) | 개발 · 시험 · Claude Code · MCP | — | — |
| macserver | 원격 맥(Tailscale) | SSH 별칭 `macserver` · `maki-mac` · `feeeld-inc-macbookpro-2` (셋 다 같은 기기) | `infra-macserver` |
| Oracle A1 | Gemma · Laya · 작업 큐 | SSH 별칭 `oci-a1` | `infra-oci-a1` — [oracle-a1.md](oracle-a1.md) |

- Tailscale 기기 목록: `tailscale status`. Oracle A1 은 Tailscale 에 없다(공인 IP 로 SSH).
- SSH 키는 `~/.ssh/id_ed25519`. 별칭 블록이 사라지면 `npm run infra -- <이름> --ssh` 로 다시 만든다.
