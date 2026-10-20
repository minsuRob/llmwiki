/**
 * 작업실 화면 조각 — 주제 고르기(＋ 새 주제 · 길게 눌러 고치기) · 접는 칸 · 입력칸 · 저장/동기화/AI 정리 상태 · 바뀐 것 카드.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";

import { pendingReview, staleSources, type ChangeEntry, type Msg, type WorkItem, type Workspace } from "../../../../packages/core/src/work.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT, type T } from "../../i18n";
import { TopicSheet, topicIcon } from "./TopicSheet";
import { useWork, type SaveState } from "./WorkContext";

/** 저장된 시각(ISO, UTC) → 이 기기 시간대의 "YYYY-MM-DD HH:mm" */
export function when(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** core 가 남긴 문구 키 → 문구. 값이 상태 같은 키면 그것도 번역한다 */
export function msgText(t: T, m: Msg): string {
  const p = { ...(m.params ?? {}) };
  if (m.key === "change.status" && typeof p.status === "string") p.status = t(`work.status.${p.status}`);
  if (m.key === "change.outputStatus" && typeof p.status === "string") p.status = t(`output.status.${p.status}`);
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

const SAVE_TONE: Record<SaveState, "ok" | "danger" | "muted"> = { saving: "muted", saved: "ok", failed: "danger", conflict: "danger" };

/** 저장 · 동기화 · AI 정리 — 셋을 따로 보여 준다 */
export function StatusStrip({ c, item }: { c: Palette; item: WorkItem }) {
  const t = useT();
  const { saves, storage, drive, state, retry } = useWork();
  const save = saves[item.id];
  const saveLabel = save ? t(`status.save.${save.state}`) : t("status.save.loaded");
  const sync =
    storage === "device" ? { label: t("status.sync.device"), tone: "muted" as const, icon: "phone-portrait-outline" as const } : drive.status === "connected" ? { label: t(drive.local ? "status.sync.localDrive" : "status.sync.drive"), tone: "ok" as const, icon: "cloud-done-outline" as const } : { label: t("status.sync.driveOffline"), tone: "danger" as const, icon: "cloud-offline-outline" as const };
  const stale = staleSources(item, state.sources);
  const lastRun = [...item.runs].sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt))[0];
  const ai = stale.length
    ? { label: t("status.ai.stale", { count: stale.length }), tone: "danger" as const }
    : !lastRun
      ? { label: t("status.ai.none"), tone: "muted" as const }
      : lastRun.status === "prepared"
        ? { label: t("status.ai.waiting"), tone: "accent" as const }
        : lastRun.status === "parse_failed"
          ? { label: t("status.ai.rawOnly"), tone: "danger" as const }
          : { label: t("status.ai.done"), tone: "ok" as const };
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <Pill c={c} icon="save-outline" label={saveLabel} tone={save ? SAVE_TONE[save.state] : "muted"} />
      <Pill c={c} icon={sync.icon} label={sync.label} tone={sync.tone} />
      <Pill c={c} icon="sparkles-outline" label={ai.label} tone={ai.tone} />
      {save?.state === "failed" ? <Btn c={c} small label={t("status.retry")} onPress={() => void retry(item.id)} /> : null}
    </View>
  );
}

/** 마지막으로 바뀐 것 — 확인이 필요한 것이 있으면 함께, [되돌리기] */
export function ChangeCard({ c, item, change }: { c: Palette; item: WorkItem; change: ChangeEntry }) {
  const t = useT();
  const { undo } = useWork();
  const latestOpen = item.changes.find((x) => !x.undone)?.id === change.id;
  const review = pendingReview(item);
  return (
    <Card c={c} tone={change.attention?.length ? "attention" : undefined}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name={change.undone ? "arrow-undo-outline" : "checkmark-circle-outline"} size={18} color={change.undone ? c.muted : c.ok} />
        <Text style={{ flex: 1, fontSize: 14, color: change.undone ? c.muted : c.text, textDecorationLine: change.undone ? "line-through" : "none" }}>{msgText(t, change.msg)}</Text>
        {latestOpen ? <Btn c={c} small label={t("common.undo")} onPress={() => void undo(item.id, change.id)} /> : null}
      </View>
      {(change.attention ?? []).map((a, i) => (
        <Text key={i} style={{ fontSize: 13, color: c.danger }}>
          {msgText(t, a)}
        </Text>
      ))}
      {!change.undone && (change.attention?.length || review.proposals.length) ? <Muted c={c}>{t("change.reviewBelow")}</Muted> : null}
    </Card>
  );
}
