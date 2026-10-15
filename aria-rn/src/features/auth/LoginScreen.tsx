/**
 * 로그인 화면 — 로그인 전에만 뜬다(app/_layout.tsx). 저장된 로그인이 있으면 이 화면 없이 바로 들어간다.
 * - Google 로 로그인(웹): 팝업으로 로그인한다. 처음이면 새 계정, 전에 쓰던 Google 이면 그 데이터.
 * - 로그인 없이 써 보기: 익명 계정. 나중에 설정 탭에서 Google 을 이으면 데이터가 그대로 남는다.
 */
import React, { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { usePalette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { errorText } from "../../firebase/api";
import { useData } from "../../firebase/data";
import { GOOGLE_SUPPORTED, signInWithGoogle } from "../../firebase/google";

export default function LoginScreen() {
  const c = usePalette();
  const { startAnonymous, mode } = useData();
  const [busy, setBusy] = useState<"google" | "anon" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const google = async () => {
    setBusy("google");
    setError(null);
    try {
      await signInWithGoogle(null);
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(null);
  };

  const anon = async () => {
    setBusy("anon");
    setError(null);
    await startAnonymous();
    setBusy(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <View style={{ width: "100%", maxWidth: 380, gap: 16 }}>
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 28, fontWeight: "800", color: c.text }}>llmwiki</Text>
          <Text style={{ fontSize: 15, color: c.muted, lineHeight: 22 }}>
            말하면 할일 · 일정 · 기록으로 정리하고, 기록이 쌓이면 생각이 어떻게 이어지는지 시냅스로 보여 드려요.
          </Text>
        </View>

        <View style={{ gap: 10, marginTop: 8 }}>
          {GOOGLE_SUPPORTED ? (
            <Btn c={c} primary label="Google 로 로그인" busy={busy === "google"} disabled={busy !== null} onPress={() => void google()} />
          ) : (
            <Text style={{ fontSize: 13, color: c.muted }}>Google 로그인은 지금 웹에서만 돼요.</Text>
          )}
          <Btn c={c} label="로그인 없이 써 보기" busy={busy === "anon"} disabled={busy !== null} onPress={() => void anon()} />
        </View>

        <Text style={{ fontSize: 12, color: c.muted, lineHeight: 18 }}>
          로그인 없이 시작해도 나중에 설정 탭에서 Google 을 이으면 지금 데이터가 그대로 남아요.
          {mode === "emulator" ? " (로컬 에뮬레이터)" : ""}
        </Text>
        {error ? (
          <Text style={{ fontSize: 13, color: c.danger }} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** 저장된 로그인 상태를 읽는 동안 */
export function AuthLoading() {
  const c = usePalette();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={c.muted} />
    </View>
  );
}
