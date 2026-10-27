/**
 * 펼쳐 보기 — 하위 페이지를 한 문서처럼 이어 읽는다(공고 500개든 무엇이든). 거르기 · 정렬은 core pageQuery.ts 그대로:
 * 낱말(제목 · 작은 값, 켜면 본문까지) · 값 고르기 칩(값이 적은 작은 값) · 날짜 '지난 것 빼기' · 아무 키로 정렬.
 * 본문은 보이는 줄 근처만 읽는다(같은 묶음은 한 번 — WorkRepo.readBodies). 제목을 누르면 그 페이지로.
 * 거른 조건(query)은 부르는 쪽(PageScreen)이 들고 있다 — 'AI 에게 맡기기'가 같은 하위만 넣게.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, useColorScheme, View, type ViewToken } from "react-native";

import { childrenOf, type PageMeta } from "../../../../packages/core/src/pages.ts";
import { facetsOf, queryPages, type Facet, type PageQuery } from "../../../../packages/core/src/pageQuery.ts";
import { viewOf } from "../../../../packages/core/src/pageView.ts";
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
/** 처음에 보이는 고르기 줄 수 */
const FACETS_SHOWN = 4;

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 이 페이지의 하위를 조건대로 — 펼쳐 보기와 AI 에게 맡기기가 같이 쓴다 */
export function useChildren(page: PageMeta, query: PageQuery, bodies?: Map<string, string>) {
  const { state } = useWork();
  const all = useMemo(() => childrenOf(state.pages, page.workspaceId, page.id), [state.pages, page.workspaceId, page.id]);
  const shown = useMemo(() => queryPages(all, query, bodies ? (p) => bodies.get(p.id) : undefined), [all, query, bodies]);
  return { all, shown };
}

const Chip = ({ c, label, on, onPress }: { c: Palette; label: string; on: boolean; onPress: () => void }) => (
  <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: on ? c.accent : c.soft }}>
    <Text style={{ fontSize: 12, color: on ? c.accentText : c.text }}>{label}</Text>
  </Pressable>
);

function Filters({ c, facets, query, setQuery, bodySearch, setBodySearch }: { c: Palette; facets: Facet[]; query: PageQuery; setQuery: (q: PageQuery) => void; bodySearch: boolean; setBodySearch: (v: boolean) => void }) {
  const t = useT();
  const [more, setMore] = useState(false);
  const enums = facets.filter((f) => f.kind === "enum");
  const dates = facets.filter((f) => f.kind === "date");
  const toggle = (key: string, value: string) => {
    const cur = query.where?.[key] ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    setQuery({ ...query, where: { ...query.where, [key]: next } });
  };
  const sortKeys = ["order", "title", "updatedAt", ...facets.map((f) => f.key)];
  const sortLabel = (k: string) => (k === "order" ? t("expanded.sortOrder") : k === "title" ? t("expanded.title") : k === "updatedAt" ? t("expanded.sortUpdated") : k);
  const sort = query.sort ?? { key: "order", dir: "asc" as const };
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Field c={c} value={query.text ?? ""} onChangeText={(v) => setQuery({ ...query, text: v })} placeholder={t("expanded.filter")} accessibilityLabel={t("expanded.filter")} />
        </View>
        <Chip c={c} label={t("expanded.bodyToo")} on={bodySearch} onPress={() => setBodySearch(!bodySearch)} />
      </View>
      {(more ? enums : enums.slice(0, FACETS_SHOWN)).map((f) => (
        <ScrollView key={f.key} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: "center" }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: c.muted, minWidth: 64 }}>{f.key}</Text>
          {f.values.map((v) => (
            <Chip key={v.value} c={c} label={`${v.value} ${v.count}`} on={!!query.where?.[f.key]?.includes(v.value)} onPress={() => toggle(f.key, v.value)} />
          ))}
        </ScrollView>
      ))}
      {enums.length > FACETS_SHOWN ? <Btn c={c} small label={more ? t("expanded.lessFilters") : t("expanded.moreFilters", { count: enums.length - FACETS_SHOWN })} onPress={() => setMore(!more)} /> : null}
      {dates.length ? (
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {dates.map((f) => {
            const on = !!query.from?.[f.key];
            return <Chip key={f.key} c={c} label={t("expanded.pastOff", { key: f.key })} on={on} onPress={() => setQuery({ ...query, from: { ...query.from, [f.key]: on ? "" : todayStr() } })} />;
          })}
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: "center" }}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: c.muted }}>{t("expanded.sort")}</Text>
        {sortKeys.map((k) => {
          const on = sort.key === k;
          return <Chip key={k} c={c} label={`${sortLabel(k)}${on ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}`} on={on} onPress={() => setQuery({ ...query, sort: { key: k, dir: on && sort.dir === "asc" ? "desc" : "asc" } })} />;
        })}
      </ScrollView>
    </View>
  );
}

