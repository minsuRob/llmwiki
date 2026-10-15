/**
 * 대화 — 말하면 할일 · 일정 · 기록으로 정리하고, 결과를 카드로 붙인다.
 * API 키가 있으면 Claude 가, 없으면 기기 안 규칙이 같은 도구를 부른다.
 */
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { CardView } from "../components/Cards.tsx";
import { usePalette } from "../components/theme.ts";
import { useApp } from "../lib/store.tsx";

const EXAMPLES = ["내일 오후 3시 팀 회의", "금요일까지 견적서 보내기, 우유 사기", "오늘 할 일 보여줘", "밀린 할일 정리해줘"];
const DUMP = "이번 주 할 거\n- 발표 자료 만들기 목요일\n- 치과 예약\n- 엄마 생신 선물 20일까지\n- 헬스장 등록";

export default function ChatScreen() {
  const c = usePalette();
  const { state, send, thinking, apiKey, ready } = useApp();
  const [text, setTextState] = useState("");
  // 웹에서 빠르게 치고 Enter 를 누르면 키 이벤트가 상태 반영보다 먼저 온다 — 최신 글은 ref 로 읽는다
  const textRef = useRef("");
  const setText = (v: string) => {
    textRef.current = v;
    setTextState(v);
  };
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    const id = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [state.messages.length, thinking]);

  const submit = (v?: string) => {
    const t = (v ?? textRef.current).trim();
    if (!t) return;
    setText("");
    void send(t);
  };

  if (!ready) return <ActivityIndicator style={{ marginTop: 40 }} color={c.muted} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 14, maxWidth: 720, width: "100%", alignSelf: "center" }}>
        {state.messages.length === 0 ? (
          <View style={{ gap: 12, paddingTop: 24 }}>
            <Text style={{ fontSize: 22, fontWeight: "800", color: c.text }}>무엇을 정리할까요?</Text>
            <Text style={{ fontSize: 14, color: c.muted, lineHeight: 20 }}>
              말하듯 쓰면 할일 · 일정 · 기록으로 나눠 담고, 결과를 카드로 보여 드려요. 카드에서 바로 되돌리거나 처리할 수 있어요.
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {[...EXAMPLES, "여러 줄 메모 넣어 보기"].map((e) => (
                <Pressable key={e} onPress={() => submit(e === "여러 줄 메모 넣어 보기" ? DUMP : e)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: c.soft }}>
                  <Text style={{ fontSize: 13, color: c.text }}>{e}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ fontSize: 12, color: c.muted }}>{apiKey ? "Claude 로 답해요." : "API 키가 없어 기기 안 규칙으로 답해요. 설정에서 키를 넣으면 Claude 가 답해요."}</Text>
          </View>
        ) : null}

        {state.messages.map((m) =>
          m.role === "user" ? (
            <View key={m.id} style={{ alignSelf: "flex-end", maxWidth: "85%", backgroundColor: c.userBubble, borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10 }}>
              <Text style={{ color: c.userText, fontSize: 15, lineHeight: 21 }}>{m.text}</Text>
            </View>
          ) : (
            <View key={m.id} style={{ alignSelf: "stretch", gap: 2 }}>
              <Text style={{ color: c.text, fontSize: 15, lineHeight: 22 }}>{m.text}</Text>
              {m.cards.map((card) => (
                <CardView key={card.id} card={card} />
              ))}
            </View>
          ),
        )}
        {thinking ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ActivityIndicator size="small" color={c.muted} />
            <Text style={{ color: c.muted, fontSize: 13 }}>정리하는 중…</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={{ borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface, padding: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: 720, width: "100%", alignSelf: "center" }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="예: 내일 3시 치과 예약, 보고서 다 했어"
            placeholderTextColor={c.muted}
            multiline
            accessibilityLabel="메시지"
            onKeyPress={(e) => {
              // 웹: Enter 로 보내고 Shift+Enter 로 줄바꿈
              const ne = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
              if (Platform.OS === "web" && ne.key === "Enter" && !ne.shiftKey) {
                (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                submit();
              }
            }}
            style={{ ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}), flex: 1, minHeight: 42, maxHeight: 140, borderRadius: 12, backgroundColor: c.row, color: c.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 }}
          />
          <Pressable
            onPress={() => submit()}
            disabled={!text.trim() || thinking}
            accessibilityRole="button"
            accessibilityLabel="보내기"
            style={{ height: 42, paddingHorizontal: 16, borderRadius: 12, justifyContent: "center", backgroundColor: c.accent, opacity: !text.trim() || thinking ? 0.4 : 1 }}
          >
            <Text style={{ color: c.accentText, fontWeight: "700" }}>보내기</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
