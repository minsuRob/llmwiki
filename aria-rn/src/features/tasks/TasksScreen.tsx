/** 할일 — 오늘 · 예정 · 마감 없음 · 완료 · 휴지통. 체크 · 삭제 · 되살리기는 taskAction 함수로 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { formatWhen, isOverdue, sameDay } from "../../../../packages/core/src/dates.ts";
import { liveTasks } from "../../../../packages/core/src/engine.ts";
import type { Task } from "../../../../packages/core/src/types.ts";
import { usePalette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { taskAction } from "../../firebase/api";
import { useData } from "../../firebase/data";

type Filter = "today" | "upcoming" | "nodate" | "done" | "trash";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "today", label: "오늘" },
  { key: "upcoming", label: "예정" },
  { key: "nodate", label: "마감 없음" },
  { key: "done", label: "완료" },
  { key: "trash", label: "휴지통" },
];

export default function TasksScreen() {
  const c = usePalette();
  const { state, run } = useData();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    await run(fn);
    setBusy(null);
  };
  const toggleTask = (id: string) => act(id, () => taskAction({ op: "toggle", id }));
  const deleteTask = (id: string) => act(id, () => taskAction({ op: "delete", id }));
  const restoreTask = (id: string) => act(id, () => taskAction({ op: "restore", id }));
  const addTaskQuick = (title: string) => (title.trim() ? act("new", () => taskAction({ op: "create", title: title.trim() })) : undefined);
  const [filter, setFilter] = useState<Filter>("today");
  const [draft, setDraft] = useState("");
  const now = new Date();
  const live = liveTasks(state);
  const byDue = (a: Task, b: Task) => (a.due ?? "9999").localeCompare(b.due ?? "9999");

  const list: Task[] =
    filter === "today"
      ? live.filter((t) => !t.done && (sameDay(t.due, now) || isOverdue(t.due, now))).sort(byDue)
      : filter === "upcoming"
        ? live.filter((t) => !t.done && t.due && !sameDay(t.due, now) && !isOverdue(t.due, now)).sort(byDue)
        : filter === "nodate"
          ? live.filter((t) => !t.done && !t.due)
          : filter === "done"
            ? live.filter((t) => t.done).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
            : state.tasks.filter((t) => t.deletedAt).sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 720, width: "100%", alignSelf: "center" }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === f.key }}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: filter === f.key ? c.accent : c.soft }}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: filter === f.key ? c.accentText : c.text }}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {filter !== "trash" && filter !== "done" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="빠르게 할일 추가"
            placeholderTextColor={c.muted}
            onSubmitEditing={() => {
              void addTaskQuick(draft);
              setDraft("");
            }}
            style={{ flex: 1, borderRadius: 12, backgroundColor: c.surface, color: c.text, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: c.border }}
          />
          <Btn c={c} primary label="추가" busy={busy === "new"} onPress={() => { void addTaskQuick(draft); setDraft(""); }} />
        </View>
      ) : null}

      {list.length === 0 ? <Text style={{ color: c.muted, textAlign: "center", marginTop: 24 }}>비어 있어요</Text> : null}
      {list.map((t) => (
        <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border }}>
          {filter === "trash" ? null : (
            <Pressable onPress={() => void toggleTask(t.id)} disabled={busy === t.id} accessibilityRole="checkbox" accessibilityState={{ checked: t.done }} accessibilityLabel={t.title}>
              <Text style={{ fontSize: 20, color: t.done ? c.ok : c.muted }}>{t.done ? "☑" : "☐"}</Text>
            </Pressable>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, color: t.done || t.deletedAt ? c.muted : c.text, textDecorationLine: t.done ? "line-through" : "none" }}>{t.title}</Text>
            {t.due ? <Text style={{ fontSize: 12, color: !t.done && isOverdue(t.due, now) ? c.danger : c.muted }}>{formatWhen(t.due, now)}</Text> : null}
          </View>
          {filter === "trash" ? (
            <Btn c={c} small label="되살리기" busy={busy === t.id} onPress={() => void restoreTask(t.id)} />
          ) : (
            <Btn c={c} small label="삭제" busy={busy === t.id} onPress={() => void deleteTask(t.id)} />
          )}
        </View>
      ))}
      {filter === "trash" && list.length ? <Text style={{ color: c.muted, fontSize: 12, textAlign: "center" }}>휴지통은 7일이 지나면 비워져요.</Text> : null}
    </ScrollView>
  );
}
