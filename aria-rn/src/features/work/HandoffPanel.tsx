/**
 * AI 로 이어하기 — 이번 작업 범위를 고르면 목표 · 상태 · 확정 결정 · 자료 발췌 · 완료 조건 · 돌려줄 형식을 한 묶음으로.
 * 복사하거나 .md 파일로 내보낸다. Claude · Codex 를 대신 실행하지 않는다.
 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { AiTool, WorkItem } from "../../../../packages/core/src/work.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { copyText, exportFile } from "./io";
import { Card, Field, H, Muted } from "./parts";
import { useWork } from "./WorkContext";

const TOOLS: AiTool[] = ["claude", "codex", "other"];

export function HandoffPanel({ c, item, onClose }: { c: Palette; item: WorkItem; onClose: () => void }) {
  const t = useT();
  const { prepare, state } = useWork();
  const [tool, setTool] = useState<AiTool>("claude");
  const [scope, setScope] = useState("");
  const [done, setDone] = useState("");
  const [includeCross, setIncludeCross] = useState(false);
  const [pack, setPack] = useState<{ markdown: string; excluded: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cross = state.sources.filter((s) => item.sourceIds.includes(s.id) && s.workspaceId !== item.workspaceId).length;

  const make = async () => {
    setBusy(true);
    setPack(await prepare(item.id, { tool, scope, doneCriteria: done, includeCross }));
    setBusy(false);
  };

  return (
    <Card c={c}>
      <H c={c} right={<Btn c={c} small label={t("common.close")} onPress={onClose} />}>
        {t("handoff.title")}
      </H>
      {!pack ? (
        <>
          <Muted c={c}>{t("handoff.intro")}</Muted>
          <View style={{ flexDirection: "row", gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={t("handoff.tool")}>
            {TOOLS.map((k) => (
              <Pressable key={k} onPress={() => setTool(k)} accessibilityRole="radio" accessibilityState={{ selected: tool === k }} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: tool === k ? c.accent : c.soft }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: tool === k ? c.accentText : c.text }}>{t(`tool.${k}`)}</Text>
              </Pressable>
            ))}
          </View>
          <Field c={c} value={scope} onChangeText={setScope} placeholder={t("handoff.scopePlaceholder")} accessibilityLabel={t("handoff.scope")} multiline />
          <Field c={c} value={done} onChangeText={setDone} placeholder={t("handoff.donePlaceholder")} accessibilityLabel={t("handoff.done")} />
          {cross ? (
            <Pressable onPress={() => setIncludeCross(!includeCross)} accessibilityRole="checkbox" accessibilityState={{ checked: includeCross }} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Text style={{ fontSize: 18, color: includeCross ? c.danger : c.muted }}>{includeCross ? "☑" : "☐"}</Text>
              <Text style={{ flex: 1, fontSize: 13, color: c.text }}>{t("handoff.includeCross", { count: cross })}</Text>
            </Pressable>
          ) : null}
          <Muted c={c}>{t("handoff.accessNote")}</Muted>
          <View style={{ flexDirection: "row" }}>
            <Btn c={c} primary label={t("handoff.make")} busy={busy} disabled={!scope.trim()} onPress={() => void make()} />
          </View>
        </>
      ) : (
        <>
          <Muted c={c}>{t("handoff.ready", { tool: t(`tool.${tool}`) })}</Muted>
          {pack.excluded ? <Muted c={c} danger>{t("handoff.excluded", { count: pack.excluded })}</Muted> : null}
          <ScrollView style={{ maxHeight: 280, backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.border }} contentContainerStyle={{ padding: 10 }}>
            <Text selectable style={{ fontSize: 12, color: c.text, fontFamily: "monospace" }}>
              {pack.markdown}
            </Text>
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Btn c={c} primary label={t("handoff.copy")} onPress={async () => setNote((await copyText(pack.markdown)) ? t("handoff.copied") : t("handoff.copyFailed"))} />
            <Btn c={c} label={t("handoff.export")} onPress={async () => setNote((await exportFile(`${item.title.replace(/[\\/:*?"<>|]/g, "_")}-ai.md`, pack.markdown)) ? t("handoff.exported") : t("handoff.exportFailed"))} />
            <Btn c={c} label={t("handoff.again")} onPress={() => setPack(null)} />
          </View>
          {note ? <Text style={{ fontSize: 13, color: c.ok }}>{note}</Text> : null}
          <Muted c={c}>{t("handoff.nextStep")}</Muted>
        </>
      )}
    </Card>
  );
}
