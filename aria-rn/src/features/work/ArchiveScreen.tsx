/**
 * 보관함 — 원본 자료 · 메모 · AI 작업 결과 · 결과물 · 검색. 지금 고른 작업실 것만 보인다.
 * 자료는 한 벌만 있고, 이어 둔 업무를 거꾸로 찾아 보여 준다(복사하지 않는다).
 */
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";

import { itemsForSource, searchWork, type Source } from "../../../../packages/core/src/work.ts";
import { usePalette, type Palette } from "../../components/theme";
import { PAGE } from "../../components/ui";
import { useT } from "../../i18n";
import { Field, Muted, Pill, WorkspaceChips, when } from "./parts";
import { useWork } from "./WorkContext";

type Tab = "sources" | "notes" | "runs" | "outputs" | "search";
const TABS: Tab[] = ["sources", "notes", "runs", "outputs", "search"];
const NOTE_PROVIDERS = new Set(["note", "paste", "legacy"]);

const open = (id: string) => router.push({ pathname: "/work/[id]", params: { id } });

function Box({ c, children, onPress }: { c: Palette; children: React.ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "link" : undefined} style={{ backgroundColor: c.surface, borderRadius: 12, padding: 12, gap: 4, borderWidth: 1, borderColor: c.border }}>
      {children}
    </Pressable>
  );
}

function SourceRow({ c, s }: { c: Palette; s: Source }) {
  const t = useT();
  const { state } = useWork();
  const used = itemsForSource(state.items, s.id);
  return (
    <Box c={c} onPress={s.url ? () => void Linking.openURL(s.url as string) : undefined}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ flex: 1, fontSize: 14, color: s.url ? c.accent : c.text }}>{s.title}</Text>
        <Pill c={c} label={t(`ingest.${s.ingest.status}`)} tone={s.ingest.status === "ok" ? "ok" : s.ingest.status === "unsupported" ? "muted" : "danger"} />
      </View>
      {s.text && NOTE_PROVIDERS.has(s.provider) ? (
        <Text numberOfLines={3} style={{ fontSize: 13, color: c.text }}>
          {s.text}
        </Text>
      ) : null}
      <Muted c={c}>
        {t(`provider.${s.provider}`)} · {t(`format.${s.format}`)} · {when(s.createdAt)}
        {s.migratedFrom ? ` · ${t("archive.migrated")}` : ""}
      </Muted>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {used.length ? (
          used.map((i) => (
            <Pressable key={i.id} onPress={() => open(i.id)} accessibilityRole="link">
              <Pill c={c} label={i.title} tone="accent" icon="briefcase-outline" />
            </Pressable>
          ))
        ) : (
          <Muted c={c}>{t("archive.unlinked")}</Muted>
        )}
      </View>
    </Box>
  );
}

export default function ArchiveScreen() {
  const c = usePalette();
  const t = useT();
  const { ready, state, workspaceId } = useWork();
  const [tab, setTab] = useState<Tab>("sources");
  const [q, setQ] = useState("");
  if (!ready) return <ActivityIndicator style={{ flex: 1, backgroundColor: c.bg }} color={c.muted} />;
  const sources = state.sources.filter((s) => s.workspaceId === workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const items = state.items.filter((i) => i.workspaceId === workspaceId);
  const runs = items.flatMap((i) => i.runs.filter((r) => r.status !== "prepared").map((r) => ({ r, i }))).sort((a, b) => (b.r.finishedAt ?? "").localeCompare(a.r.finishedAt ?? ""));
  const outputs = items.flatMap((i) => i.outputs.map((o) => ({ o, i }))).sort((a, b) => b.o.createdAt.localeCompare(a.o.createdAt));
  const hits = tab === "search" ? searchWork(state, q, workspaceId) : [];

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={PAGE}>
      <WorkspaceChips c={c} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {TABS.map((k) => (
          <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: tab === k ? c.accent : c.soft }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: tab === k ? c.accentText : c.text }}>{t(`archive.tab.${k}`)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {tab === "sources" ? (sources.filter((s) => !NOTE_PROVIDERS.has(s.provider)).length ? sources.filter((s) => !NOTE_PROVIDERS.has(s.provider)).map((s) => <SourceRow key={s.id} c={c} s={s} />) : <Muted c={c}>{t("archive.empty.sources")}</Muted>) : null}
      {tab === "notes" ? (sources.filter((s) => NOTE_PROVIDERS.has(s.provider)).length ? sources.filter((s) => NOTE_PROVIDERS.has(s.provider)).map((s) => <SourceRow key={s.id} c={c} s={s} />) : <Muted c={c}>{t("archive.empty.notes")}</Muted>) : null}
      {tab === "runs"
        ? runs.length
          ? runs.map(({ r, i }) => (
              <Box key={r.id} c={c} onPress={() => open(i.id)}>
                <Text style={{ fontSize: 14, color: c.text, fontWeight: "600" }}>
                  {i.title} · {t(`tool.${r.tool}`)}
                </Text>
                <Muted c={c}>
                  {t(`run.status.${r.status}`)} · {when(r.finishedAt)}
                </Muted>
                {r.resultSummary ? (
                  <Text numberOfLines={3} style={{ fontSize: 13, color: c.text }}>
                    {r.resultSummary}
                  </Text>
                ) : null}
              </Box>
            ))
          : <Muted c={c}>{t("archive.empty.runs")}</Muted>
        : null}
      {tab === "outputs"
        ? outputs.length
          ? outputs.map(({ o, i }) => (
              <Box key={o.id} c={c} onPress={o.url ? () => void Linking.openURL(o.url as string) : () => open(i.id)}>
                <Text style={{ fontSize: 14, color: o.url ? c.accent : c.text }}>{o.title}</Text>
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  <Pill c={c} label={t(`output.status.${o.status}`)} tone={o.status === "final" ? "ok" : "muted"} />
                  {o.isLatest ? <Pill c={c} label={t("output.latest")} tone="accent" /> : null}
                  <Pressable onPress={() => open(i.id)} accessibilityRole="link">
                    <Pill c={c} label={i.title} icon="briefcase-outline" />
                  </Pressable>
                </View>
              </Box>
            ))
          : <Muted c={c}>{t("archive.empty.outputs")}</Muted>
        : null}
      {tab === "search" ? (
        <>
          <Field c={c} value={q} onChangeText={setQ} placeholder={t("archive.searchPlaceholder")} accessibilityLabel={t("archive.tab.search")} autoFocus />
          <Muted c={c}>{t("archive.searchNote")}</Muted>
          {q.trim() && !hits.length ? <Muted c={c}>{t("archive.noHits")}</Muted> : null}
          {hits.map((h) => (
            <Box key={`${h.type}-${h.id}`} c={c} onPress={h.itemId ? () => open(h.itemId as string) : undefined}>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Pill c={c} label={t(`archive.hit.${h.type}`)} />
                <Text style={{ flex: 1, fontSize: 14, color: c.text }}>{h.title}</Text>
              </View>
              {h.snippet ? <Muted c={c}>{h.snippet}</Muted> : null}
            </Box>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
