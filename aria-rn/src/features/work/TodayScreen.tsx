/**
 * 오늘 — 받은 것(인박스) 중심. 설계: docs/inbox-today.md
 *
 * 위에서 아래로: 범주 칩 → 입력란(묻지 않는다) → 받은 것 흐름(정리 대기 · 제안 있음 · 엮임)
 * → 판단이 필요해요 → 오늘 위키에 더해진 것 → 이어서 할 업무(한 줄씩, 위에 나온 업무는 뺀다).
 * 추천 · 마감은 업무 탭으로 옮겼다. 규칙은 전부 core(work.ts "받은 것" 절)에 있고 여기서는 부르기만 한다.
 */
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import {
  acceptTriage,
  continueItems,
  dismissSource,
  fileSource,
  fragmentState,
  inboxSources,
  itemsForSource,
  nextActions,
  pendingReview,
  rejectTriage,
  restoreSource,
  sourceTriage,
  staleSources,
  type Source,
  type TriageProposal,
  type WorkItem,
} from "../../../../packages/core/src/work.ts";
import { usePalette, type Palette } from "../../components/theme";
import { Btn, PAGE } from "../../components/ui";
import { useT } from "../../i18n";
import { ConflictPanel } from "./ConflictPanel";
import { Card, Field, H, Muted, Pill, when } from "./parts";
import { TriagePanel } from "./TriagePanel";
import { useWork } from "./WorkContext";

const DAY = 86400000;
const nowIso = () => new Date().toISOString();
const open = (id: string) => router.push({ pathname: "/work/[id]", params: { id } });
const isToday = (iso?: string | null) => !!iso && Date.now() - new Date(iso).getTime() < DAY;

/** 입력란 — 붙여 넣고 남기기, 끝. 범주는 위 칩으로 이미 골라져 있다 */
function Capture({ c }: { c: Palette }) {
  const t = useT();
  const { capture } = useWork();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const s = await capture(text);
    setBusy(false);
    setFailed(!s);
    if (s) setText("");
  };
  return (
    <Card c={c}>
      <Field c={c} value={text} onChangeText={setText} placeholder={t("inbox.placeholder")} accessibilityLabel={t("inbox.captureA11y")} multiline style={{ minHeight: 64 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 12, color: failed ? c.danger : c.muted }}>{failed ? t("source.saveFailed") : t("inbox.hint")}</Text>
        <Btn c={c} primary label={t("inbox.save")} busy={busy} disabled={!text.trim()} onPress={() => void save()} />
      </View>
    </Card>
  );
}

/** 이 조각을 이을 업무 고르기 — 손으로 잇기 · [다른 곳] 이 같이 쓴다 */
function ItemPicker({ c, items, onPick, onCancel }: { c: Palette; items: WorkItem[]; onPick: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  return (
    <View style={{ gap: 6 }}>
      <Muted c={c}>{items.length ? t("inbox.pickItem") : t("inbox.noItems")}</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {items.map((i) => (
          <Pressable key={i.id} onPress={() => onPick(i.id)} accessibilityRole="button" accessibilityLabel={i.title} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: c.soft }}>
            <Text style={{ fontSize: 12, color: c.text }}>{i.title}</Text>
          </Pressable>
        ))}
        <Btn c={c} small label={t("common.close")} onPress={onCancel} />
      </View>
    </View>
  );
}

function ProposalLine({ c, p, onAccept, onOther, onReject }: { c: Palette; p: TriageProposal; onAccept: () => void; onOther: () => void; onReject: () => void }) {
  const t = useT();
  const { state } = useWork();
  const target =
    p.kind === "file_source"
      ? t("inbox.toItem", { title: state.items.find((i) => i.id === p.itemId)?.title ?? "?" })
      : p.kind === "new_work"
        ? t("inbox.toNew", { title: p.title ?? "" })
        : t("inbox.toConcept", { concept: p.concept ?? "" });
  return (
    <View style={{ gap: 4, borderLeftWidth: 2, borderLeftColor: c.accent, paddingLeft: 8 }}>
      <Text style={{ fontSize: 13, color: c.text, fontWeight: "600" }}>→ {target}</Text>
      {p.note ? <Muted c={c}>{p.note}</Muted> : null}
      <Text style={{ fontSize: 11, color: p.flags?.length ? c.danger : c.muted }}>
        {p.tool ? `${t(`tool.${p.tool}`)} · ` : ""}
        {p.refs?.length ? t("inbox.refs", { refs: p.refs.join(", ") }) : t("inbox.noEvidence")}
      </Text>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <Btn c={c} small primary label={t("inbox.accept")} onPress={onAccept} />
        <Btn c={c} small label={t("inbox.elsewhere")} onPress={onOther} />
        <Btn c={c} small label={t("inbox.reject")} onPress={onReject} />
      </View>
    </View>
  );
}

