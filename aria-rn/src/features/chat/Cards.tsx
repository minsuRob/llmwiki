/**
 * 대화 아래 카드 다섯 가지. 제목 · 마감 · 완료 여부는 카드에 적힌 글이 아니라 **지금 데이터**(Firestore 구독)에서 읽는다.
 * 단추는 cardAction 함수를 부르고, 결과는 구독으로 화면에 돌아온다.
 * - changes: 이번 턴에 만든 · 끝낸 · 지운 것 + [되돌리기]
 * - task_list: 범위의 할일을 살아 있는 체크 목록으로
 * - overdue: 기한 지난 할일 — 줄마다 [완료] · [오늘로] · [삭제]
 * - suggest: 할일 제안 — 줄마다 [추가] · [빼기], [모두 추가]
 * - recall: 시냅스에서 떠올린 개념과 그 근거 기록 · 할일
 */
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { formatWhen, isOverdue } from "../../../../packages/core/src/dates.ts";
import { tasksInScope } from "../../../../packages/core/src/engine.ts";
import type { Card, Task } from "../../../../packages/core/src/types.ts";
import { usePalette } from "../../components/theme";
import { Btn, Line, Shell, Tag } from "../../components/ui";
import { cardAction, taskAction, type CardAction } from "../../firebase/api";
import { useData } from "../../firebase/data";
import { useI18n, useT } from "../../i18n";
import { scrapLabel } from "../notes/NotesScreen";

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
    case "recall":
      return <RecallCard card={card} />;
  }
}

/** 단추 하나씩 '처리 중' 을 보이고, 처리 중엔 같은 카드의 다른 단추를 막는다 */
function useCardAction() {
  const { run } = useData();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (key: string, req: CardAction) => {
    if (busy) return;
    setBusy(key);
    await run(() => cardAction(req));
    setBusy(null);
  };
  return { busy, act };
}

function ChangesCard({ card }: { card: Extract<Card, { kind: "changes" }> }) {
  const c = usePalette();
  const t = useT();
  const { state } = useData();
  const { busy, act } = useCardAction();
  const task = (id: string) => state.tasks.find((t) => t.id === id);
  const parts: string[] = [];
  if (card.createdTaskIds.length) parts.push(t("cards.changes.createdTasks", { count: card.createdTaskIds.length }));
  if (card.createdEventIds.length) parts.push(t("cards.changes.createdEvents", { count: card.createdEventIds.length }));
  if (card.completedTaskIds.length) parts.push(t("cards.changes.completed", { count: card.completedTaskIds.length }));
  if (card.deletedTaskIds.length) parts.push(t("cards.changes.deleted", { count: card.deletedTaskIds.length }));
  if (card.createdScrapIds.length) parts.push(t("cards.changes.scraps", { count: card.createdScrapIds.length }));
  const title = card.undone ? t("cards.changes.undoneTitle", { parts: parts.join(" · ") }) : parts.join(" · ");

  const rows: React.ReactNode[] = [];
  for (const id of card.createdTaskIds) {
    const tk = task(id);
    if (!tk) continue;
    const keptDone = card.undone && tk.done && !tk.deletedAt;
    rows.push(
      <Line key={id} c={c} title={tk.title} sub={formatWhen(tk.due)} struck={card.undone ? !keptDone : tk.done} right={keptDone ? <Tag c={c} label={t("cards.changes.keptDone")} /> : tk.done ? <Tag c={c} tone="ok" label={t("cards.changes.done")} /> : null} />,
    );
  }
  for (const id of card.createdEventIds) {
    const e = state.events.find((x) => x.id === id);
    if (e) rows.push(<Line key={id} c={c} title={`📅 ${e.title}`} sub={formatWhen(e.start)} struck={card.undone} />);
  }
  for (const id of card.completedTaskIds) {
    const tk = task(id);
    if (tk) rows.push(<Line key={id} c={c} title={tk.title} struck={!card.undone} right={<Tag c={c} tone={card.undone ? "muted" : "ok"} label={t(card.undone ? "cards.changes.reopened" : "cards.changes.done")} />} />);
  }
  for (const id of card.deletedTaskIds) {
    const tk = task(id);
    if (tk) rows.push(<Line key={id} c={c} title={tk.title} struck={!card.undone} right={<Tag c={c} label={t(card.undone ? "cards.changes.restored" : "cards.changes.trash")} />} />);
  }
  for (const id of card.createdScrapIds) {
    const s = state.scraps.find((x) => x.id === id);
    if (s) rows.push(<Line key={id} c={c} title={`✎ ${s.text}`} sub={scrapLabel(t, s.label)} struck={card.undone} />);
  }

  return (
    <Shell c={c} title={title} right={card.undone ? null : <Btn c={c} small label={t("cards.changes.undo")} busy={busy === "undo"} onPress={() => act("undo", { cardId: card.id, action: "undo" })} />}>
      <View style={{ gap: 6 }}>{rows}</View>
    </Shell>
  );
}

