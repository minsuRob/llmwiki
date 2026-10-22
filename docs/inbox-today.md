# 오늘 화면 — 받은 것(인박스) 중심 설계안

> 2026-10-22 확정. 코드는 아직 바꾸지 않았다. 구현할 때 `architecture.md` 의 흐름 표부터 고치고 코드를 맞춘다.
>
> 확정한 것: ① 첫 화면은 받은 것 흐름 ② 큰 범주(개발 · 독서 · 회사 · 개인 …)는 사람이 정한다 ③ 영역(Area) 층은 없애고 **범주 바로 아래가 업무**다.
>
> 1단계 구현(2026-10-22): `packages/core/src/work.ts` "받은 것" 절 · 테스트 `inbox.test.ts`. 설계와 달라진 곳 — 정리 제안 셋(`file_source` · `new_work` · `concept_link`)은 모두 매니페스트의 `triage` 한 곳에 둔다(업무 `proposals` 에 섞지 않는다. 조각 하나의 제안을 한 번에 보이기 쉽다). 개념은 우선 조각의 `concepts`(이름)로만 남기고 시냅스 그래프 합치기는 뒤로 미룬다. 정리 묶음 기록(`triageRuns`)도 매니페스트에 둔다.

## 한 줄

**Claude · Codex 와 얘기하다 남기고 싶은 것을 그대로 던져 두면, Claude 가 위키에 엮고, 사람은 확정만 한다.**

지금 오늘 화면은 "추천 · 마감 · 판단"을 사람에게 요구하는 관리자 대시보드다. 이 컨셉에서 첫 화면이 할 일은 하나다 — **던진 것이 안 잃어버려졌고, 누군가(Claude) 가 엮고 있고, 내가 할 일은 확정뿐**이라는 걸 보여 주는 것.

## llmwiki 의 성격 — 화면에 어떻게 담기나

llmwiki 는 할 일 앱이 아니라 **LLM 과 사람이 같이 쓰는 위키**다. README · architecture.md 에 흩어진 성격을 모으면 다섯이고, 받은 것 화면은 이 다섯을 그대로 드러내야 한다.

| llmwiki 의 성격 | 받은 것 화면에서 |
|---|---|
| **기록이 쌓이면 개념이 이어진다** (시냅스 · `[[제목]]` 볼트) | 던진 조각은 "저장됨"으로 끝나지 않는다. Claude 가 엮으면 **어느 업무 · 어느 개념에 붙었는지**가 조각 밑에 `[[링크]]` 로 보인다. 화면의 세 번째 묶음 "오늘 위키에 더해진 것"이 그 결과다 |
| **AI 는 제안, 확정은 사람** (원칙 1) | Claude 의 정리는 전부 `Proposal` 이다. 조각을 업무에 잇는 것, 새 업무를 만드는 것, 개념을 붙이는 것 모두 "판단이 필요해요"에서 사람이 받아들인다. 받아들이기 전까지 조각은 인박스에 남는다 |
| **원문은 버리지 않고 근거를 댄다** (`refs` · 줄 번호 · 검사 플래그) | 조각의 원문은 `Source.text` 그대로. Claude 의 제안에는 "이 조각의 3번째 줄 때문에"(`S1:3`) 가 붙는다. 어디서 왔는지(Claude 대화 · Codex · 손) 도 조각에 남는다 |
| **데이터는 사용자 Drive, 규칙은 core 한 곳** (원칙 2) | 인박스는 새 저장소가 아니다. `Source` 에 정리 상태 하나를 더할 뿐이고, 앱의 + 와 Claude 의 MCP 쓰기는 **같은 `newSource` · `linkSource`** 를 부른다 |
| **어제 AI 와 하던 일을 오늘 이어가기** | "이어서 할 업무"는 남긴다. 다만 한 업무를 네 번 보여 주지 않는다 — 업무 하나는 화면에 한 번 |

## 화면 구성

