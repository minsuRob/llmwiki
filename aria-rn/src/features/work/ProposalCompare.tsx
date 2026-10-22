/**
 * 본문 제안 띠 · 비교 — AI(또는 옛 업무 이행)가 낸 새 본문을 지금 본문과 줄 단위로 견주고, 사람이 받거나 뺀다.
 * 낡은 제안(제안 뒤 본문이 바뀜)은 바로 받지 않는다 — 비교를 본 뒤 '낡았지만 그대로 받기'로만(core acceptBodyProposal force).
 * 받은 것은 바꾼 기록에 남아 되돌릴 수 있다.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { bodyHashOf, openBodyProposals, type BodyProposal, type PageMeta } from "../../../../packages/core/src/pages.ts";
import { diffLines, diffStats } from "../../../../packages/core/src/textDiff.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { Card, H, Muted, Pill, when } from "./parts";
import { useWork } from "./WorkContext";

const MONO = { fontFamily: "monospace" as const, fontSize: 12, lineHeight: 18 };

function Compare({ c, p, page, current, onDone }: { c: Palette; p: BodyProposal; page: PageMeta; current: string; onDone: (msg: string, bad?: boolean) => void }) {
  const t = useT();
  const { proposalBody, acceptBody, rejectBody } = useWork();
  const [body, setBody] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [stale, setStale] = useState(bodyHashOf(current) !== p.baseHash);
  useEffect(() => {
    let alive = true;
    void proposalBody(p).then((b) => alive && setBody(b));
    return () => {
      alive = false;
    };
  }, [p, proposalBody]);
  const diff = useMemo(() => (body != null ? diffLines(current, body) : []), [current, body]);
  const stats = diffStats(diff);
  const act = async (kind: "accept" | "force" | "reject") => {
    setBusy(kind);
    if (kind === "reject") {
      const r = await rejectBody(p.id);
      setBusy(null);
      return onDone(r === "saved" ? t("proposal.rejected") : t("proposal.failed"), r !== "saved");
    }
    const r = await acceptBody(p.id, { force: kind === "force" });
    setBusy(null);
    if (r === "stale") return setStale(true);
    if (r === "saved") return onDone(t("proposal.accepted"));
    onDone(r === "gone" ? t("proposal.gone") : r === "bad_raw" ? t("proposal.badRaw") : t("proposal.failed"), true);
  };
  if (body === undefined) return <Muted c={c}>{t("proposal.loading")}</Muted>;
  if (body === null) return <Muted c={c} danger>{t("proposal.missing")}</Muted>;
  return (
    <View style={{ gap: 8 }}>
      {p.note ? <Text style={{ fontSize: 13, color: c.text }}>{p.note}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <Pill c={c} label={t("proposal.stats", stats)} tone="muted" />
        {(p.flags ?? []).map((f) => (
          <Pill key={f} c={c} label={t(`proposal.flag.${f}`)} tone="danger" />
        ))}
        {p.refs?.length ? <Muted c={c}>{t("proposal.refs", { refs: p.refs.join(", ") })}</Muted> : null}
      </View>
      {stale ? <Muted c={c} danger>{t("proposal.stale")}</Muted> : null}
      <ScrollView style={{ maxHeight: 360, backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.border }} contentContainerStyle={{ padding: 8 }} nestedScrollEnabled>
        {stats.added + stats.removed === 0 ? <Muted c={c}>{t("proposal.same")}</Muted> : null}
        {diff.map((d, i) => (
          <Text
            key={i}
            selectable
            style={{ ...MONO, color: d.op === "same" ? c.muted : d.op === "add" ? c.ok : c.danger, textDecorationLine: d.op === "del" ? "line-through" : "none", backgroundColor: d.op === "same" ? undefined : c.row }}
          >
            {d.op === "add" ? "+ " : d.op === "del" ? "− " : "  "}
            {d.text || " "}
          </Text>
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {stale ? (
          <Btn c={c} primary label={t("proposal.forceAccept")} busy={busy === "force"} onPress={() => void act("force")} />
        ) : (
          <Btn c={c} primary label={t("proposal.accept")} busy={busy === "accept"} onPress={() => void act("accept")} />
        )}
        <Btn c={c} label={t("proposal.reject")} busy={busy === "reject"} onPress={() => void act("reject")} />
      </View>
      <Muted c={c}>{page.title}</Muted>
    </View>
  );
}

/** 페이지 위 띠 — 열린 제안 수, 누르면 하나씩 비교 */
export function ProposalStrip({ c, page, current, onChanged }: { c: Palette; page: PageMeta; current: string; onChanged: () => void }) {
  const t = useT();
  const { state } = useWork();
  const list = openBodyProposals(state.manifest, page.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  if (!list.length && !note) return null;
  return (
    <Card c={c} tone={list.length ? "attention" : undefined}>
      {list.length ? <H c={c}>{t("proposal.strip", { count: list.length })}</H> : null}
      {list.map((p) => (
        <View key={p.id} style={{ gap: 6, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 13, color: c.text }}>
              {p.origin === "migration" ? t("proposal.migration") : t("proposal.by", { tool: t(`tool.${p.tool}`), at: when(p.createdAt) })}
            </Text>
            <Btn c={c} small label={open === p.id ? t("proposal.hide") : t("proposal.compare")} onPress={() => setOpen(open === p.id ? null : p.id)} />
          </View>
          {open === p.id ? (
            <Compare
              c={c}
              p={p}
              page={page}
              current={current}
              onDone={(text, bad) => {
                setNote({ text, bad });
                setOpen(null);
                onChanged();
              }}
            />
          ) : null}
        </View>
      ))}
      {note ? <Text style={{ fontSize: 13, color: note.bad ? c.danger : c.ok }}>{note.text}</Text> : null}
    </Card>
  );
}
