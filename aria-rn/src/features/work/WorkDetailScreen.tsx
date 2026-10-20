/**
 * 업무 상세 — 기본 화면: 목표와 완료 조건 · 현재 상태 · 다음 행동 · 최신 결과물 · 확인/결정할 것.
 * 원본 자료 · 전체 기록 · AI 작업 이력 · 이전 결정은 접어 두었다가 펼친다.
 * AI 로 이어하기(내보내기) · 결과 가져오기는 여기서 연다.
 */
import { Ionicons } from "@expo/vector-icons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";

import {
  addAction,
  editWork,
  isBlocked,
  latestOutput,
  markLatest,
  removeAction,
  setOutputStatus,
  setSummary,
  setWorkStatus,
  staleSources,
  toggleAction,
  WORK_STATUSES,
  type OutputStatus,
  type WorkItem,
} from "../../../../packages/core/src/work.ts";
import { usePalette, type Palette } from "../../components/theme";
import { Btn, PAGE } from "../../components/ui";
import { useT } from "../../i18n";
import { DesktopRunLines } from "./DesktopRunLines";
import { HandoffPanel } from "./HandoffPanel";
import { ImportPanel } from "./ImportPanel";
import { confirmAsk } from "./io";
import { Card, ChangeCard, Field, Fold, H, Muted, Pill, StatusStrip, msgText, when } from "./parts";
import { ReviewCards } from "./ReviewCards";
import { SourcePicker } from "./SourcePicker";
import { useWork } from "./WorkContext";

const now = () => new Date().toISOString();
const OUTPUT_NEXT: Record<OutputStatus, OutputStatus> = { draft: "review", review: "final", final: "draft" };

function GoalCard({ c, item }: { c: Palette; item: WorkItem }) {
  const t = useT();
  const { update } = useWork();
  const [edit, setEdit] = useState(false);
  const [goal, setGoal] = useState(item.goal);
  const [criteria, setCriteria] = useState(item.doneCriteria.join("\n"));
  return (
    <Card c={c}>
      <H c={c} right={<Btn c={c} small label={edit ? t("common.cancel") : t("common.edit")} onPress={() => (setGoal(item.goal), setCriteria(item.doneCriteria.join("\n")), setEdit(!edit))} />}>
        {t("detail.goal")}
      </H>
      {edit ? (
        <>
          <Field c={c} value={goal} onChangeText={setGoal} placeholder={t("detail.goalPlaceholder")} accessibilityLabel={t("detail.goal")} multiline />
          <Field c={c} value={criteria} onChangeText={setCriteria} placeholder={t("detail.criteriaPlaceholder")} accessibilityLabel={t("detail.criteria")} multiline />
          <View style={{ flexDirection: "row" }}>
            <Btn
              c={c}
              small
              primary
              label={t("common.save")}
              onPress={async () => {
                await update(item.id, (i) => editWork(i, { goal: goal.trim(), doneCriteria: criteria.split("\n").map((x) => x.trim()).filter(Boolean) }, now()));
                setEdit(false);
              }}
            />
          </View>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 14, color: item.goal ? c.text : c.muted }}>{item.goal || t("detail.goalEmpty")}</Text>
          {item.doneCriteria.length ? (
            <View style={{ gap: 2 }}>
              <Muted c={c}>{t("detail.criteria")}</Muted>
              {item.doneCriteria.map((x, i) => (
                <Text key={i} style={{ fontSize: 13, color: c.text }}>
                  ✓ {x}
                </Text>
              ))}
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}

function StateCard({ c, item }: { c: Palette; item: WorkItem }) {
  const t = useT();
  const { update, state } = useWork();
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(item.summary?.text ?? "");
  const stale = staleSources(item, state.sources);
  return (
    <Card c={c}>
      <H c={c} right={<Btn c={c} small label={edit ? t("common.cancel") : t("detail.writeSummary")} onPress={() => (setText(item.summary?.text ?? ""), setEdit(!edit))} />}>
        {t("detail.state")}
      </H>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }} accessibilityRole="radiogroup" accessibilityLabel={t("detail.statusLabel")}>
        {WORK_STATUSES.map((s) => (
          <Pressable key={s} onPress={() => void update(item.id, (i) => setWorkStatus(i, s, now()))} accessibilityRole="radio" accessibilityState={{ selected: item.status === s }} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: item.status === s ? c.accent : c.soft }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: item.status === s ? c.accentText : c.text }}>{t(`work.status.${s}`)}</Text>
          </Pressable>
        ))}
      </View>
      {edit ? (
        <>
          <Field c={c} value={text} onChangeText={setText} placeholder={t("detail.summaryPlaceholder")} accessibilityLabel={t("detail.state")} multiline />
          <View style={{ flexDirection: "row" }}>
            <Btn
              c={c}
              small
              primary
              label={t("common.save")}
              onPress={async () => {
                await update(item.id, (i) => setSummary(i, text, state.sources, now()));
                setEdit(false);
              }}
            />
          </View>
        </>
      ) : item.summary ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 14, color: c.text, lineHeight: 20 }}>{item.summary.text}</Text>
          <Muted c={c}>{t(item.summary.origin === "ai" ? "detail.summaryByAi" : "detail.summaryByUser", { at: when(item.summary.updatedAt) })}</Muted>
        </View>
      ) : (
        <Muted c={c}>{t("detail.summaryEmpty")}</Muted>
      )}
      {stale.length ? (
        <Text style={{ fontSize: 13, color: c.danger }}>
          {t("detail.stale", { titles: stale.map((s) => s.title).join(", ") })}
        </Text>
      ) : null}
    </Card>
  );
}

