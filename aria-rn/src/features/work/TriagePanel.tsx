/**
 * 받은 것 정리 맡기기 — 이 주제의 정리 대기 조각을 Claude · Codex · Gemma 에 보낸다.
 * 데스크톱 셸이면 바로 실행(결과가 오면 자동으로 제안으로 들어온다), 아니면 묶음 복사 · 내보내기 + 결과 붙여 넣기.
 * 들어온 것은 언제나 정리 제안 — 받기 · 빼기는 받은 것 흐름에서 사람이 한다.
 */
import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import type { AiTool } from "../../../../packages/core/src/work.ts";
import type { TriageImport } from "../../../../packages/core/src/workTriage.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT, type T } from "../../i18n";
import { isActive, triageTarget, useDesktopRuns } from "./DesktopRuns";
import type { DesktopExecutor } from "./desktop";
import { RunHint } from "./HandoffPanel";
import { copyText, exportFile } from "./io";
import { Field, Muted } from "./parts";
import { useWork } from "./WorkContext";

const TOOLS: AiTool[] = ["claude", "codex", "gemma"];
const FILE = "llmwiki-inbox-ai.md";

export function triageNote(t: T, r: TriageImport | { kind: "save_failed" }): { text: string; bad: boolean } {
  if (r.kind === "save_failed") return { text: t("source.saveFailed"), bad: true };
  if (r.kind === "no_run") return { text: t("triage.noRun"), bad: true };
  if (r.kind === "duplicate") return { text: t("triage.duplicate"), bad: false };
  const warn = r.warnings.map((w) => t(`triage.warn.${w}`)).join(" ");
  return { text: [t("triage.imported", { added: r.added.length, skipped: r.skipped.length }), warn].filter(Boolean).join(" "), bad: r.warnings.length > 0 };
}

export function TriagePanel({ c, onClose }: { c: Palette; onClose: () => void }) {
  const t = useT();
  const { prepareTriage, importTriageText, workspaceId } = useWork();
  const shell = useDesktopRuns();
  const [tool, setTool] = useState<AiTool>("claude");
  const [pack, setPack] = useState<{ markdown: string; runId: string; count: number; dropped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const exec = shell.caps?.executors[tool as DesktopExecutor];
  const canRun = shell.available && !!exec?.available;
  const run = pack ? shell.runs[pack.runId] : undefined;

  const make = async () => {
    setBusy(true);
    setNote(null);
    const p = await prepareTriage(tool);
    setBusy(false);
    if (!p) return setNote({ text: t("triage.nothing"), bad: true });
    setPack(p);
  };
  const runNow = async () => {
    if (!pack) return;
    await shell.start({ itemId: triageTarget(workspaceId), runId: pack.runId, executor: tool as DesktopExecutor, markdown: pack.markdown });
  };
  const take = async () => {
    if (!answer.trim()) return;
    setBusy(true);
    const r = await importTriageText(answer, { runId: pack?.runId ?? null, tool });
    setBusy(false);
    setNote(triageNote(t, r));
    if (r.kind === "imported" || r.kind === "duplicate") setAnswer("");
  };

  return (
    <View style={{ gap: 8, backgroundColor: c.row, borderRadius: 10, padding: 10 }}>
      <Muted c={c}>{t("triage.intro")}</Muted>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {TOOLS.map((k) => (
          <Btn key={k} c={c} small primary={tool === k} label={t(`tool.${k}`)} onPress={() => (setTool(k), setPack(null))} />
        ))}
      </View>
      {!pack ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn c={c} primary label={t("triage.make")} busy={busy} onPress={() => void make()} />
          <Btn c={c} label={t("common.close")} onPress={onClose} />
        </View>
      ) : (
        <>
          <Muted c={c}>{t("triage.ready", { count: pack.count, tool: t(`tool.${tool}`) })}</Muted>
          {pack.dropped ? <Muted c={c} danger>{t("handoff.dropped", { count: pack.dropped })}</Muted> : null}
          <ScrollView style={{ maxHeight: 200, backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.border }} contentContainerStyle={{ padding: 10 }}>
            <Text selectable style={{ fontSize: 12, color: c.text, fontFamily: "monospace" }}>
              {pack.markdown}
            </Text>
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {canRun ? <Btn c={c} primary label={t("desktop.runNow", { tool: t(`tool.${tool}`) })} disabled={!!run && !["failed", "cancelled"].includes(run.status)} onPress={() => void runNow()} /> : null}
            <Btn c={c} primary={!canRun} label={t("handoff.copy")} onPress={async () => setNote({ text: (await copyText(pack.markdown)) ? t("handoff.copied") : t("handoff.copyFailed"), bad: false })} />
            <Btn c={c} label={t("handoff.export")} onPress={async () => setNote({ text: (await exportFile(FILE, pack.markdown)) ? t("handoff.exported") : t("handoff.exportFailed"), bad: false })} />
            <Btn c={c} label={t("common.close")} onPress={onClose} />
          </View>
          {run ? (
            <Text style={{ fontSize: 13, color: run.status === "failed" || run.status === "save_failed" ? c.danger : c.muted }}>
              {isActive(run.status) ? t("triage.running", { tool: t(`tool.${tool}`) }) : run.status === "imported" ? t("triage.imported", { added: run.triageAdded ?? 0, skipped: 0 }) : t(`triage.run.${run.status}`)}
            </Text>
          ) : null}
          {!canRun ? <RunHint c={c} tool={tool} file={FILE} /> : null}
          <Field c={c} value={answer} onChangeText={setAnswer} placeholder={t("triage.pastePlaceholder")} accessibilityLabel={t("triage.paste")} multiline style={{ minHeight: 60 }} />
          <View style={{ flexDirection: "row" }}>
            <Btn c={c} label={t("triage.paste")} busy={busy} disabled={!answer.trim()} onPress={() => void take()} />
          </View>
        </>
      )}
      {note ? <Text style={{ fontSize: 13, color: note.bad ? c.danger : c.ok }}>{note.text}</Text> : null}
    </View>
  );
}
