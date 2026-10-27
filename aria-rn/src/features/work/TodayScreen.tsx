/**
 * 오늘 — 고른 범주(대주제)의 개요. 맨 위 페이지(소주제)마다 카드 하나: 하위 개수 + AI 가 쓴 요약 2~3줄. 목록은 늘어놓지 않는다(페이지 · 펼쳐 보기에서).
 *
 * 범주는 머리 드롭다운(WorkspaceSwitcher)으로 고른다. 요약 · 칸은 소주제의 목록 보기(core pageView.ts).
 * AI 보기 제안(요약 · 칸 · 하위 값)은 카드 위 띠에서 받기 · 빼기. 본문은 읽지 않는다 — 색인만.
 * 받은 것(입력란 · 조각 흐름)은 잠시 내렸다: InboxCard.tsx.
 */
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, useColorScheme, View } from "react-native";

import { openBodyProposals, type PageMeta } from "../../../../packages/core/src/pages.ts";
import { openViewProposals, overviewOf, rowCells, summaryOf, type ColumnKind, type ViewColumn, type ViewProposal } from "../../../../packages/core/src/pageView.ts";
import { usePalette, type Palette } from "../../components/theme";
import { Btn, PAGE } from "../../components/ui";
import { useT } from "../../i18n";
import LexicalViewer from "../editor/LexicalViewer";
import { ConflictPanel } from "./ConflictPanel";
import { pageLabel } from "./PageTree";
import { Card, H, Muted } from "./parts";
import { useWork } from "./WorkContext";

const SHOWN = 8;
const open = (id: string) => router.push({ pathname: "/work/[id]", params: { id } });

/** 한 줄 — 제목 다음 칸들(종류마다 색만 다르게). 넘치면 한 줄 안에서 잘린다 */
function Row({ c, p, columns, proposed }: { c: Palette; p: PageMeta; columns: ViewColumn[]; proposed: boolean }) {
  const t = useT();
  const cells = rowCells(p, columns);
  const color: Record<ColumnKind, string> = { status: c.accent, date: c.text, tag: c.muted, flag: c.ok, text: c.muted };
  return (
    <Pressable onPress={() => open(p.id)} accessibilityRole="link" style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 2 }}>
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, color: p.title ? c.text : c.muted, fontWeight: "600" }}>
        {pageLabel(p, t("page.untitled"))}
      </Text>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: c.muted }}>
        {cells.map((x, i) => (
          <Text key={x.key} style={{ color: color[x.kind], fontWeight: x.kind === "status" ? "600" : "400" }}>
            {i ? " · " : ""}
            {x.kind === "flag" ? `#${x.text}` : x.text}
          </Text>
        ))}
      </Text>
      {proposed ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.accent }} /> : null}
    </Pressable>
  );
}

/** 접어 두는 목록 — 처음 SHOWN 줄, 더 보기는 50줄씩 */
function Rows({ c, pages, columns, proposed }: { c: Palette; pages: PageMeta[]; columns: ViewColumn[]; proposed: Set<string> }) {
  const t = useT();
  const [n, setN] = useState(SHOWN);
  const shown = pages.slice(0, n);
  return (
    <>
      {shown.map((p) => (
        <Row key={p.id} c={c} p={p} columns={columns} proposed={proposed.has(p.id)} />
      ))}
      {pages.length > SHOWN ? (
        <View style={{ flexDirection: "row", gap: 6 }}>
          {n < pages.length ? <Btn c={c} small label={t("today.more", { count: Math.min(50, pages.length - n) })} onPress={() => setN(n + 50)} /> : null}
          {n > SHOWN ? <Btn c={c} small label={t("today.less")} onPress={() => setN(SHOWN)} /> : null}
        </View>
      ) : null}
    </>
  );
}

