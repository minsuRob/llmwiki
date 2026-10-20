/**
 * 확인 창 — 웹에서 브라우저 확인 창(window.confirm) 대신 앱 안 모달로 묻는다.
 * 내장 브라우저 · 웹뷰는 window.confirm 을 막거나 저절로 '취소' 해서 단추가 아무 일도 안 하던 문제(Drive 연결 해제).
 * io.ts 의 confirmAsk 가 이 호스트가 붙어 있으면 여기로 보낸다.
 */
import React, { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import { usePalette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { setConfirmHost, type ConfirmRequest } from "./io";

export function ConfirmHost() {
  const c = usePalette();
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  useEffect(() => {
    setConfirmHost((r) => setReq(r));
    return () => setConfirmHost(null);
  }, []);
  const answer = (v: boolean) => {
    req?.resolve(v);
    setReq(null);
  };
  return (
    <Modal visible={!!req} transparent animationType="fade" onRequestClose={() => answer(false)}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={() => answer(false)} accessibilityLabel={req?.cancel} />
        <View accessibilityRole="alert" style={{ width: "100%", maxWidth: 420, backgroundColor: c.surface, borderRadius: 16, padding: 18, gap: 12, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: c.text }}>{req?.title}</Text>
          <Text style={{ fontSize: 14, lineHeight: 20, color: c.text }}>{req?.message}</Text>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Btn c={c} label={req?.cancel ?? ""} onPress={() => answer(false)} />
            <Btn c={c} primary label={req?.ok ?? ""} onPress={() => answer(true)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