function ActionsCard({ c, item }: { c: Palette; item: WorkItem }) {
  const t = useT();
  const { update } = useWork();
  const [draft, setDraft] = useState("");
  const open = item.actions.filter((a) => !a.done);
  const done = item.actions.filter((a) => a.done);
  const add = async () => {
    if (!draft.trim()) return;
    await update(item.id, (i) => addAction(i, { title: draft }, now()));
    setDraft("");
  };
  return (
    <Card c={c}>
      <H c={c}>{t("detail.next")}</H>
      {!open.length ? <Muted c={c}>{t("work.noNext")}</Muted> : null}
      {open.map((a) => {
        const blocked = isBlocked(item, a);
        return (
          <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable onPress={() => void update(item.id, (i) => toggleAction(i, a.id, now()))} accessibilityRole="checkbox" accessibilityState={{ checked: false }} accessibilityLabel={a.title}>
              <Ionicons name="square-outline" size={20} color={c.text} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, color: blocked ? c.muted : c.text }}>{a.title}</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {a.due ? <Muted c={c}>{a.due}</Muted> : null}
                {blocked ? <Muted c={c} danger>{t("detail.blocked")}</Muted> : null}
                {a.origin === "ai" ? <Muted c={c}>{t("detail.fromAi")}</Muted> : null}
              </View>
            </View>
            <Pressable onPress={() => void update(item.id, (i) => removeAction(i, a.id, now()))} accessibilityRole="button" accessibilityLabel={t("detail.removeAction", { title: a.title })}>
              <Ionicons name="close" size={18} color={c.muted} />
            </Pressable>
          </View>
        );
      })}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Field c={c} value={draft} onChangeText={setDraft} placeholder={t("detail.addAction")} accessibilityLabel={t("detail.addAction")} onSubmitEditing={() => void add()} style={{ flex: 1 }} />
        <Btn c={c} label={t("common.add")} disabled={!draft.trim()} onPress={() => void add()} />
      </View>
      {done.length ? (
        <Fold c={c} title={t("detail.doneActions")} count={done.length}>
          {done.map((a) => (
            <Pressable key={a.id} onPress={() => void update(item.id, (i) => toggleAction(i, a.id, now()))} accessibilityRole="checkbox" accessibilityState={{ checked: true }} style={{ flexDirection: "row", gap: 8 }}>
              <Ionicons name="checkbox-outline" size={18} color={c.ok} />
              <Text style={{ fontSize: 13, color: c.muted, textDecorationLine: "line-through" }}>{a.title}</Text>
            </Pressable>
          ))}
        </Fold>
      ) : null}
    </Card>
  );
}