function TaskListCard({ card }: { card: Extract<Card, { kind: "task_list" }> }) {
  const c = usePalette();
  const tr = useT();
  const { state, run } = useData();
  const [busy, setBusy] = useState<string | null>(null);
  // 방금 체크한 할일도 자리를 지키며 지운 선으로 보인다
  const tasks: Task[] = tasksInScope(state, card.scope, new Date(), { includeDone: true });
  const left = tasks.filter((t) => !t.done).length;
  const toggle = async (id: string) => {
    setBusy(id);
    await run(() => taskAction({ op: "toggle", id }));
    setBusy(null);
  };
  return (
    <Shell c={c} title={`${card.title} ${left}`}>
      <View style={{ gap: 6 }}>
        {left === 0 ? <Text style={{ color: c.muted, fontSize: 13 }}>{tr("cards.taskList.allDone")}</Text> : null}
        {tasks.map((t) => (
          <Pressable key={t.id} onPress={() => void toggle(t.id)} disabled={busy === t.id} accessibilityRole="checkbox" accessibilityState={{ checked: t.done }} accessibilityLabel={t.title}>
            <Line
              c={c}
              title={t.title}
              sub={formatWhen(t.due)}
              subDanger={!t.done && isOverdue(t.due)}
              struck={t.done}
              right={<Text style={{ fontSize: 18, color: t.done ? c.ok : c.muted, opacity: busy === t.id ? 0.4 : 1 }}>{t.done ? "☑" : "☐"}</Text>}
            />
          </Pressable>
        ))}
      </View>
    </Shell>
  );
}