/** AI 보기 제안 띠 — 칸 · 채울 값 수 · 까닭 · 표시, 받기 · 빼기(사람만) */
function ViewBand({ c, p }: { c: Palette; p: ViewProposal }) {
  const t = useT();
  const { acceptView, rejectView } = useWork();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    setFailed(r !== "saved" && r !== "gone");
  };
  const cols = p.columns?.map((x) => x.label).join(" · ");
  return (
    <View style={{ gap: 4, borderLeftWidth: 2, borderLeftColor: c.accent, paddingLeft: 8 }}>
      <Text style={{ fontSize: 13, color: c.text, fontWeight: "600" }}>{p.summary ? t("today.summaryProposal") : cols ? t("today.viewProposal", { columns: cols }) : t("today.viewOnlyValues", { count: p.valueCount })}</Text>
      {p.summary ? <SummaryText c={c} markdown={p.summary.text} /> : null}
      {p.summary && cols ? <Muted c={c}>{t("today.viewProposal", { columns: cols })}</Muted> : null}
      {cols && p.valueCount ? <Muted c={c}>{t("today.viewValues", { count: p.valueCount })}</Muted> : null}
      {p.note ? <Muted c={c}>{p.note}</Muted> : null}
      {p.flags?.length ? <Muted c={c} danger>{t("today.viewFlags", { flags: p.flags.join(", ") })}</Muted> : null}
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Btn c={c} small primary label={t("today.viewAccept")} busy={busy} onPress={() => void run(() => acceptView(p.id))} />
        <Btn c={c} small label={t("today.viewReject")} disabled={busy} onPress={() => void run(() => rejectView(p.id))} />
      </View>
      {failed ? <Muted c={c} danger>{t("today.viewFailed")}</Muted> : null}
    </View>
  );
}

/** 요약 — 마크다운(편집기와 같은 규칙: 글머리 · **굵게** · 링크 …)을 읽기 전용 뷰어로 */
function SummaryText({ c, markdown }: { c: Palette; markdown: string }) {
  const dark = useColorScheme() === "dark";
  return <LexicalViewer palette={c} dark={dark} markdown={markdown} compact dom={{ style: { width: "100%" }, scrollEnabled: false }} />;
}

/** 개수 + 요약 2~3줄. 요약이 없으면 받는 길을, 요약 뒤 하위 수가 바뀌었으면 그 사실을 */
function Summary({ c, g, kids, pending }: { c: Palette; g: PageMeta; kids: PageMeta[]; pending: boolean }) {
  const t = useT();
  const s = summaryOf(g, kids);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, color: c.muted }}>
        {s.unit ?? t("today.unit")} <Text style={{ fontSize: 22, fontWeight: "700", color: c.text }}>{s.count}</Text>
        {t("today.counter")}
      </Text>
      {s.text ? <SummaryText c={c} markdown={s.text} /> : pending ? null : <Muted c={c}>{t("today.noSummary")}</Muted>}
      {s.stale ? <Muted c={c}>{t("today.summaryStale", { from: g.view?.summary?.count ?? 0, to: s.count })}</Muted> : null}
    </View>
  );
}

export default function TodayScreen() {
  const c = usePalette();
  const t = useT();
  const { ready, state, workspaceId } = useWork();
  if (!ready) return <ActivityIndicator style={{ flex: 1, backgroundColor: c.bg }} color={c.muted} />;

  const views = openViewProposals(state.manifest).filter((p) => p.workspaceId === workspaceId);
  const { groups, loose } = overviewOf(state.pages, workspaceId, new Set(views.map((v) => v.pageId)));
  const proposed = new Set(openBodyProposals(state.manifest).filter((p) => p.workspaceId === workspaceId).map((p) => p.pageId));

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={PAGE} keyboardShouldPersistTaps="handled">
      <ConflictPanel c={c} />

      {groups.map((g) => (
        <Card key={g.page.id} c={c}>
          <Pressable onPress={() => open(g.page.id)} accessibilityRole="link" accessibilityLabel={t("today.openPage", { title: g.page.title })}>
            <H c={c}>{pageLabel(g.page, t("page.untitled"))}</H>
          </Pressable>
          {views
            .filter((v) => v.pageId === g.page.id)
            .map((v) => (
              <ViewBand key={v.id} c={c} p={v} />
            ))}
          <Summary c={c} g={g.page} kids={g.children} pending={views.some((v) => v.pageId === g.page.id)} />
        </Card>
      ))}

      {loose.length ? (
        <Card c={c}>
          <H c={c}>{t("today.loose")}</H>
          <Rows c={c} pages={loose} columns={[]} proposed={proposed} />
        </Card>
      ) : null}

      {!groups.length && !loose.length ? (
        <Card c={c}>
          <Muted c={c}>{t("today.empty")}</Muted>
        </Card>
      ) : null}
    </ScrollView>
  );
}
