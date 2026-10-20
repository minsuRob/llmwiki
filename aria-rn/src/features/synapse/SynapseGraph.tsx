/**
 * 고른 개념을 가운데에, 이웃 개념을 둘레에 두고 선으로 잇는 작은 그래프.
 * 선 굵기 = 함께 나온 글 수. 둘레 개념을 누르면 그 개념이 가운데로 온다.
 * SVG 없이 View 로만 그린다(웹 · 네이티브 같은 모습). 선은 중점에 두고 각도만큼 돌린다.
 */
import React, { useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";

import type { GraphNode } from "../../../../packages/core/src/types.ts";
import type { Palette } from "../../components/theme";
import { useT } from "../../i18n";

export interface Neighbor {
  node: GraphNode;
  weight: number;
  relation?: string;
}

const HEIGHT = 300;
const KIND_ICON: Record<GraphNode["kind"], string> = { topic: "", person: "👤 ", emotion: "💭 ", project: "📁 ", tag: "" };

export function SynapseGraph({ c, center, neighbors, onSelect }: { c: Palette; center: GraphNode; neighbors: Neighbor[]; onSelect: (id: string) => void }) {
  const t = useT();
  const [width, setWidth] = useState(0);
  const shown = neighbors.slice(0, 8);
  const cx = width / 2;
  const cy = HEIGHT / 2;
  const radius = Math.max(60, Math.min(width / 2 - 70, HEIGHT / 2 - 40));
  const maxW = Math.max(1, ...shown.map((n) => n.weight));

  const points = shown.map((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, shown.length) - Math.PI / 2;
    return { ...n, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), angle };
  });

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: HEIGHT, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, overflow: "hidden" }}
      accessibilityLabel={t("synapse.graphLabel", { name: center.name, count: shown.length })}
    >
      {width > 0 ? (
        <>
          {points.map((p) => {
            const thickness = 1 + Math.round((p.weight / maxW) * 4);
            return (
              <View
                key={`l-${p.node.id}`}
                style={{
                  position: "absolute",
                  left: (cx + p.x) / 2 - radius / 2,
                  top: (cy + p.y) / 2 - thickness / 2,
                  width: radius,
                  height: thickness,
                  borderRadius: thickness,
                  backgroundColor: c.accent,
                  opacity: 0.35 + 0.5 * (p.weight / maxW),
                  transform: [{ rotate: `${p.angle}rad` }],
                }}
              />
            );
          })}
          {points.map((p) => (
            <Pressable
              key={`n-${p.node.id}`}
              onPress={() => onSelect(p.node.id)}
              accessibilityRole="button"
              accessibilityLabel={t("synapse.neighborLabel", { name: p.node.name, count: p.weight })}
              style={{ position: "absolute", left: p.x - 60, top: p.y - 18, width: 120, alignItems: "center" }}
            >
              <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
                <Text numberOfLines={1} style={{ fontSize: 12, color: c.text }}>
                  {KIND_ICON[p.node.kind]}
                  {p.node.name}
                </Text>
              </View>
              {p.relation ? <Text style={{ fontSize: 10, color: c.muted, marginTop: 2 }}>{p.relation}</Text> : null}
            </Pressable>
          ))}
          <View style={{ position: "absolute", left: cx - 70, top: cy - 22, width: 140, alignItems: "center" }} pointerEvents="none">
            <View style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: c.accent }}>
              <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "800", color: c.accentText }}>
                {KIND_ICON[center.kind]}
                {center.name}
              </Text>
            </View>
          </View>
          {shown.length === 0 ? (
            <Text style={{ position: "absolute", bottom: 16, width: "100%", textAlign: "center", color: c.muted, fontSize: 12 }}>{t("synapse.noNeighbors")}</Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
