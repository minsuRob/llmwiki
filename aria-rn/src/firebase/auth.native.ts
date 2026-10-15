/** iOS · Android — 로그인 상태를 AsyncStorage 에 둔다(앱을 다시 열어도 같은 사용자) */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FirebaseApp } from "firebase/app";
import { initializeAuth, type Auth } from "firebase/auth";
// RN 빌드에만 있는 내보내기 — 웹 타입 정의에는 없다
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getReactNativePersistence } = require("firebase/auth") as { getReactNativePersistence: (s: typeof AsyncStorage) => unknown };

export function createAuth(app: FirebaseApp): Auth {
  return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) as never });
}
