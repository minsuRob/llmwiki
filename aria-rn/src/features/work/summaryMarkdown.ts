/**
 * 사람이 읽는 업무 요약(Drive 의 "업무 요약" 폴더 · 기기 저장소의 summaries/*.md).
 * 앱이 저장할 때마다 다시 만든다 — 사람이 고칠 필요가 없고, 구조화된 상태는 따로(state/items) 있다.
 */
import { latestOutput, nextActions, pendingReview, type WorkItem, type WorkState } from "../../../../packages/core/src/work.ts";
import type { T } from "../../i18n";
import { when } from "./parts";

export function renderSummaryMarkdown(item: WorkItem, state: WorkState, t: T): string {
  const ws = state.manifest.workspaces.find((w) => w.id === item.workspaceId);
  const area = ws?.areas.find((a) => a.id === item.areaId);
  const out: string[] = [`# ${item.title}`, "", `> ${ws?.name ?? ""} · ${area?.name ?? ""} · ${t(`work.status.${item.status}`)} · ${t("summaryDoc.updated", { at: when(item.updatedAt), rev: item.rev })}`, ""];
  out.push(`## ${t("summaryDoc.goal")}`, item.goal || "-", "");
  if (item.doneCriteria.length) out.push(`## ${t("summaryDoc.done")}`, ...item.doneCriteria.map((c) => `- ${c}`), "");
  out.push(`## ${t("summaryDoc.now")}`);
  if (item.summary) out.push(item.summary.text, "", `_${t(item.summary.origin === "ai" ? "summaryDoc.byAi" : "summaryDoc.byUser", { at: when(item.summary.updatedAt) })}_`);
  else out.push("-");
  out.push("", `## ${t("summaryDoc.next")}`, ...nextActions(item).map((a) => `- [ ] ${a.title}${a.due ? ` (${a.due})` : ""}`), "");
  const latest = latestOutput(item);
  out.push(`## ${t("summaryDoc.latest")}`, latest ? `- ${latest.url ? `[${latest.title}](${latest.url})` : latest.title} · ${t(`output.status.${latest.status}`)}` : "-", "");
  const confirmed = item.decisions.filter((d) => d.status === "confirmed");
  if (confirmed.length) out.push(`## ${t("summaryDoc.decisions")}`, ...confirmed.map((d) => `- ${d.text}${d.reason ? ` — ${d.reason}` : ""}`), "");
  const review = pendingReview(item);
  const n = review.proposals.length + review.decisions.length + review.unverified.length;
  if (n) out.push(`## ${t("summaryDoc.review")}`, t("summaryDoc.reviewCount", { count: n }), "");
  const srcs = state.sources.filter((s) => item.sourceIds.includes(s.id));
  if (srcs.length) out.push(`## ${t("summaryDoc.sources")}`, ...srcs.map((s) => `- ${s.url ? `[${s.title}](${s.url})` : s.title}`), "");
  return out.join("\n");
}
