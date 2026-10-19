/**
 * Google Drive 연결 설정 — Firebase 로그인과 따로 받는 Drive 동의(drive.file).
 * 값은 aria-rn/.env.local(커밋하지 않음)에 둔다. 없으면 Drive 는 "설정 필요" 로 보이고 연결 단추가 꺼진다.
 *   EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID  OAuth 2.0 웹 클라이언트 ID
 *   EXPO_PUBLIC_GOOGLE_PICKER_API_KEY   Picker 용 API 키(Picker API 허용)
 *   EXPO_PUBLIC_GOOGLE_PROJECT_NUMBER   Cloud 프로젝트 번호(Picker appId). 없으면 Firebase messagingSenderId(같은 값)
 */
import { firebaseConfig } from "../../../firebase/config";

export interface DriveConfig {
  clientId: string;
  apiKey: string;
  appId: string;
}

const clientId = process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
const apiKey = process.env.EXPO_PUBLIC_GOOGLE_PICKER_API_KEY?.trim() ?? "";
const appId = process.env.EXPO_PUBLIC_GOOGLE_PROJECT_NUMBER?.trim() || firebaseConfig.messagingSenderId;

export const driveConfig: DriveConfig | null = clientId && apiKey ? { clientId, apiKey, appId } : null;

/**
 * 개발 · 검증용 로컬 Drive(tools/local-drive) — 이 컴퓨터의 폴더를 Drive API 처럼 흉내 낸다. 실제 Google Drive 가 아니다.
 *   EXPO_PUBLIC_LOCAL_DRIVE_URL    예: http://127.0.0.1:8790 (있으면 Google 대신 여기에 붙는다)
 *   EXPO_PUBLIC_LOCAL_DRIVE_TOKEN  서버의 --token 과 같은 값(기본 local-dev-token, 비밀이 아닌 개발용 값)
 */
export const localDriveUrl: string | null = process.env.EXPO_PUBLIC_LOCAL_DRIVE_URL?.trim() || null;
export const localDriveToken: string = process.env.EXPO_PUBLIC_LOCAL_DRIVE_TOKEN?.trim() || "local-dev-token";
