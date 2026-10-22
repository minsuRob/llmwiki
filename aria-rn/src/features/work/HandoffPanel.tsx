/**
 * AI 로 이어하기 — 이번 작업 범위를 고르면 목표 · 상태 · 확정 결정 · 자료 발췌 · 완료 조건 · 돌려줄 형식을 한 묶음으로.
 * 복사하거나 .md 파일로 내보낸다. 웹은 로컬 CLI · SSH 를 못 띄우므로 실행자(Claude · Codex · Gemma)에 맞춰 자료 예산을 정하고,
 * 돌릴 명령(tools/handoff/run.mjs)을 보여 준다. 데스크톱 셸(desktop/) 안이면 '바로 실행' — 셸이 같은 실행 코드로 돌리고
 * 결과를 자동으로 가져온다(DesktopRuns). 어느 쪽이든 결과는 같은 검사를 거쳐 제안으로만 들어간다.
 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { executorOf } from "../../../../packages/core/src/executors.ts";
import type { AiTool, WorkItem } from "../../../../packages/core/src/work.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { DesktopRunLines } from "./DesktopRunLines";
import { useDesktopRuns } from "./DesktopRuns";
import type { DesktopExecutor } from "./desktop";
import { copyText, exportFile } from "./io";
import { Card, Field, H, Muted } from "./parts";
import { useWork } from "./WorkContext";

const TOOLS: AiTool[] = ["claude", "codex", "gemma", "other"];

/** Gemma 에 맞는 작은 일 — 고르면 범위 · 완료 조건을 채운다(고쳐 써도 된다) */
const GEMMA_PRESETS = ["summary", "injectionCheck"] as const;

const fileNameOf = (title: string) => `${title.replace(/[\\/:*?"<>|]/g, "_")}-ai.md`;

export function HandoffPanel({ c, item, onClose }: { c: Palette; item: WorkItem; onClose: () => void }) {
  const t = useT();
  const { prepare, state } = useWork();
  const [tool, setTool] = useState<AiTool>("claude");
  const [scope, setScope] = useState("");
  const [done, setDone] = useState("");
  const [includeCross, setIncludeCross] = useState(false);
  const [pack, setPack] = useState<{ markdown: string; runId: string; excluded: number; dropped: number } | null>(null);
  const shell = useDesktopRuns();
  const [started, setStarted] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cross = state.sources.filter((s) => item.sourceIds.includes(s.id) && s.workspaceId !== item.workspaceId).length;

  const make = async () => {
    setBusy(true);
    setPack(await prepare(item.id, { tool, scope, doneCriteria: done, includeCross }));
    setStarted(null);
    setBusy(false);
  };
  const shellExec = tool !== "other" ? shell.caps?.executors[tool as DesktopExecutor] : undefined;
  const canRun = shell.available && !!shellExec?.available;
  const runNow = async () => {
    if (!pack) return;
    setStarted(pack.runId);
    const r = await shell.start({ itemId: item.id, runId: pack.runId, executor: tool as DesktopExecutor, markdown: pack.markdown });
    if (!r.ok && r.code === "declined") setStarted(null);
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
          {tool === "gemma" ? (
            <View style={{ gap: 6 }}>
              <Muted c={c}>{t("handoff.gemmaHint")}</Muted>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {GEMMA_PRESETS.map((k) => (
                  <Btn
                    key={k}
                    c={c}
                    small
                    label={t(`handoff.preset.${k}.label`)}
                    onPress={() => {
                      setScope(t(`handoff.preset.${k}.scope`));
                      setDone(t(`handoff.preset.${k}.done`));
                    }}
                  />
                ))}
              </View>
            </View>
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
          {pack.dropped ? <Muted c={c} danger>{t("handoff.dropped", { count: pack.dropped })}</Muted> : null}
          <ScrollView style={{ maxHeight: 280, backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.border }} contentContainerStyle={{ padding: 10 }}>
            <Text selectable style={{ fontSize: 12, color: c.text, fontFamily: "monospace" }}>
              {pack.markdown}
            </Text>
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {canRun ? <Btn c={c} primary label={t("desktop.runNow", { tool: t(`tool.${tool}`) })} disabled={!!shell.runs[pack.runId] && !["failed", "cancelled"].includes(shell.runs[pack.runId].status)} onPress={() => void runNow()} /> : null}
            <Btn c={c} primary={!canRun} label={t("handoff.copy")} onPress={async () => setNote((await copyText(pack.markdown)) ? t("handoff.copied") : t("handoff.copyFailed"))} />
            <Btn c={c} label={t("handoff.export")} onPress={async () => setNote((await exportFile(fileNameOf(item.title), pack.markdown)) ? t("handoff.exported") : t("handoff.exportFailed"))} />
            <Btn c={c} label={t("handoff.again")} onPress={() => setPack(null)} />
          </View>
          {note ? <Text style={{ fontSize: 13, color: c.ok }}>{note}</Text> : null}
          {started ? <DesktopRunLines c={c} itemId={item.id} /> : null}
          {canRun ? <Muted c={c}>{t("desktop.runNote", { tool: t(`tool.${tool}`) })}</Muted> : null}
          {shell.available && shellExec && !shellExec.available ? <Muted c={c} danger>{t(`desktop.why.${shellExec.reason ?? "disabled"}`, { tool: t(`tool.${tool}`) })}</Muted> : null}
          {!canRun ? <RunHint c={c} tool={tool} file={fileNameOf(item.title)} /> : null}
          <Muted c={c}>{t("handoff.nextStep")}</Muted>
        </>
      )}
    </Card>
  );
}

/** 이 실행자를 어떻게 돌리나 — 명령 한 줄(복사 가능)과 어디서 도는지 */
export function RunHint({ c, tool, file }: { c: Palette; tool: AiTool; file: string }) {
  const t = useT();
  const ex = executorOf(tool);
  if (!ex) return null;
  const cmd = ex.command.replace("{file}", `"${file}"`);
  return (
    <View style={{ gap: 6, backgroundColor: c.row, borderRadius: 10, padding: 10 }}>
      <Muted c={c}>{t("handoff.runWith")}</Muted>
      <Text selectable style={{ fontSize: 12, color: c.text, fontFamily: "monospace" }}>
        {cmd}
      </Text>
      <Muted c={c}>{t(`handoff.where.${ex.where}`, { tool: t(`tool.${tool}`) })}</Muted>
      {ex.id === "gemma" ? <Muted c={c}>{t("handoff.mcpHint")}</Muted> : null}
    </View>
  );
}
