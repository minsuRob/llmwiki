/**
 * iOS · Android — Drive 동의 · Picker 는 아직 없다(네이티브 Google 로그인 + 개발 빌드가 필요하다).
 * 웹은 googleDrive.web.ts. 두 파일은 같은 것을 내보낸다.
 */
export interface DriveToken {
  token: string;
  expiresAt: number;
}

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
  url: string | null;
}

export class DriveAuthError extends Error {
  readonly code: "cancelled" | "not_configured" | "unsupported" | "failed";
  constructor(code: DriveAuthError["code"], message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export const DRIVE_PLATFORM_SUPPORTED = false;

export async function requestDriveToken(_opts: { interactive: boolean; hint?: string | null }): Promise<DriveToken> {
  throw new DriveAuthError("unsupported");
}

export function revokeDriveToken(_token: string): void {}

export async function pickDriveFiles(_token: string): Promise<PickedFile[] | null> {
  throw new DriveAuthError("unsupported");
}

export function rememberDriveToken(_uid: string, _t: DriveToken | null): void {}

export function recallDriveToken(_uid: string): DriveToken | null {
  return null;
}