아래 탭은 그대로(오늘 · 업무 · 보관함 · 편집기 · 대화). 바뀌는 건 **오늘 탭의 내용과 순서**다. 위에서 아래로:

### 0. 작업실 칩 (개인 · 회사 · +주제) — 유지
인박스는 작업실별로 본다. **큰 범주(개발 · 독서 · 회사 · 개인 …)는 사람이 정한다** — 범주의 목록도, 조각이 어느 범주에 속하는지도 Claude 가 제안하지 않는다. 지금 고른 칩이 던지는 곳이다. 범주는 지금의 Workspace 그대로다(`addWorkspace` 로 "독서"를 더하면 끝).

### 1. 입력란 — 화면 맨 위, 항상 열려 있음
```
┌──────────────────────────────────────────────┐
│ 붙여 넣거나 적어 두세요. 정리는 Claude 가 합니다. │
│                                              │
│                                   [남기기]   │
└──────────────────────────────────────────────┘
```
- 묻지 않는다: 업무 · 제목은 안 묻는다. 범주는 위 칩으로 이미 골라져 있으므로 붙여 넣고 남기기, 끝. 범주를 바꾸려면 칩을 누른다(한 번).
- URL 이면 `link`, 아니면 `paste`(붙여 넣은 원문) 로 저장. 제목은 첫 줄 80자(지금 QuickAdd 와 같음).
- 남긴 직후 그 조각이 바로 아래 흐름 맨 위에 "정리 대기"로 나타난다 — 안 잃어버렸다는 확인은 이걸로 충분하고, 토스트는 안 띄운다.
- 우하단 + 단추는 다른 탭에서만 남긴다(오늘 탭엔 입력란이 있으므로).

### 2. 받은 것 — 조각 흐름(최신 위)
조각 하나의 모양:
```
┌──────────────────────────────────────────────┐
│ 피트인은 2027년 1월 부평구로 이전 예정 …        │  ← 원문 2~3줄
│ Claude 대화 · 10/22 14:03          [정리 대기] │  ← 출처 · 시각 · 상태
└──────────────────────────────────────────────┘
```
상태는 셋뿐이다:

| 상태 | 뜻 | 조각 밑에 보이는 것 |
|---|---|---|
| **정리 대기** | 아직 Claude 가 안 봤다 | 없음 |
| **제안 있음** | Claude 가 엮을 곳을 냈다 | "→ 그룹바이 지원 후보 정리에 잇기 · 근거 S1:2" + [받기] [다른 곳] [빼기] |
| **엮임** | 사람이 받아들였다 | `[[그룹바이 지원 후보 정리]]` · `[[부평구]]` 같은 링크 칩. 흐름에서 하루 뒤 사라지고 보관함 · 업무 상세에서 산다 |

- 정리 대기가 N개면 묶음 머리에 **"정리 대기 3 · [Claude 에게 정리 맡기기]"**. 이 단추가 지금의 "맥락 묶기 → 실행" 과 같은 길(데스크톱 셸 · 터미널 `run.mjs`) 로 **정리 묶음**을 보낸다. MCP 가 붙으면 Claude 가 대화 중에 스스로 하므로 단추는 보조가 된다.
- 조각을 길게 누르면 손으로 잇기(지금 QuickAdd 의 "이을 업무" 고르기를 여기로 옮긴다). 손으로 이은 건 제안 없이 바로 "엮임".
- 한 조각이 여러 업무에 이어질 수 있다(자료는 한 벌, 지금 규칙 그대로).

### 3. 판단이 필요해요 — 유지, 범위 확장
지금 카드 그대로 두고, 세는 것에 **조각 제안**을 더한다: "제안 3 · 결정 제안 1 · 조각 2 · 바뀐 자료 0". 조각 제안은 2 에서 바로 받을 수도 있고 여기서 업무별로 모아 받을 수도 있다. 사람이 판단하는 자리는 **이 카드 하나**다.

