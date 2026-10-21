import React, { useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, useColorScheme, View } from "react-native";

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
  /** 편집기 상태(JSON) · HTML — 원본 보기를 열 때만 읽으니 state 대신 ref(바뀔 때마다 웹뷰로 props 를 다시 보내지 않게) */
  const source = useRef<{ json: string; html: string }>({ json: "", html: "" });
  const [view, setView] = useState<{ kind: "json" | "html"; body: string } | null>(null);
  const openSource = (kind: "json" | "html") => {
    const { json, html } = source.current;
    const body = kind === "json" ? (json ? JSON.stringify(JSON.parse(json), null, 2) : "") : html.replace(/></g, ">\n<");
    setView({ kind, body: body || t("editor.empty") });
  };
  const words = plainText.trim() ? plainText.trim().split(/\s+/).length : 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 12, color: c.muted }} accessibilityLabel="editor-count">
            {t("editor.count", { words, chars: plainText.length })}
          </Text>
          {(["json", "html"] as const).map((kind) => (
            <Pressable
              key={kind}
              onPress={() => openSource(kind)}
              accessibilityRole="button"
              accessibilityLabel={`editor-source-${kind}`}
              style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: c.border }}
            >
              <Text style={{ fontSize: 11, color: c.muted }}>{kind.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ fontSize: 13, color: c.text }} numberOfLines={1} accessibilityLabel="editor-preview">
          {plainText || t("editor.empty")}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <LexicalEditor
          palette={c}
          dark={dark}
          placeholder={t("editor.placeholder")}
          onChange={async ({ text, json, html }) => {
            source.current = { json, html };
            setPlainText(text);
          }}
          dom={DOM}
        />
      </View>
      <Modal visible={view !== null} animationType="slide" transparent onRequestClose={() => setView(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}>
          <View style={{ height: "80%", backgroundColor: c.bg, borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16, gap: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: c.text }}>{view?.kind.toUpperCase()}</Text>
              <Pressable onPress={() => setView(null)} accessibilityRole="button" accessibilityLabel="editor-source-close" hitSlop={8}>
                <Text style={{ fontSize: 14, color: c.accent }}>{t("editor.close")}</Text>
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
              <Text selectable style={{ fontSize: 12, color: c.text, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" }) }}>
                {view?.body}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
