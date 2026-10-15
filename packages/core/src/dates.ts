/**
 * 날짜 · 시각 — 기기 시간대 기준. 할일 · 일정의 시각은 "YYYY-MM-DD" 또는 "YYYY-MM-DDTHH:mm" 글자로 둔다
 * (UTC 로 바꾸면 날짜만 있는 값이 다른 날로 넘어간다).
 */

const pad = (n: number) => String(n).padStart(2, "0");

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ymdhm(d: Date): string {
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** "YYYY-MM-DD" · "YYYY-MM-DDTHH:mm" → 기기 시간대 Date. 날짜만이면 그날 23:59 로 본다(마감 비교용) */
export function parseLocal(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  if (m[4] === undefined) return new Date(y, mo, d, 23, 59);
  return new Date(y, mo, d, Number(m[4]), Number(m[5]));
}

export function hasTime(s: string | null | undefined): boolean {
  return !!s && /T\d{2}:\d{2}/.test(s);
}

/** 오늘 0시 이전이면 기한 지남 */
export function isOverdue(due: string | null | undefined, now = new Date()): boolean {
  const d = parseLocal(due);
  if (!d) return false;
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return day.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function sameDay(due: string | null | undefined, target: Date): boolean {
  const d = parseLocal(due);
  return !!d && ymd(d) === ymd(target);
}

/** 이번 주 일요일(월요일 시작 주) */
export function endOfWeek(now = new Date()): Date {
  const dow = now.getDay(); // 0 = 일
  return addDays(now, dow === 0 ? 0 : 7 - dow);
}

/** 화면 표시 — 오늘 · 내일 · 어제는 말로, 그 밖은 M/D(요일). 시각이 있으면 붙인다 */
export function formatWhen(s: string | null | undefined, now = new Date()): string | null {
  const d = parseLocal(s);
  if (!d) return null;
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  const words: Record<number, string> = { 0: "오늘", 1: "내일", 2: "모레", [-1]: "어제" };
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const label = words[diff] ?? `${d.getMonth() + 1}/${d.getDate()}(${dayNames[d.getDay()]})`;
  if (!hasTime(s)) return label;
  const h = d.getHours();
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${label} ${ampm} ${h12}시${d.getMinutes() ? ` ${d.getMinutes()}분` : ""}`;
}

const WEEKDAYS: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

export interface ParsedWhen {
  /** "YYYY-MM-DD" 또는 "YYYY-MM-DDTHH:mm" */
  value: string;
  /** 원문에서 날짜 · 시각에 해당한 부분(제목에서 뺀다) */
  matched: string[];
}

/**
 * 한국어 문장에서 날짜 · 시각을 뽑는다(기기 안 규칙 — 모델이 없을 때 쓰는 길).
 * 지원: 오늘 · 내일 · 모레 · 글피 · N일 후 · 이번/다음 주 X요일 · X요일 · M월 D일 · M/D · D일,
 *       오전/오후/아침/저녁/밤 H시(반 · M분) · HH:MM · 정오 · 자정
 */
export function parseKoreanWhen(text: string, now = new Date()): ParsedWhen | null {
  const matched: string[] = [];
  let day: Date | null = null;

  const take = (re: RegExp, fn: (m: RegExpExecArray) => Date | null) => {
    if (day) return;
    const m = re.exec(text);
    if (!m) return;
    const d = fn(m);
    if (d) {
      day = d;
      matched.push(m[0]);
    }
  };

  take(/오늘|금일/, () => addDays(now, 0));
  take(/내일|낼(?=\s|$)/, () => addDays(now, 1));
  take(/모레/, () => addDays(now, 2));
  take(/글피/, () => addDays(now, 3));
  take(/(\d+)\s*일\s*(?:후|뒤)/, (m) => addDays(now, Number(m[1])));
  take(/(이번\s*주|다음\s*주|담주|다다음\s*주)?\s*([일월화수목금토])요일/, (m) => {
    const target = WEEKDAYS[m[2]];
    const which = (m[1] ?? "").replace(/\s/g, "");
    const dow = now.getDay();
    // 월요일 시작 주: 이번 주 X요일 = 이번 주 월요일 + (X-1)
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const idx = target === 0 ? 6 : target - 1;
    let offset = mondayOffset + idx;
    if (which === "다음주" || which === "담주") offset += 7;
    else if (which === "다다음주") offset += 14;
    else if (!which && offset < 0) offset += 7; // 그냥 "금요일" 인데 지났으면 다음 주
    return addDays(now, offset);
  });
  take(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/, (m) => {
    const d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
    // 반년 넘게 지난 날이면 내년(12월에 "1월 5일"). 며칠 전 날짜는 그대로 둔다 — 밀린 일을 적을 수 있게
    if (d.getTime() < addDays(now, -180).getTime()) d.setFullYear(d.getFullYear() + 1);
    return d;
  });
  take(/(?<![\d:])(\d{1,2})\/(\d{1,2})(?![\d:])/, (m) => new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2])));
  take(/(?<![\d월])(\d{1,2})\s*일(?!\s*(?:후|뒤|간|동안))/, (m) => {
    const n = Number(m[1]);
    if (n < 1 || n > 31) return null;
    const d = new Date(now.getFullYear(), now.getMonth(), n);
    if (n < now.getDate()) d.setMonth(d.getMonth() + 1);
    return d;
  });

  // 시각
  let hour: number | null = null;
  let minute = 0;
  const tm = /(오전|오후|아침|점심|저녁|밤|새벽)?\s*(\d{1,2})\s*시\s*(반|(\d{1,2})\s*분)?/.exec(text);
  const colon = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/.exec(text);
  if (tm) {
    hour = Number(tm[2]);
    minute = tm[3] === "반" ? 30 : tm[4] ? Number(tm[4]) : 0;
    const p = tm[1];
    if ((p === "오후" || p === "저녁" || p === "밤") && hour < 12) hour += 12;
    if (p === "점심" && hour < 6) hour += 12;
    if ((p === "오전" || p === "새벽" || p === "아침") && hour === 12) hour = 0;
    // 앞말이 없고 1~6시면 오후로 본다("3시 회의")
    if (!p && hour >= 1 && hour <= 6) hour += 12;
    matched.push(tm[0]);
  } else if (colon) {
    hour = Number(colon[1]);
    minute = Number(colon[2]);
    matched.push(colon[0]);
  } else if (/정오/.test(text)) {
    hour = 12;
    matched.push("정오");
  } else if (/자정/.test(text)) {
    hour = 0;
    matched.push("자정");
  }

  if (!day && hour === null) return null;
  let base: Date = day ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!day && hour !== null) {
    // 시각만 말했는데 이미 지났으면 내일
    const t = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute);
    if (t.getTime() < now.getTime()) base = addDays(base, 1);
  }
  if (hour === null) return { value: ymd(base), matched };
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute);
  return { value: ymdhm(d), matched };
}
