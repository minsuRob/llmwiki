/**
 * 대화 아래 카드 네 가지. 제목 · 마감 · 완료 여부는 카드에 적힌 글이 아니라 **지금 데이터**에서 읽는다.
 * - changes: 이번 턴에 만든 · 끝낸 · 지운 것 + [되돌리기]
 * - task_list: 범위의 할일을 살아 있는 체크 목록으로
 * - overdue: 기한 지난 할일 — 줄마다 [완료] · [오늘로] · [삭제]
 * - suggest: 할일 제안 — 줄마다 [추가] · [빼기], [모두 추가]
 * Pressable 의 style 은 정적 객체만 쓴다(함수형 style 은 플랫폼마다 다르게 먹는다).
 */
import React from "react";
import { Pressable, Text, View } from "react-native";

import { formatWhen, isOverdue } from "../lib/dates.ts";
import { tasksInScope } from "../lib/engine.ts";
import type { Card, Task } from "../lib/types.ts";
import { useApp } from "../lib/store.tsx";
import { usePalette, type Palette } from "./theme.ts";

export function CardView({ card }: { card: Card }) {
  switch (card.kind) {
    case "changes":
      return <ChangesCard card={card} />;
    case "task_list":
      return <TaskListCard card={card} />;
    case "overdue":
      return <OverdueCard card={card} />;
    case "suggest":
      return <SuggestCard card={card} />;
  }
}

function Shell({ c, title, children, right }: { c: Palette; title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: c.card, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: c.border, marginTop: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: "700", color: c.text }}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Btn({ label, onPress, primary, c, small }: { label: string; onPress: () => void; primary?: boolean; c: Palette; small?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ paddingHorizontal: small ? 10 : 14, paddingVertical: small ? 6 : 9, borderRadius: 10, backgroundColor: primary ? c.accent : c.soft }}
    >
      <Text style={{ fontSize: small ? 12 : 14, fontWeight: primary ? "700" : "500", color: primary ? c.accentText : c.text }}>{label}</Text>
    </Pressable>
  );
}

function Tag({ label, c, tone }: { label: string; c: Palette; tone?: "ok" | "muted" }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: c.soft }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: tone === "ok" ? c.ok : c.muted }}>{label}</Text>
    </View>
  );
}