/** 조각 하나 — 원문 · 출처 · 상태, 그리고 상태에 맞는 동작 */
function Fragment({ c, s }: { c: Palette; s: Source }) {
  const t = useT();
  const { state, applyTriage } = useWork();
  const [picking, setPicking] = useState<null | { proposalId?: string }>(null);
  const [note, setNote] = useState<string | null>(null);
  const st = fragmentState(s, state.manifest);
  const proposals = state.manifest.triage.filter((p) => p.status === "open" && p.sourceIds.includes(s.id));
  const linked = itemsForSource(state.items, s.id);
  const pickable = state.items.filter((i) => i.workspaceId === s.workspaceId && i.status !== "archived" && i.status !== "done");
  const origin = s.origin?.via === "mcp" ? t("inbox.origin.mcp", { tool: t(`tool.${s.origin.tool ?? "other"}`) }) : t(`inbox.origin.${s.origin?.via ?? "app"}`);
  const pill = { waiting: ["inbox.state.waiting", "muted"], proposed: ["inbox.state.proposed", "accent"], filed: ["inbox.state.filed", "ok"], dismissed: ["inbox.state.dismissed", "muted"] } as const;

  const report = (r: Awaited<ReturnType<typeof applyTriage>>) => setNote(r === "saved" ? null : t("source.saveFailed"));
  const accept = async (p: TriageProposal, itemId?: string) => {
    const r = acceptTriage(state, p.id, nowIso(), itemId ? { itemId } : {});
    if (r.kind === "needs_confirm") return setNote(t("inbox.crossConfirm"));
    if (r.kind === "gone") return setNote(t("inbox.gone"));
    report(await applyTriage(r));
    setPicking(null);
  };
  const pick = async (itemId: string) => {
    const p = picking?.proposalId ? proposals.find((x) => x.id === picking.proposalId) : null;
    if (p) return accept(p, itemId);
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    const r = fileSource(item, s, nowIso());
    if (r.kind === "needs_confirm") return setNote(t("inbox.crossConfirm"));
    report(await applyTriage({ items: [r.item], sources: [r.source] }));
    setPicking(null);
  };

  return (
    <View style={{ backgroundColor: c.row, borderRadius: 10, padding: 10, gap: 6, opacity: st === "dismissed" ? 0.6 : 1 }}>
      <Text numberOfLines={3} style={{ fontSize: 14, color: s.url ? c.accent : c.text }}>
        {s.text ?? s.url ?? s.title}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ flex: 1, fontSize: 12, color: c.muted }}>
          {origin} · {when(s.createdAt)}
        </Text>
        <Pill c={c} label={t(pill[st][0])} tone={pill[st][1]} />
      </View>

      {/* 엮인 뒤에도 남은 제안(개념 등)은 계속 보인다 — 숫자로만 남지 않게 */}
      {st !== "dismissed"
        ? proposals.map((p) => (
            <ProposalLine
              key={p.id}
              c={c}
              p={p}
              onAccept={() => void accept(p)}
              onOther={() => setPicking({ proposalId: p.id })}
              onReject={() => void applyTriage({ manifest: rejectTriage(state.manifest, p.id, nowIso()) }).then(report)}
            />
          ))
        : null}

      {st === "filed" ? (
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {linked.map((i) => (
            <Pressable key={i.id} onPress={() => open(i.id)} accessibilityRole="link">
              <Pill c={c} label={`[[${i.title}]]`} tone="accent" icon="briefcase-outline" />
            </Pressable>
          ))}
          {(s.concepts ?? []).map((x) => (
            <Pill key={x} c={c} label={`[[${x}]]`} tone="muted" />
          ))}
        </View>
      ) : null}

      {picking ? (
        <ItemPicker c={c} items={pickable} onPick={(id) => void pick(id)} onCancel={() => setPicking(null)} />
      ) : st === "waiting" || st === "proposed" ? (
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          <Btn c={c} small label={t("inbox.fileByHand")} onPress={() => setPicking({})} />
          <Btn c={c} small label={t("inbox.dismiss")} onPress={() => void applyTriage({ sources: [dismissSource(s, nowIso())] }).then(report)} />
        </View>
      ) : st === "dismissed" ? (
        <View style={{ flexDirection: "row" }}>
          <Btn c={c} small label={t("inbox.restore")} onPress={() => void applyTriage({ sources: [restoreSource(s, nowIso())] }).then(report)} />
        </View>
      ) : null}
      {note ? <Muted c={c} danger>{note}</Muted> : null}
    </View>
  );
}

