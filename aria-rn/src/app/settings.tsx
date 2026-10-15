/** 설정 — Claude API 키(기기 안에만 저장) · 대화 지우기 */
import React, { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { Btn } from "../components/Cards.tsx";
import { usePalette } from "../components/theme.ts";
import { MODEL } from "../lib/claude.ts";
import { useApp } from "../lib/store.tsx";

export default function SettingsScreen() {
  const c = usePalette();
  const { apiKey, setApiKey, clearChat, state } = useApp();
  const [draft, setDraft] = useState("");

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 720, width: "100%", alignSelf: "center" }}>
      <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: c.border }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: c.text }}>Claude 연결</Text>
        <Text style={{ fontSize: 13, color: c.muted, lineHeight: 19 }}>
          {apiKey
            ? `연결됨 — ${MODEL} 가 답해요. 키는 이 기기에만 저장돼요.`
            : "키가 없으면 기기 안 규칙으로 답해요(자주 쓰는 말만 알아들어요). Anthropic API 키를 넣으면 Claude 가 답해요. 키는 이 기기에만 저장되고, 앱이 직접 API 를 부르므로 개인 기기에서만 쓰세요."}
        </Text>
        {apiKey ? (
          <View style={{ flexDirection: "row" }}>
            <Btn c={c} label="키 지우기" onPress={() => setApiKey("")} />
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="sk-ant-..."
              placeholderTextColor={c.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Anthropic API 키"
              style={{ flex: 1, borderRadius: 10, backgroundColor: c.row, color: c.text, paddingHorizontal: 12, paddingVertical: 10 }}
            />
            <Btn c={c} primary label="저장" onPress={() => { setApiKey(draft); setDraft(""); }} />
          </View>
        )}
      </View>

      <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: c.border }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: c.text }}>데이터</Text>
        <Text style={{ fontSize: 13, color: c.muted }}>
          할일 {state.tasks.filter((t) => !t.deletedAt).length} · 일정 {state.events.filter((e) => !e.deletedAt).length} · 기록 {state.scraps.filter((s) => !s.deletedAt).length} · 대화 {state.messages.length}
        </Text>
        <View style={{ flexDirection: "row" }}>
          <Btn c={c} label="대화 지우기" onPress={clearChat} />
        </View>
      </View>
    </ScrollView>
  );
}
