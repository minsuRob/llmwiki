/**
 * 볼트 그래프 — 옵시디언 그래프 뷰처럼 기록 · 할일을 점으로, [[링크]] · 개념을 선으로 그린다.
 * 좌표는 core 의 layoutVault 가 계산하고, 여기서는 끌어서 옮기기 · 확대/축소 · 점 고르기만 한다.
 * 고른 점과 이웃은 밝게, 나머지는 흐리게(옵시디언의 마우스 올림 강조). SVG 없이 View 로만 그린다.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, Text, View, type LayoutChangeEvent } from "react-native";

import { degrees, groupColor, layoutVault, nodeRadius, showLabelAt, type GraphSettings, type Point, type VaultGraph, type VaultNode } from "../../../../packages/core/src/vault.ts";
import type { Palette } from "../../components/theme";
import { useT } from "../../i18n";

const MIN_SCALE = 0.15;
const MAX_SCALE = 4;

export function VaultGraphView({
  c,
  graph,
  settings,
  selected,
  onSelect,
  height,
  relayoutKey,
}: {
  c: Palette;
  graph: VaultGraph;
  settings: GraphSettings;
  selected: string | null;
  onSelect: (id: string | null) => void;
  height: number;
  /** 바뀌면 이전 좌표를 버리고 처음부터 다시 배치한다(옵시디언 "애니메이션 재생") */
  relayoutKey: number;
}) {
  const t = useT();
  const [size, setSize] = useState({ w: 0, h: height });
  const [view, setView] = useState({ x: 0, y: 0, scale: 0.6 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const prevPos = useRef<Map<string, Point> | undefined>(undefined);
  const lastKey = useRef(relayoutKey);

  const { centerStrength, repelStrength, linkStrength, linkDistance } = settings;
  const positions = useMemo(() => {
    if (lastKey.current !== relayoutKey) {
      prevPos.current = undefined;
      lastKey.current = relayoutKey;
    }
    const next = layoutVault(graph, { centerStrength, repelStrength, linkStrength, linkDistance }, { prev: prevPos.current, iterations: prevPos.current ? 120 : 300 });
    prevPos.current = next;
    return next;
  }, [graph, centerStrength, repelStrength, linkStrength, linkDistance, relayoutKey]);

  const deg = useMemo(() => degrees(graph), [graph]);
  const colors = useMemo(() => new Map(graph.nodes.map((n) => [n.id, groupColor(graph, n, settings.groups)])), [graph, settings.groups]);
  const near = useMemo(() => {
    if (!selected) return null;
    const s = new Set([selected]);
    for (const l of graph.links) {
      if (l.source === selected) s.add(l.target);
      if (l.target === selected) s.add(l.source);
    }
    return s;
  }, [graph, selected]);

  // 처음 · 다시 배치할 때 전체가 보이게 맞춘다
  const fit = () => {
    if (!size.w || positions.size === 0) return;
    const xs = [...positions.values()].map((p) => p.x);
    const ys = [...positions.values()].map((p) => p.y);
    const spanX = Math.max(...xs) - Math.min(...xs) + 120;
    const spanY = Math.max(...ys) - Math.min(...ys) + 80;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(size.w / spanX, size.h / spanY)));
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    setView({ x: -cx * scale, y: -cy * scale, scale });
  };
  const fitted = useRef("");
  useEffect(() => {
    const key = `${relayoutKey}|${size.w}|${graph.nodes.length}`;
    if (size.w && fitted.current !== key) {
      fitted.current = key;
      fit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, size.w, relayoutKey]);

  const zoomAt = (factor: number, fx = 0, fy = 0) =>
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const k = scale / v.scale;
      // 기준점(fx, fy — 가운데 기준 화면 좌표)이 제자리에 있게
      return { scale, x: fx - (fx - v.x) * k, y: fy - (fy - v.y) * k };
    });

  // 바탕을 끌면 옮긴다. 짧은 탭은 점(Pressable)에게 넘긴다
  const start = useRef({ x: 0, y: 0 });
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          start.current = { x: viewRef.current.x, y: viewRef.current.y };
        },
        onPanResponderMove: (_, g) => setView((v) => ({ ...v, x: start.current.x + g.dx, y: start.current.y + g.dy })),
      }),
    [],
  );

  // 웹: 휠로 확대/축소(마우스 자리 기준)
  const box = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = box.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toScreen = (p: Point) => ({ x: size.w / 2 + view.x + p.x * view.scale, y: size.h / 2 + view.y + p.y * view.scale });
  const showLabels = showLabelAt(view.scale, settings.textFade);
  const radiusOf = (n: VaultNode) => nodeRadius(deg.get(n.id) ?? 0, settings.nodeSize) * Math.max(0.6, Math.min(1.6, view.scale * 1.4));
  const fillOf = (n: VaultNode) => colors.get(n.id) ?? (n.kind === "concept" ? c.accent : n.kind === "missing" ? c.soft : c.muted);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  return (
    <View
      ref={box}
      onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={{ height, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, overflow: "hidden" }}
      accessibilityLabel={t("vault.graphLabel", { nodes: graph.nodes.length, links: graph.links.length })}
      {...pan.panHandlers}
    >
      <Pressable style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} onPress={() => onSelect(null)} accessibilityLabel={t("vault.clearSelection")} />
      {size.w > 0
        ? graph.links.map((l) => {
            const a = positions.get(l.source);
            const b = positions.get(l.target);
            if (!a || !b) return null;
            const p = toScreen(a);
            const q = toScreen(b);
            const len = Math.hypot(q.x - p.x, q.y - p.y);
            if (len < 0.5) return null;
            const angle = Math.atan2(q.y - p.y, q.x - p.x);
            const lit = near ? near.has(l.source) && near.has(l.target) && (l.source === selected || l.target === selected) : false;
            const thick = Math.max(0.5, settings.linkSize * (lit ? 1.6 : 1));
            const target = byId.get(l.target);
            const r = target ? radiusOf(target) : 0;
            return (
              <React.Fragment key={`${l.kind}|${l.source}|${l.target}`}>
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: (p.x + q.x) / 2 - len / 2,
                    top: (p.y + q.y) / 2 - thick / 2,
                    width: len,
                    height: thick,
                    backgroundColor: lit ? c.accent : c.muted,
                    opacity: near ? (lit ? 0.9 : 0.08) : l.kind === "concept" ? 0.25 : 0.4,
                    transform: [{ rotate: `${angle}rad` }],
                  }}
                />
                {settings.showArrow && l.kind === "link" ? (
                  <Text
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      left: q.x - Math.cos(angle) * (r + 6) - 5,
                      top: q.y - Math.sin(angle) * (r + 6) - 7,
                      width: 10,
                      fontSize: 9,
                      lineHeight: 14,
                      textAlign: "center",
                      color: lit ? c.accent : c.muted,
                      opacity: near && !lit ? 0.1 : 0.8,
                      transform: [{ rotate: `${angle}rad` }],
                    }}
                  >
                    ▶
                  </Text>
                ) : null}
              </React.Fragment>
            );
          })
        : null}
      {size.w > 0
        ? graph.nodes.map((n) => {
            const pos = positions.get(n.id);
            if (!pos) return null;
            const s = toScreen(pos);
            const r = radiusOf(n);
            const dim = near ? !near.has(n.id) : false;
            const on = n.id === selected;
            const label = showLabels || (near?.has(n.id) ?? false);
            return (
              <Pressable
                key={n.id}
                onPress={() => onSelect(on ? null : n.id)}
                accessibilityRole="button"
                accessibilityLabel={`${n.name}, ${t(KIND_NAME[n.kind])}`}
                accessibilityState={{ selected: on }}
                hitSlop={6}
                style={{ position: "absolute", left: s.x - 70, top: s.y - r, width: 140, alignItems: "center", opacity: dim ? 0.2 : 1 }}
              >
                <View
                  style={{
                    width: r * 2,
                    height: r * 2,
                    borderRadius: r,
                    backgroundColor: fillOf(n),
                    borderWidth: on ? 2 : n.kind === "missing" ? 1 : 0,
                    borderColor: on ? c.text : c.muted,
                  }}
                />
                {label ? (
                  <Text numberOfLines={2} style={{ marginTop: 3, fontSize: 11, lineHeight: 14, textAlign: "center", color: n.kind === "missing" ? c.muted : c.text, fontWeight: on ? "700" : "400", textDecorationLine: n.kind === "task" && n.done ? "line-through" : "none" }}>
                    {n.kind === "concept" ? `#${n.name}` : n.name}
                  </Text>
                ) : null}
              </Pressable>
            );
          })
        : null}
      {graph.nodes.length === 0 ? (
        <Text style={{ position: "absolute", top: height / 2 - 10, width: "100%", textAlign: "center", color: c.muted, fontSize: 13 }}>{t("vault.noMatch")}</Text>
      ) : null}
      <View style={{ position: "absolute", right: 10, bottom: 10, flexDirection: "row", gap: 6 }}>
        {[
          { label: "−", hint: "vault.zoomOut", on: () => zoomAt(1 / 1.3) },
          { label: "+", hint: "vault.zoomIn", on: () => zoomAt(1.3) },
          { label: "⤢", hint: "vault.fit", on: fit },
        ].map((b) => (
          <Pressable key={b.hint} onPress={b.on} accessibilityRole="button" accessibilityLabel={t(b.hint)} style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: c.soft, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 16, color: c.text }}>{b.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** 종류 이름의 번역 키 — 그릴 때 t() 로 */
export const KIND_NAME: Record<VaultNode["kind"], string> = { scrap: "vault.kinds.scrap", task: "vault.kinds.task", concept: "vault.kinds.concept", missing: "vault.kinds.missing" };
