/**
 * 페이지로 가져오기 — 취준 공고(Firestore users/{uid}/jobs · jobTexts) 또는 붙여 넣은 · 올린 마크다운을 한 부모 아래 하위 페이지로.
 * 순서: 주제 → 부모(새 페이지 · 있는 페이지) → 출처 거르기 → 가져오기. 공고 본문(jobTexts)은 이 기기에서 8개씩 읽는다(서버는 내용을 보지 않는다).
 * 변환(core jobPages.ts) · 계획(core importPlan — 같은 공고는 고치고, 내가 고친 페이지는 건너뛴다)은 core, 쓰기는 WorkContext.importPages.
 */
import { doc, getDoc } from "firebase/firestore";
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { jobToEntry } from "../../../../packages/core/src/jobPages.ts";
import { isExpired, type Job, type JobSource } from "../../../../packages/core/src/jobs.ts";
import { pageOf, splitMarkdownPages, type ImportEntry } from "../../../../packages/core/src/pages.ts";
import { mapLimit } from "../../../../packages/core/src/workStore.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { db } from "../../firebase/client";
import { useT } from "../../i18n";
import { pickTextFile } from "./io";
import { PagePicker, pageLabel } from "./PageTree";
import { Field, Muted } from "./parts";
import { useWork } from "./WorkContext";

export type ImportSource = { kind: "jobs"; jobs: Job[]; uid: string } | { kind: "markdown"; workspaceId: string; parentId: string };

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function Chip({ c, label, on, onPress }: { c: Palette; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: on ? c.accent : c.soft }}>
      <Text style={{ fontSize: 13, color: on ? c.accentText : c.text }}>{label}</Text>
    </Pressable>
  );
}

