/**
 * 이 아래로 가져오기 — 어느 페이지에서든 같은 길. 붙여 넣기 · 파일(마크다운 · CSV · JSON 을 알아서)을
 * 이 페이지의 하위 페이지로. 표 데이터의 칸은 하위 페이지의 작은 값(props)이 되어 펼쳐 보기에서 거르고 정렬한다.
 * 해석(core rowsToEntries · splitMarkdownPages) · 계획(core importPlan — 같은 것은 고치고, 내가 고친 페이지는 건너뛴다)은 core,
 * 쓰기는 WorkContext.importPages.
 */
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import {
  pageOf,
  rowsToEntries,
  splitMarkdownPages,
  type ImportEntry,
} from "../../../../packages/core/src/pages.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { pickTextFile } from "./io";
import { pageLabel } from "./PageTree";
import { Field, Muted } from "./parts";
import { useWork } from "./WorkContext";

/** 붙여 넣은 글 → 항목 — 표(JSON · CSV)면 행마다, 아니면 '# 제목' 마다 */
export function textToEntries(
  text: string,
  fallbackTitle: string,
): { entries: ImportEntry[]; kind: "rows" | "markdown" } {
  const rows = rowsToEntries(text);
  return rows
    ? { entries: rows, kind: "rows" }
    : { entries: splitMarkdownPages(text, fallbackTitle), kind: "markdown" };
}

export function ImportPagesSheet({
  c,
  workspaceId,
  parentId,
  onClose,
}: {
  c: Palette;
  workspaceId: string;
  parentId: string;
  onClose: () => void;
}) {
  const t = useT();
  const { state, importPages } = useWork();
  const [text, setText] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(
    null,
  );
  const parent = pageOf(state.pages, parentId);
  const preview = text.trim()
    ? textToEntries(text, t("importPages.pasted"))
    : null;

  const run = async () => {
    setNote(null);
    const entries: ImportEntry[] = preview?.entries ?? [];
    if (!entries.length)
      return setNote({ text: t("importPages.nothing"), bad: true });
    setProgress(t("importPages.writing"));
    const r = await importPages(workspaceId, parentId, entries);
    setProgress(null);
    if (r.status === "bad_parent")
      return setNote({ text: t("importPages.badParent"), bad: true });
    if (r.status !== "saved")
      return setNote({ text: t("importPages.failed"), bad: true });
    setNote({ text: t("importPages.done", r) });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.4)",
          justifyContent: "center",
          alignItems: "center",
          padding: 16,
        }}
        onPress={onClose}
        accessibilityLabel={t("common.close")}
      >
        <Pressable
          onPress={() => undefined}
          style={{
            width: "100%",
            maxWidth: 560,
            maxHeight: "90%",
            backgroundColor: c.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: c.border,
          }}
        >
          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 10 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text
              accessibilityRole="header"
              style={{ fontSize: 17, fontWeight: "700", color: c.text }}
            >
              {t("importPages.title")}
            </Text>
            {parent ? (
              <Muted c={c}>
                {t("importPages.picked", {
                  title: pageLabel(parent, t("page.untitled")),
                })}
              </Muted>
            ) : null}
            <Muted c={c}>{t("importPages.textIntro")}</Muted>
            <Field
              c={c}
              value={text}
              onChangeText={setText}
              placeholder={t("importPages.paste")}
              accessibilityLabel={t("importPages.paste")}
              multiline
              style={{ minHeight: 160 }}
            />
            <View style={{ flexDirection: "row" }}>
              <Btn
                c={c}
                small
                label={t("importPages.upload")}
                onPress={async () => {
                  const f = await pickTextFile().catch(() => null);
                  if (f)
                    setText((v) => (v.trim() ? `${v}\n\n${f.text}` : f.text));
                }}
              />
            </View>
            {preview ? (
              <Muted c={c}>
                {t(
                  preview.kind === "rows"
                    ? "importPages.previewRows"
                    : "importPages.previewMd",
                  { count: preview.entries.length },
                )}
              </Muted>
            ) : null}

            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Btn
                c={c}
                primary
                label={t("importPages.run")}
                busy={!!progress}
                disabled={!preview?.entries.length}
                onPress={() => void run()}
              />
              <Btn c={c} label={t("common.close")} onPress={onClose} />
            </View>
            {progress ? <Muted c={c}>{progress}</Muted> : null}
            {note ? (
              <Text style={{ fontSize: 13, color: note.bad ? c.danger : c.ok }}>
                {note.text}
              </Text>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
