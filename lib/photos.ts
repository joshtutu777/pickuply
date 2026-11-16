import {
  photoMaxBytes,
  photoMaxEdgePx,
  photoMaxPixels,
  photoPrepareRequestBytes,
  photoSourceMaxBytes,
  videoMaxBytes,
  videoMaxSeconds,
} from "./constants";
import { decodeBmp, type DecodedRaster } from "./images/bmp";
import { decodeTiff } from "./images/decode-tiff";
import { exceedsPixelLimit, sniffImage, type RasterKind } from "./images/sniff";

const prepareFailed = "This photo couldn't be prepared. Try again.";
const legacyFailed = "This photo couldn't be prepared. Try a JPEG or PNG.";
const notAPhoto = "That file isn't a photo. Choose a picture from your camera or photo library.";
const tooLarge = "That photo is too large. Take a new picture instead.";
const legacyTooLarge = "Each photo must be 5 MB or smaller.";
const legacyMaxBytes = 5 * 1024 * 1024;
const legacyMaxEdgePx = 1600;

export const imageAccept = "image/*,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.avif";

/** Re-encodes a photo to JPEG so stored files do not keep GPS or other camera data. */
export async function compressImage(file: File): Promise<Blob> {
  return prepareStoredPhoto(file, "photo");
}

/**
 * Shrinks a phone photo before upload.
 * License and insurance photos use "document" so text stays easier to read.
 */
export async function prepareStoredPhoto(
  file: File,
  use: "photo" | "document" = "photo",
  enabled?: boolean,
): Promise<Blob> {
  if (file.size === 0) throw new Error("Choose a photo.");
  if (file.size > photoSourceMaxBytes) throw new Error(tooLarge);
  const on = enabled ?? (await photoConversionIsOn());
  if (!on) return legacyCompress(file);
  const header = new Uint8Array(await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer());
  const kind = sniffImage(header);
  if (!kind) throw new Error(notAPhoto);
  if (exceedsPixelLimit(header, kind)) throw new Error(tooLarge);

  let payload: Blob = file;
  if (file.size > photoPrepareRequestBytes) {
    payload = await shrinkForTransport(file, kind);
  }

  const body = new FormData();
  body.set("file", payload, "photo.jpg");
  body.set("use", use);
  let response: Response;
  try {
    response = await fetch("/api/images/prepare", { method: "POST", body });
  } catch {
    throw new Error("We couldn't reach Pickuply to prepare that photo. Try again.");
  }
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || prepareFailed);
  }
  const blob = await response.blob();
  await assertPreparedJpeg(blob);
  return blob;
}

export async function assertPreparedJpeg(blob: Blob): Promise<void> {
  const header = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (blob.type !== "image/jpeg" || !jpeg || blob.size === 0 || blob.size > photoMaxBytes) {
    throw new Error(prepareFailed);
  }
}

/** Re-encodes a short clip so the stored file does not keep the original location metadata. */
export async function prepareProofVideo(file: File): Promise<Blob> {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  video.src = url;
  video.muted = true;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("This video couldn't be prepared."));
    });
    if (!Number.isFinite(video.duration) || video.duration > videoMaxSeconds) {
      throw new Error("Video must be 30 seconds or less.");
    }
    const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    if (!capture || typeof MediaRecorder === "undefined") {
      throw new Error("This browser cannot prepare a video. Add a photo instead.");
    }
    await video.play();
    const recorder = new MediaRecorder(capture.call(video));
    const chunks: Blob[] = [];
    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
      recorder.onerror = () => reject(new Error("This video couldn't be prepared."));
      recorder.start();
      video.onended = () => recorder.stop();
      window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, Math.ceil(video.duration * 1000) + 500);
    });
    if (blob.size > videoMaxBytes) {
      throw new Error("That video is too large. Record a shorter clip.");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function photoConversionIsOn(): Promise<boolean> {
  try {
    const response = await fetch("/api/images/prepare", { method: "GET", cache: "no-store" });
    if (!response.ok) return false;
    const body = (await response.json()) as { enabled?: unknown };
    return body.enabled === true;
  } catch {
    return false;
  }
}

/** The browser upload path used when PHOTO_CONVERSION is not on. */
async function legacyCompress(file: File): Promise<Blob> {
  if (file.size > legacyMaxBytes) throw new Error(legacyTooLarge);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(legacyFailed);
  }
  const scale = Math.min(1, legacyMaxEdgePx / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error(legacyFailed);
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.8);
  });
  if (!blob) throw new Error(legacyFailed);
  return blob;
}

async function shrinkForTransport(file: File, kind: RasterKind): Promise<Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (exceedsPixelLimit(bytes, kind)) throw new Error(tooLarge);
  const raster = await rasterFrom(file, bytes, kind);
  if (typeof document === "undefined") throw new Error(prepareFailed);
  const longest = Math.max(raster.width, raster.height);
  const scale = Math.min(1, photoMaxEdgePx / longest);
  const width = Math.max(1, Math.round(raster.width * scale));
  const height = Math.max(1, Math.round(raster.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(prepareFailed);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  if (raster.image) {
    context.drawImage(raster.image, 0, 0, width, height);
    raster.image.close();
  } else if (raster.data) {
    const full = document.createElement("canvas");
    full.width = raster.width;
    full.height = raster.height;
    const source = full.getContext("2d");
    if (!source) throw new Error(prepareFailed);
    source.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
    context.drawImage(full, 0, 0, width, height);
  }
  let quality = 0.9;
  let blob = await canvasToJpeg(canvas, quality);
  while (blob.size > photoPrepareRequestBytes && quality > 0.6) {
    quality -= 0.1;
    blob = await canvasToJpeg(canvas, quality);
  }
  if (blob.size > photoPrepareRequestBytes) throw new Error(tooLarge);
  return blob;
}

async function rasterFrom(
  file: File,
  bytes: Uint8Array,
  kind: RasterKind,
): Promise<{ width: number; height: number; image?: ImageBitmap; data?: Uint8Array }> {
  if (typeof createImageBitmap === "function" && kind !== "heif" && kind !== "tiff") {
    try {
      const image = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { width: image.width, height: image.height, image };
    } catch {
      // The browser could not paint this file. A dedicated decoder is the next try.
    }
  }
  const decoded = await decodeSpecial(bytes, kind);
  return { width: decoded.width, height: decoded.height, data: decoded.data };
}

async function decodeSpecial(bytes: Uint8Array, kind: RasterKind): Promise<DecodedRaster> {
  if (kind === "bmp") {
    const decoded = decodeBmp(bytes);
    if (!decoded) throw new Error(notAPhoto);
    return decoded;
  }
  if (kind === "tiff") return decodeTiff(bytes);
  if (kind === "heif") {
    const decode = (await import("heic-decode")).default;
    const image = await decode({ buffer: bytes });
    if (image.width * image.height > photoMaxPixels) throw new Error(tooLarge);
    return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
  }
  throw new Error(notAPhoto);
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(prepareFailed));
      },
      "image/jpeg",
      quality,
    );
  });
}
