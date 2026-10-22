/**
 * 보관함 — 원본 자료 · 메모 · 검색(페이지 제목 · 자료). 지금 고른 주제 것만 보인다.
 * 자료는 한 벌만 있고, 이어 둔 페이지를 거꾸로 찾아 보여 준다(색인의 자료 사본으로 — 본문을 읽지 않는다).
 */
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";

import { pagesForSource, searchPageTitles } from "../../../../packages/core/src/pages.ts";
import type { Source } from "../../../../packages/core/src/work.ts";
import { usePalette, type Palette } from "../../components/theme";
import { PAGE } from "../../components/ui";
import { useT } from "../../i18n";
import { Field, Muted, Pill, when } from "./parts";
import { useWork } from "./WorkContext";

type Tab = "sources" | "notes" | "search";
const TABS: Tab[] = ["sources", "notes", "search"];
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
  const used = pagesForSource(state.pages, s.id);
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
              <Pill c={c} label={i.title} tone="accent" icon="document-text-outline" />
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
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits =
    tab === "search" && words.length
      ? [
          ...searchPageTitles(state.pages, q, workspaceId).map((p) => ({ type: "page" as const, id: p.id, pageId: p.id as string | undefined, title: p.title, snippet: "" })),
          ...sources.filter((s) => words.every((w) => `${s.title}\n${s.text ?? ""}`.toLowerCase().includes(w))).map((s) => ({ type: "source" as const, id: s.id, pageId: pagesForSource(state.pages, s.id)[0]?.id, title: s.title, snippet: (s.text ?? s.url ?? "").slice(0, 120) })),
        ]
      : [];

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={PAGE}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {TABS.map((k) => (
          <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: tab === k ? c.accent : c.soft }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: tab === k ? c.accentText : c.text }}>{t(`archive.tab.${k}`)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {tab === "sources" ? (sources.filter((s) => !NOTE_PROVIDERS.has(s.provider)).length ? sources.filter((s) => !NOTE_PROVIDERS.has(s.provider)).map((s) => <SourceRow key={s.id} c={c} s={s} />) : <Muted c={c}>{t("archive.empty.sources")}</Muted>) : null}
      {tab === "notes" ? (sources.filter((s) => NOTE_PROVIDERS.has(s.provider)).length ? sources.filter((s) => NOTE_PROVIDERS.has(s.provider)).map((s) => <SourceRow key={s.id} c={c} s={s} />) : <Muted c={c}>{t("archive.empty.notes")}</Muted>) : null}
      {tab === "search" ? (
        <>
          <Field c={c} value={q} onChangeText={setQ} placeholder={t("archive.searchPlaceholder")} accessibilityLabel={t("archive.tab.search")} autoFocus />
          <Muted c={c}>{t("archive.searchNote")}</Muted>
          {q.trim() && !hits.length ? <Muted c={c}>{t("archive.noHits")}</Muted> : null}
          {hits.map((h) => (
            <Box key={`${h.type}-${h.id}`} c={c} onPress={h.pageId ? () => open(h.pageId as string) : undefined}>
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
