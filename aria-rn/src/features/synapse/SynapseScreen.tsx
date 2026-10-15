/**
 * 시냅스 — 기록 · 할일에서 뽑은 개념(노드)과 함께 나온 관계(엣지).
 * 위: 연결이 많은 개념 순 칩. 가운데: 고른 개념의 이웃 그래프. 아래: 그 개념이 나온 기록 · 할일.
 * 그래프는 서버가 글이 바뀔 때마다 다시 계산한다(functions/src/common.ts mutate).
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
import { SynapseGraph } from "./SynapseGraph";

const KIND_LABEL: Record<NodeKind, string> = { topic: "주제", person: "사람", emotion: "감정", project: "일", tag: "태그" };

export default function SynapseScreen() {
  const c = usePalette();
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
        <Text style={{ fontSize: 20, fontWeight: "800", color: c.text }}>아직 시냅스가 비어 있어요</Text>
        <Text style={{ fontSize: 14, color: c.muted, lineHeight: 21 }}>
          대화에서 "메모: …" 로 생각을 남기거나 할일을 추가하면, 두 번 이상 나온 주제와 감정 · #태그가 개념으로 이어져 여기에 쌓여요. 그다음 "전에 ○○ 얘기 뭐라고 했지?" 라고 물으면 근거를 모아 보여 드려요.
        </Text>
      </ScrollView>
    );
  }

  const refs = current?.refs ?? [];
  const scraps = refs.filter((r) => r.type === "scrap").map((r) => state.scraps.find((s) => s.id === r.id)).filter((s): s is NonNullable<typeof s> => !!s && !s.deletedAt);
  const tasks = refs.filter((r) => r.type === "task").map((r) => state.tasks.find((t) => t.id === r.id)).filter((t): t is NonNullable<typeof t> => !!t && !t.deletedAt);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={PAGE}>
      <Text style={{ fontSize: 13, color: c.muted }}>
        개념 {graph.nodes.length} · 연결 {graph.edges.length}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {[null, "topic", "emotion", "person", "project", "tag"].map((k) => (
          <Pressable key={k ?? "all"} onPress={() => setKind(k as NodeKind | null)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: kind === k ? c.accent : c.soft }}>
            <Text style={{ fontSize: 12, color: kind === k ? c.accentText : c.text }}>{k ? KIND_LABEL[k as NodeKind] : "전체"}</Text>
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
              accessibilityLabel={`${n.name}, ${KIND_LABEL[n.kind]}`}
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
          <Text style={{ fontSize: 15, fontWeight: "700", color: c.text, marginTop: 4 }}>
            "{current.name}" 이 나온 곳 {scraps.length + tasks.length}
          </Text>
          <View style={{ gap: 6 }}>
            {scraps.map((s) => (
              <Line key={s.id} c={c} title={s.text} sub={`기록 · ${s.label} · ${new Date(s.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}`} />
            ))}
            {tasks.map((t) => (
              <Line key={t.id} c={c} title={`☐ ${t.title}`} sub={["할일", formatWhen(t.due)].filter(Boolean).join(" · ")} struck={t.done} />
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
