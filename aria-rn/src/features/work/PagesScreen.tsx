/**
 * 페이지 탭 — 폭이 900 이상이면 왼쪽 트리(280px) + 오른쪽 페이지, 좁으면 트리 → 페이지(/work/[id]).
 * /work/[id] 로 들어와도 넓은 화면이면 같은 나눈 화면에서 그 페이지를 고른 채로 연다.
 */
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, useWindowDimensions, View } from "react-native";

import { usePalette } from "../../components/theme";
import { useT } from "../../i18n";
import { PageScreen } from "./PageScreen";
import { PageTree } from "./PageTree";
import { Muted } from "./parts";
import { useWork } from "./WorkContext";

const WIDE = 900;
const TREE = 280;

export const isWide = (width: number) => width >= WIDE;

export default function PagesScreen({ initialId }: { initialId?: string | null }) {
  const c = usePalette();
  const t = useT();
  const { width } = useWindowDimensions();
  const { ready, state, workspaceId, setWorkspaceId } = useWork();
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  // 다른 주제의 페이지로 들어오면 머리의 주제도 그쪽으로
  const page = state.pages.find((p) => p.id === selected);
  useEffect(() => {
    if (page && page.workspaceId !== workspaceId) setWorkspaceId(page.workspaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.workspaceId]);
  if (!ready) return <ActivityIndicator style={{ flex: 1, backgroundColor: c.bg }} color={c.muted} />;
  const wide = isWide(width);
  const open = (id: string) => (wide ? setSelected(id) : router.push({ pathname: "/work/[id]", params: { id } }));
  const shown = page && page.workspaceId === workspaceId && !page.trashedAt ? page.id : null;
  if (!wide)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: 12 }}>
        <PageTree c={c} selectedId={null} onSelect={open} />
      </View>
    );
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: c.bg }}>
      <View style={{ width: TREE, borderRightWidth: 1, borderRightColor: c.border, backgroundColor: c.surface, padding: 10 }}>
        <PageTree c={c} selectedId={shown} onSelect={open} />
      </View>
      <View style={{ flex: 1 }}>{shown ? <PageScreen id={shown} onSelect={open} /> : <View style={{ padding: 24 }}><Muted c={c}>{t("page.none")}</Muted></View>}</View>
    </View>
  );
}

/** /work/[id] — 좁으면 페이지 하나, 넓으면 나눈 화면 */
export function PageRoute({ id }: { id: string }) {
  const { width } = useWindowDimensions();
  // key — 다른 페이지 링크로 오면 고른 페이지를 새로
  if (isWide(width)) return <PagesScreen key={id} initialId={id} />;
  return <PageScreen id={id} onSelect={(next) => router.push({ pathname: "/work/[id]", params: { id: next } })} onBack={() => (router.canGoBack() ? router.back() : router.replace("/work"))} />;
}
