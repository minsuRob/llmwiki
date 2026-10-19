/**
 * 그래프 설정 — 옵시디언 그래프 뷰의 오른쪽 위 패널과 같은 네 갈래(필터 · 그룹 · 표시 · 장력).
 * 슬라이더 대신 − / + 로 값을 바꾼다(웹 · 네이티브 같은 모습, 추가 라이브러리 없이).
 */
import React, { useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";

import type { GraphSettings } from "../../../../packages/core/src/vault.ts";
import type { Palette } from "../../components/theme";
import { useT } from "../../i18n";

/** 그룹 색 — 다크 · 라이트 모두에서 구분되는 차례 */
const GROUP_COLORS = ["#e5484d", "#f2a33a", "#e2c94c", "#46a758", "#3e9bd6", "#8e6fd8", "#d561a6", "#7c8a99"];

function Section({ c, title, open, onToggle, children }: { c: Palette; title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10, gap: 10 }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ color: c.muted, fontSize: 12, width: 12 }}>{open ? "▾" : "▸"}</Text>
        <Text style={{ color: c.text, fontSize: 15, fontWeight: "700" }}>{title}</Text>
      </Pressable>
      {open ? <View style={{ gap: 12, paddingLeft: 4 }}>{children}</View> : null}
    </View>
  );
}

function Toggle({ c, label, value, onChange }: { c: Palette; label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ color: c.text, fontSize: 14 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: c.accent, false: c.soft }} thumbColor="#ffffff" />
    </View>
  );
}

function Stepper({ c, label, value, step, digits = 2, onChange }: { c: Palette; label: string; value: number; step: number; digits?: number; onChange: (v: number) => void }) {
  const t = useT();
  const btn = (text: string, hint: string, delta: number) => (
    <Pressable onPress={() => onChange(Number((value + delta).toFixed(4)))} accessibilityRole="button" accessibilityLabel={t(hint, { label })} style={{ width: 30, height: 28, borderRadius: 8, backgroundColor: c.soft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: c.text, fontSize: 15 }}>{text}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ flex: 1, color: c.text, fontSize: 14 }}>{label}</Text>
      {btn("−", "graph.decrease", -step)}
      <Text style={{ minWidth: 48, textAlign: "center", color: c.text, fontVariant: ["tabular-nums"], fontSize: 13 }}>{value.toFixed(digits)}</Text>
      {btn("+", "graph.increase", step)}
    </View>
  );
}

