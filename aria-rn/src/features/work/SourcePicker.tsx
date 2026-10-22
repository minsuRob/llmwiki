/**
 * 자료 붙이기(페이지에) — 메모 · 링크 · 파일(글) · Drive(Picker) · 보관함에 있는 자료. 같은 자료는 다시 복사하지 않고 잇기만 한다.
 * 다른 작업실 자료는 확인을 받고서야 잇는다.
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { pagesForSource, type PageDoc, type PageMeta } from "../../../../packages/core/src/pages.ts";
import type { Source } from "../../../../packages/core/src/work.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { confirmAsk, pickTextFile } from "./io";
import { Field, Muted } from "./parts";
import { useWork } from "./WorkContext";

export function SourcePicker({ c, page, doc, onDone }: { c: Palette; page: PageMeta; doc: PageDoc; onDone?: () => void }) {
  const t = useT();
  const { state, addSource, linkExisting, drive, pickFromDrive } = useWork();
  const [mode, setMode] = useState<"note" | "link" | "vault">("note");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const item = page;
  const available = state.sources.filter((s) => !doc.sourceIds.includes(s.id));

  const link = async (s: Source) => {
    let r = await linkExisting(item.id, s.id);
    if (r === "needs_confirm") {
      const ws = state.manifest.workspaces.find((w) => w.id === s.workspaceId);
      if (!(await confirmAsk(t("source.crossTitle"), t("source.crossAsk", { workspace: ws?.name ?? "" }), t("source.crossOk"), t("common.cancel")))) return;
      r = await linkExisting(item.id, s.id, true);
    }
    setNote({ text: t("source.linked", { title: s.title }) });
  };
  const result = (r: Awaited<ReturnType<typeof addSource>>) => setNote(r.source ? { text: t("source.added") } : { text: t("source.saveFailed"), bad: true });

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {(["note", "link", "vault"] as const).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: mode === m ? c.accent : c.soft }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: mode === m ? c.accentText : c.text }}>{t(`source.mode.${m}`)}</Text>
          </Pressable>
        ))}
        <Btn
          c={c}
          small
          label={t("source.file")}
          onPress={async () => {
            const f = await pickTextFile().catch(() => null);
            if (f) result(await addSource({ workspaceId: item.workspaceId, provider: "upload", title: f.name, text: f.text, format: "text" }, item.id));
          }}
        />
        <Btn
          c={c}
          small
          label={t("source.drive")}
          disabled={drive.status !== "connected"}
          onPress={async () => {
            const r = await pickFromDrive(item.id);
            if (r) setNote({ text: r.folders ? t("source.driveFolder", { added: r.added, folders: r.folders, visible: r.folderVisible }) : t("source.driveAdded", { added: r.added }) });
          }}
        />
      </View>
      {drive.status !== "connected" ? <Muted c={c}>{t(`drive.hint.${drive.status}`)}</Muted> : null}

      {mode === "note" ? (
        <>
          <Field c={c} value={text} onChangeText={setText} placeholder={t("source.notePlaceholder")} accessibilityLabel={t("source.mode.note")} multiline />
          <View style={{ flexDirection: "row" }}>
            <Btn
              c={c}
              small
              primary
              label={t("source.saveNote")}
              disabled={!text.trim()}
              onPress={async () => {
                result(await addSource({ workspaceId: item.workspaceId, provider: "note", title: text.trim().split("\n")[0].slice(0, 80), text: text.trim() }, item.id));
                setText("");
                onDone?.();
              }}
            />
          </View>
        </>
      ) : null}
      {mode === "link" ? (
        <>
          <Field c={c} value={title} onChangeText={setTitle} placeholder={t("source.linkTitle")} accessibilityLabel={t("source.linkTitle")} />
          <Field c={c} value={text} onChangeText={setText} placeholder="https://" accessibilityLabel={t("source.linkUrl")} autoCapitalize="none" />
          <Muted c={c}>{t("source.linkNote")}</Muted>
          <View style={{ flexDirection: "row" }}>
            <Btn
              c={c}
              small
              primary
              label={t("source.saveLink")}
              disabled={!/^https?:\/\//.test(text.trim())}
              onPress={async () => {
                result(await addSource({ workspaceId: item.workspaceId, provider: "link", title: title.trim() || text.trim(), url: text.trim() }, item.id));
                setText("");
                setTitle("");
              }}
            />
          </View>
        </>
      ) : null}
      {mode === "vault" ? (
        available.length ? (
          available.slice(0, 30).map((s) => {
            const ws = state.manifest.workspaces.find((w) => w.id === s.workspaceId);
            const other = s.workspaceId !== item.workspaceId;
            return (
              <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.row, borderRadius: 10, padding: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, color: c.text }}>{s.title}</Text>
                  <Muted c={c} danger={other}>
                    {other ? t("source.otherWorkspace", { workspace: ws?.name ?? "" }) : t("source.usedBy", { count: pagesForSource(state.pages, s.id).length })}
                  </Muted>
                </View>
                <Btn c={c} small label={t("source.link")} onPress={() => void link(s)} />
              </View>
            );
          })
        ) : (
          <Muted c={c}>{t("source.vaultEmpty")}</Muted>
        )
      ) : null}
      {note ? <Text style={{ fontSize: 13, color: note.bad ? c.danger : c.ok }}>{note.text}</Text> : null}
    </View>
  );
}
