/**
 * 펼쳐 보기 — 하위 페이지를 한 문서처럼 이어 읽는다(공고 500개). 목차 · 거르기 · 표는 색인(제목 · 작은 값)만으로,
 * 본문은 보이는 줄 근처만 읽는다(같은 묶음은 한 번 — WorkRepo.readBodies). 제목을 누르면 그 페이지로.
 * '한 문서로 내보내기'는 거른 페이지 본문을 '# 제목' 으로 이어 .md 하나로.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, useColorScheme, View, type ViewToken } from "react-native";

import { childrenOf, type PageMeta } from "../../../../packages/core/src/pages.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import LexicalViewer from "../editor/LexicalViewer";
import { exportFile } from "./io";
import { pageLabel } from "./PageTree";
import { Field, Muted } from "./parts";
import { useWork } from "./WorkContext";

/** 보이는 줄 앞뒤로 이만큼 더 읽어 둔다 */
const AHEAD = 6;
const MAX_COLS = 5;

export function ExpandedView({ c, page, onSelect }: { c: Palette; page: PageMeta; onSelect: (id: string) => void }) {
  const t = useT();
  const dark = useColorScheme() === "dark";
  const { state, readBodies } = useWork();
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"list" | "table">("list");
  const [bodies, setBodies] = useState<Map<string, string>>(() => new Map());
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(new Set<string>());
  const all = useMemo(() => childrenOf(state.pages, page.workspaceId, page.id), [state.pages, page.workspaceId, page.id]);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    return all.filter((p) => words.every((w) => `${p.title} ${Object.values(p.props ?? {}).join(" ")}`.toLowerCase().includes(w)));
  }, [all, q]);
  const cols = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of shown) for (const k of Object.keys(p.props ?? {})) count.set(k, (count.get(k) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]).slice(0, MAX_COLS).map(([k]) => k);
  }, [shown]);

  const load = useCallback(
    (metas: PageMeta[]) => {
      const want = metas.filter((m) => !asked.current.has(m.id));
      if (!want.length) return;
      want.forEach((m) => asked.current.add(m.id));
      void readBodies(want).then((got) => setBodies((prev) => new Map([...prev, ...got])));
    },
    [readBodies],
  );
  // 보이는 줄이 바뀔 때 부르는 함수는 FlatList 가 처음 것만 쓴다 — 지금 값은 ref 로
  const loadRef = useRef(load);
  const shownRef = useRef(shown);
  useEffect(() => {
    loadRef.current = load;
    shownRef.current = shown;
  });
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: ViewToken<PageMeta>[] }) => {
    const idx = viewableItems.map((v) => v.index ?? 0);
    if (!idx.length) return;
    loadRef.current(shownRef.current.slice(Math.max(0, Math.min(...idx) - 1), Math.max(...idx) + AHEAD));
  });

  const exportAll = async () => {
    setBusy(true);
    const got = await readBodies(shown);
    const md = [`# ${page.title}`, "", ...shown.flatMap((p) => [`## ${p.title}`, "", got.get(p.id) ?? "", ""])].join("\n");
    setBusy(false);
    setNote((await exportFile(`${page.title || t("page.untitled")}.md`, md)) ? t("expanded.exported") : t("expanded.exportFailed"));
  };

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <Btn c={c} small primary={mode === "list"} label={t("expanded.list")} onPress={() => setMode("list")} />
        <Btn c={c} small primary={mode === "table"} label={t("expanded.table")} onPress={() => setMode("table")} />
        <Btn c={c} small label={t("expanded.export")} busy={busy} onPress={() => void exportAll()} />
        <Muted c={c}>{t("expanded.count", { shown: shown.length, total: all.length })}</Muted>
      </View>
      <Field c={c} value={q} onChangeText={setQ} placeholder={t("expanded.filter")} accessibilityLabel={t("expanded.filter")} />
      {note ? <Muted c={c}>{note}</Muted> : null}
      {mode === "table" ? (
        <ScrollView horizontal style={{ maxHeight: 560 }}>
          <FlatList
            data={shown}
            keyExtractor={(p) => p.id}
            nestedScrollEnabled
            style={{ maxHeight: 560 }}
            ListHeaderComponent={
              <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: 6 }}>
                <Text style={{ width: 320, fontSize: 12, fontWeight: "700", color: c.muted }}>{t("expanded.title")}</Text>
                {cols.map((k) => (
                  <Text key={k} style={{ width: 140, fontSize: 12, fontWeight: "700", color: c.muted }}>
                    {k}
                  </Text>
                ))}
              </View>
            }
            renderItem={({ item: p }) => (
              <Pressable onPress={() => onSelect(p.id)} accessibilityRole="link" style={{ flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border }}>
                <Text numberOfLines={1} style={{ width: 320, fontSize: 13, color: c.text, paddingRight: 8 }}>
                  {pageLabel(p, t("page.untitled"))}
                </Text>
                {cols.map((k) => (
                  <Text key={k} numberOfLines={1} style={{ width: 140, fontSize: 12, color: c.muted, paddingRight: 8 }}>
                    {p.props?.[k] ?? ""}
                  </Text>
                ))}
              </Pressable>
            )}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(p) => p.id}
          nestedScrollEnabled
          style={{ maxHeight: 720 }}
          initialNumToRender={6}
          windowSize={5}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 1 }}
          onLayout={() => load(shown.slice(0, AHEAD))}
          renderItem={({ item: p }) => {
            const body = bodies.get(p.id);
            return (
              <View style={{ gap: 4, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
                <Pressable onPress={() => onSelect(p.id)} accessibilityRole="link">
                  <Text style={{ fontSize: 17, fontWeight: "700", color: c.text }}>{pageLabel(p, t("page.untitled"))}</Text>
                </Pressable>
                {p.props ? <Muted c={c}>{Object.entries(p.props).map(([k, v]) => `${k} ${v}`).join(" · ")}</Muted> : null}
                {body == null ? <Muted c={c}>{t("expanded.loading")}</Muted> : <LexicalViewer palette={c} dark={dark} markdown={body} dom={{ style: { width: "100%" }, scrollEnabled: false }} />}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
