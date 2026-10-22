/**
 * 지시문 검사 — AI 결과 · 자료에 숨은 주입("이전 지시를 무시해")을 표시만 한다(막지 않는다).
 * 정리 제안 · 본문 제안 · 맥락 결과가 모두 같은 함수를 부른다.
 */

/** 결과 원문에서 지시문으로 보이는 말 — 자료나 AI 답에 숨은 주입을 표시만 한다(막지 않는다) */
const INJECTION: RegExp[] = [
  /ignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules)/i,
  /disregard\s+.{0,30}(instructions|rules|prompt)/i,
  /(reveal|print|show)\s+.{0,20}system\s+prompt/i,
  /you\s+are\s+now\s+(a|an|the)\b/i,
  /(이전|앞의|위의|기존)\s*(의\s*)?(모든\s*)?(지시|명령|규칙|프롬프트)[^\n]{0,12}(무시|잊)/,
  /시스템\s*프롬프트[^\n]{0,12}(보여|출력|알려|공개)/,
  /(지금부터|이제부터)\s*(너는|당신은)/,
  /(업무|할\s*일|결정)[^\n]{0,10}(자동으로\s*)?(확정|완료)\s*(처리|상태로)[^\n]{0,6}(해라|하라|하세요|해\s*줘)/,
];

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";

/** 호환 자모로 풀어 쓴 글(ㅁㅜㅅㅣ)을 음절(무시)로 합친다. 조합형 자모는 NFC 가, 폭 없는 글자는 지워서 */
export function composeJamo(text: string): string {
  const t = text.normalize("NFC").replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, "");
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const l = CHO.indexOf(t[i]);
    const v = l >= 0 ? JUNG.indexOf(t[i + 1] ?? "") : -1;
    if (l < 0 || v < 0) {
      out += t[i];
      continue;
    }
    let tail = 0;
    const j = JONG.indexOf(t[i + 2] ?? "");
    if (j > 0 && JUNG.indexOf(t[i + 3] ?? "") < 0) tail = j;
    out += String.fromCharCode(0xac00 + (l * 21 + v) * 28 + tail);
    i += tail ? 2 : 1;
  }
  return out;
}

/** 자모를 풀어 쓴 우회(ㅁㅜㅅㅣ → 무시) · 폭 없는 글자 끼우기도 잡도록 합친 뒤 본다 */
export function scanInjection(text: string): string[] {
  const t = composeJamo(text);
  return INJECTION.filter((re) => re.test(t)).map((re) => re.source.slice(0, 40));
}

