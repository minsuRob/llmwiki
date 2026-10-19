/**
 * 그래프 모드 — 옵시디언 그래프 뷰. 전체 그래프와 로컬 그래프(고른 점 둘레, 깊이 설정)를 오간다.
 * 넓은 화면: 그래프 | 설정 · 고른 노트. 좁은 화면: 위아래로.
 * 고른 노트 칸에는 옵시디언처럼 백링크 · 나가는 링크 · 개념(태그)을 보인다.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

import { formatWhen } from "../../../../packages/core/src/dates.ts";
import { backlinks, buildVault, filterVault, localGraph, outgoingLinks, type VaultGraph, type VaultNode } from "../../../../packages/core/src/vault.ts";
import { usePalette, type Palette } from "../../components/theme";
import { Line } from "../../components/ui";
import { useData } from "../../firebase/data";
import { GraphSettingsPanel } from "./GraphSettingsPanel";
import { useGraphSettings } from "./useGraphSettings";
import { KIND_NAME, VaultGraphView } from "./VaultGraphView";

export function VaultScreen({ focus }: { focus: string | null }) {
  const c = usePalette();
  const { state } = useData();
  const { width, height } = useWindowDimensions();
  const wide = width >= 900;
  const [settings, update, reset] = useGraphSettings();
  const [selected, setSelected] = useState<string | null>(focus);
  const [local, setLocal] = useState(!!focus);
  const [relayout, setRelayout] = useState(0);
  const [showSettings, setShowSettings] = useState(wide);

  useEffect(() => {
    if (focus) {
      setSelected(focus);
      setLocal(true);
    }
  }, [focus]);

  const vault = useMemo(() => buildVault(state), [state]);
  const { search, showTags, hideUnresolved, showOrphans, depth } = settings;
  const shown: VaultGraph = useMemo(() => {
    // 로컬 그래프는 고른 점 둘레를 먼저 자르고 필터를 얹는다. 고른 점은 필터에 걸려도 남긴다(옵시디언과 같다)
    if (local && selected) {
      const around = localGraph(vault, selected, depth);
      const f = filterVault(around, { search, showTags, hideUnresolved, showOrphans: true });
      if (f.nodes.some((n) => n.id === selected)) return f;
      const center = around.nodes.find((n) => n.id === selected);
      return center ? { nodes: [center, ...f.nodes], links: f.links } : f;
    }
    return filterVault(vault, { search, showTags, hideUnresolved, showOrphans });
  }, [vault, local, selected, depth, search, showTags, hideUnresolved, showOrphans]);

  const current = vault.nodes.find((n) => n.id === selected) ?? null;
  const graphHeight = Math.max(360, Math.min(wide ? height - 170 : 460, 900));
  const counts = { notes: vault.nodes.filter((n) => n.kind === "scrap" || n.kind === "task").length, links: vault.links.filter((l) => l.kind === "link").length };

  const side = (
    <View style={{ gap: 12 }}>
      {current ? <NoteDetail c={c} vault={vault} node={current} onSelect={setSelected} /> : null}
      {showSettings ? <GraphSettingsPanel c={c} settings={settings} update={update} reset={reset} onRelayout={() => setRelayout((k) => k + 1)} local={local} /> : null}
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 12, gap: 12, width: "100%", maxWidth: 1200, alignSelf: "center" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {[
          { key: false, label: "전체 그래프" },
          { key: true, label: "로컬 그래프" },
        ].map((t) => (
          <Pressable
            key={t.label}
            onPress={() => setLocal(t.key)}
            disabled={t.key && !selected}
            accessibilityRole="tab"
            accessibilityState={{ selected: local === t.key, disabled: t.key && !selected }}
            style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: local === t.key ? c.accent : c.border, opacity: t.key && !selected ? 0.4 : 1 }}
          >
            <Text style={{ fontSize: 12, color: local === t.key ? c.accent : c.text }}>{t.label}</Text>
          </Pressable>
        ))}
        <Text style={{ flex: 1, fontSize: 12, color: c.muted, minWidth: 120 }}>
          노트 {counts.notes} · 링크 {counts.links}
          {local && current ? ` · "${current.name}" 둘레 ${depth}걸음` : ""}
        </Text>
        <Pressable onPress={() => setShowSettings((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showSettings }} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: showSettings ? c.accent : c.soft }}>
          <Text style={{ fontSize: 12, color: showSettings ? c.accentText : c.text }}>⚙︎ 설정</Text>
        </Pressable>
      </View>
      {vault.nodes.length === 0 ? (
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 21 }}>
          아직 노트가 없어요. 대화에서 "메모: [[LLM 공부]] 다시 보기" 처럼 [[제목]] 을 넣어 기록하면, 같은 제목의 할일 · 기록과 선으로 이어져요.
        </Text>
      ) : wide ? (
        <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <VaultGraphView c={c} graph={shown} settings={settings} selected={selected} onSelect={setSelected} height={graphHeight} relayoutKey={relayout} />
          </View>
          {current || showSettings ? <View style={{ width: 320 }}>{side}</View> : null}
        </View>
      ) : (
        <>
          <VaultGraphView c={c} graph={shown} settings={settings} selected={selected} onSelect={setSelected} height={graphHeight} relayoutKey={relayout} />
          {side}
        </>
      )}
    </ScrollView>
  );
}

function NoteDetail({ c, vault, node, onSelect }: { c: Palette; vault: VaultGraph; node: VaultNode; onSelect: (id: string) => void }) {
  const { state } = useData();
  const back = backlinks(vault, node.id);
  const out = outgoingLinks(vault, node.id);
  const byId = new Map(vault.nodes.map((n) => [n.id, n]));
  const concepts = vault.links.filter((l) => l.kind === "concept" && l.source === node.id).map((l) => byId.get(l.target)!).filter(Boolean);
  const mentions = node.kind === "concept" ? vault.links.filter((l) => l.kind === "concept" && l.target === node.id).map((l) => byId.get(l.source)!).filter(Boolean) : [];
  const task = node.kind === "task" ? state.tasks.find((t) => t.id === node.refId) : undefined;
  const scrap = node.kind === "scrap" ? state.scraps.find((s) => s.id === node.refId) : undefined;

  const list = (title: string, items: VaultNode[], empty?: string) =>
    items.length || empty ? (
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: c.muted }}>
          {title} {items.length}
        </Text>
        {items.length === 0 ? <Text style={{ fontSize: 12, color: c.muted }}>{empty}</Text> : null}
        {items.map((n) => (
          <Pressable key={n.id} onPress={() => onSelect(n.id)} accessibilityRole="button" accessibilityLabel={`${n.name} 로 가기`}>
            <Line c={c} title={n.kind === "concept" ? `#${n.name}` : n.name} sub={KIND_NAME[n.kind]} struck={n.kind === "task" && n.done} />
          </Pressable>
        ))}
      </View>
    ) : null;

  return (
    <View style={{ backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 11, color: c.muted }}>{KIND_NAME[node.kind]}</Text>
        <Text style={{ fontSize: 17, fontWeight: "800", color: c.text }}>{node.kind === "concept" ? `#${node.name}` : node.name}</Text>
        {task ? <Text style={{ fontSize: 12, color: c.muted }}>{[task.done ? "완료" : "열림", formatWhen(task.due)].filter(Boolean).join(" · ")}</Text> : null}
        {task?.notes ? <Text style={{ fontSize: 13, color: c.text, lineHeight: 19 }}>{task.notes}</Text> : null}
        {scrap ? <Text style={{ fontSize: 13, color: c.text, lineHeight: 19 }}>{scrap.text}</Text> : null}
        {node.kind === "missing" ? <Text style={{ fontSize: 12, color: c.muted }}>이 제목의 할일 · 기록이 아직 없어요. 같은 제목으로 만들면 바로 이어져요.</Text> : null}
      </View>
      {node.kind === "concept" ? list("이 개념이 나온 글", mentions) : null}
      {node.kind !== "concept" ? list("백링크", back, "이 노트를 [[링크]] 한 곳이 없어요") : null}
      {list("나가는 링크", out)}
      {list("개념", concepts)}
    </View>
  );
}
