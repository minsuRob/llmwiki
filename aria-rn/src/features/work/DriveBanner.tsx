/**
 * Drive 를 쓰는데 권한이 끝났을 때 화면 위에 한 줄 — 누르면 동의 화면 없이 다시 받는다.
 * 그동안은 기기 사본으로 읽기만 하고 저장은 되지 않으므로, 설정 화면까지 가지 않아도 바로 알 수 있게.
 */
import React from "react";
import { Text, View } from "react-native";

import { usePalette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { useWork } from "./WorkContext";

export function DriveBanner() {
  const c = usePalette();
  const t = useT();
  const { storage, drive, connectDrive } = useWork();
  if (storage !== "drive" || drive.local || (drive.status !== "expired" && drive.status !== "connecting")) return null;
  return (
    <View accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.soft, borderBottomWidth: 1, borderBottomColor: c.border, paddingHorizontal: 16, paddingVertical: 8 }}>
      <Text style={{ flex: 1, fontSize: 13, color: c.danger }}>{t("drive.banner")}</Text>
      <Btn c={c} small primary label={t("drive.reconnect")} busy={drive.status === "connecting"} onPress={() => void connectDrive()} />
    </View>
  );
}
