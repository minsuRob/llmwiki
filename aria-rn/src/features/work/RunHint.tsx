/**
 * 셸이 없을 때 — 묶음 파일을 이 컴퓨터에서 돌리는 명령(tools/handoff/run.mjs)과 어디서 도는지 안내.
 */
import React from "react";
import { Text, View } from "react-native";

import { executorOf } from "../../../../packages/core/src/executors.ts";
import type { AiTool } from "../../../../packages/core/src/work.ts";
import type { Palette } from "../../components/theme";
import { useT } from "../../i18n";
import { Muted } from "./parts";

export function RunHint({ c, tool, file }: { c: Palette; tool: AiTool; file: string }) {
  const t = useT();
  const ex = executorOf(tool);
  if (!ex) return null;
  const cmd = ex.command.replace("{file}", `"${file}"`);
  return (
    <View style={{ gap: 6, backgroundColor: c.row, borderRadius: 10, padding: 10 }}>
      <Muted c={c}>{t("handoff.runWith")}</Muted>
      <Text selectable style={{ fontSize: 12, color: c.text, fontFamily: "monospace" }}>
        {cmd}
      </Text>
      <Muted c={c}>{t(`handoff.where.${ex.where}`, { tool: t(`tool.${tool}`) })}</Muted>
      {ex.id === "gemma" ? <Muted c={c}>{t("handoff.mcpHint")}</Muted> : null}
    </View>
  );
}
