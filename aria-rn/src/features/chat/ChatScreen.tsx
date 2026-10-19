/**
 * 대화 — 말하면 서버(chat 함수)가 할일 · 일정 · 기록으로 정리하고, 결과 카드를 messages 에 쓴다.
 * 화면은 구독으로 그 메시지를 받아 그린다. 보내는 동안엔 내 말을 임시 말풍선으로 먼저 보여 준다.
 */
import React, { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { usePalette } from "../../components/theme";
import { sendChat } from "../../firebase/api";
import { useData } from "../../firebase/data";
import { useT } from "../../i18n";
import { CardView } from "./Cards";

const EXAMPLES = ["chat.examples.meeting", "chat.examples.quote", "chat.examples.today", "chat.examples.overdue", "chat.examples.dump", "chat.examples.memos"];
const MEMOS = ["chat.memos.m1", "chat.memos.m2", "chat.memos.m3"];

export default function ChatScreen() {
  const c = usePalette();
  const t = useT();
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
    const msg = (v ?? textRef.current).trim();
    if (!msg) return;
    setText("");
    setPending((p) => [...p, msg]);
    await run(() => sendChat({ text: msg }));
    setPending((p) => p.filter((x) => x !== msg));
  };

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: c.bg }}>
        <ActivityIndicator color={c.muted} />
        <Text style={{ color: c.muted, fontSize: 13 }}>{t(mode === "emulator" ? "chat.connectingEmulator" : "chat.connecting")}</Text>
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
            <Text style={{ fontSize: 22, fontWeight: "800", color: c.text }}>{t("chat.emptyTitle")}</Text>
            <Text style={{ fontSize: 14, color: c.muted, lineHeight: 20 }}>{t("chat.emptyBody")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {EXAMPLES.map((e) => (
                <Pressable
                  key={e}
                  onPress={async () => {
                    if (e === "chat.examples.dump") return submit(t("chat.dump"));
                    if (e === "chat.examples.memos") {
                      for (const m of MEMOS) await submit(t(m));
                      return;
                    }
                    return submit(t(e));
                  }}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: c.soft }}
                >
                  <Text style={{ fontSize: 13, color: c.text }}>{t(e)}</Text>
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
              <Text style={{ color: c.muted, fontSize: 13 }}>{t("chat.organizing")}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={{ borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface, padding: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: 720, width: "100%", alignSelf: "center" }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("chat.placeholder")}
            placeholderTextColor={c.muted}
            multiline
            accessibilityLabel={t("chat.inputLabel")}
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
            accessibilityLabel={t("chat.send")}
            style={{ height: 42, paddingHorizontal: 16, borderRadius: 12, justifyContent: "center", backgroundColor: c.accent, opacity: !text.trim() ? 0.4 : 1 }}
          >
            <Text style={{ color: c.accentText, fontWeight: "700" }}>{t("chat.send")}</Text>
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