function OutputsCard({ c, item }: { c: Palette; item: WorkItem }) {
  const t = useT();
  const { update } = useWork();
  const latest = latestOutput(item);
  const others = item.outputs.filter((o) => o.id !== latest?.id);
  const makeLatest = async (id: string) => {
    let r = markLatest(item, id, now());
    if (r.kind === "needs_confirm") {
      if (!(await confirmAsk(t("output.replaceTitle"), t("output.replaceAsk", { title: r.current.title }), t("common.ok"), t("common.cancel")))) return;
      r = markLatest(item, id, now(), { confirmReplace: true });
    }
    if (r.kind === "ok") await update(item.id, () => r.item);
  };
  const row = (o: WorkItem["outputs"][number], isLatest: boolean) => (
    <View key={o.id} style={{ gap: 6, backgroundColor: c.row, borderRadius: 10, padding: 10 }}>
      <Pressable onPress={() => (o.url ? void Linking.openURL(o.url) : undefined)} accessibilityRole={o.url ? "link" : "text"}>
        <Text style={{ fontSize: 14, color: o.url ? c.accent : c.text, fontWeight: isLatest ? "700" : "400" }}>{o.title}</Text>
      </Pressable>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <Pill c={c} label={t(`output.status.${o.status}`)} tone={o.status === "final" ? "ok" : "muted"} />
        {o.runId ? <Pill c={c} label={t("output.byAi")} icon="sparkles-outline" /> : null}
        {o.version ? <Muted c={c}>v{o.version}</Muted> : null}
        <Btn c={c} small label={t("output.nextStatus", { status: t(`output.status.${OUTPUT_NEXT[o.status]}`) })} onPress={() => void update(item.id, (i) => setOutputStatus(i, o.id, OUTPUT_NEXT[o.status], now()))} />
        {!isLatest ? <Btn c={c} small label={t("output.makeLatest")} onPress={() => void makeLatest(o.id)} /> : null}
      </View>
    </View>
  );
  return (
    <Card c={c}>
      <H c={c}>{t("detail.latest")}</H>
      {latest ? row(latest, true) : <Muted c={c}>{item.outputs.length ? t("output.noLatestYet") : t("output.none")}</Muted>}
      {others.length ? (
        <Fold c={c} title={t("output.others")} count={others.length}>
          {others.map((o) => row(o, false))}
        </Fold>
      ) : null}
    </Card>
  );
}

