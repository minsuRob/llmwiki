/**
 * 공통 입력 — 어느 화면에서나 + 단추로 메모 · 링크를 바로 보관함에 넣는다. 업무 상세에 있으면 그 업무에 잇는 것이 기본.
 * AI 를 부르지 않는다 — 저장만 하고, 정리는 나중에.
 */
import { Ionicons } from "@expo/vector-icons";
import { usePathname } from "expo-router";
import React, { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { usePalette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { Field, Muted, WorkspaceChips } from "./parts";
import { useWork } from "./WorkContext";

export function QuickAdd() {
  const c = usePalette();
  const t = useT();
  const path = usePathname();
  const { ready, state, workspaceId, addSource } = useWork();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ready) return null;
  const here = /^\/work\/([^/]+)$/.exec(path)?.[1] ?? null;
  const items = state.items.filter((i) => i.workspaceId === workspaceId && i.status !== "archived" && i.status !== "done");

  const show = () => {
    const item = here ? state.items.find((i) => i.id === here) : null;
    setTarget(item && item.workspaceId === workspaceId ? item.id : null);
    setNote(null);
    setOpen(true);
  };
  const save = async () => {
    const v = text.trim();
    if (!v) return;
    setBusy(true);
    const isUrl = /^https?:\/\/\S+$/.test(v);
    const r = await addSource(isUrl ? { workspaceId, provider: "link", title: v, url: v } : { workspaceId, provider: "note", title: v.split("\n")[0].slice(0, 80), text: v }, target);
    setBusy(false);
    if (!r.source) return setNote({ text: t("source.saveFailed"), bad: true });
    setText("");
    setNote({ text: target ? t("quick.savedLinked") : t("quick.saved") });
  };

  // 대화 화면은 아래에 입력줄 · 보내기 단추가 있어 그 위로 올린다
  return (
    <>
      <Pressable
        onPress={show}
        accessibilityRole="button"
        accessibilityLabel={t("quick.open")}
        style={{ position: "absolute", right: 18, bottom: path === "/chat" ? 150 : 78, width: 52, height: 52, borderRadius: 26, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}
      >
        <Ionicons name="add" size={28} color={c.accentText} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} accessibilityLabel={t("common.close")} />
          <View style={{ backgroundColor: c.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 10, maxWidth: 720, width: "100%", alignSelf: "center" }}>
            <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "700", color: c.text }}>
              {t("quick.title")}
            </Text>
            <WorkspaceChips c={c} />
            <Field c={c} value={text} onChangeText={setText} placeholder={t("quick.placeholder")} accessibilityLabel={t("quick.title")} multiline autoFocus />
            <Muted c={c}>{t("quick.linkTo")}</Muted>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {[{ id: null as string | null, title: t("quick.noLink") }, ...items.map((i) => ({ id: i.id as string | null, title: i.title }))].map((o) => (
                <Pressable key={o.id ?? "none"} onPress={() => setTarget(o.id)} accessibilityRole="radio" accessibilityState={{ selected: target === o.id }} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: target === o.id ? c.accent : c.soft }}>
                  <Text style={{ fontSize: 12, color: target === o.id ? c.accentText : c.text }}>{o.title}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Btn c={c} primary label={t("common.save")} busy={busy} disabled={!text.trim()} onPress={() => void save()} />
              <Btn c={c} label={t("common.close")} onPress={() => setOpen(false)} />
            </View>
            {note ? <Text style={{ fontSize: 13, color: note.bad ? c.danger : c.ok }}>{note.text}</Text> : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
