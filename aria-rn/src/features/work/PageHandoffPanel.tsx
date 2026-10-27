/**
 * 페이지 넘기기 — 이 페이지와 하위를 Claude · Codex · Gemma 에 보낸다(core pageHandoff.ts).
 * 데스크톱 셸이면 바로 실행(결과가 오면 자동으로 본문 제안으로 들어온다), 아니면 묶음 복사 · 내보내기 + 결과 붙여 넣기.
 * 들어온 것은 언제나 본문 제안 — 받기 · 빼기는 페이지 위 띠(ProposalCompare)에서 사람이 한다.
 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { PageResultImport } from "../../../../packages/core/src/pageHandoff.ts";
import type { AiTool } from "../../../../packages/core/src/work.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT, type T } from "../../i18n";
import { isActive, useDesktopRuns } from "./DesktopRuns";
import type { DesktopExecutor } from "./desktop";
import { copyText, exportFile } from "./io";
import { Field, Muted } from "./parts";
import { RunHint } from "./RunHint";
import { useWork } from "./WorkContext";

const TOOLS: AiTool[] = ["claude", "codex", "gemma"];
const FILE = "llmwiki-page-ai.md";

export function pageResultNote(t: T, r: PageResultImport | { kind: "save_failed" }): { text: string; bad: boolean } {
  if (r.kind === "save_failed") return { text: t("source.saveFailed"), bad: true };
  if (r.kind === "no_run") return { text: t("pageHandoff.noRun"), bad: true };
  if (r.kind === "duplicate") return { text: t("pageHandoff.duplicate"), bad: false };
  const warn = r.warnings.map((w) => t(`pageHandoff.warn.${w}`)).join(" ");
  return { text: [r.added.length || !r.views.length ? t("pageHandoff.imported", { added: r.added.length, skipped: r.skipped.length }) : "", r.views.length ? t("pageHandoff.viewImported") : "", warn].filter(Boolean).join(" "), bad: r.warnings.length > 0 || !(r.added.length + r.views.length) };
}

export function PageHandoffPanel({ c, pageId, filter }: { c: Palette; pageId: string; filter?: { childIds: string[]; query: string; total: number } | null }) {
  const t = useT();
  const { preparePage, importPageText } = useWork();
  const shell = useDesktopRuns();
  const [tool, setTool] = useState<AiTool>("claude");
  const [scope, setScope] = useState("");
  const [pack, setPack] = useState<{ markdown: string; runId: string; count: number; droppedBodies: number; droppedLines: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [onlyFiltered, setOnlyFiltered] = useState(true);
  const exec = shell.caps?.executors[tool as DesktopExecutor];
  const canRun = shell.available && !!exec?.available;
  const run = pack ? shell.runs[pack.runId] : undefined;

  const make = async () => {
    setBusy(true);
    setNote(null);
    const p = await preparePage(pageId, { tool, scope, ...(filter && onlyFiltered ? { childIds: filter.childIds, query: filter.query } : {}) });
    setBusy(false);
    if (p) setPack(p);
  };
  const take = async () => {
    if (!answer.trim()) return;
    setBusy(true);
    const r = await importPageText(answer, { runId: pack?.runId ?? null, tool });
    setBusy(false);
    setNote(pageResultNote(t, r));
    if (r.kind === "imported" || r.kind === "duplicate") setAnswer("");
  };

  return (
    <View style={{ gap: 8 }}>
      <Muted c={c}>{t("pageHandoff.intro")}</Muted>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {TOOLS.map((k) => (
          <Btn key={k} c={c} small primary={tool === k} label={t(`tool.${k}`)} onPress={() => (setTool(k), setPack(null))} />
        ))}
      </View>
      <Field c={c} value={scope} onChangeText={setScope} placeholder={t("pageHandoff.scopePlaceholder")} accessibilityLabel={t("pagePack.scope")} multiline style={{ minHeight: 56 }} />
      {filter ? (
        <Pressable onPress={() => (setOnlyFiltered(!onlyFiltered), setPack(null))} accessibilityRole="checkbox" accessibilityState={{ checked: onlyFiltered }} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Text style={{ fontSize: 18, color: onlyFiltered ? c.accent : c.muted }}>{onlyFiltered ? "☑" : "☐"}</Text>
          <Text style={{ flex: 1, fontSize: 13, color: c.text }}>{t("pageHandoff.onlyFiltered", { count: filter.childIds.length, total: filter.total, query: filter.query })}</Text>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn c={c} primary={!pack} label={t("pageHandoff.make")} busy={busy && !pack} onPress={() => void make()} />
      </View>
      {pack ? (
        <>
          <Muted c={c}>{t("pageHandoff.ready", { tool: t(`tool.${tool}`), count: pack.count })}</Muted>
          {pack.droppedLines ? <Muted c={c} danger>{t("pageHandoff.droppedLines", { count: pack.droppedLines })}</Muted> : null}
          {pack.droppedBodies ? <Muted c={c} danger>{t("pageHandoff.droppedBodies", { count: pack.droppedBodies })}</Muted> : null}
          <ScrollView style={{ maxHeight: 200, backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.border }} contentContainerStyle={{ padding: 10 }} nestedScrollEnabled>
            <Text selectable style={{ fontSize: 12, color: c.text, fontFamily: "monospace" }}>
              {pack.markdown}
            </Text>
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {canRun ? (
              <Btn
                c={c}
                primary
                label={t("desktop.runNow", { tool: t(`tool.${tool}`) })}
                disabled={!!run && !["failed", "cancelled"].includes(run.status)}
                onPress={() => void shell.start({ itemId: pageId, runId: pack.runId, executor: tool as DesktopExecutor, markdown: pack.markdown })}
              />
            ) : null}
            <Btn c={c} primary={!canRun} label={t("handoff.copy")} onPress={async () => setNote({ text: (await copyText(pack.markdown)) ? t("handoff.copied") : t("handoff.copyFailed"), bad: false })} />
            <Btn c={c} label={t("handoff.export")} onPress={async () => setNote({ text: (await exportFile(FILE, pack.markdown)) ? t("handoff.exported") : t("handoff.exportFailed"), bad: false })} />
          </View>
          {run ? (
            <Text style={{ fontSize: 13, color: run.status === "failed" || run.status === "save_failed" ? c.danger : c.muted }}>
              {isActive(run.status) ? t("pageHandoff.running", { tool: t(`tool.${tool}`) }) : run.status === "imported" ? t("pageHandoff.importedRun", { added: run.pageAdded ?? 0 }) : t(`triage.run.${run.status}`)}
            </Text>
          ) : null}
          {!canRun ? <RunHint c={c} tool={tool} file={FILE} /> : null}
        </>
      ) : null}
      <Field c={c} value={answer} onChangeText={setAnswer} placeholder={t("pageHandoff.pastePlaceholder")} accessibilityLabel={t("pageHandoff.paste")} multiline style={{ minHeight: 60 }} />
      <View style={{ flexDirection: "row" }}>
        <Btn c={c} label={t("pageHandoff.paste")} busy={busy && !!pack} disabled={!answer.trim()} onPress={() => void take()} />
      </View>
      {note ? <Text style={{ fontSize: 13, color: note.bad ? c.danger : c.ok }}>{note.text}</Text> : null}
    </View>
  );
}
