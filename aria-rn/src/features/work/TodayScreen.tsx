/**
 * 오늘 — 받은 것(인박스) 중심. 설계: docs/inbox-today.md
 *
 * 위에서 아래로: 입력란(묻지 않는다) → 받은 것 흐름(정리 대기 · 제안 있음 · 엮임) → 최근 바뀐 페이지(위 10개).
 * 규칙은 전부 core(work.ts "받은 것" 절 · pages.ts)에 있고 여기서는 부르기만 한다.
 */
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { openBodyProposals, pageOf, pagesForSource, recentPages } from "../../../../packages/core/src/pages.ts";
import { dismissSource, fragmentState, inboxSources, rejectTriage, restoreSource, sourceTriage, type Source, type TriageProposal } from "../../../../packages/core/src/work.ts";
import { usePalette, type Palette } from "../../components/theme";
import { Btn, PAGE } from "../../components/ui";
import { useT } from "../../i18n";
import { ConflictPanel } from "./ConflictPanel";
import { PagePicker, pageLabel } from "./PageTree";
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

function ProposalLine({ c, p, onAccept, onOther, onReject }: { c: Palette; p: TriageProposal; onAccept: () => void; onOther: () => void; onReject: () => void }) {
  const t = useT();
  const { state } = useWork();
  const parent = pageOf(state.pages, p.parentId);
  const target =
    p.kind === "file_source"
      ? t("inbox.toItem", { title: pageOf(state.pages, p.itemId)?.title ?? "?" })
      : p.kind === "concept_link"
        ? t("inbox.toConcept", { concept: p.concept ?? "" })
        : parent
          ? t("inbox.toNewUnder", { title: p.title ?? "", parent: parent.title })
          : t("inbox.toNew", { title: p.title ?? "" });
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
  const { state, applyTriage, acceptTriage, linkExisting } = useWork();
  const [picking, setPicking] = useState<null | { proposalId?: string }>(null);
  const [note, setNote] = useState<string | null>(null);
  const st = fragmentState(s, state.manifest);
  const proposals = state.manifest.triage.filter((p) => p.status === "open" && p.sourceIds.includes(s.id));
  const linked = pagesForSource(state.pages, s.id);
  const origin = s.origin?.via === "mcp" ? t("inbox.origin.mcp", { tool: t(`tool.${s.origin.tool ?? "other"}`) }) : t(`inbox.origin.${s.origin?.via ?? "app"}`);
  const pill = { waiting: ["inbox.state.waiting", "muted"], proposed: ["inbox.state.proposed", "accent"], filed: ["inbox.state.filed", "ok"], dismissed: ["inbox.state.dismissed", "muted"] } as const;

  const report = (r: Awaited<ReturnType<typeof applyTriage>>) => setNote(r === "saved" ? null : t("source.saveFailed"));
  const accept = async (p: TriageProposal, pageId?: string) => {
    const r = await acceptTriage(p.id, pageId ? { pageId } : {});
    if (r === "needs_confirm") return setNote(t("inbox.crossConfirm"));
    if (r === "gone") return setNote(t("inbox.gone"));
    setNote(r === "saved" ? null : t("source.saveFailed"));
    setPicking(null);
  };
  const pick = async (pageId: string) => {
    const p = picking?.proposalId ? proposals.find((x) => x.id === picking.proposalId) : null;
    if (p) return accept(p, pageId);
    const r = await linkExisting(pageId, s.id);
    if (r === "needs_confirm") return setNote(t("inbox.crossConfirm"));
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
          {linked.map((p) => (
            <Pressable key={p.id} onPress={() => open(p.id)} accessibilityRole="link">
              <Pill c={c} label={`[[${p.title}]]`} tone="accent" icon="document-text-outline" />
            </Pressable>
          ))}
          {(s.concepts ?? []).map((x) => (
            <Pill key={x} c={c} label={`[[${x}]]`} tone="muted" />
          ))}
        </View>
      ) : null}

      {picking ? (
        <PagePicker c={c} workspaceId={s.workspaceId} onPick={(id) => void pick(id)} onCancel={() => setPicking(null)} />
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

  const waiting = inboxSources(state, workspaceId);
  // 엮이거나 뺀 지 하루가 안 된 조각도 흐름에 남겨 "어디로 갔는지" 보여 준다(그 뒤엔 보관함 · 페이지에서)
  const recent = state.sources
    .filter((s) => s.workspaceId === workspaceId && s.triage != null && sourceTriage(s) !== "inbox" && isToday(s.updatedAt))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const stream = [...waiting, ...recent];
  const shown = showAll ? stream : stream.slice(0, 8);
  const triageOpen = state.manifest.triage.filter((p) => p.status === "open" && p.workspaceId === workspaceId).length;
  const pages = recentPages(state.pages, workspaceId, 10);
  const proposals = openBodyProposals(state.manifest).filter((p) => p.workspaceId === workspaceId);
  const proposed = new Set(proposals.map((p) => p.pageId));

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={PAGE} keyboardShouldPersistTaps="handled">
      <ConflictPanel c={c} />
      <Capture c={c} />

      <Card c={c}>
        <H c={c} right={waiting.length ? <Pill c={c} label={t("inbox.waitingCount", { count: waiting.length })} tone="accent" /> : null}>
          {t("inbox.title")}
        </H>
        {triageOpen ? <Muted c={c}>{t("inbox.needsTriage", { count: triageOpen })}</Muted> : null}
        {triaging ? <TriagePanel c={c} onClose={() => setTriaging(false)} /> : waiting.length ? <Btn c={c} small label={t("triage.open")} onPress={() => setTriaging(true)} /> : null}
        {stream.length ? (
          shown.map((s) => <Fragment key={s.id} c={c} s={s} />)
        ) : (
          <Muted c={c}>{t("inbox.empty")}</Muted>
        )}
        {stream.length > shown.length || showAll ? <Btn c={c} small label={showAll ? t("today.less") : t("today.more", { count: stream.length - shown.length })} onPress={() => setShowAll(!showAll)} /> : null}
      </Card>

      <Card c={c}>
        <H c={c}>{t("today.recentPages")}</H>
        {proposals.length ? <Muted c={c}>{t("today.proposalsWaiting", { count: proposals.length })}</Muted> : null}
        {pages.length ? (
          pages.map((p) => (
            <Pressable key={p.id} onPress={() => open(p.id)} accessibilityRole="link" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: p.title ? c.text : c.muted, fontWeight: "600" }}>
                {pageLabel(p, t("page.untitled"))}
              </Text>
              {proposed.has(p.id) ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.accent }} /> : null}
              <Text style={{ fontSize: 12, color: c.muted }}>{when(p.updatedAt)}</Text>
            </Pressable>
          ))
        ) : (
          <Muted c={c}>{t("today.noRecent")}</Muted>
        )}
      </Card>
    </ScrollView>
  );
}
