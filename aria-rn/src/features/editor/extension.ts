import { CodeExtension } from "@lexical/code-core";
import { AutoFocusExtension, HorizontalRuleExtension, TabIndentationExtension } from "@lexical/extension";
import { HistoryExtension } from "@lexical/history";
import { AutoLinkExtension, createLinkMatcherWithRegExp, LinkExtension } from "@lexical/link";
import { CheckListExtension, ListExtension } from "@lexical/list";
import { RichTextExtension } from "@lexical/rich-text";
import { $isElementNode, configExtension, defineExtension, type ElementNode } from "lexical";

import { normalizeLinkUrl } from "./FloatingToolbarPlugin";
import { CalloutExtension } from "./CalloutExtension";
import { ImageExtension } from "./ImageExtension";
import { editorTheme } from "./theme";
import { ToggleExtension } from "./ToggleExtension";

/** 들여쓰기 한도 — 단계 수(0 포함). 5 면 0~4, 다섯 단계까지 들어간다(목록 항목 포함) */
export const MAX_INDENT = 5;

/**
 * 바로 위 블록보다 한 단계 깊게까지만 들인다(Notion 과 같다) — 위 블록이 없거나 이미 그만큼 들어가 있으면 막는다.
 * 문단 · 목록 항목 모두 같은 규칙
 */
const $canIndentOneLevel = (block: ElementNode) => {
  const prev = block.getPreviousSibling();
  return prev !== null && $isElementNode(prev) && block.getIndent() <= prev.getIndent();
};

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
    // Tab 으로 한 단계씩만 들어가는 규칙은 $canIndentOneLevel 이 목록 항목에도 똑같이 건다
    ListExtension,
    CheckListExtension,
    configExtension(LinkExtension, { validateUrl: isPastableUrl }),
    configExtension(AutoLinkExtension, { matchers: [URL_MATCHER, EMAIL_MATCHER] }),
    CodeExtension,
    HorizontalRuleExtension,
    configExtension(TabIndentationExtension, { maxIndent: MAX_INDENT, $canIndent: $canIndentOneLevel }),
    // 이미지는 기기 안에서만 줄여 data URL 로 담는다(서버 업로드 없음)
    ImageExtension,
    ToggleExtension,
    CalloutExtension,
  ],
  onError(error: Error) {
    throw error;
  },
});

