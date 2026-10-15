/**
 * 할일 탭 — POST taskAction { op, id?, title?, timeZone? }
 * - create(title) · toggle(id) · delete(id, 휴지통으로) · restore(id) · purge(7일 지난 휴지통 비우기)
 * 대화와 달리 카드를 만들지 않는다(사람이 직접 누른 일).
 */
import { HttpsError, onCall } from "firebase-functions/https";

import { purgeTrash } from "../../../packages/core/src/engine.ts";
import { newId, type Task } from "../../../packages/core/src/types.ts";
import { REGION, mutate, requireUid, wallClock } from "../common.ts";

export interface TaskActionRequest {
  op: "create" | "toggle" | "delete" | "restore" | "purge";
  id?: string;
  title?: string;
  due?: string | null;
  timeZone?: string;
}

export const taskAction = onCall<TaskActionRequest>({ region: REGION }, async (req) => {
  const uid = requireUid(req);
  const { op, id } = req.data ?? ({} as TaskActionRequest);
  const { now } = wallClock(req.data?.timeZone);
  const nowIso = now.toISOString();

  return mutate<{ id?: string; ok?: boolean }>(uid, now, (s) => {
    const patch = (fn: (t: Task) => Task) => {
      if (typeof id !== "string" || !s.tasks.some((t) => t.id === id)) throw new HttpsError("not-found", "할일을 찾지 못했어요.");
      return { ...s, tasks: s.tasks.map((t) => (t.id === id ? fn(t) : t)) };
    };
    switch (op) {
      case "create": {
        const title = typeof req.data.title === "string" ? req.data.title.trim().slice(0, 200) : "";
        if (!title) throw new HttpsError("invalid-argument", "title 이 필요해요.");
        const task: Task = { id: newId(), title, due: typeof req.data.due === "string" ? req.data.due : null, done: false, createdAt: nowIso };
        return { state: { ...s, tasks: [...s.tasks, task] }, result: { id: task.id } };
      }
      case "toggle":
        return { state: patch((t) => ({ ...t, done: !t.done, completedAt: t.done ? null : nowIso })), result: { ok: true } };
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