### 4. 오늘 위키에 더해진 것
오늘 "엮임"이 된 조각과 받아들인 제안을 **업무 · 개념 기준으로 모아** 보여 준다.
```
그룹바이 지원 후보 정리
  + 조각 2 · 할 일 1 · 결정 1
  [[부평구]] [[피트인]] [[2027-01]]
```
- 이게 위키가 자라는 모습이다. 조각(점) 이 업무 · 개념(점) 에 선으로 이어졌다는 걸 하루 단위로 보여 준다. 누르면 업무 상세 또는 시냅스 그래프(로컬 그래프, 깊이 1).
- 개념 추출은 기존 `synapse.ts` 규칙 길 + Claude 제안(`concept_link`) 을 쓴다. 새 엔진을 만들지 않는다.

### 5. 이어서 할 업무 — 축소
진행 중 업무를 **한 줄씩**(제목 · 다음 행동 하나). 2~4 에 이미 나온 업무는 여기서 뺀다 — 한 업무는 한 번.

### 옮기는 것
- **추천 행동 3개 · 순서 바꾸기 · 가까운 마감** → 업무 탭 맨 위로. 추천 엔진(`recommend`) 과 `todayOrder` 는 그대로 쓰고 자리만 옮긴다.
- **최근 AI 작업 결과** → 4 "오늘 위키에 더해진 것" 안으로 녹인다(실행 결과도 결국 업무에 더해진 것이다).

### 빈 상태
업무가 하나도 없어도 입력란은 있다. 첫 조각을 던지면 Claude 의 첫 제안은 "새 업무 만들기"가 된다 — 업무를 먼저 만들라고 요구하지 않는다.

## 데이터 흐름

### 모델 — 더하는 것만, 새 저장소 없음

구현(`packages/core/src/work.ts`, 스키마 2)은 아래 모양이다. 처음 설계와 달라진 곳은 셋 — 정리 제안은 업무 `proposals` 가 아니라 **매니페스트의 `triage` 한 곳**에, 개념은 노드 id 가 아니라 **이름(`concepts`)** 으로, 정리 묶음 기록(`triageRuns`)도 매니페스트에.