function OverdueCard({ card }: { card: Extract<Card, { kind: "overdue" }> }) {
  const c = usePalette();
  const tr = useT();
  const { state } = useData();
  const { busy, act } = useCardAction();
  const open = card.rows.filter((r) => r.state === "open").length;
  const label = { completed: "cards.overdue.completed", today: "cards.overdue.movedToday", deleted: "cards.overdue.deleted" } as const;
  return (
    <Shell c={c} title={tr("cards.overdue.title", { count: card.rows.length })} right={card.closed ? <Tag c={c} label={tr("cards.closed")} /> : null}>
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
                right={r.state !== "open" ? <Tag c={c} tone={r.state === "completed" ? "ok" : "muted"} label={tr(label[r.state])} /> : null}
              />
              {r.state === "open" && !card.closed ? (
                <View style={{ flexDirection: "row", gap: 6, paddingLeft: 4 }}>
                  <Btn c={c} small primary label={tr("cards.overdue.complete")} busy={busy === `c${r.taskId}`} disabled={!!busy} onPress={() => act(`c${r.taskId}`, { cardId: card.id, action: "overdue_complete", taskId: r.taskId })} />
                  <Btn c={c} small label={tr("cards.overdue.today")} busy={busy === `t${r.taskId}`} disabled={!!busy} onPress={() => act(`t${r.taskId}`, { cardId: card.id, action: "overdue_today", taskId: r.taskId })} />
                  <Btn c={c} small label={tr("cards.overdue.delete")} busy={busy === `d${r.taskId}`} disabled={!!busy} onPress={() => act(`d${r.taskId}`, { cardId: card.id, action: "overdue_delete", taskId: r.taskId })} />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {!card.closed && open > 0 ? (
        <View style={{ flexDirection: "row" }}>
          <Btn c={c} small label={tr("cards.close")} busy={busy === "close"} disabled={!!busy} onPress={() => act("close", { cardId: card.id, action: "close" })} />
        </View>
      ) : null}
    </Shell>
  );
}

function SuggestCard({ card }: { card: Extract<Card, { kind: "suggest" }> }) {
  const c = usePalette();
  const t = useT();
  const { busy, act } = useCardAction();
  const open = card.rows.filter((r) => r.state === "open").length;
  return (
    <Shell c={c} title={t("cards.suggest.title", { count: card.rows.length })} right={card.closed ? <Tag c={c} label={t("cards.closed")} /> : null}>
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
                  <Btn c={c} small primary label={t("cards.suggest.add")} busy={busy === `a${i}`} disabled={!!busy} onPress={() => act(`a${i}`, { cardId: card.id, action: "suggest_add", index: i })} />
                  <Btn c={c} small label={t("cards.suggest.skip")} busy={busy === `s${i}`} disabled={!!busy} onPress={() => act(`s${i}`, { cardId: card.id, action: "suggest_skip", index: i })} />
                </View>
              ) : r.state === "added" ? (
                <Tag c={c} tone="ok" label={t("cards.suggest.added")} />
              ) : r.state === "skipped" ? (
                <Tag c={c} label={t("cards.suggest.skipped")} />
              ) : null
            }
          />
        ))}
      </View>
      {!card.closed && open > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 12, color: c.muted }}>{t("cards.suggest.hint")}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {open >= 2 ? <Btn c={c} primary label={t("cards.suggest.addAll")} busy={busy === "all"} disabled={!!busy} onPress={() => act("all", { cardId: card.id, action: "suggest_add_all" })} /> : null}
            <Btn c={c} label={t("cards.close")} busy={busy === "close"} disabled={!!busy} onPress={() => act("close", { cardId: card.id, action: "close" })} />
          </View>
        </View>
      ) : null}
    </Shell>
  );
}

function RecallCard({ card }: { card: Extract<Card, { kind: "recall" }> }) {
  const c = usePalette();
  const { lang, t } = useI18n();
  const { state } = useData();
  const nodes = card.nodeIds.map((id) => state.nodes.find((n) => n.id === id)).filter((n): n is NonNullable<typeof n> => !!n);
  const scraps = card.scrapIds.map((id) => state.scraps.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s && !s.deletedAt);
  const tasks = card.taskIds.map((id) => state.tasks.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t && !t.deletedAt);
  return (
    <Shell c={c} title={t("cards.recall.title", { query: card.query })}>
      {nodes.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {nodes.map((n) => (
            <Pressable key={n.id} onPress={() => router.push({ pathname: "/synapse", params: { node: n.id } })} accessibilityRole="link" accessibilityLabel={t("cards.recall.openInSynapse", { name: n.name })}>
              <Tag c={c} tone="accent" label={n.name} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ gap: 6 }}>
        {scraps.map((s) => (
          <Line key={s.id} c={c} title={s.text} sub={`${scrapLabel(t, s.label)} · ${new Date(s.createdAt).toLocaleDateString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric" })}`} />
        ))}
        {tasks.map((t) => (
          <Line key={t.id} c={c} title={`☐ ${t.title}`} sub={formatWhen(t.due)} struck={t.done} />
        ))}
      </View>
    </Shell>
  );
}
