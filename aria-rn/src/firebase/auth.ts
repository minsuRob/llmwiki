/** 웹 — 브라우저 저장소에 로그인 상태를 둔다(기본). 네이티브는 auth.native.ts */
import type { FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

export function createAuth(app: FirebaseApp): Auth {
  return getAuth(app);
}
