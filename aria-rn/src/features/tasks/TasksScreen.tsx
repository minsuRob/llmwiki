/**
 * 할일 — 오늘 · 예정 · 마감 없음 · 완료 · 휴지통. 체크 · 삭제 · 되살리기는 taskAction 함수로.
 * 옵시디언 일감 프론트매터처럼 상태 · 우선순위 꼬리표를 달고, 누르면 다음 값으로 바뀐다. 꼬리표로 걸러 볼 수도 있다.
 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { formatWhen, isOverdue, sameDay } from "../../../../packages/core/src/dates.ts";
import { liveTasks } from "../../../../packages/core/src/engine.ts";
import {
  TASK_PRIORITIES,
  taskPriority,
  taskStatus,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../../../../packages/core/src/types.ts";
import { usePalette, type Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { taskAction } from "../../firebase/api";
import { useData } from "../../firebase/data";
import { useT } from "../../i18n";

type Filter = "today" | "upcoming" | "nodate" | "done" | "trash";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "today", label: "tasks.filters.today" },
  { key: "upcoming", label: "tasks.filters.upcoming" },
  { key: "nodate", label: "tasks.filters.nodate" },
  { key: "done", label: "tasks.filters.done" },
  { key: "trash", label: "tasks.filters.trash" },
];

/** 열린 할일이 돌 수 있는 상태(완료는 체크 칸이 맡는다) */
const OPEN_STATUSES: TaskStatus[] = ["진행중", "대기", "보류"];
const next = <T,>(list: readonly T[], v: T): T => list[(list.indexOf(v) + 1) % list.length];

function Chip({ c, label, active, tone, onPress, a11y }: { c: Palette; label: string; active: boolean; tone?: string; onPress: () => void; a11y?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={a11y}
      style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: active ? (tone ?? c.accent) : c.soft }}
    >
      <Text style={{ fontSize: 12, fontWeight: "600", color: active ? c.accentText : c.text }}>{label}</Text>
    </Pressable>
  );
}

/** 할일 줄의 꼬리표 — 누르면 다음 값. 끝낸 할일은 읽기만 */
function Tag({ c, label, tone, onPress, a11y }: { c: Palette; label: string; tone: string; onPress?: () => void; a11y: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={a11y}
      style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: tone }}
    >
      <Text style={{ fontSize: 11, fontWeight: "600", color: tone }}>{label}</Text>
    </Pressable>
  );
}