export function ImportPagesSheet({ c, source, onClose, onDone }: { c: Palette; source: ImportSource; onClose: () => void; onDone?: (parentId: string) => void }) {
  const t = useT();
  const { state, workspaceId, createPage, importPages } = useWork();
  const [ws, setWs] = useState(source.kind === "markdown" ? source.workspaceId : workspaceId);
  const [parentId, setParentId] = useState<string | null>(source.kind === "markdown" ? source.parentId : null);
  const [newTitle, setNewTitle] = useState(t("importPages.newParentTitle"));
  const [picking, setPicking] = useState(false);
  const [from, setFrom] = useState<JobSource | null>(null);
  const [devOnly, setDevOnly] = useState(false);
  const [text, setText] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [donePage, setDonePage] = useState<string | null>(null);
  const today = todayStr();
  const jobs = useMemo(
    () => (source.kind === "jobs" ? source.jobs.filter((j) => !isExpired(j, today) && (!from || j.source === from) && (!devOnly || j.dev)) : []),
    [source, from, devOnly, today],
  );
  const parent = pageOf(state.pages, parentId);

  const run = async () => {
    setNote(null);
    let entries: ImportEntry[];
    if (source.kind === "jobs") {
      if (!jobs.length) return setNote({ text: t("importPages.nothing"), bad: true });
      // 본문은 이 기기에서 읽는다 — 서버는 공고 본문을 보지 않는다
      const want = jobs.filter((j) => j.hasText);
      let done = 0;
      setProgress(t("importPages.reading", { done, total: want.length }));
      const texts = new Map<string, string>();
      await mapLimit(want, 8, async (j) => {
        const s = await getDoc(doc(db, "users", source.uid, "jobTexts", j.id)).catch(() => null);
        const body = s?.data()?.text;
        if (typeof body === "string") texts.set(j.id, body);
        done++;
        if (done % 8 === 0 || done === want.length) setProgress(t("importPages.reading", { done, total: want.length }));
      });
      entries = jobs.map((j) => jobToEntry(j, texts.get(j.id) ?? null));
    } else {
      entries = splitMarkdownPages(text, t("importPages.pasted"));
      if (!entries.length) return setNote({ text: t("importPages.nothing"), bad: true });
    }
    let target = parentId;
    if (!target) {
      const p = await createPage({ workspaceId: ws, parentId: null, title: newTitle.trim() || t("importPages.newParentTitle") });
      if (!p) {
        setProgress(null);
        return setNote({ text: t("importPages.failed"), bad: true });
      }
      target = p.id;
      setParentId(p.id);
    }
    setProgress(t("importPages.writing"));
    const r = await importPages(ws, target, entries);
    setProgress(null);
    if (r.status === "bad_parent") return setNote({ text: t("importPages.badParent"), bad: true });
    if (r.status !== "saved") return setNote({ text: t("importPages.failed"), bad: true });
    setNote({ text: t("importPages.done", r) });
    setDonePage(target);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 16 }} onPress={onClose} accessibilityLabel={t("common.close")}>
        <Pressable onPress={() => undefined} style={{ width: "100%", maxWidth: 560, maxHeight: "90%", backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.border }}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: "700", color: c.text }}>
              {t("importPages.title")}
            </Text>
            <Muted c={c}>{source.kind === "jobs" ? t("importPages.jobsIntro") : t("importPages.mdIntro")}</Muted>

            {source.kind === "jobs" ? (
              <>
                <Text style={{ fontSize: 13, fontWeight: "700", color: c.muted }}>{t("importPages.workspace")}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {state.manifest.workspaces.map((w) => (
                    <Chip key={w.id} c={c} label={w.name} on={ws === w.id} onPress={() => (setWs(w.id), setParentId(null))} />
                  ))}
                </View>
                <Text style={{ fontSize: 13, fontWeight: "700", color: c.muted }}>{t("importPages.parent")}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <Chip c={c} label={t("importPages.newParent")} on={!parentId} onPress={() => (setParentId(null), setPicking(false))} />
                  <Chip c={c} label={parent ? t("importPages.picked", { title: pageLabel(parent, t("page.untitled")) }) : t("importPages.existing")} on={!!parentId} onPress={() => setPicking(true)} />
                </View>
                {!parentId && !picking ? <Field c={c} value={newTitle} onChangeText={setNewTitle} accessibilityLabel={t("importPages.newParent")} /> : null}
                {picking ? <PagePicker c={c} workspaceId={ws} onPick={(id) => (setParentId(id), setPicking(false))} onCancel={() => setPicking(false)} /> : null}
                <Text style={{ fontSize: 13, fontWeight: "700", color: c.muted }}>{t("importPages.source")}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <Chip c={c} label={t("importPages.all")} on={!from} onPress={() => setFrom(null)} />
                  <Chip c={c} label="그룹바이" on={from === "groupby"} onPress={() => setFrom("groupby")} />
                  <Chip c={c} label="인디스워크" on={from === "inthiswork"} onPress={() => setFrom("inthiswork")} />
                  <Chip c={c} label={t("importPages.devOnly")} on={devOnly} onPress={() => setDevOnly(!devOnly)} />
                </View>
                <Muted c={c}>{t("importPages.count", { count: jobs.length })}</Muted>
              </>
            ) : (
              <>
                {parent ? <Muted c={c}>{t("importPages.picked", { title: pageLabel(parent, t("page.untitled")) })}</Muted> : null}
                <Field c={c} value={text} onChangeText={setText} placeholder={t("importPages.paste")} accessibilityLabel={t("importPages.paste")} multiline style={{ minHeight: 160 }} />
                <View style={{ flexDirection: "row" }}>
                  <Btn
                    c={c}
                    small
                    label={t("importPages.upload")}
                    onPress={async () => {
                      const f = await pickTextFile().catch(() => null);
                      if (f) setText((v) => (v.trim() ? `${v}\n\n${f.text}` : f.text));
                    }}
                  />
                </View>
              </>
            )}

            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Btn c={c} primary label={t("importPages.run")} busy={!!progress} onPress={() => void run()} />
              {donePage && onDone ? <Btn c={c} label={t("importPages.open")} onPress={() => onDone(donePage)} /> : null}
              <Btn c={c} label={t("common.close")} onPress={onClose} />
            </View>
            {progress ? <Muted c={c}>{progress}</Muted> : null}
            {note ? <Text style={{ fontSize: 13, color: note.bad ? c.danger : c.ok }}>{note.text}</Text> : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
