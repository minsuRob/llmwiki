/**
 * 오늘 — 추천 행동(처음엔 3개, 이유와 함께 · 순서를 바꿀 수 있다) · 이어서 할 업무 · 가까운 마감 · 판단이 필요한 것 · 최근 AI 작업 결과.
 * 전체 할 일 · 일정은 기존 화면으로 이어진다(옛 할일은 Firestore 에서 그대로 읽는다).
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { formatWhen, isOverdue } from "../../../../packages/core/src/dates.ts";
import { liveTasks } from "../../../../packages/core/src/engine.ts";
import { continueItems, moveRecommendation, nextActions, pendingReview, recommend, staleSources, toggleAction } from "../../../../packages/core/src/work.ts";
import { usePalette } from "../../components/theme";
import { Btn, PAGE } from "../../components/ui";
import { useData } from "../../firebase/data";
import { useT } from "../../i18n";
import { ConflictPanel } from "./ConflictPanel";
import { Card, H, Muted, Pill, WorkspaceChips, msgText } from "./parts";
import { useWork } from "./WorkContext";

const FIRST = 3;

export default function TodayScreen() {
  const c = usePalette();
  const t = useT();
  const { state: legacy } = useData();
  const { ready, state, workspaceId, update, saveManifest } = useWork();
  const [more, setMore] = useState(false);
  if (!ready) return <ActivityIndicator style={{ flex: 1, backgroundColor: c.bg }} color={c.muted} />;

  const now = new Date();
  const recs = recommend(state, now, { workspaceId });
  const shown = more ? recs : recs.slice(0, FIRST);
  const items = continueItems(state, workspaceId);
  const inWs = state.items.filter((i) => i.workspaceId === workspaceId);
  const soon = (d?: string | null) => !!d && (isOverdue(d, now) || new Date(d.length === 10 ? `${d}T23:59` : d).getTime() - now.getTime() < 7 * 86400000);
  const deadlines = [
    ...inWs.flatMap((i) => nextActions(i).filter((a) => soon(a.due)).map((a) => ({ key: a.id, title: a.title, due: a.due as string, sub: i.title, itemId: i.id as string | null }))),
    // 예전 할일(작업실 밖) — 할일 탭과 같은 데이터
    ...liveTasks(legacy).filter((x) => !x.done && soon(x.due)).map((x) => ({ key: x.id, title: x.title, due: x.due as string, sub: t("today.legacyTask"), itemId: null })),
  ].sort((a, b) => a.due.localeCompare(b.due));
  const needs = inWs.map((i) => ({ item: i, review: pendingReview(i), stale: staleSources(i, state.sources).length })).filter((x) => x.review.proposals.length + x.review.decisions.length + x.stale > 0);
  const recentRuns = inWs
    .flatMap((i) => i.runs.filter((r) => r.finishedAt).map((r) => ({ r, item: i })))
    .sort((a, b) => (b.r.finishedAt ?? "").localeCompare(a.r.finishedAt ?? ""))
    .slice(0, 3);

  const move = (key: string, dir: -1 | 1) => void saveManifest((m) => ({ ...m, prefs: moveRecommendation(m.prefs, recs.map((r) => r.key), key, dir) }));
  const open = (id: string) => router.push({ pathname: "/work/[id]", params: { id } });

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={PAGE}>
      <WorkspaceChips c={c} />
      <ConflictPanel c={c} />

      {!inWs.length ? (
        <Card c={c}>
          <H c={c}>{t("today.emptyTitle")}</H>
          <Muted c={c}>{t("today.emptyBody")}</Muted>
          <View style={{ flexDirection: "row" }}>
            <Btn c={c} primary label={t("work.new")} onPress={() => router.push({ pathname: "/work", params: { new: "1" } })} />
          </View>
        </Card>
      ) : null}

      {recs.length ? (
        <Card c={c}>
          <H c={c} right={state.manifest.prefs.todayOrder.length ? <Btn c={c} small label={t("today.resetOrder")} onPress={() => void saveManifest((m) => ({ ...m, prefs: { ...m.prefs, todayOrder: [] } }))} /> : null}>
            {t("today.recommended")}
          </H>
          {shown.map((r, i) => (
            <View key={r.key} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: c.row, borderRadius: 10, padding: 10 }}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: false }}
                accessibilityLabel={t("today.doneA11y", { title: r.title })}
                onPress={() => r.taskId && void update(r.itemId, (it) => toggleAction(it, r.taskId as string, new Date().toISOString()))}
                style={{ paddingTop: 1 }}
              >
                <Ionicons name="square-outline" size={20} color={r.blocked ? c.muted : c.text} />
              </Pressable>
              <Pressable style={{ flex: 1, gap: 3 }} onPress={() => open(r.itemId)} accessibilityRole="link">
                <Text style={{ fontSize: 15, color: r.blocked ? c.muted : c.text, fontWeight: "600" }}>{r.title}</Text>
                <Text style={{ fontSize: 12, color: c.muted }}>
                  {r.workTitle}
                  {r.due ? ` · ${formatWhen(r.due, now)}` : ""}
                </Text>
                <Text style={{ fontSize: 12, color: r.blocked ? c.danger : c.accent }}>{t("today.why", { reasons: r.reasons.map((m) => msgText(t, m)).join(" · ") })}</Text>
              </Pressable>
              <View style={{ gap: 4 }}>
                <Pressable accessibilityRole="button" accessibilityLabel={t("today.moveUp")} disabled={i === 0} onPress={() => move(r.key, -1)} style={{ opacity: i === 0 ? 0.3 : 1 }}>
                  <Ionicons name="chevron-up" size={18} color={c.muted} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t("today.moveDown")} disabled={i === shown.length - 1} onPress={() => move(r.key, 1)} style={{ opacity: i === shown.length - 1 ? 0.3 : 1 }}>
                  <Ionicons name="chevron-down" size={18} color={c.muted} />
                </Pressable>
              </View>
            </View>
          ))}
          {recs.length > FIRST ? <Btn c={c} small label={more ? t("today.less") : t("today.more", { count: recs.length - FIRST })} onPress={() => setMore(!more)} /> : null}
        </Card>
      ) : null}

      {items.length ? (
        <Card c={c}>
          <H c={c}>{t("today.continue")}</H>
          {items.slice(0, 3).map((i) => (
            <Pressable key={i.id} onPress={() => open(i.id)} accessibilityRole="link" style={{ backgroundColor: c.row, borderRadius: 10, padding: 10, gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: c.text }}>{i.title}</Text>
                <Pill c={c} label={t(`work.status.${i.status}`)} tone="accent" />
              </View>
              {i.summary ? (
                <Text numberOfLines={2} style={{ fontSize: 13, color: c.text }}>
                  {i.summary.text}
                </Text>
              ) : null}
              <Text style={{ fontSize: 12, color: c.muted }}>{nextActions(i)[0] ? t("today.nextIs", { title: nextActions(i)[0].title }) : t("work.noNext")}</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {needs.length ? (
        <Card c={c} tone="attention">
          <H c={c}>{t("today.needsYou")}</H>
          {needs.map(({ item, review, stale }) => (
            <Pressable key={item.id} onPress={() => open(item.id)} accessibilityRole="link" style={{ gap: 2 }}>
              <Text style={{ fontSize: 14, color: c.text, fontWeight: "600" }}>{item.title}</Text>
              <Muted c={c}>{t("today.needsDetail", { proposals: review.proposals.length, decisions: review.decisions.length, stale })}</Muted>
            </Pressable>
          ))}
        </Card>
      ) : null}

      <Card c={c}>
        <H c={c}>{t("today.deadlines")}</H>
        {deadlines.length ? (
          deadlines.slice(0, 6).map((d) => (
            <Pressable key={d.key} onPress={() => (d.itemId ? open(d.itemId) : router.push("/tasks"))} accessibilityRole="link" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Text style={{ flex: 1, fontSize: 14, color: c.text }}>{d.title}</Text>
              <Text style={{ fontSize: 12, color: isOverdue(d.due, now) ? c.danger : c.muted }}>
                {formatWhen(d.due, now)} · {d.sub}
              </Text>
            </Pressable>
          ))
        ) : (
          <Muted c={c}>{t("today.noDeadlines")}</Muted>
        )}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Btn c={c} small label={t("nav.allTasks")} onPress={() => router.push("/tasks")} />
          <Btn c={c} small label={t("nav.calendar")} onPress={() => router.push("/calendar")} />
        </View>
      </Card>

      {recentRuns.length ? (
        <Card c={c}>
          <H c={c}>{t("today.recentAi")}</H>
          {recentRuns.map(({ r, item }) => (
            <Pressable key={r.id} onPress={() => open(item.id)} accessibilityRole="link" style={{ gap: 2 }}>
              <Text style={{ fontSize: 14, color: c.text }}>
                {item.title} · {t(`tool.${r.tool}`)}
              </Text>
              <Muted c={c}>{r.resultSummary ?? t("today.noSummary")}</Muted>
            </Pressable>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}
