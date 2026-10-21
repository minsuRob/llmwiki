import React, { useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, useColorScheme, useWindowDimensions, View } from "react-native";

import { usePalette } from "../../components/theme";
import { useT } from "../../i18n";
import LexicalEditor, { type EditorDomProps } from "./LexicalEditor";

type Anchor = { x: number; y: number; width: number; height: number };

/** 원본 팝업 자리 — 누른 버튼 오른쪽 위에 맞추고, 오른쪽이 아주 좁으면(200px 미만) 버튼 아래로. 화면 밖으로 넘치지 않게 */
function popoverFrame(anchor: Anchor, screen: { width: number; height: number }) {
  const margin = 12;
  const right = anchor.x + anchor.width + 8;
  const beside = screen.width - right - margin >= 200;
  const left = beside ? right : margin;
  const top = beside ? anchor.y : anchor.y + anchor.height + 6;
  return {
    position: "absolute" as const,
    left,
    top,
    width: Math.min(520, screen.width - left - margin),
    maxHeight: Math.max(160, screen.height - top - margin * 2),
  };
}

const DOM: EditorDomProps = { style: { flex: 1 }, containerStyle: { flex: 1 }, scrollEnabled: false };

/** 편집기 탭 — Lexical 기본 편집기 + 네이티브 쪽에서 받은 평문 · 글자 수 */
export default function EditorScreen() {
  const c = usePalette();
  const t = useT();
  const dark = useColorScheme() === "dark";
  const [plainText, setPlainText] = useState("");
  /** 편집기 상태(JSON) · HTML — 원본 보기를 열 때만 읽으니 state 대신 ref(바뀔 때마다 웹뷰로 props 를 다시 보내지 않게) */
  const source = useRef<{ json: string; html: string }>({ json: "", html: "" });
  const [view, setView] = useState<{ kind: "json" | "html"; body: string; anchor: Anchor } | null>(null);
  const buttons = useRef<Record<"json" | "html", View | null>>({ json: null, html: null });
  const screen = useWindowDimensions();
  const openSource = (kind: "json" | "html") => {
    const { json, html } = source.current;
    const body = kind === "json" ? (json ? JSON.stringify(JSON.parse(json), null, 2) : "") : html.replace(/></g, ">\n<");
    // 누른 버튼 자리를 재서 그 오른쪽에 띄운다
    buttons.current[kind]?.measureInWindow((x, y, width, height) => setView({ kind, body: body || t("editor.empty"), anchor: { x, y, width, height } }));
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
              ref={(r) => {
                buttons.current[kind] = r;
              }}
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
      <Modal visible={view !== null} animationType="fade" transparent onRequestClose={() => setView(null)}>
        {/* 바깥을 누르면 닫는다 */}
        <Pressable style={{ flex: 1 }} onPress={() => setView(null)} accessibilityLabel="editor-source-backdrop">
          {view && (
            <Pressable
              onPress={() => {}}
              style={[
                popoverFrame(view.anchor, screen),
                { backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 10, padding: 12, gap: 8, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
              ]}
              accessibilityLabel="editor-source-popover"
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: c.text }}>{view.kind.toUpperCase()}</Text>
                <Pressable onPress={() => setView(null)} accessibilityRole="button" accessibilityLabel="editor-source-close" hitSlop={8}>
                  <Text style={{ fontSize: 13, color: c.accent }}>{t("editor.close")}</Text>
                </Pressable>
              </View>
              <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 4 }}>
                <Text selectable style={{ fontSize: 11, lineHeight: 16, color: c.text, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" }) }}>
                  {view.body}
                </Text>
              </ScrollView>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}
