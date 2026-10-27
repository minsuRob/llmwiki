/**
 * 오늘 — 고른 범주(대주제)의 개요. 맨 위 페이지(소주제)마다 카드 하나, 그 하위를 한 줄씩.
 *
 * 범주는 머리 드롭다운(WorkspaceSwitcher)으로 고른다. 칸은 소주제의 목록 보기(core pageView.ts) — 정한 보기가 없으면 값 모양으로 짐작.
 * AI 보기 제안(칸 · 하위 값)은 카드 위 띠에서 받기 · 빼기. 본문은 읽지 않는다 — 색인만.
 * 받은 것(입력란 · 조각 흐름)은 잠시 내렸다: InboxCard.tsx.
 */
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { openBodyProposals, type PageMeta } from "../../../../packages/core/src/pages.ts";
import { openViewProposals, overviewOf, rowCells, type ColumnKind, type ViewColumn, type ViewProposal } from "../../../../packages/core/src/pageView.ts";
import { usePalette, type Palette } from "../../components/theme";
import { Btn, PAGE } from "../../components/ui";
import { useT } from "../../i18n";
import { ConflictPanel } from "./ConflictPanel";
import { pageLabel } from "./PageTree";
import { Card, H, Muted, Pill } from "./parts";
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
      <Text style={{ fontSize: 13, color: c.text, fontWeight: "600" }}>{cols ? t("today.viewProposal", { columns: cols }) : t("today.viewOnlyValues", { count: p.valueCount })}</Text>
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
            <H c={c} right={<Pill c={c} label={String(g.children.length)} tone="muted" />}>
              {pageLabel(g.page, t("page.untitled"))}
            </H>
          </Pressable>
          {views
            .filter((v) => v.pageId === g.page.id)
            .map((v) => (
              <ViewBand key={v.id} c={c} p={v} />
            ))}
          {g.guessed && g.children.length ? <Muted c={c}>{t("today.guessed")}</Muted> : null}
          {!g.children.length && g.columns.length ? <Muted c={c}>{t("today.noChildren", { columns: g.columns.map((x) => x.label).join(" · ") })}</Muted> : null}
          <Rows c={c} pages={g.children} columns={g.columns} proposed={proposed} />
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