export default function WorkDetailScreen() {
  const c = usePalette();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready, state, cachedText, rawText, unlink } = useWork();
  const [panel, setPanel] = useState<"handoff" | "import" | null>(null);
  const [raw, setRaw] = useState<{ hash: string; text: string } | null>(null);
  // 화면을 연 시각 — 그 10분 전 이후에 바뀐 것만 위 카드로 보여 준다
  const [openedAt] = useState(() => Date.now());
  if (!ready) return <ActivityIndicator style={{ flex: 1, backgroundColor: c.bg }} color={c.muted} />;
  const item = state.items.find((i) => i.id === id);
  if (!item) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: 24 }}>
        <Text style={{ color: c.muted }}>{t("detail.notFound")}</Text>
      </View>
    );
  }
  const ws = state.manifest.workspaces.find((w) => w.id === item.workspaceId);
  const area = ws?.areas.find((a) => a.id === item.areaId);
  const sources = state.sources.filter((s) => item.sourceIds.includes(s.id));
  const latestChange = item.changes[0];
  const oldDecisions = item.decisions.filter((d) => d.status === "superseded" || d.status === "rejected");
  const confirmed = item.decisions.filter((d) => d.status === "confirmed");

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={PAGE}>
      <Stack.Screen
        options={{
          title: item.title,
          headerLeft: () => (
            <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/work"))} accessibilityRole="button" accessibilityLabel={t("common.back")} style={{ paddingHorizontal: 12 }}>
              <Ionicons name="chevron-back" size={24} color={c.text} />
            </Pressable>
          ),
        }}
      />
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 22, fontWeight: "800", color: c.text }}>{item.title}</Text>
        <Muted c={c}>
          {ws?.name} · {area?.name} · {t(`importance.${item.importance}`)}
          {item.due ? ` · ${t("work.dueOn", { due: item.due })}` : ""} · rev {item.rev}
        </Muted>
        <StatusStrip c={c} item={item} />
      </View>

      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Btn c={c} primary label={t("detail.continueWithAi")} onPress={() => setPanel(panel === "handoff" ? null : "handoff")} />
        <Btn c={c} label={t("detail.importResult")} onPress={() => setPanel(panel === "import" ? null : "import")} />
      </View>
      {panel !== "handoff" ? <DesktopRunLines c={c} itemId={item.id} /> : null}
      {panel === "handoff" ? <HandoffPanel c={c} item={item} onClose={() => setPanel(null)} /> : null}
      {panel === "import" ? <ImportPanel c={c} item={item} onClose={() => setPanel(null)} /> : null}
      {latestChange && openedAt - new Date(latestChange.at).getTime() < 10 * 60 * 1000 ? <ChangeCard c={c} item={item} change={latestChange} /> : null}

      <GoalCard key={`g${item.rev}`} c={c} item={item} />
      <StateCard key={`s${item.rev}`} c={c} item={item} />
      <ActionsCard c={c} item={item} />
      <OutputsCard c={c} item={item} />
      <ReviewCards c={c} item={item} />

      <Fold c={c} title={t("detail.sources")} count={sources.length}>
        {sources.map((s) => {
          const text = cachedText(s);
          return (
            <View key={s.id} style={{ gap: 4, backgroundColor: c.row, borderRadius: 10, padding: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Pressable style={{ flex: 1 }} onPress={() => (s.url ? void Linking.openURL(s.url) : undefined)} accessibilityRole={s.url ? "link" : "text"}>
                  <Text style={{ fontSize: 14, color: s.url ? c.accent : c.text }}>{s.title}</Text>
                </Pressable>
                <Pill c={c} label={t(`ingest.${s.ingest.status}`)} tone={s.ingest.status === "ok" ? "ok" : s.ingest.status === "unsupported" ? "muted" : "danger"} />
              </View>
              <Muted c={c}>
                {t(`provider.${s.provider}`)} · {t(`format.${s.format}`)}
                {s.remoteVersion && s.provider === "drive" ? ` · v${s.remoteVersion}` : ""}
                {s.workspaceId !== item.workspaceId ? ` · ${t("source.otherWorkspace", { workspace: state.manifest.workspaces.find((w) => w.id === s.workspaceId)?.name ?? "" })}` : ""}
              </Muted>
              {text ? (
                <Text numberOfLines={3} style={{ fontSize: 12, color: c.muted }}>
                  {text}
                </Text>
              ) : null}
              <View style={{ flexDirection: "row" }}>
                <Btn c={c} small label={t("source.unlink")} onPress={() => void unlink(item.id, s.id)} />
              </View>
            </View>
          );
        })}
        <SourcePicker c={c} item={item} />
      </Fold>

      <Fold c={c} title={t("detail.decisions")} count={confirmed.length + oldDecisions.length}>
        {confirmed.map((d) => (
          <View key={d.id} style={{ gap: 2 }}>
            <Text style={{ fontSize: 14, color: c.text }}>✓ {d.text}</Text>
            <Muted c={c}>
              {d.reason ? t("review.reason", { reason: d.reason }) : ""} {t(d.origin === "ai" ? "decision.byAiConfirmed" : "decision.byUser", { at: when(d.decidedAt) })}
            </Muted>
          </View>
        ))}
        {oldDecisions.map((d) => (
          <View key={d.id} style={{ gap: 2 }}>
            <Text style={{ fontSize: 13, color: c.muted, textDecorationLine: "line-through" }}>{d.text}</Text>
            <Muted c={c}>{t(`decision.status.${d.status}`)}</Muted>
          </View>
        ))}
      </Fold>

      <Fold c={c} title={t("detail.runs")} count={item.runs.length}>
        {[...item.runs].reverse().map((r) => (
          <View key={r.id} style={{ gap: 4, backgroundColor: c.row, borderRadius: 10, padding: 10 }}>
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: c.text }}>{t(`tool.${r.tool}`)}</Text>
              <Pill c={c} label={t(`run.status.${r.status}`)} tone={r.status === "imported" ? "ok" : r.status === "parse_failed" ? "danger" : "accent"} />
              <Muted c={c}>{when(r.finishedAt ?? r.startedAt)}</Muted>
            </View>
            {r.scope ? <Muted c={c}>{t("run.scope", { scope: r.scope })}</Muted> : null}
            {r.contextVersion ? <Muted c={c}>{t("run.context", { version: r.contextVersion, count: r.inputSourceIds.length })}</Muted> : null}
            {r.resultSummary ? <Text style={{ fontSize: 13, color: c.text }}>{r.resultSummary}</Text> : null}
            {r.done.length ? <Muted c={c}>{t("run.done", { list: r.done.join(" · ") })}</Muted> : null}
            {r.remaining.length ? <Muted c={c}>{t("run.remaining", { list: r.remaining.join(" · ") })}</Muted> : null}
            {r.rawHash ? (
              <Btn
                c={c}
                small
                label={raw?.hash === r.rawHash ? t("run.hideRaw") : t("run.showRaw")}
                onPress={async () => {
                  if (raw?.hash === r.rawHash) return setRaw(null);
                  setRaw({ hash: r.rawHash as string, text: (await rawText(r.rawHash as string)) ?? t("run.rawMissing") });
                }}
              />
            ) : null}
            {raw && raw.hash === r.rawHash ? (
              <Text selectable style={{ fontSize: 12, color: c.text, fontFamily: "monospace" }}>
                {raw.text}
              </Text>
            ) : null}
          </View>
        ))}
      </Fold>

      <Fold c={c} title={t("detail.history")} count={item.changes.length}>
        {item.changes.map((ch) => (
          <View key={ch.id} style={{ flexDirection: "row", gap: 8 }}>
            <Muted c={c}>{when(ch.at)}</Muted>
            <Text style={{ flex: 1, fontSize: 13, color: ch.undone ? c.muted : c.text, textDecorationLine: ch.undone ? "line-through" : "none" }}>{msgText(t, ch.msg)}</Text>
          </View>
        ))}
      </Fold>
    </ScrollView>
  );
}
