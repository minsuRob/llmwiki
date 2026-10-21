import { CodeExtension } from "@lexical/code-core";
import { AutoFocusExtension, HorizontalRuleExtension } from "@lexical/extension";
import { HistoryExtension } from "@lexical/history";
import { AutoLinkExtension, createLinkMatcherWithRegExp, LinkExtension } from "@lexical/link";
import { CheckListExtension, ListExtension } from "@lexical/list";
import { RichTextExtension } from "@lexical/rich-text";
import { configExtension, defineExtension } from "lexical";

import { normalizeLinkUrl } from "./FloatingToolbarPlugin";
import { CalloutExtension } from "./CalloutExtension";
import { ImageExtension } from "./ImageExtension";
import { editorTheme } from "./theme";
import { ToggleExtension } from "./ToggleExtension";

/** 붙여넣은 글이 온전한 http(s) 주소인지 — 선택한 글 위에 붙이면 링크가 된다 */
const isPastableUrl = (url: string) => /^https?:\/\/\S+$/i.test(url) && normalizeLinkUrl(url) !== false;

/** 주소 · 메일을 치고 띄어쓰면 바로 링크로(Notion 과 같다) */
const URL_MATCHER = createLinkMatcherWithRegExp(/((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/, (text) =>
  text.startsWith("http") ? text : `https://${text}`,
);
const EMAIL_MATCHER = createLinkMatcherWithRegExp(/[\w.+-]+@[\w-]+(\.[\w-]+)+/, (text) => `mailto:${text}`);

/** 모듈 범위에 두어야 다시 그릴 때마다 편집기가 새로 만들어지지 않는다 */
export const editorExtension = defineExtension({
  name: "llmwiki/editor",
  namespace: "llmwiki-editor",
  theme: editorTheme,
  dependencies: [
    RichTextExtension,
    HistoryExtension,
    AutoFocusExtension,
    // 엄격 들여쓰기(hasStrictIndent)는 끈다 — 하위 항목을 문단으로 꺼낼 때 뒤 항목들이 제 깊이를 잃는다.
    // Tab · 들여쓰기는 Lexical 탭 들여쓰기 확장 대신 shortcuts.ts 가 개요(outline.ts)로 처리한다(블록 종류는 그대로, 깊이 한도 MAX_DEPTH)
    ListExtension,
    CheckListExtension,
    configExtension(LinkExtension, { validateUrl: isPastableUrl }),
    configExtension(AutoLinkExtension, { matchers: [URL_MATCHER, EMAIL_MATCHER] }),
    CodeExtension,
    HorizontalRuleExtension,
    // 이미지는 기기 안에서만 줄여 data URL 로 담는다(서버 업로드 없음)
    ImageExtension,
    ToggleExtension,
    CalloutExtension,
  ],
  onError(error: Error) {
    throw error;
  },
});

