/** 설정 — 연결 상태(에뮬레이터 · 클라우드) · 내 계정(익명 → Google 연결) · 휴지통 비우기 · 시냅스 다시 계산 */
import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { usePalette } from "../../components/theme";
import { Btn, PAGE } from "../../components/ui";
import { rebuildSynapse, taskAction } from "../../firebase/api";
import { useData } from "../../firebase/data";
import { GOOGLE_SUPPORTED, describeUser, signInWithGoogle } from "../../firebase/google";

export default function SettingsScreen() {
  const c = usePalette();
  const { user, state, mode, run, resetUser } = useData();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<string | null>) => {
    setBusy(key);
    const msg = await fn();
    if (msg) setNote(msg);
    setBusy(null);
  };

  const section = { backgroundColor: c.surface, borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: c.border } as const;
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ ...PAGE, gap: 16 }}>
      <View style={section}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: c.text }}>연결</Text>
        <Text style={{ fontSize: 13, color: c.muted, lineHeight: 19 }}>
          {mode === "emulator"
            ? "로컬 Firebase 에뮬레이터(Auth · Firestore · Functions)에 붙어 있어요. 데이터는 이 컴퓨터에만 있어요."
            : "Firebase 프로젝트 llmwiki-minsu 에 붙어 있어요."}
        </Text>
        <Text style={{ fontSize: 13, color: c.muted, lineHeight: 19 }}>
          답은 서버(chat 함수)가 만들어요. 서버에 Claude 키가 있으면 Claude 가, 없으면 한국어 규칙이 답해요 — 키는 앱에 두지 않아요.
        </Text>
      </View>

      <View style={section}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: c.text }}>내 계정</Text>
        <Text style={{ fontSize: 14, color: c.text }}>{describeUser(user)}</Text>
        <Text style={{ fontSize: 12, color: c.muted }} selectable>
          {user?.uid ?? "-"}
        </Text>
        {user?.isAnonymous ? (
          <Text style={{ fontSize: 13, color: c.muted, lineHeight: 19 }}>
            Google 로 로그인하면 지금 기록이 그 계정에 이어져서, 다른 기기 · 브라우저에서도 같은 데이터를 볼 수 있어요.
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {user?.isAnonymous && GOOGLE_SUPPORTED ? (
            <Btn
              c={c}
              primary
              label="Google 로 로그인"
              busy={busy === "google"}
              onPress={() =>
                void act("google", async () => {
                  const r = await run(() => signInWithGoogle(user));
                  if (!r || r.kind === "cancelled") return null;
                  return r.kind === "linked" ? `${r.email ?? "Google"} 에 지금 기록을 이었어요.` : `${r.email ?? "Google"} 계정으로 들어왔어요(이미 있던 계정이라 그 데이터를 보여 줘요).`;
                })
              }
            />
          ) : null}
          {user && !user.isAnonymous ? (
            <Btn c={c} label="로그아웃" busy={busy === "reset"} onPress={() => void act("reset", async () => (await resetUser(), "로그아웃했어요. 익명으로 다시 시작해요."))} />
          ) : (
            <Btn c={c} label="새 익명 계정으로 시작" busy={busy === "reset"} onPress={() => void act("reset", async () => (await resetUser(), "새 계정으로 바꿨어요."))} />
          )}
        </View>
        {user?.isAnonymous && !GOOGLE_SUPPORTED ? <Text style={{ fontSize: 12, color: c.muted }}>Google 로그인은 지금 웹에서만 돼요.</Text> : null}
        {note ? <Text style={{ fontSize: 13, color: c.ok }}>{note}</Text> : null}
      </View>

      <View style={section}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: c.text }}>데이터</Text>
        <Text style={{ fontSize: 13, color: c.muted }}>
          할일 {state.tasks.filter((t) => !t.deletedAt).length} · 일정 {state.events.filter((e) => !e.deletedAt).length} · 기록 {state.scraps.filter((s) => !s.deletedAt).length} · 개념 {state.nodes.length} · 연결 {state.edges.length}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Btn
            c={c}
            label="시냅스 다시 계산"
            busy={busy === "syn"}
            onPress={() =>
              void act("syn", async () => {
                const r = await run(() => rebuildSynapse({}));
                return r ? `개념 ${r.nodes}개 · 연결 ${r.edges}개 (${r.via === "claude" ? "Claude" : "규칙"})` : null;
              })
            }
          />
          <Btn c={c} label="휴지통 비우기(7일 지난 것)" busy={busy === "purge"} onPress={() => void act("purge", async () => ((await run(() => taskAction({ op: "purge" }))) ? "비웠어요." : null))} />
        </View>
      </View>
    </ScrollView>
  );
}
