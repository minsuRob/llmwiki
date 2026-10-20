/**
 * 바로 실행 상태 — 업무 상세 위 · 위임 패널 안에 한 줄씩. 패널을 닫아도 실행은 이어진다.
 * 끝나면 결과는 이미 '제안'으로 들어와 있다(아래 검토 카드).
 */
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";

import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { isActive, runsOf, useDesktopRuns, type DesktopRun } from "./DesktopRuns";

/** 끝난 줄은 10분 지나면 숨긴다 */
const SHOW_DONE_MS = 10 * 60 * 1000;

export function DesktopRunLines({ c, itemId }: { c: Palette; itemId: string }) {
  const { runs } = useDesktopRuns();
  const [now, setNow] = useState(() => Date.now());
  const list = runsOf(runs, itemId).filter((r) => isActive(r.status) || now - r.startedAt < SHOW_DONE_MS);
  const live = list.some((r) => isActive(r.status));
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  if (!list.length) return null;
  return (
    <View style={{ gap: 6 }} accessibilityLiveRegion="polite">
      {list.map((r) => (
        <Line key={r.runId} c={c} run={r} now={now} />
      ))}
    </View>
  );
}

function Line({ c, run, now }: { c: Palette; run: DesktopRun; now: number }) {
  const t = useT();
  const { cancel } = useDesktopRuns();
  const tool = t(`tool.${run.executor}`);
  const secs = Math.max(0, Math.round((now - run.startedAt) / 1000));
  const elapsed = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : `${secs}s`;
  const bad = run.status === "failed" || run.status === "save_failed";
  let text: string;
  if (run.status === "queued") text = t("desktop.queued", { tool, ahead: run.ahead ?? 0, elapsed });
  else if (run.status === "imported") text = run.rawOnly ? t("desktop.importedRaw", { tool }) : t("desktop.imported", { tool, ...(run.counts ?? { outputs: 0, decisions: 0, tasks: 0 }) });
  else if (run.status === "failed") text = t("desktop.failed", { tool, reason: t(`desktop.code.${run.code ?? "exec_failed"}`) });
  else if (run.status === "running") text = t("desktop.running", { tool, elapsed });
  else text = t(`desktop.${run.status}`, { tool, elapsed });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.row, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 13, color: bad ? c.danger : c.text }}>{text}</Text>
        {run.status === "failed" && run.message ? (
          <Text selectable numberOfLines={3} style={{ fontSize: 11, color: c.muted }}>
            {run.message}
          </Text>
        ) : null}
      </View>
      {run.status === "queued" || run.status === "running" ? <Btn c={c} small label={t("desktop.cancel")} onPress={() => void cancel(run.runId)} /> : null}
    </View>
  );
}
