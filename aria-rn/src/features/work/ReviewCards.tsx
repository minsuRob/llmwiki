/**
 * 확인하거나 결정해야 할 것 — AI 가 낸 할 일 · 마감 변경 · 최신본 교체 · 결정 제안, 그리고 확인되지 않은 내용.
 * 중요한 변경만 카드로 보여 주고, 사람이 받아들여야 바뀐다.
 */
import React, { useState } from "react";
import { Text, View } from "react-native";

import { acceptProposal, addDecision, confirmDecision, pendingReview, rejectDecision, rejectProposal, type RunFlag, type WorkItem } from "../../../../packages/core/src/work.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { confirmAsk } from "./io";
import { Card, Field, H, Muted, Pill, when } from "./parts";
import { useWork } from "./WorkContext";

const now = () => new Date().toISOString();

export function ReviewCards({ c, item }: { c: Palette; item: WorkItem }) {
  const t = useT();
  const { update } = useWork();
  const review = pendingReview(item);
  const [dText, setDText] = useState("");
  const [dWhy, setDWhy] = useState("");
  const total = review.proposals.length + review.decisions.length + review.unverified.length;
  const runOf = (id?: string | null) => item.runs.find((r) => r.id === id);

  return (
    <Card c={c} tone={review.proposals.length + review.decisions.length ? "attention" : undefined}>
      <H c={c}>{t("detail.review", { count: total })}</H>
      {!total ? <Muted c={c}>{t("detail.reviewNone")}</Muted> : null}

      {review.decisions.map((d) => {
        const replaces = d.supersedes ? item.decisions.find((x) => x.id === d.supersedes) : null;
        return (
          <View key={d.id} style={{ gap: 6, backgroundColor: c.row, borderRadius: 10, padding: 10 }}>
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
              <Pill c={c} label={t("review.decisionProposed")} tone="accent" icon="sparkles-outline" />
              {runOf(d.runId) ? <Muted c={c}>{t("review.fromRun", { tool: t(`tool.${runOf(d.runId)!.tool}`), at: when(runOf(d.runId)!.finishedAt) })}</Muted> : null}
            </View>
            <RunFlags c={c} flags={runOf(d.runId)?.flags} />
            <Text style={{ fontSize: 14, color: c.text }}>{d.text}</Text>
            {d.reason ? <Muted c={c}>{t("review.reason", { reason: d.reason })}</Muted> : null}
            {d.refs?.length ? <Muted c={c}>{t("review.refs", { refs: d.refs.join(", ") })}</Muted> : null}
            {replaces ? <Text style={{ fontSize: 12, color: c.danger }}>{t("review.replaces", { text: replaces.text })}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Btn
                c={c}
                small
                primary
                label={t("review.confirm")}
                onPress={async () => {
                  if (replaces && !(await confirmAsk(t("review.confirm"), t("review.replaceAsk", { text: replaces.text }), t("common.ok"), t("common.cancel")))) return;
                  await update(item.id, (i) => confirmDecision(i, d.id, now()));
                }}
              />
              <Btn c={c} small label={t("review.reject")} onPress={() => void update(item.id, (i) => rejectDecision(i, d.id, now()))} />
            </View>
          </View>
        );
      })}

      {review.proposals.map((p) => (
        <View key={p.id} style={{ gap: 6, backgroundColor: c.row, borderRadius: 10, padding: 10 }}>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <Pill c={c} label={t(`review.kind.${p.kind}`)} tone="accent" icon="sparkles-outline" />
            {(p.flags ?? []).map((f) => (
              <Text key={f} style={{ fontSize: 12, fontWeight: "600", color: c.danger }}>
                {t(`review.flag.${f}`)}
              </Text>
            ))}
          </View>
          <RunFlags c={c} flags={runOf(p.runId)?.flags} />
          <Text style={{ fontSize: 14, color: c.text }}>
            {p.kind === "due_change" ? t("review.dueChange", { title: p.title ?? "", before: p.note || "-", after: p.due ?? "-" }) : p.kind === "task" ? `${p.title}${p.due ? ` (${p.due})` : ""}` : (p.title ?? "")}
          </Text>
          {p.refs?.length ? <Muted c={c}>{t("review.refs", { refs: p.refs.join(", ") })}</Muted> : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn c={c} small primary label={t(p.kind === "task" ? "review.addTask" : p.kind === "output_latest" ? "review.makeLatest" : "review.accept")} onPress={() => void update(item.id, (i) => acceptProposal(i, p.id, now()))} />
            <Btn c={c} small label={t("review.reject")} onPress={() => void update(item.id, (i) => rejectProposal(i, p.id, now()))} />
          </View>
        </View>
      ))}

      {review.unverified.length ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: c.text }}>{t("review.unverified")}</Text>
          {review.unverified.map((u, i) => (
            <Text key={i} style={{ fontSize: 13, color: c.text }}>
              • {u.text}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={{ gap: 6 }}>
        <Muted c={c}>{t("review.addDecision")}</Muted>
        <Field c={c} value={dText} onChangeText={setDText} placeholder={t("review.decisionText")} accessibilityLabel={t("review.decisionText")} />
        <Field c={c} value={dWhy} onChangeText={setDWhy} placeholder={t("review.decisionWhy")} accessibilityLabel={t("review.decisionWhy")} />
        <View style={{ flexDirection: "row" }}>
          <Btn
            c={c}
            small
            label={t("review.saveDecision")}
            disabled={!dText.trim()}
            onPress={async () => {
              await update(item.id, (i) => addDecision(i, { text: dText, reason: dWhy }, now()));
              setDText("");
              setDWhy("");
            }}
          />
        </View>
      </View>
    </Card>
  );
}

/** 이 제안을 낸 결과에서 코드가 찾은 문제 — 판단은 사람이 한다 */
function RunFlags({ c, flags }: { c: Palette; flags?: RunFlag[] }) {
  const t = useT();
  if (!flags?.length) return null;
  return <Text style={{ fontSize: 12, color: c.danger }}>⚠ {flags.map((f) => t(`review.runFlag.${f}`)).join(" · ")}</Text>;
}
