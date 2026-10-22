/**
 * 계획 카드 — 지금 할 만한 일(추천 · 이유 · 순서 바꾸기)과 가까운 마감. 업무 탭 맨 위에 놓인다.
 * (오늘 화면은 받은 것 중심이 되어 여기로 옮겼다 — docs/inbox-today.md)
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { formatWhen, isOverdue } from "../../../../packages/core/src/dates.ts";
import { liveTasks } from "../../../../packages/core/src/engine.ts";
import { moveRecommendation, nextActions, recommend, toggleAction } from "../../../../packages/core/src/work.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useData } from "../../firebase/data";
import { useT } from "../../i18n";
import { Card, H, Muted, msgText } from "./parts";
import { useWork } from "./WorkContext";

const FIRST = 3;
const open = (id: string) => router.push({ pathname: "/work/[id]", params: { id } });

export function RecommendCard({ c }: { c: Palette }) {
  const t = useT();
  const { state, workspaceId, update, saveManifest } = useWork();
  const [more, setMore] = useState(false);
  const now = new Date();
  const recs = recommend(state, now, { workspaceId });
  if (!recs.length) return null;
  const shown = more ? recs : recs.slice(0, FIRST);
  const move = (key: string, dir: -1 | 1) => void saveManifest((m) => ({ ...m, prefs: moveRecommendation(m.prefs, recs.map((r) => r.key), key, dir) }));
  return (
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
  );
}

export function DeadlineCard({ c }: { c: Palette }) {
  const t = useT();
  const { state: legacy } = useData();
  const { state, workspaceId } = useWork();
  const now = new Date();
  const inWs = state.items.filter((i) => i.workspaceId === workspaceId);
  const soon = (d?: string | null) => !!d && (isOverdue(d, now) || new Date(d.length === 10 ? `${d}T23:59` : d).getTime() - now.getTime() < 7 * 86400000);
  const deadlines = [
    ...inWs.flatMap((i) => nextActions(i).filter((a) => soon(a.due)).map((a) => ({ key: a.id, title: a.title, due: a.due as string, sub: i.title, itemId: i.id as string | null }))),
    // 예전 할일(작업실 밖) — 할일 탭과 같은 데이터
    ...liveTasks(legacy).filter((x) => !x.done && soon(x.due)).map((x) => ({ key: x.id, title: x.title, due: x.due as string, sub: t("today.legacyTask"), itemId: null })),
  ].sort((a, b) => a.due.localeCompare(b.due));
  return (
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
  );
}
