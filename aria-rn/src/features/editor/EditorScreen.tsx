import React, { useRef, useState } from "react";
import { Text, useColorScheme, View } from "react-native";

import { usePalette } from "../../components/theme";
import { useT } from "../../i18n";
import LexicalEditor, { type EditorDomProps } from "./LexicalEditor";

const DOM: EditorDomProps = { style: { flex: 1 }, containerStyle: { flex: 1 }, scrollEnabled: false };

/** 편집기 탭 — Lexical 기본 편집기 + 네이티브 쪽에서 받은 평문 · 글자 수 */
export default function EditorScreen() {
  const c = usePalette();
  const t = useT();
  const dark = useColorScheme() === "dark";
  const [plainText, setPlainText] = useState("");
  /** 편집기 상태(JSON) — 화면에 쓰지 않으니 state 대신 ref(바뀔 때마다 웹뷰로 props 를 다시 보내지 않게) */
  const editorState = useRef<string | null>(null);
  const words = plainText.trim() ? plainText.trim().split(/\s+/).length : 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 4 }}>
        <Text style={{ fontSize: 12, color: c.muted }} accessibilityLabel="editor-count">
          {t("editor.count", { words, chars: plainText.length })}
        </Text>
        <Text style={{ fontSize: 13, color: c.text }} numberOfLines={1} accessibilityLabel="editor-preview">
          {plainText || t("editor.empty")}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <LexicalEditor
          palette={c}
          dark={dark}
          placeholder={t("editor.placeholder")}
          onChange={async ({ text, json }) => {
            editorState.current = json;
            setPlainText(text);
          }}
          dom={DOM}
        />
      </View>
    </View>
  );
}
