# features/editor — Lexical 편집기 · 뷰어

Notion 처럼 동작하는 블록 편집기(Lexical 0.52, 확장 API — `defineExtension` · `LexicalExtensionComposer`). 기준은 늘 "Notion 실측"이다 — 동작을 바꿀 때는 Notion 에서 같은 입력을 해 보고 맞춘다.

## 실행 구조

- `LexicalEditor.tsx` · `LexicalViewer.tsx` 는 **DOM 컴포넌트**(`"use dom"`). 웹에서는 앱 페이지에 그대로 그려지고, 네이티브에서는 웹뷰 안에서 돈다.
  - props 는 직렬화되는 값만(문자열 · 숫자 · 팔레트 객체 · 콜백). 노드나 함수 참조를 넘기지 않는다.
  - 이 파일은 **기본 내보내기 하나만** 둘 수 있다(린트 `expo/use-dom-exports`). 도우미는 다른 파일로(예: `markdownCompat.ts`).
- 색은 앱 팔레트를 `--lex-*` CSS 변수로 받는다. 모든 CSS 는 `.lex-root` 아래로 가둔다(`editor.css`, 웹에서 앱 페이지와 섞이지 않게).
- **편집기 탭 내용은 아직 저장하지 않는다**(`EditorScreen.tsx` 는 평문 미리보기 · JSON/HTML 원본 팝업만). 저장을 붙이려면 `onChange` 의 `json` 을 쓴다.
- 자동 시험이 없다 — 바꾸면 웹(`web-emulator`)에서 직접 입력해 확인한다.

## 지도

| 파일 | 맡은 일 |
|---|---|
| `extension.ts` | 편집기 확장 묶음(`editorExtension`) — RichText · History · AutoFocus · List · CheckList · Link · AutoLink · Code · HorizontalRule · Image · Toggle · Callout. 모듈 범위에 두어야 다시 만들어지지 않는다 |
| `LexicalEditor.tsx` | 편집기 본체 — 도구 막대 · 마크다운 · 블록 단축키 · 슬래시 메뉴 · 떠 있는 도구 막대 · 변경 알림(`EditorChange` = text · json · html) |
| `LexicalViewer.tsx` | **읽기 전용** — 같은 노드 · 테마 · 마크다운 규칙으로 마크다운을 서식 있게. `markdown` prop 이 바뀌면 다시 읽는다(업무 원본 보기에서 씀) |
| `markdownCompat.ts` | 일반 마크다운 → 이 편집기 규칙(`> 인용` → `| 인용`, `>` 는 토글이라) |
| `markdown.ts` | `MARKDOWN_TRANSFORMERS`(순서 중요) · 바로 바꾸기(```` ``` ```` · `---`) · 여러 줄 마크다운 붙여넣기 |
| `blocks.ts` | 블록 종류 목록 `BLOCKS`(텍스트 · 제목1~4 · 글머리 · 번호 · 할 일 · 토글 · 콜아웃 · 인용 · 코드 · 이미지 · 구분선) — 슬래시 메뉴와 블록 바꾸기 단축키가 같이 쓴다. 새 블록은 여기에 더한다 |
| `outline.ts` | **블록 개요 모델** — 한 범위(문서 · 토글 안 · 콜아웃 안)를 "순서 + 깊이(0~4) + 종류" 줄(`OutlineEntry`)로 읽고(`$readOutline`) 고쳐서 다시 짓는다(`$writeOutline`). 들여쓰기 · 내어쓰기 · 옮기기 · 복제 · Enter · Backspace 가 모두 이것으로 |
| `shortcuts.ts` | Notion 식 단축키(아래) · 한글 조합 중 Enter(`registerImeEnter`) |
| `listItems.ts` · `blockState.ts` · `listStyle.ts` · `nesting.ts` · `nestedBlocks.ts` | 목록 항목 종류 바꾸기 · 할 일이 아니게 돼도 체크 값 보존 · `a.` 목록 · 목록째 깊이 옮기기 · 중첩 블록 안 커서 자리 |
| `ToggleNodes.ts` · `ToggleExtension.ts` | 토글(제목 + 내용, 열림 상태) 노드 · 명령 · `>` 마크다운 |
| `CalloutExtension.ts` | 콜아웃(이모지 + 내용) |
| `ImageNode.tsx` · `ImageExtension.ts` · `imageFile.ts` | 이미지 — 기기 안에서 줄여 data URL 로(서버 업로드 없음), 손잡이로 크기 조절 |
| `SlashMenuPlugin.tsx` · `ToolbarPlugin.tsx` · `FloatingToolbarPlugin.tsx` · `PlaceholderPlugin.tsx` | `/` 블록 메뉴 · 위 도구 막대 · 선택 위 서식 막대(링크 포함) · 빈 블록 안내(Notion 한국어판 문구) |
| `theme.ts` · `editor.css` | 노드 → CSS 클래스 · 모양(`.lex-viewer` 는 뷰어 전용) |
| `EditorScreen.tsx` | 편집기 탭 화면(미리보기 · 원본 팝업) |

## 마크다운 규칙(입력 · 붙여넣기 · 뷰어 공통)

`#`~`####` 제목 · `>` **토글** · `"` 또는 `|` 인용 · `[]`/`[x]` 할 일 · `-` 글머리 · `1.`/`a.` 번호 · ```` ``` ```` 코드 · `---` 구분선 · `**굵게**` · `*기울임*` · `~취소~` · `` `코드` `` · 링크. 일반 마크다운의 `>` 인용은 이 편집기에서 토글이 되니, 바깥 마크다운을 넣을 때는 `toEditorMarkdown` 을 거친다.

## 단축키(shortcuts.ts)

Cmd+Opt+0~8 블록 바꾸기(0 텍스트 · 1~3 제목 · 4 할 일 · 5 글머리 · 6 번호 · 7 토글 · 8 코드) · Cmd+Enter 체크/토글 · Cmd+D 복제 · Cmd+Shift+↑↓ 옮기기 · Tab/Shift+Tab 자식과 함께 들이고 내어 쓰기(종류는 그대로) · 목록 맨 앞 Backspace 는 같은 깊이 텍스트로 · 빈 목록 Enter 는 내어 쓰거나 텍스트로.

## 바꿀 때

- 목록 깊이를 Lexical 기본 들여쓰기에 맡기지 않는다 — 종류가 섞이면(할 일 아래 글머리) Lexical 은 종류를 바꿔 버린다. `outline.ts` 의 줄 모델로 고친다.
- 새 블록: 노드(필요하면 `extension.ts` 에 확장 등록) → `blocks.ts` 의 `BLOCKS` 에 항목(슬래시 메뉴 `SlashMenuPlugin.tsx` 와 Cmd+Opt 단축키가 이 목록을 읽는다) → 필요하면 `MARKDOWN_TRANSFORMERS` · `theme.ts` · `editor.css` · `PlaceholderPlugin`.
- 칸 · 열이 있는 블록(표 등)은 개요 모델에서 **한 줄(블록 하나)** 로 다룬다 — `outline.ts` 는 범위 바로 아래 블록과 목록 항목만 줄로 읽으니, 새 블록을 범위(토글 · 콜아웃처럼 안에 블록을 담는 것)로 만들 때만 `$readOutline` 의 범위 처리를 함께 고친다.
- 뷰어도 같은 노드를 쓰므로, 새 노드는 `LexicalViewer.tsx` 의 확장 목록에도 넣는다.
