/** 기록 — 대화에서 남긴 스크랩. 라벨별로 걸러 본다 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { SCRAP_LABELS } from "../../../../packages/core/src/types.ts";
import { usePalette } from "../../components/theme";
import { useData } from "../../firebase/data";

export default function NotesScreen() {
  const c = usePalette();
  const { state } = useData();
  const [label, setLabel] = useState<string | null>(null);
  const scraps = state.scraps.filter((s) => !s.deletedAt && (!label || s.label === label)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 10, maxWidth: 720, width: "100%", alignSelf: "center" }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {[null, ...SCRAP_LABELS].map((l) => (
          <Pressable key={l ?? "all"} onPress={() => setLabel(l)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: label === l ? c.accent : c.soft }}>
            <Text style={{ fontSize: 13, color: label === l ? c.accentText : c.text }}>{l ?? "전체"}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {scraps.length === 0 ? (
        <Text style={{ color: c.muted, textAlign: "center", marginTop: 24 }}>대화에서 "메모: …" 라고 말하면 여기에 남아요</Text>
      ) : null}
      {scraps.map((s) => (
        <View key={s.id} style={{ backgroundColor: c.surface, borderRadius: 12, padding: 14, gap: 6, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ fontSize: 15, color: c.text, lineHeight: 21 }}>{s.text}</Text>
          <Text style={{ fontSize: 12, color: c.muted }}>
            {s.label} · {new Date(s.createdAt).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}
