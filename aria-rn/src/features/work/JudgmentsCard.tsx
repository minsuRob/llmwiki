/**
 * 판단 기록 — AI 가 낸 제안 · 결정을 사람이 얼마나 받아들였나(실행자별), JSONL 로 내보내기.
 * 기록은 따로 저장하지 않고 업무 파일에서 계산한다(packages/core/src/judgments.ts). 회사 작업실은 기본으로 뺀다.
 */
import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { deriveJudgments, judgmentStats, toJsonl, type JudgmentStats } from "../../../../packages/core/src/judgments.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { exportFile } from "./io";
import { Card, H, Muted } from "./parts";
import { useWork } from "./WorkContext";

const pct = (r: number | null) => (r == null ? "-" : `${Math.round(r * 100)}%`);

function Row({ c, label, s }: { c: Palette; label: string; s: JudgmentStats }) {
  const t = useT();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "baseline", backgroundColor: c.row, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
      <Text style={{ fontSize: 14, fontWeight: "700", color: c.text, minWidth: 90 }}>{label}</Text>
      <Text style={{ fontSize: 13, color: c.text }}>{t("judgments.row", { rate: pct(s.acceptRate), approved: s.approved, rejected: s.rejected, pending: s.pending })}</Text>
      {s.flaggedButApproved ? <Text style={{ fontSize: 12, color: c.danger }}>{t("judgments.flagged", { count: s.flaggedButApproved })}</Text> : null}
    </View>
  );
}

export function JudgmentsCard({ c }: { c: Palette }) {
  const t = useT();
  const { state } = useWork();
  const [company, setCompany] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rows = useMemo(() => deriveJudgments(state, { includeCompany: company }), [state, company]);
  const stats = useMemo(() => judgmentStats(rows), [rows]);
  const order = ["gemma", "claude", "codex", "other", "unknown"].filter((k) => stats.byExecutor[k]);

  return (
    <Card c={c}>
      <H c={c}>{t("judgments.title")}</H>
      <Muted c={c}>{t("judgments.intro")}</Muted>
      {rows.length ? (
        <View style={{ gap: 6 }}>
          <Row c={c} label={t("judgments.all")} s={stats.all} />
          {order.map((k) => (
            <Row key={k} c={c} label={k === "unknown" ? t("judgments.unknown") : t(`tool.${k}`)} s={stats.byExecutor[k]} />
          ))}
        </View>
      ) : (
        <Muted c={c}>{t("judgments.none")}</Muted>
      )}
      <Pressable onPress={() => setCompany(!company)} accessibilityRole="checkbox" accessibilityState={{ checked: company }} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Text style={{ fontSize: 18, color: company ? c.danger : c.muted }}>{company ? "☑" : "☐"}</Text>
        <Text style={{ flex: 1, fontSize: 13, color: c.text }}>{t("judgments.includeCompany")}</Text>
      </Pressable>
      <View style={{ flexDirection: "row" }}>
        <Btn
          c={c}
          label={t("judgments.export", { count: rows.length })}
          disabled={!rows.length}
          onPress={async () => {
            const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
            setNote((await exportFile(`llmwiki-judgments-${day}.jsonl`, toJsonl(rows))) ? t("judgments.exported") : t("handoff.exportFailed"));
          }}
        />
      </View>
      <Muted c={c}>{t("judgments.privacy")}</Muted>
      {note ? <Text style={{ fontSize: 13, color: c.ok }}>{note}</Text> : null}
    </Card>
  );
}
