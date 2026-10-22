/**
 * 작업실 화면 조각 — 주제 고르기(머리 드롭다운 · 칩, ＋ 새 주제 · 길게 눌러 고치기) · 접는 칸 · 입력칸 · 꼬리표.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";

import type { Msg, Workspace } from "../../../../packages/core/src/work.ts";
import type { Palette } from "../../components/theme";
import { useT, type T } from "../../i18n";
import { TopicSheet, topicIcon } from "./TopicSheet";
import { useWork } from "./WorkContext";

/** 저장된 시각(ISO, UTC) → 이 기기 시간대의 "YYYY-MM-DD HH:mm" */
export function when(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** core 가 남긴 문구 키 → 문구. 실행자 같은 값은 그것도 번역한다 */
export function msgText(t: T, m: Msg): string {
  const p = { ...(m.params ?? {}) };
  if (typeof p.tool === "string") p.tool = t(`tool.${p.tool}`);
  return t(m.key, p);
}

/** manage: ＋ 칩과 길게 눌러 고치기를 보인다(다른 시트 안에서는 끈다) */
export function WorkspaceChips({ c, manage = true }: { c: Palette; manage?: boolean }) {
  const { state, workspaceId, setWorkspaceId } = useWork();
  const t = useT();
  const [editing, setEditing] = useState<Workspace | "new" | null>(null);
  const chip = { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 };
  return (
    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }} accessibilityRole="tablist" accessibilityLabel={t("ws.switch")}>
      {state.manifest.workspaces.map((w) => {
        const on = w.id === workspaceId;
        return (
          <Pressable
            key={w.id}
            onPress={() => setWorkspaceId(w.id)}
            onLongPress={manage ? () => setEditing(w) : undefined}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityHint={manage ? t("topic.longPressHint") : undefined}
            style={{ ...chip, backgroundColor: on ? c.accent : c.soft }}
          >
            <Ionicons name={topicIcon(w.icon)} size={14} color={on ? c.accentText : c.text} />
            <Text style={{ fontSize: 13, fontWeight: "600", color: on ? c.accentText : c.text }}>{w.name}</Text>
            {manage && on ? (
              <Pressable onPress={() => setEditing(w)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("topic.edit")}>
                <Ionicons name="ellipsis-horizontal" size={14} color={c.accentText} />
              </Pressable>
            ) : null}
          </Pressable>
        );
      })}
      {manage ? (
        <Pressable onPress={() => setEditing("new")} accessibilityRole="button" accessibilityLabel={t("topic.new")} style={{ ...chip, borderWidth: 1, borderStyle: "dashed", borderColor: c.border }}>
          <Ionicons name="add" size={14} color={c.muted} />
          <Text style={{ fontSize: 13, color: c.muted }}>{t("topic.add")}</Text>
        </Pressable>
      ) : null}
      {manage ? <TopicSheet c={c} editing={editing} onClose={() => setEditing(null)} /> : null}
    </View>
  );
}

