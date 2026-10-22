/**
 * 공개 페이지 링크 — 소개 · 개인정보처리방침 · 이용약관(aria-rn/public/*.html, 로그인 없이 열린다).
 * Google OAuth 동의 화면의 홈페이지 · 방침 · 약관 주소와 같은 페이지다(docs/google-verification.md).
 */
import React from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";

import { useT } from "../i18n";
import type { Palette } from "./theme";

export const PUBLIC_ORIGIN = "https://llmwiki-minsu.web.app";
const PAGES = ["about", "privacy", "terms"] as const;

function open(page: (typeof PAGES)[number]) {
  const url = `${PUBLIC_ORIGIN}/${page}`;
  // 웹은 새 탭으로 — 앱 화면(로그인 · 설정)을 떠나지 않게
  if (Platform.OS === "web" && typeof window !== "undefined") window.open(url, "_blank", "noopener");
  else void Linking.openURL(url);
}

export function LegalLinks({ c }: { c: Palette }) {
  const t = useT();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
      {PAGES.map((p) => (
        <Pressable key={p} onPress={() => open(p)} accessibilityRole="link">
          <Text style={{ fontSize: 12, color: c.muted, textDecorationLine: "underline" }}>{t(`legal.${p}`)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