export default function TodayScreen() {
  const c = usePalette();
  const t = useT();
  const { ready, state, workspaceId } = useWork();
  const [showAll, setShowAll] = useState(false);
  const [triaging, setTriaging] = useState(false);
  if (!ready) return <ActivityIndicator style={{ flex: 1, backgroundColor: c.bg }} color={c.muted} />;

  const inWs = state.items.filter((i) => i.workspaceId === workspaceId);
  const waiting = inboxSources(state, workspaceId);
  // 엮이거나 뺀 지 하루가 안 된 조각도 흐름에 남겨 "어디로 갔는지" 보여 준다(그 뒤엔 보관함 · 업무 상세에서)
  const recent = state.sources
    .filter((s) => s.workspaceId === workspaceId && s.triage != null && sourceTriage(s) !== "inbox" && isToday(s.updatedAt))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const stream = [...waiting, ...recent];
  const shown = showAll ? stream : stream.slice(0, 8);
  const triageOpen = state.manifest.triage.filter((p) => p.status === "open" && p.workspaceId === workspaceId).length;

  // 판단이 필요해요 — 업무의 제안 · 결정 제안 · 바뀐 자료
  const needs = inWs.map((i) => ({ item: i, review: pendingReview(i), stale: staleSources(i, state.sources).length })).filter((x) => x.review.proposals.length + x.review.decisions.length + x.stale > 0);

  // 오늘 위키에 더해진 것 — 업무별로 모은다
  const added = inWs
    .map((i) => {
      const frags = state.sources.filter((s) => i.sourceIds.includes(s.id) && s.triage === "filed" && isToday(s.updatedAt));
      const tasks = i.actions.filter((a) => isToday(a.createdAt)).length;
      const decisions = i.decisions.filter((d) => d.status === "confirmed" && isToday(d.decidedAt ?? d.createdAt)).length;
      const runs = i.runs.filter((r) => isToday(r.finishedAt)).length;
      const concepts = [...new Set(frags.flatMap((s) => s.concepts ?? []))];
      return { item: i, frags: frags.length, tasks, decisions, runs, concepts, total: frags.length + tasks + decisions + runs };
    })
    .filter((x) => x.total > 0);
  const looseConcepts = [...new Set(state.sources.filter((s) => s.workspaceId === workspaceId && s.triage === "filed" && isToday(s.updatedAt) && !itemsForSource(state.items, s.id).length).flatMap((s) => s.concepts ?? []))];

  // 이어서 할 업무 — 위에 이미 나온 업무는 뺀다(한 업무는 한 번)
  const seen = new Set([...needs.map((x) => x.item.id), ...added.map((x) => x.item.id)]);
  const cont = continueItems(state, workspaceId).filter((i) => !seen.has(i.id)).slice(0, 5);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={PAGE} keyboardShouldPersistTaps="handled">
      <ConflictPanel c={c} />
      <Capture c={c} />

      <Card c={c}>
        <H c={c} right={waiting.length ? <Pill c={c} label={t("inbox.waitingCount", { count: waiting.length })} tone="accent" /> : null}>
          {t("inbox.title")}
        </H>
        {triaging ? <TriagePanel c={c} onClose={() => setTriaging(false)} /> : waiting.length ? <Btn c={c} small label={t("triage.open")} onPress={() => setTriaging(true)} /> : null}
        {stream.length ? (
          shown.map((s) => <Fragment key={s.id} c={c} s={s} />)
        ) : (
          <Muted c={c}>{t("inbox.empty")}</Muted>
        )}
        {stream.length > shown.length || showAll ? <Btn c={c} small label={showAll ? t("today.less") : t("today.more", { count: stream.length - shown.length })} onPress={() => setShowAll(!showAll)} /> : null}
      </Card>

      {needs.length || triageOpen ? (
        <Card c={c} tone="attention">
          <H c={c}>{t("today.needsYou")}</H>
          {triageOpen ? <Muted c={c}>{t("inbox.needsTriage", { count: triageOpen })}</Muted> : null}
          {needs.map(({ item, review, stale }) => (
            <Pressable key={item.id} onPress={() => open(item.id)} accessibilityRole="link" style={{ gap: 2 }}>
              <Text style={{ fontSize: 14, color: c.text, fontWeight: "600" }}>{item.title}</Text>
              <Muted c={c}>{t("today.needsDetail", { proposals: review.proposals.length, decisions: review.decisions.length, stale })}</Muted>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {added.length || looseConcepts.length ? (
        <Card c={c}>
          <H c={c}>{t("inbox.addedToday")}</H>
          {added.map((x) => (
            <Pressable key={x.item.id} onPress={() => open(x.item.id)} accessibilityRole="link" style={{ gap: 4 }}>
              <Text style={{ fontSize: 14, color: c.text, fontWeight: "600" }}>{x.item.title}</Text>
              <Muted c={c}>{t("inbox.addedDetail", { frags: x.frags, tasks: x.tasks, decisions: x.decisions, runs: x.runs })}</Muted>
              {x.concepts.length ? (
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  {x.concepts.map((k) => (
                    <Pill key={k} c={c} label={`[[${k}]]`} tone="muted" />
                  ))}
                </View>
              ) : null}
            </Pressable>
          ))}
          {looseConcepts.length ? (
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {looseConcepts.map((k) => (
                <Pill key={k} c={c} label={`[[${k}]]`} tone="muted" />
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      {cont.length ? (
        <Card c={c}>
          <H c={c}>{t("today.continue")}</H>
          {cont.map((i) => (
            <Pressable key={i.id} onPress={() => open(i.id)} accessibilityRole="link" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Text numberOfLines={1} style={{ fontSize: 14, color: c.text, fontWeight: "600", flexShrink: 1 }}>
                {i.title}
              </Text>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: c.muted }}>
                {nextActions(i)[0] ? t("today.nextIs", { title: nextActions(i)[0].title }) : t("work.noNext")}
              </Text>
            </Pressable>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}
