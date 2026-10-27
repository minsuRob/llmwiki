/**
 * 오늘 — 고른 범주(대주제)의 개요. 맨 위 페이지(중간주제)마다 카드 하나, 그 하위를 한 줄씩(제목 + 속성 몇 개).
 *
 * 범주는 머리 드롭다운(WorkspaceSwitcher)으로 고른다. 무엇을 어떤 순서로 보일지는 core pageQuery.ts(overviewOf · rowProps)가 정한다.
 * 본문은 읽지 않는다 — 색인만. 받은 것(입력란 · 조각 흐름)은 잠시 내렸다: InboxCard.tsx.
 */
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { overviewOf, rowProps } from "../../../../packages/core/src/pageQuery.ts";
import { openBodyProposals, type PageMeta } from "../../../../packages/core/src/pages.ts";
import { usePalette, type Palette } from "../../components/theme";
import { Btn, PAGE } from "../../components/ui";
import { useT } from "../../i18n";
import { ConflictPanel } from "./ConflictPanel";
import { pageLabel } from "./PageTree";
import { Card, H, Muted, Pill } from "./parts";
import { useWork } from "./WorkContext";

const SHOWN = 8;
const open = (id: string) => router.push({ pathname: "/work/[id]", params: { id } });

/** 한 줄 — 제목 · 속성 값(keys 순서) · 본문 제안 점. 넘치면 한 줄 안에서 잘린다 */
function Row({ c, p, keys, proposed }: { c: Palette; p: PageMeta; keys: string[]; proposed: boolean }) {
  const t = useT();
  const props = rowProps(p, keys).join(" · ");
  return (
    <Pressable onPress={() => open(p.id)} accessibilityRole="link" style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 2 }}>
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, color: p.title ? c.text : c.muted, fontWeight: "600" }}>
        {pageLabel(p, t("page.untitled"))}
      </Text>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: c.muted }}>
        {props}
      </Text>
      {proposed ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.accent }} /> : null}
    </Pressable>
  );
}

/** 접어 두는 목록 — 처음 SHOWN 줄, 더 보기로 펼친다 */
function Rows({ c, pages, keys, proposed }: { c: Palette; pages: PageMeta[]; keys: string[]; proposed: Set<string> }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? pages : pages.slice(0, SHOWN);
  return (
    <>
      {shown.map((p) => (
        <Row key={p.id} c={c} p={p} keys={keys} proposed={proposed.has(p.id)} />
      ))}
      {pages.length > SHOWN ? <Btn c={c} small label={all ? t("today.less") : t("today.more", { count: pages.length - shown.length })} onPress={() => setAll(!all)} /> : null}
    </>
  );
}

export default function TodayScreen() {
  const c = usePalette();
  const t = useT();
  const { ready, state, workspaceId } = useWork();
  if (!ready) return <ActivityIndicator style={{ flex: 1, backgroundColor: c.bg }} color={c.muted} />;

  const { groups, loose } = overviewOf(state.pages, workspaceId);
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
          <Rows c={c} pages={g.children} keys={g.keys} proposed={proposed} />
        </Card>
      ))}

      {loose.length ? (
        <Card c={c}>
          <H c={c}>{t("today.loose")}</H>
          <Rows c={c} pages={loose} keys={[]} proposed={proposed} />
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