```ts
// Source 에 셋을 더한다
interface Source {
  …
  /** 정리 상태 — inbox: 아직 안 엮임 · filed: 업무 · 개념에 이어짐 · dismissed: 뺌. 값이 없는 옛 자료는 filed 로 본다 */
  triage?: "inbox" | "filed" | "dismissed";
  /** 어디서 던졌나 — 출처 표시 · 검사 기준 */
  origin?: { via: "app" | "share" | "mcp"; tool?: AiTool | null };
  /** 받아들인 개념 이름 — 시냅스 그래프와 합치기 전 */
  concepts?: string[];
}

// 정리 제안 — 업무 proposals 와 별개. 매니페스트 triage[] 에 둔다
type TriageKind = "file_source" | "new_work" | "concept_link";
interface TriageProposal {
  id: string;
  kind: TriageKind;
  status: "open" | "accepted" | "rejected";
  workspaceId: string;      // 조각과 같은 범주 — 제안은 이 범주 안에서만
  sourceIds: string[];      // 대상 조각(new_work 는 여럿일 수 있다)
  itemId?: string | null;   // file_source: 이을 업무
  title?: string; goal?: string;   // new_work: 새 업무 제목 · 목표
  concept?: string;         // concept_link: 개념 이름
  note?: string;            // AI 가 쓴 근거 문장
  refs?: string[];          // 근거 줄("S1:2")
  flags?: ("no_evidence" | "injection_suspect" | "bad_refs")[];
  runId?: string | null; tool?: AiTool | null;
  createdAt: string; decidedAt?: string | null;
}

interface WorkManifest {
  …
  triage: TriageProposal[];   // 열린 것은 모두, 정한 것은 최근 100개
  triageRuns?: TriageRun[];   // 묶음의 S1 · W1 이 어느 조각 · 업무인지(refLines · rawHash · counts). 최근 20개
}
```
- 제안 셋이 모두 매니페스트 `triage` 에 있으므로 조각 하나의 제안을 한 번에 보이기 쉽고, `new_work` 처럼 업무가 아직 없는 제안도 같은 자리에 둔다. 매니페스트는 이미 Drive 에 한 파일이라 새 저장소가 아니다.
- 들이기는 `proposeTriage` 가 한다 — 없는 조각 · 업무, 범주를 넘는 제안, 빈 칸(`new_work` 제목 · `concept_link` 개념), 같은 열린 제안은 들이지 않고(`TriageSkip`), 근거(`refs`)가 없으면 들이되 `no_evidence` 로 표시한다.
- 받아들이기는 `acceptTriage` 하나다: `file_source` → `linkSource`, `new_work` → `createWorkItem` + `linkSource`, `concept_link` → 조각 `concepts` 에 이름 추가. 셋 다 조각 `triage` 를 `filed` 로 바꾼다. [다른 곳]은 `itemId` 를 넘겨 사람이 고른 업무에 잇고, 그 업무가 다른 범주면 `needs_confirm` 으로 확인을 거친다. [빼기]는 `rejectTriage`(조각은 정리 대기로 남는다). 화면 단추와 MCP 가 같은 함수를 부른다(원칙 1).
- 사람만 하는 것: `fileSource`(제안 없이 손으로 잇기) · `dismissSource` · `restoreSource` · `moveSource`(범주 옮기기 — 그 조각의 열린 제안은 닫는다) · `moveWorkItem`.
- `workspaceId` 는 지금처럼 **항상 있다**. 범주는 사람 몫이므로 Claude 의 제안은 조각과 같은 범주 안에서만 들어온다. 다른 범주 업무에 잇는 것은 사람이 [다른 곳]으로 고를 때만, 확인을 거쳐서.
- 앱과 MCP 가 같은 매니페스트를 번갈아 쓰므로 저장은 `WorkRepo.saveManifestWith` 로 하고, 충돌하면 최신본에 `mergeTriage` 로 내 제안 · 기록만 얹는다(사본 없음).

### 흐름

```
① 던지기 ──┬─ 앱 입력란 · 다른 탭 +        ─┐
           ├─ 공유 시트(iOS · Android)     ─┼→ newSource({provider, text|url, triage:"inbox", origin})  → Drive 보관함
           └─ MCP llmwiki_capture (Claude) ─┘

② 엮기 ──── [Claude 에게 정리 맡기기](prepareTriage → 셸 · 터미널) 또는 MCP llmwiki_inbox (Claude 가 대화 중 스스로)
            묶음 = 이 범주의 정리 대기 조각(최신 30개, 오래된 것부터 S1 · 줄 번호 S1:1…) + 업무 목록(W1 · 제목 · 목표 · 다음 행동) + 개념 이름 목록
            기록 = 매니페스트 triageRuns 에 run(S1 · W1 → 실제 id · 줄 수)
            결과 = llmwiki-triage 블록의 triage[] 에 file_source · new_work · concept_link (붙여 넣기 또는 MCP llmwiki_propose)
            → importTriage 가 검사(없는 줄 근거는 빼고 bad_refs · 지시문은 injection_suspect · 확정 필드는 무시 · 같은 원문은 한 번만)
            → proposeTriage 가 들인다(범주 넘김 · 없는 조각/업무 · 빈 칸 · 중복은 거름) → 매니페스트 triage 에 제안으로만 저장

③ 확정 ──── 받은 것 흐름에서 사람이 [받기] [다른 곳] [빼기]
            → acceptTriage(linkSource / createWorkItem + linkSource / concepts 추가) → triage: filed → "오늘 위키에 더해진 것"
            → rejectTriage 면 조각은 정리 대기로 남는다

④ 이어가기 ─ 다음 맥락 묶음에 그 조각이 자료로 들어간다(지금 흐름 그대로)
```

### Claude 가 읽고 쓰는 길 — MCP (`tools/llmwiki-mcp`)

