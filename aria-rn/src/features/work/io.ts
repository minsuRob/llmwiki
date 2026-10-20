/**
 * 복사 · 파일로 내보내기 · 파일 가져오기 · 확인 묻기. 웹과 기기에서 같은 이름으로 쓴다.
 */
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { Alert, Platform, Share } from "react-native";

export async function copyText(text: string): Promise<boolean> {
  try {
    return await Clipboard.setStringAsync(text);
  } catch {
    return false;
  }
}

/** 웹은 .md 파일로 내려받고, 기기는 공유 시트(파일 앱 · 메일 · Claude 앱 등)로 넘긴다 */
export async function exportFile(name: string, text: string): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      const doc = (globalThis as unknown as { document: Document }).document;
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = url;
      a.download = name;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    }
    const r = await Share.share({ title: name, message: text });
    return r.action !== Share.dismissedAction;
  } catch {
    return false;
  }
}

/** 결과 파일 고르기 — 글로 읽을 수 있는 파일만 */
export async function pickTextFile(): Promise<{ name: string; text: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ["text/*", "application/json", "text/markdown"], copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const text = a.file ? await a.file.text() : await (await fetch(a.uri)).text();
  return { name: a.name, text };
}

/** 확인 — RN web 의 Alert 는 단추를 그리지 않아 웹은 브라우저 확인 창을 쓴다 */
export function confirmAsk(title: string, message: string, ok: string, cancel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve((globalThis as unknown as { confirm: (m: string) => boolean }).confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: cancel, style: "cancel", onPress: () => resolve(false) },
      { text: ok, onPress: () => resolve(true) },
    ]),
  );
}