export default function TasksScreen() {
  const c = usePalette();
  const tr = useT();
  const statusLabel = (st: TaskStatus) => tr(`tasks.status.${st}`);
  const priorityLabel = (p: TaskPriority) => tr(`tasks.priority.${p}`);
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
  const setMeta = (id: string, meta: { status?: TaskStatus; priority?: TaskPriority }) => act(id, () => taskAction({ op: "update", id, ...meta }));
  const [statusFilter, setStatusFilter] = useState<TaskStatus | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | null>(null);
  const addTaskQuick = (title: string) => (title.trim() ? act("new", () => taskAction({ op: "create", title: title.trim() })) : undefined);
  const [filter, setFilter] = useState<Filter>("today");
  const [draft, setDraft] = useState("");
  const now = new Date();
  const live = liveTasks(state);
  const byDue = (a: Task, b: Task) => (a.due ?? "9999").localeCompare(b.due ?? "9999");

  const byFilter: Task[] =
    filter === "today"
      ? live.filter((t) => !t.done && (sameDay(t.due, now) || isOverdue(t.due, now))).sort(byDue)
      : filter === "upcoming"
        ? live.filter((t) => !t.done && t.due && !sameDay(t.due, now) && !isOverdue(t.due, now)).sort(byDue)
        : filter === "nodate"
          ? live.filter((t) => !t.done && !t.due)
          : filter === "done"
            ? live.filter((t) => t.done).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
            : state.tasks.filter((t) => t.deletedAt).sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
  const metaFilters = filter !== "trash";
  const list = byFilter.filter(
    (t) =>
      !metaFilters ||
      ((filter === "done" || !statusFilter || taskStatus(t) === statusFilter) && (!priorityFilter || taskPriority(t) === priorityFilter)),
  );
  const priorityTone = (p: TaskPriority) => (p === "최우선" ? c.danger : p === "중간" ? c.accent : c.muted);
  const statusTone = (st: TaskStatus) => (st === "진행중" ? c.ok : st === "보류" ? c.danger : st === "완료" ? c.muted : c.text);

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
            <Text style={{ fontSize: 13, fontWeight: "600", color: filter === f.key ? c.accentText : c.text }}>{tr(f.label)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {metaFilters ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: "center" }}>
          {filter !== "done" ? (
            <>
              <Text style={{ fontSize: 12, color: c.muted }}>{tr("tasks.statusHeading")}</Text>
              {OPEN_STATUSES.map((st) => (
                <Chip key={st} c={c} label={statusLabel(st)} tone={statusTone(st)} active={statusFilter === st} a11y={tr("tasks.filterStatus", { value: statusLabel(st) })} onPress={() => setStatusFilter(statusFilter === st ? null : st)} />
              ))}
              <View style={{ width: 8 }} />
            </>
          ) : null}
          <Text style={{ fontSize: 12, color: c.muted }}>{tr("tasks.priorityHeading")}</Text>
          {TASK_PRIORITIES.map((p) => (
            <Chip key={p} c={c} label={priorityLabel(p)} tone={priorityTone(p)} active={priorityFilter === p} a11y={tr("tasks.filterPriority", { value: priorityLabel(p) })} onPress={() => setPriorityFilter(priorityFilter === p ? null : p)} />
          ))}
        </ScrollView>
      ) : null}

      {filter !== "trash" && filter !== "done" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={tr("tasks.quickAdd")}
            placeholderTextColor={c.muted}
            onSubmitEditing={() => {
              void addTaskQuick(draft);
              setDraft("");
            }}
            style={{ flex: 1, borderRadius: 12, backgroundColor: c.surface, color: c.text, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: c.border }}
          />
          <Btn c={c} primary label={tr("tasks.add")} busy={busy === "new"} onPress={() => { void addTaskQuick(draft); setDraft(""); }} />
        </View>
      ) : null}

      {list.length === 0 ? (
        <Text style={{ color: c.muted, textAlign: "center", marginTop: 24 }}>{tr(byFilter.length ? "tasks.noMatch" : "tasks.empty")}</Text>
      ) : null}
      {list.map((t) => (
        <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border }}>
          {filter === "trash" ? null : (
            <Pressable onPress={() => void toggleTask(t.id)} disabled={busy === t.id} accessibilityRole="checkbox" accessibilityState={{ checked: t.done }} accessibilityLabel={t.title}>
              <Text style={{ fontSize: 20, color: t.done ? c.ok : c.muted }}>{t.done ? "☑" : "☐"}</Text>
            </Pressable>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, color: t.done || t.deletedAt ? c.muted : c.text, textDecorationLine: t.done ? "line-through" : "none" }}>{t.title}</Text>
            {filter === "trash" ? (
              t.due ? <Text style={{ fontSize: 12, color: c.muted }}>{formatWhen(t.due, now)}</Text> : null
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                <Tag
                  c={c}
                  label={statusLabel(taskStatus(t))}
                  tone={statusTone(taskStatus(t))}
                  a11y={tr(t.done ? "tasks.statusTag" : "tasks.statusTagEditable", { value: statusLabel(taskStatus(t)) })}
                  onPress={t.done || busy === t.id ? undefined : () => void setMeta(t.id, { status: next(OPEN_STATUSES, taskStatus(t)) })}
                />
                <Tag
                  c={c}
                  label={priorityLabel(taskPriority(t))}
                  tone={priorityTone(taskPriority(t))}
                  a11y={tr(t.done ? "tasks.priorityTag" : "tasks.priorityTagEditable", { value: priorityLabel(taskPriority(t)) })}
                  onPress={t.done || busy === t.id ? undefined : () => void setMeta(t.id, { priority: next(TASK_PRIORITIES, taskPriority(t)) })}
                />
                {t.due ? <Text style={{ fontSize: 12, color: !t.done && isOverdue(t.due, now) ? c.danger : c.muted }}>{formatWhen(t.due, now)}</Text> : null}
              </View>
            )}
          </View>
          {filter === "trash" ? (
            <Btn c={c} small label={tr("tasks.restore")} busy={busy === t.id} onPress={() => void restoreTask(t.id)} />
          ) : (
            <Btn c={c} small label={tr("tasks.delete")} busy={busy === t.id} onPress={() => void deleteTask(t.id)} />
          )}
        </View>
      ))}
      {filter === "trash" && list.length ? <Text style={{ color: c.muted, fontSize: 12, textAlign: "center" }}>{tr("tasks.trashNote")}</Text> : null}
    </ScrollView>
  );
}
