/**
 * 원본 보기 — 업무 하나가 실제로 저장되는 모습.
 * - 문서: Drive '업무 요약' 폴더에 쓰이는 마크다운(summaryMarkdown.ts)을 편집기와 같은 Lexical 구조로 읽어 서식 있게 보인다.
 *   업무가 바뀌면(item 이 새로 오면) 마크다운이 다시 만들어지고 뷰어가 따라 읽는다
 * - 마크다운: 같은 문서의 글 그대로
 */
import React, { useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, useColorScheme, useWindowDimensions, View } from "react-native";

import type { WorkItem } from "../../../../packages/core/src/work.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import LexicalViewer from "../editor/LexicalViewer";
import { copyText } from "./io";
import { renderSummaryMarkdown } from "./summaryMarkdown";
import { useWork } from "./WorkContext";

type Kind = "doc" | "markdown";
const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" });

export function RawView({ c, item, onClose }: { c: Palette; item: WorkItem; onClose: () => void }) {
  const t = useT();
  const { state } = useWork();
  const screen = useWindowDimensions();
  const dark = useColorScheme() === "dark";
  const [kind, setKind] = useState<Kind>("doc");
  const [note, setNote] = useState<string | null>(null);
  const markdown = renderSummaryMarkdown(item, state, t);
  const viewerHeight = Math.max(240, Math.min(620, screen.height - 220));

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      {/* 바깥을 누르면 닫는다 */}
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 16 }} onPress={onClose} accessibilityLabel={t("common.close")}>
        <Pressable
          onPress={() => {}}
          accessibilityLabel={t("detail.raw.title")}
          style={{ width: "100%", maxWidth: 760, maxHeight: screen.height - 48, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text accessibilityRole="header" style={{ flex: 1, fontSize: 15, fontWeight: "700", color: c.text }}>
              {t("detail.raw.title")}
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={8}>
              <Text style={{ fontSize: 13, color: c.accent }}>{t("common.close")}</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {(["doc", "markdown"] as const).map((k) => (
              <Btn key={k} c={c} small primary={kind === k} label={t(`detail.raw.${k}`)} onPress={() => (setKind(k), setNote(null))} />
            ))}
            <View style={{ flex: 1 }} />
            <Btn c={c} small label={t("handoff.copy")} onPress={async () => setNote((await copyText(markdown)) ? t("handoff.copied") : t("handoff.copyFailed"))} />
          </View>
          <Text style={{ fontSize: 12, color: c.muted }}>{t(`detail.raw.${kind}Note`)}</Text>
          {kind === "doc" ? (
            <View style={{ height: viewerHeight }}>
              <LexicalViewer palette={c} dark={dark} markdown={markdown} dom={{ style: { height: viewerHeight, width: "100%" }, scrollEnabled: true }} />
            </View>
          ) : (
            <ScrollView style={{ flexGrow: 0, backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.border }} contentContainerStyle={{ padding: 10 }}>
              <Text selectable style={{ fontSize: 12, lineHeight: 18, color: c.text, fontFamily: MONO }}>
                {markdown}
              </Text>
            </ScrollView>
          )}
          {note ? <Text style={{ fontSize: 12, color: c.ok }}>{note}</Text> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
