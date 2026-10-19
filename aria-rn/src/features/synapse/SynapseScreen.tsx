/**
 * 시냅스 — 두 가지로 본다.
 * - 그래프: 옵시디언 그래프 뷰처럼 기록 · 할일을 점으로, [[링크]] · 개념을 선으로(전체 · 로컬). VaultScreen
 * - 개념: 기록 · 할일에서 뽑은 개념(노드)과 함께 나온 관계(엣지). 연결이 많은 개념 순 칩 + 고른 개념의 이웃.
 * 개념 그래프는 서버가 글이 바뀔 때마다 다시 계산한다(functions/src/common.ts mutate).
 */
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { formatWhen } from "../../../../packages/core/src/dates.ts";
import { degree, neighbors } from "../../../../packages/core/src/synapse.ts";
import type { NodeKind } from "../../../../packages/core/src/types.ts";
import { usePalette } from "../../components/theme";
import { Line, PAGE } from "../../components/ui";
import { useData } from "../../firebase/data";
import { useI18n, useT } from "../../i18n";
import { scrapLabel } from "../notes/NotesScreen";
import { SynapseGraph } from "./SynapseGraph";
import { VaultScreen } from "./VaultScreen";

const KIND_LABEL: Record<NodeKind, string> = { topic: "synapse.kinds.topic", person: "synapse.kinds.person", emotion: "synapse.kinds.emotion", project: "synapse.kinds.project", tag: "synapse.kinds.tag" };

export default function SynapseScreen() {
  const c = usePalette();
  const t = useT();
  const params = useLocalSearchParams<{ node?: string; doc?: string }>();
  const [mode, setMode] = useState<"graph" | "concepts">(params.node ? "concepts" : "graph");
  useEffect(() => {
    if (params.node) setMode("concepts");
    if (params.doc) setMode("graph");
  }, [params.node, params.doc]);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: "row", gap: 6, padding: 12, paddingBottom: 0, alignSelf: "center", width: "100%", maxWidth: 1200 }}>
        {(["graph", "concepts"] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
            style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: mode === m ? c.accent : c.soft }}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: mode === m ? c.accentText : c.text }}>{t(`synapse.modes.${m}`)}</Text>
          </Pressable>
        ))}
      </View>
      {mode === "graph" ? <VaultScreen focus={params.doc ?? null} /> : <ConceptScreen />}
    </View>
  );
}

function ConceptScreen() {
  const c = usePalette();
  const { lang, t } = useI18n();
  const { state } = useData();
  const params = useLocalSearchParams<{ node?: string }>();
  const graph = useMemo(() => ({ nodes: state.nodes, edges: state.edges }), [state.nodes, state.edges]);
  const ranked = useMemo(() => [...graph.nodes].map((n) => ({ n, d: degree(graph, n.id) })).sort((a, b) => b.d - a.d), [graph]);
  const [selected, setSelected] = useState<string | null>(null);
  const [kind, setKind] = useState<NodeKind | null>(null);

  useEffect(() => {
    if (params.node) setSelected(params.node);
  }, [params.node]);

  const current = graph.nodes.find((n) => n.id === selected) ?? ranked[0]?.n ?? null;
  const filtered = ranked.filter((x) => !kind || x.n.kind === kind);
  const maxD = Math.max(1, ...ranked.map((x) => x.d));

  if (graph.nodes.length === 0) {
    return (
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ ...PAGE, paddingTop: 40 }}>
        <Text style={{ fontSize: 20, fontWeight: "800", color: c.text }}>{t("synapse.emptyTitle")}</Text>
        <Text style={{ fontSize: 14, color: c.muted, lineHeight: 21 }}>{t("synapse.emptyBody")}</Text>
      </ScrollView>
    );
  }

  const refs = current?.refs ?? [];
  const scraps = refs.filter((r) => r.type === "scrap").map((r) => state.scraps.find((s) => s.id === r.id)).filter((s): s is NonNullable<typeof s> => !!s && !s.deletedAt);
  const tasks = refs.filter((r) => r.type === "task").map((r) => state.tasks.find((t) => t.id === r.id)).filter((t): t is NonNullable<typeof t> => !!t && !t.deletedAt);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={PAGE}>
      <Text style={{ fontSize: 13, color: c.muted }}>{t("synapse.stats", { nodes: graph.nodes.length, edges: graph.edges.length })}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {[null, "topic", "emotion", "person", "project", "tag"].map((k) => (
          <Pressable key={k ?? "all"} onPress={() => setKind(k as NodeKind | null)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: kind === k ? c.accent : c.soft }}>
            <Text style={{ fontSize: 12, color: kind === k ? c.accentText : c.text }}>{t(k ? KIND_LABEL[k as NodeKind] : "synapse.all")}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {filtered.slice(0, 40).map(({ n, d }) => {
          const on = current?.id === n.id;
          const size = 12 + Math.round((d / maxD) * 6);
          return (
            <Pressable
              key={n.id}
              onPress={() => setSelected(n.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t("synapse.chipLabel", { name: n.name, kind: t(KIND_LABEL[n.kind]) })}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: on ? c.accent : c.surface, borderWidth: 1, borderColor: on ? c.accent : c.border }}
            >
              <Text style={{ fontSize: size, color: on ? c.accentText : c.text, fontWeight: on ? "700" : "500" }}>{n.name}</Text>
            </Pressable>
          );
        })}
      </View>

      {current ? (
        <>
          <SynapseGraph c={c} center={current} neighbors={neighbors(graph, current.id)} onSelect={setSelected} />
          <Text style={{ fontSize: 15, fontWeight: "700", color: c.text, marginTop: 4 }}>{t("synapse.appearsIn", { name: current.name, count: scraps.length + tasks.length })}</Text>
          <View style={{ gap: 6 }}>
            {scraps.map((s) => (
              <Line key={s.id} c={c} title={s.text} sub={t("synapse.scrapSub", { label: scrapLabel(t, s.label), date: new Date(s.createdAt).toLocaleDateString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric" }) })} />
            ))}
            {tasks.map((tk) => (
              <Line key={tk.id} c={c} title={`☐ ${tk.title}`} sub={[t("synapse.task"), formatWhen(tk.due)].filter(Boolean).join(" · ")} struck={tk.done} />
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
