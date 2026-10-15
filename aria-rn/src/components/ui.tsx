/**
 * 화면 공용 조각 — 카드 틀 · 단추 · 꼬리표 · 줄. Pressable 의 style 은 정적 객체만 쓴다
 * (함수형 style 은 플랫폼마다 다르게 먹는다).
 */
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import type { Palette } from "./theme";

export function Shell({ c, title, children, right }: { c: Palette; title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: c.card, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: c.border, marginTop: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: "700", color: c.text }}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Btn({ label, onPress, primary, c, small, busy, disabled }: { label: string; onPress: () => void; primary?: boolean; c: Palette; small?: boolean; busy?: boolean; disabled?: boolean }) {
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={{
        paddingHorizontal: small ? 10 : 14,
        paddingVertical: small ? 6 : 9,
        borderRadius: 10,
        backgroundColor: primary ? c.accent : c.soft,
        opacity: off && !busy ? 0.5 : 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={primary ? c.accentText : c.text} /> : null}
      <Text style={{ fontSize: small ? 12 : 14, fontWeight: primary ? "700" : "500", color: primary ? c.accentText : c.text }}>{label}</Text>
    </Pressable>
  );
}

export function Tag({ label, c, tone }: { label: string; c: Palette; tone?: "ok" | "muted" | "accent" }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: c.soft }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: tone === "ok" ? c.ok : tone === "accent" ? c.accent : c.muted }}>{label}</Text>
    </View>
  );
}

export function Line({ c, title, sub, struck, subDanger, right }: { c: Palette; title: string; sub?: string | null; struck?: boolean; subDanger?: boolean; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.row, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={3} style={{ fontSize: 14, color: struck ? c.muted : c.text, textDecorationLine: struck ? "line-through" : "none" }}>
          {title}
        </Text>
        {sub ? <Text style={{ fontSize: 12, color: subDanger ? c.danger : c.muted }}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** 화면 폭이 넓어도 읽기 좋은 폭으로 */
export const PAGE = { padding: 16, gap: 12, maxWidth: 720, width: "100%", alignSelf: "center" } as const;
