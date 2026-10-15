/**
 * 대화 — 말하면 서버(chat 함수)가 할일 · 일정 · 기록으로 정리하고, 결과 카드를 messages 에 쓴다.
 * 화면은 구독으로 그 메시지를 받아 그린다. 보내는 동안엔 내 말을 임시 말풍선으로 먼저 보여 준다.
 */
import React, { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { usePalette } from "../../components/theme";
import { sendChat } from "../../firebase/api";
import { useData } from "../../firebase/data";
import { CardView } from "./Cards";

const EXAMPLES = ["내일 오후 3시 팀 회의", "금요일까지 견적서 보내기, 우유 사기", "오늘 할 일 보여줘", "밀린 할일 정리해줘"];
const DUMP = "이번 주 할 거\n- 발표 자료 만들기 목요일\n- 치과 예약\n- 엄마 생신 선물 20일까지\n- 헬스장 등록";
const MEMOS = ["메모: 채용 공고는 다음 주에 올리기로 했다", "메모: 채용 면접이 걱정된다", "전에 채용 얘기 뭐라고 했지?"];

export default function ChatScreen() {
  const c = usePalette();
  const { state, ready, run, mode } = useData();
  const [text, setTextState] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  // 웹에서 빠르게 치고 Enter 를 누르면 키 이벤트가 상태 반영보다 먼저 온다 — 최신 글은 ref 로 읽는다
  const textRef = useRef("");
  const setText = (v: string) => {
    textRef.current = v;
    setTextState(v);
  };
  const scroll = useRef<ScrollView>(null);

  const submit = async (v?: string) => {
    const t = (v ?? textRef.current).trim();
    if (!t) return;
    setText("");
    setPending((p) => [...p, t]);
    await run(() => sendChat({ text: t }));
    setPending((p) => p.filter((x) => x !== t));
  };

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: c.bg }}>
        <ActivityIndicator color={c.muted} />
        <Text style={{ color: c.muted, fontSize: 13 }}>{mode === "emulator" ? "로컬 에뮬레이터에 연결하는 중…" : "연결하는 중…"}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView
        ref={scroll}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        contentContainerStyle={{ padding: 16, gap: 14, maxWidth: 720, width: "100%", alignSelf: "center" }}
      >
        {state.messages.length === 0 && pending.length === 0 ? (
          <View style={{ gap: 12, paddingTop: 24 }}>
            <Text style={{ fontSize: 22, fontWeight: "800", color: c.text }}>무엇을 정리할까요?</Text>
            <Text style={{ fontSize: 14, color: c.muted, lineHeight: 20 }}>
              말하듯 쓰면 할일 · 일정 · 기록으로 나눠 담고, 결과를 카드로 보여 드려요. 기록이 쌓이면 시냅스 탭에서 생각이 어떻게 이어지는지 볼 수 있어요.
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {[...EXAMPLES, "여러 줄 메모 넣어 보기", "기록 3개 남기고 떠올리기"].map((e) => (
                <Pressable
                  key={e}
                  onPress={async () => {
                    if (e === "여러 줄 메모 넣어 보기") return submit(DUMP);
                    if (e === "기록 3개 남기고 떠올리기") {
                      for (const m of MEMOS) await submit(m);
                      return;
                    }
                    return submit(e);
                  }}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: c.soft }}
                >
                  <Text style={{ fontSize: 13, color: c.text }}>{e}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {state.messages.map((m) =>
          m.role === "user" ? (
            <Bubble key={m.id} text={m.text} />
          ) : (
            <View key={m.id} style={{ alignSelf: "stretch", gap: 2 }}>
              <Text style={{ color: c.text, fontSize: 15, lineHeight: 22 }}>{m.text}</Text>
              {m.cards.map((card) => (
                <CardView key={card.id} card={card} />
              ))}
            </View>
          ),
        )}
        {pending.map((p, i) => (
          <View key={`p${i}`} style={{ gap: 8 }}>
            <Bubble text={p} faded />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ActivityIndicator size="small" color={c.muted} />
              <Text style={{ color: c.muted, fontSize: 13 }}>정리하는 중…</Text>
            </View>
          </View>
        ))}
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
              // 웹: Enter 로 보내고 Shift+Enter 로 줄바꿈.
              // 한글 입력 중(조합 중)에 누른 Enter 는 글자 확정에 먼저 쓰인다 — 확정된 뒤(다음 틱)에 최신 글로 보낸다
              const ne = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
              if (Platform.OS === "web" && ne.key === "Enter" && !ne.shiftKey) {
                (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                setTimeout(() => void submit(), 30);
              }
            }}
            style={{
              ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}),
              flex: 1,
              minHeight: 42,
              maxHeight: 140,
              borderRadius: 12,
              backgroundColor: c.row,
              color: c.text,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 15,
            }}
          />
          <Pressable
            onPress={() => void submit()}
            disabled={!text.trim()}
            accessibilityRole="button"
            accessibilityLabel="보내기"
            style={{ height: 42, paddingHorizontal: 16, borderRadius: 12, justifyContent: "center", backgroundColor: c.accent, opacity: !text.trim() ? 0.4 : 1 }}
          >
            <Text style={{ color: c.accentText, fontWeight: "700" }}>보내기</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ text, faded }: { text: string; faded?: boolean }) {
  const c = usePalette();
  return (
    <View style={{ alignSelf: "flex-end", maxWidth: "85%", backgroundColor: c.userBubble, borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10, opacity: faded ? 0.6 : 1 }}>
      <Text style={{ color: c.userText, fontSize: 15, lineHeight: 21 }}>{text}</Text>
    </View>
  );
}