function Line({ c, title, sub, struck, subDanger, right }: { c: Palette; title: string; sub?: string | null; struck?: boolean; subDanger?: boolean; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.row, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ fontSize: 14, color: struck ? c.muted : c.text, textDecorationLine: struck ? "line-through" : "none" }}>
          {title}
        </Text>
        {sub ? <Text style={{ fontSize: 12, color: subDanger ? c.danger : c.muted }}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

function ChangesCard({ card }: { card: Extract<Card, { kind: "changes" }> }) {
  const c = usePalette();
  const { state, undo } = useApp();
  const task = (id: string) => state.tasks.find((t) => t.id === id);
  const parts: string[] = [];
  if (card.createdTaskIds.length) parts.push(`추가한 할일 ${card.createdTaskIds.length}`);
  if (card.createdEventIds.length) parts.push(`추가한 일정 ${card.createdEventIds.length}`);
  if (card.completedTaskIds.length) parts.push(`완료 ${card.completedTaskIds.length}`);
  if (card.deletedTaskIds.length) parts.push(`삭제 ${card.deletedTaskIds.length}`);
  if (card.createdScrapIds.length) parts.push(`기록 ${card.createdScrapIds.length}`);
  const title = (card.undone ? "되돌림 · " : "") + parts.join(" · ");

  const rows: React.ReactNode[] = [];
  for (const id of card.createdTaskIds) {
    const t = task(id);
    if (!t) continue;
    const keptDone = card.undone && t.done && !t.deletedAt;
    rows.push(
      <Line key={id} c={c} title={t.title} sub={formatWhen(t.due)} struck={card.undone ? !keptDone : t.done} right={keptDone ? <Tag c={c} label="완료라 남김" /> : t.done ? <Tag c={c} tone="ok" label="완료" /> : null} />,
    );
  }
  for (const id of card.createdEventIds) {
    const e = state.events.find((x) => x.id === id);
    if (e) rows.push(<Line key={id} c={c} title={`📅 ${e.title}`} sub={formatWhen(e.start)} struck={card.undone} />);
  }
  for (const id of card.completedTaskIds) {
    const t = task(id);
    if (t) rows.push(<Line key={id} c={c} title={t.title} struck={!card.undone} right={<Tag c={c} tone={card.undone ? "muted" : "ok"} label={card.undone ? "다시 열림" : "완료"} />} />);
  }
  for (const id of card.deletedTaskIds) {
    const t = task(id);
    if (t) rows.push(<Line key={id} c={c} title={t.title} struck={!card.undone} right={<Tag c={c} label={card.undone ? "되살림" : "휴지통"} />} />);
  }
  for (const id of card.createdScrapIds) {
    const s = state.scraps.find((x) => x.id === id);
    if (s) rows.push(<Line key={id} c={c} title={`✎ ${s.text}`} sub={s.label} struck={card.undone} />);
  }

  return (
    <Shell c={c} title={title} right={card.undone ? null : <Btn c={c} small label="되돌리기" onPress={() => undo(card.id)} />}>
      <View style={{ gap: 6 }}>{rows}</View>
    </Shell>
  );
}

function TaskListCard({ card }: { card: Extract<Card, { kind: "task_list" }> }) {
  const c = usePalette();
  const { state, toggleTask } = useApp();
  // 지금 데이터로 그린다 — 방금 체크한 할일도 자리를 지키며 지운 선으로 보인다
  const tasks: Task[] = tasksInScope(state, card.scope, new Date(), { includeDone: true });
  const left = tasks.filter((t) => !t.done).length;
  return (
    <Shell c={c} title={`${card.title} ${left}`}>
      <View style={{ gap: 6 }}>
        {left === 0 ? <Text style={{ color: c.muted, fontSize: 13 }}>모두 끝냈어요 🎉</Text> : null}
        {tasks.map((t) => (
          <Pressable key={t.id} onPress={() => toggleTask(t.id)} accessibilityRole="checkbox" accessibilityState={{ checked: t.done }}>
            <Line
              c={c}
              title={t.title}
              sub={formatWhen(t.due)}
              subDanger={isOverdue(t.due)}
              struck={t.done}
              right={<Text style={{ fontSize: 18, color: t.done ? c.ok : c.muted }}>{t.done ? "☑" : "☐"}</Text>}
            />
          </Pressable>
        ))}
      </View>
    </Shell>
  );
}

function OverdueCard({ card }: { card: Extract<Card, { kind: "overdue" }> }) {
  const c = usePalette();
  const { state, overdueAction, close } = useApp();
  const open = card.rows.filter((r) => r.state === "open").length;
  const label = { completed: "완료", today: "오늘로 옮김", deleted: "삭제함", open: "" } as const;
  return (
    <Shell c={c} title={`기한 지난 할일 ${card.rows.length}`} right={card.closed ? <Tag c={c} label="정리 끝" /> : null}>
      <View style={{ gap: 6 }}>
        {card.rows.map((r) => {
          const t = state.tasks.find((x) => x.id === r.taskId);
          if (!t) return null;
          return (
            <View key={r.taskId} style={{ gap: 6 }}>
              <Line
                c={c}
                title={t.title}
                sub={formatWhen(t.due)}
                subDanger={r.state === "open"}
                struck={r.state === "completed" || r.state === "deleted"}
                right={r.state !== "open" ? <Tag c={c} tone={r.state === "completed" ? "ok" : "muted"} label={label[r.state]} /> : null}
              />
              {r.state === "open" && !card.closed ? (
                <View style={{ flexDirection: "row", gap: 6, paddingLeft: 4 }}>
                  <Btn c={c} small primary label="완료" onPress={() => overdueAction(card.id, r.taskId, "complete")} />
                  <Btn c={c} small label="오늘로" onPress={() => overdueAction(card.id, r.taskId, "today")} />
                  <Btn c={c} small label="삭제" onPress={() => overdueAction(card.id, r.taskId, "delete")} />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {!card.closed && open > 0 ? (
        <View style={{ flexDirection: "row" }}>
          <Btn c={c} small label="닫기" onPress={() => close(card.id)} />
        </View>
      ) : null}
    </Shell>
  );
}

function SuggestCard({ card }: { card: Extract<Card, { kind: "suggest" }> }) {
  const c = usePalette();
  const { suggestAction, addAllSuggested, close } = useApp();
  const open = card.rows.filter((r) => r.state === "open").length;
  return (
    <Shell c={c} title={`이런 할일이 보여요 ${card.rows.length}`} right={card.closed ? <Tag c={c} label="정리 끝" /> : null}>
      {card.note ? <Text style={{ fontSize: 13, color: c.muted, lineHeight: 19 }}>{card.note}</Text> : null}
      <View style={{ gap: 6 }}>
        {card.rows.map((r, i) => (
          <Line
            key={`${card.id}-${i}`}
            c={c}
            title={r.title}
            sub={formatWhen(r.due)}
            struck={r.state === "skipped"}
            right={
              r.state === "open" && !card.closed ? (
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Btn c={c} small primary label="추가" onPress={() => suggestAction(card.id, i, "add")} />
                  <Btn c={c} small label="빼기" onPress={() => suggestAction(card.id, i, "skip")} />
                </View>
              ) : r.state === "added" ? (
                <Tag c={c} tone="ok" label="추가함" />
              ) : r.state === "skipped" ? (
                <Tag c={c} label="뺌" />
              ) : null
            }
          />
        ))}
      </View>
      {!card.closed && open > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 12, color: c.muted }}>추가를 누르기 전엔 할일이 생기지 않아요.</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {open >= 2 ? <Btn c={c} primary label="모두 추가" onPress={() => addAllSuggested(card.id)} /> : null}
            <Btn c={c} label="닫기" onPress={() => close(card.id)} />
          </View>
        </View>
      ) : null}
    </Shell>
  );
}
