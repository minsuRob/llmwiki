/**
 * 작업 결과 가져오기 — 붙여넣기 · 파일 · Drive 결과물 링크. 원문을 먼저 저장하고, 해석은 그다음(실패해도 원문은 남는다).
 * 같은 결과를 다시 넣으면 "이미 가져온 결과" 로 알리고 아무것도 늘리지 않는다.
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { addOutput, type AiTool, type WorkItem } from "../../../../packages/core/src/work.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { pickTextFile } from "./io";
import { Card, Field, H, Muted } from "./parts";
import { useWork } from "./WorkContext";

export function ImportPanel({ c, item, onClose }: { c: Palette; item: WorkItem; onClose: () => void }) {
  const t = useT();
  const { importText, update, drive, pickDriveOutput } = useWork();
  const prepared = item.runs.filter((r) => r.status === "prepared");
  const [runId, setRunId] = useState<string | null>(prepared.at(-1)?.id ?? null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [link, setLink] = useState("");
  const [linkTitle, setLinkTitle] = useState("");

  const doImport = async (body: string) => {
    if (!body.trim()) return;
    setBusy(true);
    const tool: AiTool | undefined = prepared.find((r) => r.id === runId)?.tool;
    const r = await importText(item.id, body, { runId, tool });
    setBusy(false);
    if (r.kind === "duplicate") setNote({ text: t("import.duplicate") });
    else if (r.kind === "save_failed") setNote({ text: t("import.saveFailed"), bad: true });
    else {
      setText("");
      setNote({ text: r.parsed.structured === "none" ? t("import.rawOnly") : t("import.done", r.counts) });
    }
  };

  return (
    <Card c={c}>
      <H c={c} right={<Btn c={c} small label={t("common.close")} onPress={onClose} />}>
        {t("import.title")}
      </H>
      {prepared.length ? (
        <View style={{ gap: 6 }}>
          <Muted c={c}>{t("import.forRun")}</Muted>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {[...prepared.map((r) => ({ id: r.id as string | null, label: `${t(`tool.${r.tool}`)} · ${r.scope.slice(0, 24)}` })), { id: null, label: t("import.noRun") }].map((o) => (
              <Pressable key={o.id ?? "none"} onPress={() => setRunId(o.id)} accessibilityRole="radio" accessibilityState={{ selected: runId === o.id }} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: runId === o.id ? c.accent : c.soft }}>
                <Text style={{ fontSize: 12, color: runId === o.id ? c.accentText : c.text }}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      <Field c={c} value={text} onChangeText={setText} placeholder={t("import.pastePlaceholder")} accessibilityLabel={t("import.paste")} multiline style={{ minHeight: 140 }} />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Btn c={c} primary label={t("import.importText")} busy={busy} disabled={!text.trim()} onPress={() => void doImport(text)} />
        <Btn
          c={c}
          label={t("import.file")}
          onPress={async () => {
            const f = await pickTextFile().catch(() => null);
            if (f) await doImport(f.text);
          }}
        />
      </View>
      <Muted c={c}>{t("import.hint")}</Muted>

      <View style={{ height: 1, backgroundColor: c.border }} />
      <Muted c={c}>{t("import.outputLink")}</Muted>
      <Field c={c} value={linkTitle} onChangeText={setLinkTitle} placeholder={t("import.outputTitle")} accessibilityLabel={t("import.outputTitle")} />
      <Field c={c} value={link} onChangeText={setLink} placeholder="https://" accessibilityLabel={t("import.outputUrl")} autoCapitalize="none" />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Btn
          c={c}
          label={t("import.addOutput")}
          disabled={!/^https?:\/\//.test(link.trim())}
          onPress={async () => {
            const url = link.trim();
            const s = await update(item.id, (i) => addOutput(i, { title: linkTitle.trim() || url, url, externalId: /\/d\/([\w-]+)/.exec(url)?.[1] ?? null }, new Date().toISOString()));
            setNote(s === "failed" ? { text: t("import.saveFailed"), bad: true } : { text: t("import.outputAdded") });
            setLink("");
            setLinkTitle("");
          }}
        />
        {drive.status === "connected" ? <Btn c={c} label={t("import.pickDriveOutput")} onPress={async () => {
              const n = await pickDriveOutput(item.id);
              if (n) setNote({ text: t("import.outputAdded") });
            }} /> : null}
      </View>
      {note ? <Text style={{ fontSize: 13, color: note.bad ? c.danger : c.ok }}>{note.text}</Text> : null}
    </Card>
  );
}