export function GraphSettingsPanel({
  c,
  settings,
  update,
  reset,
  onRelayout,
  local,
}: {
  c: Palette;
  settings: GraphSettings;
  update: (patch: Partial<GraphSettings>) => void;
  reset: () => void;
  onRelayout: () => void;
  local: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState({ filter: true, group: true, display: false, force: false });
  const flip = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const input = { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: c.text, backgroundColor: c.row, fontSize: 14 } as const;

  return (
    <View style={{ backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: "800" }}>{t("graph.title")}</Text>
        <Pressable onPress={reset} accessibilityRole="button" accessibilityLabel={t("graph.reset")} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ color: c.muted, fontSize: 18 }}>↺</Text>
        </Pressable>
      </View>

      <Section c={c} title={t("graph.sections.filter")} open={open.filter} onToggle={() => flip("filter")}>
        <TextInput
          value={settings.search}
          onChangeText={(search) => update({ search })}
          placeholder={t("graph.searchPlaceholder")}
          placeholderTextColor={c.muted}
          accessibilityLabel={t("graph.searchLabel")}
          autoCapitalize="none"
          style={input}
        />
        <Toggle c={c} label={t("graph.showTags")} value={settings.showTags} onChange={(showTags) => update({ showTags })} />
        <Toggle c={c} label={t("graph.hideUnresolved")} value={settings.hideUnresolved} onChange={(hideUnresolved) => update({ hideUnresolved })} />
        <Toggle c={c} label={t("graph.showOrphans")} value={settings.showOrphans} onChange={(showOrphans) => update({ showOrphans })} />
        {local ? <Stepper c={c} label={t("graph.depth")} value={settings.depth} step={1} digits={0} onChange={(depth) => update({ depth })} /> : null}
      </Section>

      <Section c={c} title={t("graph.sections.group")} open={open.group} onToggle={() => flip("group")}>
        {settings.groups.map((g, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextInput
              value={g.query}
              onChangeText={(query) => update({ groups: settings.groups.map((x, j) => (j === i ? { ...x, query } : x)) })}
              placeholder={t("graph.groupPlaceholder")}
              placeholderTextColor={c.muted}
              accessibilityLabel={t("graph.groupQuery", { n: i + 1 })}
              autoCapitalize="none"
              style={{ ...input, flex: 1 }}
            />
            <Pressable
              onPress={() => update({ groups: settings.groups.map((x, j) => (j === i ? { ...x, color: GROUP_COLORS[(GROUP_COLORS.indexOf(x.color) + 1) % GROUP_COLORS.length] } : x)) })}
              accessibilityRole="button"
              accessibilityLabel={t("graph.groupColor", { n: i + 1 })}
              style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: g.color, borderWidth: 2, borderColor: c.border }}
            />
            <Pressable onPress={() => update({ groups: settings.groups.filter((_, j) => j !== i) })} accessibilityRole="button" accessibilityLabel={t("graph.groupRemove", { n: i + 1 })} style={{ padding: 4 }}>
              <Text style={{ color: c.muted, fontSize: 16 }}>✕</Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          onPress={() => update({ groups: [...settings.groups, { query: "", color: GROUP_COLORS[settings.groups.length % GROUP_COLORS.length] }] })}
          accessibilityRole="button"
          style={{ backgroundColor: c.soft, borderRadius: 10, paddingVertical: 10, alignItems: "center" }}
        >
          <Text style={{ color: c.text, fontSize: 14 }}>{t("graph.newGroup")}</Text>
        </Pressable>
      </Section>

      <Section c={c} title={t("graph.sections.display")} open={open.display} onToggle={() => flip("display")}>
        <Toggle c={c} label={t("graph.arrows")} value={settings.showArrow} onChange={(showArrow) => update({ showArrow })} />
        <Stepper c={c} label={t("graph.textFade")} value={settings.textFade} step={0.5} onChange={(textFade) => update({ textFade })} />
        <Stepper c={c} label={t("graph.nodeSize")} value={settings.nodeSize} step={0.25} onChange={(nodeSize) => update({ nodeSize })} />
        <Stepper c={c} label={t("graph.linkSize")} value={settings.linkSize} step={0.25} onChange={(linkSize) => update({ linkSize })} />
        <Pressable onPress={onRelayout} accessibilityRole="button" style={{ alignSelf: "flex-end", backgroundColor: c.soft, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 }}>
          <Text style={{ color: c.text, fontSize: 14 }}>{t("graph.relayout")}</Text>
        </Pressable>
      </Section>

      <Section c={c} title={t("graph.sections.force")} open={open.force} onToggle={() => flip("force")}>
        <Stepper c={c} label={t("graph.centerStrength")} value={settings.centerStrength} step={0.1} onChange={(centerStrength) => update({ centerStrength })} />
        <Stepper c={c} label={t("graph.repelStrength")} value={settings.repelStrength} step={1} onChange={(repelStrength) => update({ repelStrength })} />
        <Stepper c={c} label={t("graph.linkStrength")} value={settings.linkStrength} step={0.1} onChange={(linkStrength) => update({ linkStrength })} />
        <Stepper c={c} label={t("graph.linkDistance")} value={settings.linkDistance} step={25} digits={0} onChange={(linkDistance) => update({ linkDistance })} />
      </Section>
    </View>
  );
}
