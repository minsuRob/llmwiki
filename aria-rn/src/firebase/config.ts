/**
 * Firebase 연결 설정. 웹 앱 설정은 비밀이 아니다(브라우저에 그대로 실리는 식별자) — 접근은 Firestore 규칙과 Auth 가 막는다.
 *
 * EXPO_PUBLIC_USE_EMULATORS=1 이면 로컬 에뮬레이터(Auth 9099 · Firestore 8080 · Functions 5001)에 붙는다.
 * 실기기에서 에뮬레이터를 쓰려면 EXPO_PUBLIC_EMULATOR_HOST 에 이 컴퓨터의 LAN 주소를 넣는다.
 * 포트를 바꿔 띄웠으면 EXPO_PUBLIC_EMULATOR_PORTS="auth,firestore,functions" (예: "19099,18080,15001").
 */
export const firebaseConfig = {
  apiKey: "AIzaSyDPdOK-nU97FxYGX8DNM4ko8pVIYIsooII",
  authDomain: "llmwiki-minsu.firebaseapp.com",
  projectId: "llmwiki-minsu",
  storageBucket: "llmwiki-minsu.firebasestorage.app",
  messagingSenderId: "946261881838",
  appId: "1:946261881838:web:bbb24aabdb25ae9695d4ff",
};

export const FUNCTIONS_REGION = "asia-northeast3";

export const USE_EMULATORS = process.env.EXPO_PUBLIC_USE_EMULATORS === "1";
export const EMULATOR_HOST = process.env.EXPO_PUBLIC_EMULATOR_HOST || "127.0.0.1";
const ports = (process.env.EXPO_PUBLIC_EMULATOR_PORTS || "").split(",").map(Number);
export const EMULATOR_PORTS = { auth: ports[0] || 9099, firestore: ports[1] || 8080, functions: ports[2] || 5001 };
