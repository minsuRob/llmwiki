/** 설정 — 연결 상태(에뮬레이터 · 클라우드) · 내 계정 · 휴지통 비우기 · 시냅스 다시 계산 */
import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { usePalette } from "../../components/theme";
import { Btn, PAGE } from "../../components/ui";
import { rebuildSynapse, taskAction } from "../../firebase/api";
import { useData } from "../../firebase/data";

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
        <Text style={{ fontSize: 13, color: c.muted }} selectable>
          익명 로그인 · {user?.uid ?? "-"}
        </Text>
        <View style={{ flexDirection: "row" }}>
          <Btn c={c} label="새 익명 계정으로 시작" busy={busy === "reset"} onPress={() => void act("reset", async () => (await resetUser(), "새 계정으로 바꿨어요."))} />
        </View>
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
        {note ? <Text style={{ fontSize: 13, color: c.ok }}>{note}</Text> : null}
      </View>
    </ScrollView>
  );
}
