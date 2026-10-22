/**
 * 저장 충돌 — 바깥(다른 기기 · Drive 에서 직접)에서 바뀐 파일과 부딪힌 내 변경. 덮어쓰지 않고 사본으로 남겨 둔 것을 비교해 고른다.
 */
import React, { useState } from "react";
import { Text, View } from "react-native";

import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { confirmAsk } from "./io";
import { Card, H, Muted, when } from "./parts";
import { useWork } from "./WorkContext";

/** 사본 한 줄 — 페이지 문서는 본문 앞부분, 색인 · 자료는 제목 */
function brief(json: string, title?: string): string {
  try {
    const o = JSON.parse(json) as { title?: string; body?: string; rev?: number; updatedAt?: string };
    return [title ?? o.title, o.body != null ? o.body.replace(/\s+/g, " ").slice(0, 60) : null, o.rev != null ? `rev ${o.rev}` : null, when(o.updatedAt)].filter(Boolean).join(" · ");
  } catch {
    return json.slice(0, 120);
  }
}

export function ConflictPanel({ c }: { c: Palette }) {
  const t = useT();
  const { conflicts, state, docs, resolveConflict } = useWork();
  const [busy, setBusy] = useState<string | null>(null);
  if (!conflicts.length) return null;
  return (
    <Card c={c} tone="attention">
      <H c={c}>{t("conflict.title", { count: conflicts.length })}</H>
      <Muted c={c}>{t("conflict.body")}</Muted>
      {conflicts.map((cf) => {
        const id = /state\/(?:pages|items)\/(.+)\.json$/.exec(cf.path)?.[1];
        const title = state.pages.find((p) => p.id === id)?.title;
        const remote = id ? docs[id] : undefined;
        return (
          <View key={cf.copyPath} style={{ gap: 6, backgroundColor: c.row, borderRadius: 10, padding: 10 }}>
            <Text style={{ fontSize: 13, color: c.text }}>{t("conflict.mine", { brief: brief(cf.mine, title) })}</Text>
            <Text style={{ fontSize: 13, color: c.text }}>{t("conflict.theirs", { brief: remote ? brief(JSON.stringify(remote), title) : cf.path })}</Text>
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