/** 주제 이름 첫 글자를 아이콘처럼 */
function TopicLetter({ c, name, on }: { c: Palette; name: string; on?: boolean }) {
  return (
    <View style={{ width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: on ? c.accent : c.soft }}>
      <Text style={{ fontSize: 13, fontWeight: "700", color: on ? c.accentText : c.text }}>{(Array.from(name.trim())[0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}

/** 화면 머리의 주제 드롭다운 — 첫 글자 아이콘 · 이름 · ⌄. 펼치면 주제 목록(… 로 고치기) · ＋ 새 주제 */
export function WorkspaceSwitcher({ c }: { c: Palette }) {
  const { state, workspaceId, setWorkspaceId } = useWork();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Workspace | "new" | null>(null);
  const current = state.manifest.workspaces.find((w) => w.id === workspaceId);
  const edit = (w: Workspace | "new") => {
    setOpen(false);
    setEditing(w);
  };
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("ws.switch")}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, paddingRight: 6 }}
      >
        {current ? <TopicLetter c={c} name={current.name} /> : null}
        <Text style={{ fontSize: 17, fontWeight: "700", color: c.text }}>{current?.name ?? t("ws.switch")}</Text>
        <Ionicons name="chevron-down" size={16} color={c.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} onPress={() => setOpen(false)} accessibilityLabel={t("common.close")}>
          <View
            accessibilityRole="menu"
            style={{ position: "absolute", top: 60, left: 12, minWidth: 220, maxWidth: 320, backgroundColor: c.surface, borderRadius: 14, paddingVertical: 6, borderWidth: 1, borderColor: c.border }}
          >
            {state.manifest.workspaces.map((w) => {
              const on = w.id === workspaceId;
              return (
                <Pressable
                  key={w.id}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setWorkspaceId(w.id);
                    setOpen(false);
                  }}
                  onLongPress={() => edit(w)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: on ? c.row : undefined }}
                >
                  <TopicLetter c={c} name={w.name} on={on} />
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: on ? "700" : "500", color: c.text }}>{w.name}</Text>
                  {w.private ? <Ionicons name="lock-closed-outline" size={13} color={c.muted} /> : null}
                  <Pressable onPress={() => edit(w)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("topic.edit")}>
                    <Ionicons name="ellipsis-horizontal" size={16} color={c.muted} />
                  </Pressable>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="menuitem"
              onPress={() => edit("new")}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: c.border }}
            >
              <View style={{ width: 24, alignItems: "center" }}>
                <Ionicons name="add" size={18} color={c.accent} />
              </View>
              <Text style={{ fontSize: 14, color: c.accent }}>{t("topic.new")}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      <TopicSheet c={c} editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

export function Card({ c, children, tone }: { c: Palette; children: React.ReactNode; tone?: "attention" }) {
  return <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: tone === "attention" ? c.danger : c.border }}>{children}</View>;
}

export function H({ c, children, right }: { c: Palette; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text accessibilityRole="header" style={{ flex: 1, fontSize: 15, fontWeight: "700", color: c.text }}>
        {children}
      </Text>
      {right}
    </View>
  );
}

export function Muted({ c, children, danger }: { c: Palette; children: React.ReactNode; danger?: boolean }) {
  return <Text style={{ fontSize: 12, color: danger ? c.danger : c.muted, lineHeight: 17 }}>{children}</Text>;
}

/** 접어 두는 칸 — 원본 자료 · 전체 기록 · AI 작업 이력 · 이전 결정 */
export function Fold({ c, title, count, children, initial }: { c: Palette; title: string; count?: number; children: React.ReactNode; initial?: boolean }) {
  const [open, setOpen] = useState(!!initial);
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.border }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 14 }}>
        <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={16} color={c.muted} />
        <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: c.text }}>{title}</Text>
        {count != null ? <Text style={{ fontSize: 12, color: c.muted }}>{count}</Text> : null}
      </Pressable>
      {open ? <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>{children}</View> : null}
    </View>
  );
}

export function Field({ c, ...props }: TextInputProps & { c: Palette }) {
  return (
    <TextInput
      placeholderTextColor={c.muted}
      {...props}
      style={[{ borderRadius: 10, backgroundColor: c.bg, color: c.text, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: c.border, fontSize: 14 }, props.multiline ? { minHeight: 90, textAlignVertical: "top" } : null, props.style]}
    />
  );
}

export function Pill({ c, label, tone, icon }: { c: Palette; label: string; tone?: "ok" | "danger" | "muted" | "accent"; icon?: React.ComponentProps<typeof Ionicons>["name"] }) {
  const color = tone === "ok" ? c.ok : tone === "danger" ? c.danger : tone === "accent" ? c.accent : c.muted;
  return (
    <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: color }}>
      {icon ? <Ionicons name={icon} size={11} color={color} /> : null}
      <Text style={{ fontSize: 11, fontWeight: "600", color }}>{label}</Text>
    </View>
  );
}
