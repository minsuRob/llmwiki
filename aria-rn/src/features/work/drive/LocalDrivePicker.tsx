/**
 * 로컬 Drive(개발용) 파일 고르기 — Google Picker 대신 쓴다. tools/local-drive 서버의 /__picker 목록에서 고른다.
 * 실제 Google Drive 가 아니라는 것을 제목에 늘 밝힌다.
 */
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { usePalette } from "../../../components/theme";
import { Btn } from "../../../components/ui";
import { useT } from "../../../i18n";
import { localDriveToken, localDriveUrl } from "./config";
import type { PickedFile } from "./googleDrive";

type Entry = PickedFile & { path: string };
let open: ((resolve: (v: PickedFile[] | null) => void) => void) | null = null;

/** 고르기 창을 띄우고 고른 파일을 돌려준다(취소하면 null) */
export function requestLocalPick(): Promise<PickedFile[] | null> {
  return new Promise((resolve) => (open ? open(resolve) : resolve(null)));
}

export function LocalDrivePickerHost() {
  const c = usePalette();
  const t = useT();
  const [pending, setPending] = useState<((v: PickedFile[] | null) => void) | null>(null);
  const [files, setFiles] = useState<Entry[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!localDriveUrl) return;
    open = (resolve) => {
      setChosen(new Set());
      setFiles(null);
      setError(false);
      setPending(() => resolve);
      fetch(`${localDriveUrl}/__picker`, { headers: { Authorization: `Bearer ${localDriveToken}` } })
        .then((r) => r.json())
        .then((b: { files: { id: string; name: string; mimeType: string; webViewLink?: string; path: string }[] }) => setFiles(b.files.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, url: f.webViewLink ?? null, path: f.path }))))
        .catch(() => setError(true));
    };
    return () => {
      open = null;
    };
  }, []);

  const finish = (v: PickedFile[] | null) => {
    pending?.(v);
    setPending(null);
  };
  if (!pending) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => finish(null)}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 16 }}>
        <View style={{ backgroundColor: c.surface, borderRadius: 16, padding: 16, gap: 10, maxWidth: 560, width: "100%", alignSelf: "center", maxHeight: "85%" }}>
          <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "700", color: c.text }}>
            {t("drive.local.pickTitle")}
          </Text>
          <Text style={{ fontSize: 12, color: c.danger }}>{t("drive.local.notReal")}</Text>
          {error ? <Text style={{ color: c.danger }}>{t("drive.local.unreachable")}</Text> : null}
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6 }}>
            {(files ?? []).map((f) => {
              const on = chosen.has(f.id);
              return (
                <Pressable
                  key={f.id}
                  onPress={() => setChosen((s) => (s.has(f.id) ? new Set([...s].filter((x) => x !== f.id)) : new Set(s).add(f.id)))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={{ flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: on ? c.soft : c.row, borderRadius: 10, padding: 10 }}
                >
                  <Text style={{ fontSize: 16, color: on ? c.accent : c.muted }}>{on ? "☑" : "☐"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, color: c.text }}>{f.name}</Text>
                    <Text style={{ fontSize: 11, color: c.muted }}>{f.path}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn c={c} primary label={t("drive.local.pick", { count: chosen.size })} disabled={!chosen.size} onPress={() => finish((files ?? []).filter((f) => chosen.has(f.id)))} />
            <Btn c={c} label={t("common.cancel")} onPress={() => finish(null)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
