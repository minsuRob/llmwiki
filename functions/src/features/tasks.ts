/**
 * 할일 탭 — POST taskAction { op, id?, title?, status?, priority?, timeZone? }
 * - create(title, status?, priority?) · toggle(id) · update(id, status?, priority?) · delete(id, 휴지통으로) · restore(id) · purge(7일 지난 휴지통 비우기)
 * 대화와 달리 카드를 만들지 않는다(사람이 직접 누른 일).
 */
import { HttpsError, onCall } from "firebase-functions/https";

import { applyTaskMeta, purgeTrash } from "../../../packages/core/src/engine.ts";
import { asTaskPriority, asTaskStatus, newId, type Task, type TaskPriority, type TaskStatus } from "../../../packages/core/src/types.ts";
import { REGION, mutate, requireUid, wallClock } from "../common.ts";

export interface TaskActionRequest {
  op: "create" | "toggle" | "update" | "delete" | "restore" | "purge";
  id?: string;
  title?: string;
  due?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  timeZone?: string;
}

export const taskAction = onCall<TaskActionRequest>({ region: REGION }, async (req) => {
  const uid = requireUid(req);
  const { op, id } = req.data ?? ({} as TaskActionRequest);
  const { now } = wallClock(req.data?.timeZone);
  const nowIso = now.toISOString();

  // 상태 · 우선순위 — 보낸 것만, 모르는 값은 거절한다
  const meta = () => {
    const out: { status?: TaskStatus; priority?: TaskPriority } = {};
    if (req.data?.status !== undefined) {
      const st = asTaskStatus(req.data.status);
      if (!st) throw new HttpsError("invalid-argument", "status 는 진행중 · 완료 · 보류 · 대기 중 하나예요.");
      out.status = st;
    }
    if (req.data?.priority !== undefined) {
      const pr = asTaskPriority(req.data.priority);
      if (!pr) throw new HttpsError("invalid-argument", "priority 는 최우선 · 중간 · 하순위 중 하나예요.");
      out.priority = pr;
    }
    return out;
  };

  return mutate<{ id?: string; ok?: boolean }>(uid, now, (s) => {
    const patch = (fn: (t: Task) => Task) => {
      if (typeof id !== "string" || !s.tasks.some((t) => t.id === id)) throw new HttpsError("not-found", "할일을 찾지 못했어요.");
      return { ...s, tasks: s.tasks.map((t) => (t.id === id ? fn(t) : t)) };
    };
    switch (op) {
      case "create": {
        const title = typeof req.data.title === "string" ? req.data.title.trim().slice(0, 200) : "";
        if (!title) throw new HttpsError("invalid-argument", "title 이 필요해요.");
        const base: Task = { id: newId(), title, due: typeof req.data.due === "string" ? req.data.due : null, done: false, createdAt: nowIso };
        const task = applyTaskMeta(base, meta(), nowIso);
        return { state: { ...s, tasks: [...s.tasks, task] }, result: { id: task.id } };
      }
      case "toggle":
        return { state: patch((t) => ({ ...t, done: !t.done, completedAt: t.done ? null : nowIso })), result: { ok: true } };
      case "update": {
        const m = meta();
        if (m.status === undefined && m.priority === undefined) throw new HttpsError("invalid-argument", "status 나 priority 가 필요해요.");
        return { state: patch((t) => applyTaskMeta(t, m, nowIso)), result: { ok: true } };
      }
      case "delete":
        return { state: patch((t) => ({ ...t, deletedAt: nowIso })), result: { ok: true } };
      case "restore":
        return { state: patch((t) => ({ ...t, deletedAt: null })), result: { ok: true } };
      case "purge":
        return { state: purgeTrash(s, now), result: { ok: true } };
      default:
        throw new HttpsError("invalid-argument", `모르는 op: ${String(op)}`);
    }
  });
});
