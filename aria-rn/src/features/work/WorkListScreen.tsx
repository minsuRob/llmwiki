/**
 * 업무 — 진행 중인 업무 목록(영역별) + 새 업무(템플릿). 끝낸 · 보관한 업무는 접어 둔다.
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { nextActions, pendingReview, staleSources, TEMPLATE_KEYS, type Importance, type TemplateKey, type WorkItem, type WorkStatus } from "../../../../packages/core/src/work.ts";
import { usePalette, type Palette } from "../../components/theme";
import { Btn, PAGE } from "../../components/ui";
import { useT } from "../../i18n";
import { Card, Field, Fold, H, Muted, Pill, WorkspaceChips } from "./parts";
import { DeadlineCard, RecommendCard } from "./PlanCards";
import { useWork } from "./WorkContext";

function Choice<K extends string>({ c, options, value, onChange, label }: { c: Palette; options: { key: K; label: string }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Muted c={c}>{label}</Muted>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === o.key }}
            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: value === o.key ? c.accent : c.soft }}
          >
            <Text style={{ fontSize: 12, fontWeight: "600", color: value === o.key ? c.accentText : c.text }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function NewWork({ c, onDone }: { c: Palette; onDone: () => void }) {
  const t = useT();
  const { state, workspaceId, createItem } = useWork();
  const ws = state.manifest.workspaces.find((w) => w.id === workspaceId) ?? state.manifest.workspaces[0];
  const [title, setTitle] = useState("");
  const [tpl, setTpl] = useState<TemplateKey | "none">("none");
  const [importance, setImportance] = useState<Importance>("normal");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const dueOk = !due || /^\d{4}-\d{2}-\d{2}$/.test(due);
  const submit = async () => {
    if (!title.trim() || !dueOk) return;
    setBusy(true);
    const item = await createItem({ workspaceId: ws.id, title, templateKey: tpl === "none" ? null : tpl, importance, due: due || null });
    setBusy(false);
    if (item) {
      onDone();
      router.push({ pathname: "/work/[id]", params: { id: item.id } });
    }
  };
  return (
    <Card c={c}>
      <H c={c}>{t("work.newIn", { workspace: ws.name })}</H>
      <Field c={c} value={title} onChangeText={setTitle} placeholder={t("work.titlePlaceholder")} accessibilityLabel={t("work.title")} onSubmitEditing={() => void submit()} />
      <Choice c={c} label={t("work.template")} value={tpl} onChange={setTpl} options={[{ key: "none" as const, label: t("template.none") }, ...TEMPLATE_KEYS.map((k) => ({ key: k, label: t(`template.${k}.name`) }))]} />
      {tpl !== "none" ? <Muted c={c}>{t(`template.${tpl}.goal`)}</Muted> : null}
      <Choice c={c} label={t("work.importance")} value={importance} onChange={setImportance} options={(["high", "normal", "low"] as const).map((k) => ({ key: k, label: t(`importance.${k}`) }))} />
      <Field c={c} value={due} onChangeText={setDue} placeholder={t("work.duePlaceholder")} accessibilityLabel={t("work.due")} />
      {!dueOk ? <Muted c={c} danger>{t("work.dueInvalid")}</Muted> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn c={c} primary label={t("work.create")} busy={busy} disabled={!title.trim() || !dueOk} onPress={() => void submit()} />
        <Btn c={c} label={t("common.cancel")} onPress={onDone} />
      </View>
    </Card>
  );
}

function Row({ c, item }: { c: Palette; item: WorkItem }) {
  const t = useT();
  const { state } = useWork();
  const review = pendingReview(item);
  const n = review.proposals.length + review.decisions.length;
  const stale = staleSources(item, state.sources).length;
  const next = nextActions(item)[0];
  return (
    <Pressable onPress={() => router.push({ pathname: "/work/[id]", params: { id: item.id } })} accessibilityRole="link" style={{ backgroundColor: c.surface, borderRadius: 12, padding: 12, gap: 6, borderWidth: 1, borderColor: c.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: c.text }}>{item.title}</Text>
        <Pill c={c} label={t(`work.status.${item.status}`)} tone="accent" />
      </View>
      <Text style={{ fontSize: 12, color: c.muted }}>{next ? t("today.nextIs", { title: next.title }) : t("work.noNext")}</Text>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {item.importance === "high" ? <Pill c={c} label={t("importance.high")} tone="danger" /> : null}
        {item.due ? <Pill c={c} label={t("work.dueOn", { due: item.due })} /> : null}
        {n ? <Pill c={c} icon="help-circle-outline" label={t("work.reviewCount", { count: n })} tone="danger" /> : null}
        {stale ? <Pill c={c} icon="alert-circle-outline" label={t("status.ai.stale", { count: stale })} tone="danger" /> : null}
      </View>
    </Pressable>
  );
}

const ACTIVE_GROUPS: WorkStatus[] = ["active", "waiting", "blocked", "planned"];

export default function WorkListScreen() {
  const c = usePalette();
  const t = useT();
  const params = useLocalSearchParams<{ new?: string }>();
  const { ready, state, workspaceId } = useWork();
  const [open, setCreating] = useState(false);
  // 오늘 화면의 "새 업무" 는 ?new=1 로 온다
  const creating = open || params.new === "1";
  const close = () => {
    setCreating(false);
    if (params.new) router.setParams({ new: undefined });
  };
  if (!ready) return <ActivityIndicator style={{ flex: 1, backgroundColor: c.bg }} color={c.muted} />;
  const inWs = state.items.filter((i) => i.workspaceId === workspaceId);
  const active = inWs.filter((i) => i.status !== "done" && i.status !== "archived").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const closed = inWs.filter((i) => i.status === "done" || i.status === "archived");
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={PAGE}>
      <WorkspaceChips c={c} />
      <RecommendCard c={c} />
      <DeadlineCard c={c} />
      {creating ? <NewWork c={c} onDone={close} /> : <Btn c={c} primary label={t("work.new")} onPress={() => setCreating(true)} />}
      {!active.length && !creating ? <Muted c={c}>{t("work.empty")}</Muted> : null}
      {/* 범주 바로 아래가 업무 — 상태별로 묶는다(진행 중 · 대기 · 막힘 · 계획) */}
      {ACTIVE_GROUPS.map((st) => {
        const list = active.filter((i) => i.status === st);
        if (!list.length) return null;
        return (
          <View key={st} style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: c.muted }}>{t(`work.status.${st}`)}</Text>
            {list.map((i) => (
              <Row key={i.id} c={c} item={i} />
            ))}
          </View>
        );
      })}
      {closed.length ? (
        <Fold c={c} title={t("work.closed")} count={closed.length}>
          {closed.map((i) => (
            <Row key={i.id} c={c} item={i} />
          ))}
        </Fold>
      ) : null}
    </ScrollView>
  );
}
