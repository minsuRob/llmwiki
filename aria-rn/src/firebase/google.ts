/**
 * 웹 Google 로그인. 처음엔 익명으로 시작하므로, 지금 익명 계정에 Google 을 **연결**한다(linkWithPopup) —
 * 그래서 익명으로 쌓은 할일 · 기록 · 시냅스가 그대로 남는다(uid 가 같다).
 * 그 Google 계정이 이미 다른 데이터에 연결돼 있으면 그 계정으로 로그인한다(지금 익명 데이터는 그 계정으로 옮기지 않는다).
 * iOS · Android 는 팝업이 없어 아직 지원하지 않는다(네이티브 Google 로그인 + 개발 빌드가 필요하다).
 */
import { GoogleAuthProvider, linkWithPopup, signInWithCredential, signInWithPopup, type User } from "firebase/auth";
import { Platform } from "react-native";

import type { T } from "../i18n";
import { auth } from "./client";

export const GOOGLE_SUPPORTED = Platform.OS === "web";

export type GoogleResult = { kind: "linked" | "signed_in"; email: string | null } | { kind: "cancelled" };

function provider(): GoogleAuthProvider {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  return p;
}

const CANCELLED = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

export async function signInWithGoogle(current: User | null): Promise<GoogleResult> {
  try {
    if (current?.isAnonymous) {
      const r = await linkWithPopup(current, provider());
      return { kind: "linked", email: r.user.email };
    }
    const r = await signInWithPopup(auth, provider());
    return { kind: "signed_in", email: r.user.email };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (CANCELLED.has(code)) return { kind: "cancelled" };
    if (code === "auth/credential-already-in-use") {
      // 이 Google 계정은 이미 다른 사용자다 — 그 계정으로 들어간다
      const credential = GoogleAuthProvider.credentialFromError(e as never);
      if (credential) {
        const r = await signInWithCredential(auth, credential);
        return { kind: "signed_in", email: r.user.email };
      }
    }
    throw e;
  }
}

/** 로그인 방식 한 줄 — 설정 화면 */
export function describeUser(user: User | null, t: T): string {
  if (!user) return t("settings.account.signingIn");
  if (user.isAnonymous) return t("settings.account.anonymous");
  const google = user.providerData.find((p) => p.providerId === "google.com");
  return google ? t("settings.account.google", { email: google.email ?? user.email ?? "" }) : (user.email ?? t("settings.account.signedIn"));
}
