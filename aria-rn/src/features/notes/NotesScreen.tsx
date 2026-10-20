/**
 * 기록 — 대화에서 남긴 스크랩. 라벨별로 걸러 본다.
 * 옵시디언처럼 글 속 [[제목]] 은 링크로 보이고(누르면 그래프에서 그 노트), 아래에 백링크가 붙는다.
 */
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { SCRAP_LABELS } from "../../../../packages/core/src/types.ts";
import { backlinks, buildVault, linkTargets } from "../../../../packages/core/src/vault.ts";
import { usePalette, type Palette } from "../../components/theme";
import { useData } from "../../firebase/data";
import { useI18n, type T } from "../../i18n";

/** 라벨은 저장된 값 그대로 두고 보일 때만 번역한다 — 모르는 라벨은 그대로 */
export function scrapLabel(t: T, label: string): string {
  const key = `notes.labels.${label}`;
  const s = t(key);
  return s === key ? label : s;
}

const openInGraph = (id: string) => router.push({ pathname: "/synapse", params: { doc: id } });

/** 본문을 글 조각과 [[링크]] 조각으로 나눠 그린다 — 링크는 이어질 노트가 있으면 강조, 없으면 흐리게 */
function LinkedText({ c, text, targets }: { c: Palette; text: string; targets: Map<string, { id: string; missing: boolean }> }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[\[([^\[\]]+?)\]\]/g)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    const [target, alias] = m[1].split("|");
    const key = target.split("#")[0].trim().toLowerCase();
    const hit = targets.get(key);
    parts.push(
      <Text
        key={m.index}
        onPress={hit ? () => openInGraph(hit.id) : undefined}
        accessibilityRole={hit ? "link" : undefined}
        style={{ color: hit && !hit.missing ? c.accent : c.muted, textDecorationLine: "underline" }}
      >
        {(alias ?? target).trim()}
      </Text>,
    );
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Text style={{ fontSize: 15, color: c.text, lineHeight: 21 }}>{parts}</Text>;
}

export default function NotesScreen() {
  const c = usePalette();
  const { lang, t } = useI18n();
  const { state } = useData();
  const [label, setLabel] = useState<string | null>(null);
  const scraps = state.scraps.filter((s) => !s.deletedAt && (!label || s.label === label)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const vault = useMemo(() => buildVault(state), [state]);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 10, maxWidth: 720, width: "100%", alignSelf: "center" }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {[null, ...SCRAP_LABELS].map((l) => (
          <Pressable key={l ?? "all"} onPress={() => setLabel(l)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: label === l ? c.accent : c.soft }}>
            <Text style={{ fontSize: 13, color: label === l ? c.accentText : c.text }}>{l ? scrapLabel(t, l) : t("notes.all")}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {scraps.length === 0 ? (
        <Text style={{ color: c.muted, textAlign: "center", marginTop: 24 }}>{t("notes.empty")}</Text>
      ) : null}
      {scraps.map((s) => {
        const id = `scrap:${s.id}`;
        const targets = new Map([...linkTargets(vault, id)].map(([text, target]) => [text, { id: target, missing: target.startsWith("missing:") }]));
        const back = backlinks(vault, id);
        return (
          <View key={s.id} style={{ backgroundColor: c.surface, borderRadius: 12, padding: 14, gap: 6, borderWidth: 1, borderColor: c.border }}>
            <LinkedText c={c} text={s.text} targets={targets} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={{ fontSize: 12, color: c.muted }}>
                {scrapLabel(t, s.label)} · {new Date(s.createdAt).toLocaleDateString(lang === "ko" ? "ko-KR" : "en-US", { month: "long", day: "numeric", weekday: "short" })}
              </Text>
              {back.length ? (
                <Text style={{ fontSize: 12, color: c.muted }} numberOfLines={1}>
                  {t("notes.backlinks", { count: back.length, names: back.map((b) => b.name).join(", ") })}
                </Text>
              ) : null}
              <Pressable onPress={() => openInGraph(id)} accessibilityRole="button" accessibilityLabel={t("notes.openInGraph")} style={{ marginLeft: "auto" }}>
                <Text style={{ fontSize: 12, color: c.accent }}>{t("notes.openInGraph")}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
