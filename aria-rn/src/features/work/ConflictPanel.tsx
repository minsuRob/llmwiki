/**
 * 저장 충돌 — 바깥(다른 기기 · Drive 에서 직접)에서 바뀐 파일과 부딪힌 내 변경. 덮어쓰지 않고 사본으로 남겨 둔 것을 비교해 고른다.
 */
import React, { useState } from "react";
import { Text, View } from "react-native";

import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT, type T } from "../../i18n";
import { confirmAsk } from "./io";
import { Card, H, Muted, when } from "./parts";
import { useWork } from "./WorkContext";

function brief(json: string, t: T): string {
  try {
    const o = JSON.parse(json) as { title?: string; status?: string; rev?: number; updatedAt?: string };
    return [o.title, o.status ? t(`work.status.${o.status}`) : null, o.rev != null ? `rev ${o.rev}` : null, when(o.updatedAt)].filter(Boolean).join(" · ");
  } catch {
    return json.slice(0, 120);
  }
}

export function ConflictPanel({ c }: { c: Palette }) {
  const t = useT();
  const { conflicts, state, resolveConflict } = useWork();
  const [busy, setBusy] = useState<string | null>(null);
  if (!conflicts.length) return null;
  return (
    <Card c={c} tone="attention">
      <H c={c}>{t("conflict.title", { count: conflicts.length })}</H>
      <Muted c={c}>{t("conflict.body")}</Muted>
      {conflicts.map((cf) => {
        const id = /state\/items\/(.+)\.json$/.exec(cf.path)?.[1];
        const remote = state.items.find((i) => i.id === id);
        return (
          <View key={cf.copyPath} style={{ gap: 6, backgroundColor: c.row, borderRadius: 10, padding: 10 }}>
            <Text style={{ fontSize: 13, color: c.text }}>{t("conflict.mine", { brief: brief(cf.mine, t) })}</Text>
            <Text style={{ fontSize: 13, color: c.text }}>{t("conflict.theirs", { brief: remote ? brief(JSON.stringify(remote), t) : cf.path })}</Text>
            <Muted c={c}>{t("conflict.at", { at: when(cf.at) })}</Muted>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Btn
                c={c}
                small
                label={t("conflict.keepMine")}
                busy={busy === cf.copyPath + "m"}
                onPress={async () => {
                  if (!(await confirmAsk(t("conflict.keepMine"), t("conflict.keepMineAsk"), t("common.ok"), t("common.cancel")))) return;
                  setBusy(cf.copyPath + "m");
                  await resolveConflict(cf, "mine");
                  setBusy(null);
                }}
              />
              <Btn
                c={c}
                small
                label={t("conflict.keepTheirs")}
                busy={busy === cf.copyPath + "t"}
                onPress={async () => {
                  setBusy(cf.copyPath + "t");
                  await resolveConflict(cf, "theirs");
                  setBusy(null);
                }}
              />
            </View>
          </View>
        );
      })}
    </Card>
  );
}
