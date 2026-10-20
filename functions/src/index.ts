/**
 * llmwiki API(Cloud Functions, asia-northeast3). 기능마다 한 파일:
 * - chat          features/chat.ts      대화 → 할일 · 일정 · 기록 + 카드
 * - cardAction    features/cards.ts     카드 단추(되돌리기 · 기한 지난 할일 · 제안)
 * - taskAction    features/tasks.ts     할일 탭(만들기 · 체크 · 휴지통)
 * - rebuildSynapse features/synapse.ts  시냅스 다시 계산
 * - jobsSync      features/jobs.ts      취준 공고 넣기 · 정리(Admin 스크립트도 같은 코드)
 * - drive*        features/drive.ts     Drive 열쇠 보관 · access token · 해제 · 서버 읽기(docs/architecture.md)
 * 로컬에서는 `firebase emulators:start` 로 Auth · Firestore · Functions 를 함께 띄워 테스트한다.
 */
import { initializeApp } from "firebase-admin/app";

initializeApp();

export { chat } from "./features/chat.ts";
export { cardAction } from "./features/cards.ts";
export { taskAction } from "./features/tasks.ts";
export { rebuildSynapse } from "./features/synapse.ts";
export { jobsSync } from "./features/jobs.ts";
export { driveLink, driveListWork, driveStatus, driveToken, driveUnlink } from "./features/drive.ts";