export function ExpandedView({ c, page, query, setQuery, onSelect }: { c: Palette; page: PageMeta; query: PageQuery; setQuery: (q: PageQuery) => void; onSelect: (id: string) => void }) {
  const t = useT();
  const dark = useColorScheme() === "dark";
  const { readBodies } = useWork();
  const [mode, setMode] = useState<"list" | "table">("list");
  const [bodies, setBodies] = useState<Map<string, string>>(() => new Map());
  const [bodySearch, setBodySearch] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(new Set<string>());
  const { all, shown } = useChildren(page, query, bodySearch ? bodies : undefined);
  const facets = useMemo(() => facetsOf(all), [all]);
  // 소주제 보기의 칸이 앞(그 이름으로), 나머지 속성은 뒤에
  const view = useMemo(() => viewOf(page, all).columns, [page, all]);
  const labels = new Map(view.map((v) => [v.key, v.label]));
  const cols = [...view.map((v) => v.key), ...facets.map((f) => f.key).filter((k) => !labels.has(k))];
  const filtered = shown.length !== all.length;

  const load = useCallback(
    (metas: PageMeta[]) => {
      const want = metas.filter((m) => !asked.current.has(m.id));
      if (!want.length) return Promise.resolve();
      want.forEach((m) => asked.current.add(m.id));
      return readBodies(want).then((got) => setBodies((prev) => new Map([...prev, ...got])));
    },
    [readBodies],
  );
  // 본문까지 찾기 — 하위 본문을 한 번 다 읽는다(묶음 단위라 요청은 몇 번뿐)
  useEffect(() => {
    if (!bodySearch || allLoaded) return;
    void load(all).then(() => setAllLoaded(true));
  }, [bodySearch, allLoaded, all, load]);

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
    void loadRef.current(shownRef.current.slice(Math.max(0, Math.min(...idx) - 1), Math.max(...idx) + AHEAD));
  });

  const exportAll = async () => {
    setBusy(true);
    const got = await readBodies(shown);
    const md = [`# ${page.title}`, "", ...shown.flatMap((p) => [`## ${p.title}`, "", got.get(p.id) ?? "", ""])].join("\n");
    setBusy(false);
    setNote((await exportFile(`${page.title || t("page.untitled")}.md`, md)) ? t("expanded.exported") : t("expanded.exportFailed"));
  };
  const sortBy = (k: string) => setQuery({ ...query, sort: { key: k, dir: query.sort?.key === k && query.sort.dir === "asc" ? "desc" : "asc" } });

  return (
    <View style={{ gap: 8 }}>
      <Filters c={c} facets={facets} query={query} setQuery={setQuery} bodySearch={bodySearch} setBodySearch={setBodySearch} />
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <Btn c={c} small primary={mode === "list"} label={t("expanded.list")} onPress={() => setMode("list")} />
        <Btn c={c} small primary={mode === "table"} label={t("expanded.table")} onPress={() => setMode("table")} />
        <Btn c={c} small label={t("expanded.export")} busy={busy} onPress={() => void exportAll()} />
        <Muted c={c}>{t("expanded.count", { shown: shown.length, total: all.length })}</Muted>
        {filtered || query.sort ? <Btn c={c} small label={t("expanded.clear")} onPress={() => setQuery({})} /> : null}
        {bodySearch && !allLoaded ? <Muted c={c}>{t("expanded.loading")}</Muted> : null}
      </View>
      {note ? <Muted c={c}>{note}</Muted> : null}
      {!shown.length ? <Muted c={c}>{t("expanded.none")}</Muted> : null}
      {mode === "table" ? (
        <ScrollView horizontal style={{ maxHeight: 600 }}>
          <FlatList
            data={shown}
            keyExtractor={(p) => p.id}
            nestedScrollEnabled
            style={{ maxHeight: 600 }}
            ListHeaderComponent={
              <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: 6 }}>
                {["title", ...cols].map((k) => (
                  <Pressable key={k} onPress={() => sortBy(k)} accessibilityRole="button" style={{ width: k === "title" ? 320 : 140, paddingRight: 8 }}>
                    <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "700", color: query.sort?.key === k ? c.accent : c.muted }}>
                      {k === "title" ? t("expanded.title") : (labels.get(k) ?? k)}
                      {query.sort?.key === k ? (query.sort.dir === "asc" ? " ↑" : " ↓") : ""}
                    </Text>
                  </Pressable>
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
          onLayout={() => void load(shown.slice(0, AHEAD))}
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