컨셉의 진짜 마찰은 이 앱이 아니라 **Claude Code · Codex 대화창**에 있다. 거기서 "이거 남겨 둬" 한마디가 곧 ① 이 되어야 한다. architecture.md 의 열린 문제 "서버 읽기를 MCP 로 열 때의 인증"에 답을 먼저 적는다.

구현(`tools/llmwiki-mcp/server.mjs`, stdio, 의존성 없음)의 도구 여섯. 범주(`workspace`)는 이름 또는 id.

| 도구 | 하는 일 | 권한 |
|---|---|---|
| `llmwiki_workspaces()` | 범주 목록(이름 · id · 비공개 여부). 범주는 사용자가 정한다 | 읽기 |
| `llmwiki_capture(workspace, text, tool?)` | 조각을 `triage:"inbox"`, `origin:{via:"mcp", tool}` 로 저장(URL 하나면 `link`, 아니면 `paste`). **범주는 필수** — Claude 가 대화 맥락으로 고르고 "개발에 남겼어요" 라고 말한다. 틀리면 앱에서 칩 한 번으로 옮긴다. 범주를 만들거나 바꾸는 도구는 없다 | 쓰기 — 받은 것에만. 비공개 범주도 됨 |
| `llmwiki_work(workspace)` | 업무 목록 — 제목 · 상태 · 목표 · 다음 행동 · 이어 둔 조각 수 | 읽기 |
| `llmwiki_read(item)` | 업무 하나의 맥락 — 목표 · 완료 조건 · 현재 상황 · 확정된 결정 · 다음 행동 · 이어 둔 조각(글 조각은 본문까지) | 읽기 |
| `llmwiki_inbox(workspace, tool?)` | 정리 묶음(`prepareTriage` 와 같은 것 — 조각 S1 · 줄 번호 · 업무 W1 · 개념 · 규칙 · 돌려줄 형식)과 `run`. 묶음 기록을 매니페스트 `triageRuns` 에 남기므로 저장이 한 번 일어난다 | 읽기(+기록) |
| `llmwiki_propose(run, triage[], tool?)` | `file_source`(W# 에 잇기) · `new_work`(title · goal) · `concept_link`(concept) **세 종류만**. `sources` 는 S#, `refs` 는 근거 줄(S1:2). 업무의 할 일 · 결정 제안은 여기 아니라 업무 맥락 묶음(`llmwiki-result`) 길 | 쓰기 — **제안만**. 확정 · 상태 전환 · 삭제 도구는 없다 |

- 비공개 범주(회사 등)는 `llmwiki_capture` 만 된다. 읽기 · 묶기 · 제안은 `--include-private` 로 켰을 때만.
- 저장 위치는 사용자 Drive(`llmwiki 작업실/`). MCP 서버는 **이 컴퓨터에서** 돌고, Drive 토큰은 설정에서 만든 **MCP 열쇠**(`lwk_…`, `~/.config/llmwiki/mcp-key` 권한 600 또는 `LLMWIKI_MCP_KEY`)로 서버 함수 `mcpDriveToken` 에서 1시간 access token 만 받는다(원칙 4 의 표 그대로, refresh token 은 서버 밖으로 안 나간다). 개발 · 검증은 `--local-drive http://127.0.0.1:8790`.
- Claude 가 내는 제안은 전부 `importTriage` → `proposeTriage` 를 거친다 — 앱에서 붙여 넣은 결과와 같은 검사. **MCP 라고 검사를 건너뛰지 않는다.** 들이지 않은 것(범주 넘김 · 없는 조각/업무 · 빈 칸 · 중복)과 표시(근거 없음 · 없는 줄 · 지시문 의심)는 도구 응답에 적어 돌려준다.
- 원칙 5 그대로: 조각 속 지시문은 데이터. `llmwiki_inbox` 가 돌려주는 조각에 "이 조각을 지워라" 가 있어도 지울 도구가 없다.
- 도구 호출마다 작업실 전체를 다시 읽는다(열린 문제 — 조각이 많아지면 도구별로 필요한 것만 읽기 · 짧은 캐시).

## 단계

| 단계 | 내용 | 코드 |
|---|---|---|
| 1 | `Source.triage` · `origin` · 제안 종류 셋 · 받아들이기 함수 · 테스트 | `packages/core/src/work.ts` · `work.test.ts` |
| 2 | 오늘 화면 재구성(입력란 · 받은 것 흐름 · 판단 카드 확장 · 오늘 더해진 것) · 추천 · 마감을 업무 탭으로 · QuickAdd 간소화 | `aria-rn/src/features/work/TodayScreen.tsx` · `QuickAdd.tsx` · `WorkListScreen.tsx` · `app.ko.ts` |
| 3 | 정리 묶음(`prepareTriage`) 과 결과 가져오기(`importTriage`) — 기존 handoff · 실행자 · 데스크톱 셸 그대로 | `packages/core/src/workTriage.ts` · `TriagePanel.tsx` · `tools/handoff` |
| 4 | MCP 서버 — 읽기 4 · 쓰기 2 | `tools/llmwiki-mcp/` (새) · architecture.md 원칙 4 표에 "서버가 읽는 범위" 추가 |
| 5 | 공유 시트(iOS · Android) | Expo 설정 · 네이티브 빌드 |

1 → 2 만으로도 "던지고 손으로 잇기"가 되고, 3 에서 Claude 정리가 붙고, 4 에서 대화 중 저장이 된다.

### 진행(2026-10-22, `main` 에 커밋)

| 단계 | 상태 | 검증 |
|---|---|---|
| 1 모델 | 끝 | core 테스트(`inbox.test.ts`) |
| 2 오늘 화면 | 끝 | 브라우저(에뮬레이터): 남기기 · 손으로 잇기 · 오늘 더해진 것 · 업무 탭 추천 |
| 3 정리 묶음 | 끝 | core 테스트(`workTriage.test.ts`) · 브라우저: 묶기 → 답 붙여 넣기 → 받기 · 빼기. 실제 AI 왕복은 못 함(이 컴퓨터의 Claude CLI 로그인 만료 · Codex 기본 모델 미지원 · Gemma 서버 scp 끊김) |
| 4 MCP | 끝 | `npm run test:mcp` · 로컬 Drive 에 앱과 MCP 를 함께 붙여 남기기 → 묶음 → 제안 → 앱에서 받기, 동시 쓰기 합치기 |
| 5 공유 시트 | 안 함 | 네이티브 모듈 + 개발 빌드가 필요 — 따로 |

- 데스크톱 셸은 바뀌지 않았다(정리 실행은 기존 브리지에 `triage-<범주>` 대상으로 실린다). 셸은 배포된 웹을 띄우므로 새 화면은 웹 배포 뒤에 셸에 보인다.

## 열린 문제
- "엮임" 조각이 흐름에서 사라지는 기준(하루? 보관함으로 넘어가는 시점?).
- 개념 링크의 확정 — 개념은 지금 `rebuildGraph` 로 자동이라 "제안"이 아니다. 조각의 개념만 제안으로 둘지, 전부 자동으로 둘지.
- MCP 인증 — 토큰을 어디에 두고 누가 갱신하나(원칙 4 의 표에 먼저 쓴 뒤 구현).
- 옛 기능(대화 탭)과의 관계 — 대화는 Claude · Codex 바깥에서 한다는 컨셉이면 대화 탭의 자리를 줄일지.

## 범주는 사람이, 그 아래는 Claude 가 — 구조에 주는 영향

| 층 | 누가 | 지금 코드에서 |
|---|---|---|
| **범주**(개발 · 독서 · 회사 · 개인 …) | 사람 — 목록을 만들고, 조각 · 업무가 어디 속하는지 정한다 | `Workspace` 그대로. 이름 · 아이콘 · 비공개 여부 이미 있음. "작업실"을 "범주"로 부를지만 정하면 된다 |
| **업무 · 개념 · 연결** | Claude 제안 → 사람 확정 | `WorkItem` · 시냅스 · `Proposal` |
| **영역**(`Area`) | — | **없앤다.** 범주를 사람이 세분하므로 두 번째 층은 겹친다. 아래 "영역 제거" 참고 |

구조 변경에 큰 문제는 없다. 오히려 쉬워진다:
- 작업실 `null` 이 없어지므로 미정 조각 · 비공개 섞임 문제가 사라진다.
- 회사(비공개) 범주는 지금처럼 따로 묶여 나가고, Claude 가 범주를 넘나드는 제안을 안 하므로 묶음도 범주 하나씩이다.
- 던질 때 범주 하나 고르는 건 칩 한 번이고, 오늘 탭에서는 이미 골라져 있어 0번이다.

### 영역 제거 — 구조는 세 층에서 두 층으로

```
전:  범주(Workspace) ─ 영역(Area) ─ 업무(WorkItem) ─ 조각 · 할 일 · 결정 · 결과물
후:  범주(Workspace) ─ 업무(WorkItem) ─ 조각 · 할 일 · 결정 · 결과물
```

기본 범주는 **개발 · 독서 · 회사 · 개인** 넷(회사만 비공개). 지금의 개인 · 회사 둘에 더하는 것이고, 사용자가 `addWorkspace` 로 더 만들거나 지운다.

영역이 쓰이는 곳은 적다(core 4곳 · 화면 4곳 · 테스트). 바꾸는 것:

| 곳 | 지금 | 후 |
|---|---|---|
| `Workspace.areas` · `Area` · `PERSONAL_AREA_KEYS` · `COMPANY_AREA_KEYS` | 범주마다 영역 목록 | 삭제. `defaultManifest` 는 범주 넷만 만든다(`names.areas` 인자 삭제) |
| `WorkItem.areaId` | 필수 | 삭제. `createWorkItem` · `editWork` 입력에서 뺀다 |
| `judgments.ts` 의 `areaId` | 판단 기록에 영역 저장 | `workspaceId` 만 남긴다 |
| `WorkListScreen` | 새 업무 폼의 영역 고르기 · 목록을 영역별로 묶음 | 폼에서 빼고, 목록은 **상태별**(진행 중 · 대기 · 막힘 · 계획)로 묶는다 |
| `WorkDetailScreen` · `summaryMarkdown` | 머리에 "범주 · 영역" | "범주"만 |
| `WorkContext` | 영역 이름 번역을 매니페스트에 넣음 | 삭제 |
| `app.ko.ts` · `app.en.ts` | `area.*` · `work.area` | 삭제 |

**이행**(`WORK_SCHEMA_VERSION` 1 → 2):
- `upgradeItem`: `areaId` 를 지운다. 값은 어디에도 안 옮긴다 — 영역이 "이직 · 개발 · 부업" 이었으면 그건 범주가 되어야 할 것이지 업무 속성이 아니다.
- `upgradeManifest`: `workspaces[].areas` 를 지운다. 기본 두 범주(`ws-personal` · `ws-company`)가 있으면 그대로 두고 **개발 · 독서는 더하지 않는다** — 기존 사용자의 범주는 사용자가 만든다. 새 사용자만 넷으로 시작한다.
- 옛 영역의 이름이 아까우면(예: "이직" 아래 업무가 여럿) 이행 뒤 사용자가 범주 "이직"을 만들고 업무를 옮긴다. 업무의 범주 옮기기(`editWork` 에 `workspaceId`)는 이 단계에 같이 넣는다 — 조각은 한 벌이라 업무를 옮기면 이어진 조각도 그 범주에서 보인다(`cross_link` 확인 규칙 그대로).
- Drive 의 업무 파일은 다음 저장 때 새 모양으로 쓰인다. 되돌릴 일은 없다(지운 값은 영역 id 하나뿐).

**단계 표의 1단계에 포함**한다 — 모델을 한 번에 바꾸고 테스트를 한 번에 고친다.
