/** 이미지 파일 → 편집기에 넣을 데이터 URL(서버 업로드 없이 기기 안에서만 처리한다) */

/** 받을 수 있는 원본 크기 한도 */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
/** 본 이미지 긴 변 한도(px) */
export const MAX_EDGE = 1600;
/** 미리보기(흐린 자리 표시) 긴 변 한도(px) */
export const THUMB_EDGE = 48;
/** 이 크기 이하 GIF 는 움직임을 지키려고 원본 그대로 둔다 */
export const GIF_KEEP_BYTES = 5 * 1024 * 1024;

const JPEG_QUALITY = 0.85;
const THUMB_QUALITY = 0.6;

/** 확장자로만 알아보는 경우(HEIC 는 type 이 빈 채로 오기도 한다) */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|avif|bmp)$/i;

export interface ProcessedImage {
  /** 본 이미지(데이터 URL) */
  src: string;
  /** 작은 미리보기(데이터 URL) */
  thumb: string;
  /** src 의 실제 크기 — 자리 비율에 쓴다 */
  naturalWidth: number;
  naturalHeight: number;
}

/** 이미지 파일인가 — MIME 또는 확장자로 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || (!file.type && IMAGE_EXT.test(file.name));
}

/** 파일 이름에서 대체 글(alt) — 확장자를 뗀다 */
export function altFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim();
}

type Source = { image: CanvasImageSource; width: number; height: number; close: () => void };

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽지 못했어요"));
    reader.readAsDataURL(file);
  });
}

/** createImageBitmap(EXIF 방향 반영) → 안 되면 <img> 로 */
async function decode(file: File): Promise<Source> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // 옵션을 모르는 브라우저 · 못 읽는 형식 — <img> 로 다시 해 본다
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    // <img> 는 EXIF 방향을 기본으로 반영한다(image-orientation: from-image)
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } catch {
    throw new Error("이미지를 열 수 없어요. 이 기기에서 지원하지 않는 형식일 수 있어요");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 긴 변을 max 이하로 — 키우지는 않는다 */
function fit(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리할 수 없어요");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

/** 크게 줄일 때는 반씩 나눠 줄여 계단 · 뭉개짐을 줄인다 */
function draw(src: Source, width: number, height: number): HTMLCanvasElement {
  let image: CanvasImageSource = src.image;
  let w = src.width;
  let h = src.height;
  while (w / 2 >= width && h / 2 >= height) {
    const step = canvasOf(Math.round(w / 2), Math.round(h / 2));
    step.ctx.drawImage(image, 0, 0, step.canvas.width, step.canvas.height);
    image = step.canvas;
    w = step.canvas.width;
    h = step.canvas.height;
  }
  const out = canvasOf(width, height);
  out.ctx.drawImage(image, 0, 0, width, height);
  return out.canvas;
}

/** 투명한 픽셀이 있는가 — 작은 캔버스에서 알파만 본다 */
function hasAlpha(canvas: HTMLCanvasElement): boolean {
  const { width, height } = fit(canvas.width, canvas.height, 64);
  const { ctx } = canvasOf(width, height);
  ctx.drawImage(canvas, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * 파일을 읽어 본 이미지(긴 변 1600px) · 미리보기(48px)를 데이터 URL 로 만든다.
 * 이미지가 아니거나 너무 크면 Error(한국어 메시지)를 던진다
 */
export async function processImageFile(file: File): Promise<ProcessedImage> {
  if (!isImageFile(file)) throw new Error("이미지 파일만 넣을 수 있어요");
  if (file.size > MAX_INPUT_BYTES) throw new Error(`이미지가 너무 커요(최대 ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)}MB)`);
  const type = file.type.toLowerCase();
  const source = await decode(file);
  try {
    if (!source.width || !source.height) throw new Error("이미지를 열 수 없어요");
    const size = fit(source.width, source.height, MAX_EDGE);
    const full = draw(source, size.width, size.height);
    const alpha = type === "image/png" || type === "image/gif" || type === "image/webp" ? hasAlpha(full) : false;

    let src: string;
    let naturalWidth = size.width;
    let naturalHeight = size.height;
    if (type === "image/gif" && file.size <= GIF_KEEP_BYTES) {
      // 움직이는 GIF 를 지키려고 원본 그대로(크기도 원본)
      src = await readAsDataURL(file);
      naturalWidth = source.width;
      naturalHeight = source.height;
    } else if (alpha || type === "image/png" || type === "image/gif") {
      src = full.toDataURL("image/png");
    } else {
      src = full.toDataURL("image/jpeg", JPEG_QUALITY);
    }

    const t = fit(size.width, size.height, THUMB_EDGE);
    const thumbCanvas = draw({ image: full, width: full.width, height: full.height, close: () => undefined }, t.width, t.height);
    // JPEG 는 투명 부분이 검게 되니 투명한 이미지는 PNG 로
    const thumb = alpha ? thumbCanvas.toDataURL("image/png") : thumbCanvas.toDataURL("image/jpeg", THUMB_QUALITY);

    return { src, thumb, naturalWidth, naturalHeight };
  } finally {
    source.close();
  }
}
