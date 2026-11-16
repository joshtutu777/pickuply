import { photoMaxPixels } from "@/lib/constants";

export type RasterKind = "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "heif" | "avif";

const heifBrands = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);
const avifBrands = new Set(["avif", "avis"]);

/** Identifies a picture from its bytes. A file name is not evidence. */
export function sniffImage(bytes: Uint8Array): RasterKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "gif";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  ) {
    return "tiff";
  }
  if (ascii(bytes, 4, 8) !== "ftyp") return null;
  const brand = ascii(bytes, 8, 12).replace(/\0/g, "").trim().toLowerCase();
  if (heifBrands.has(brand)) return "heif";
  if (avifBrands.has(brand)) return "avif";
  return null;
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && ascii(bytes, 0, 4) === "%PDF";
}

/** Reads the size written in the file header and rejects a decompression bomb before decode. */
export function declaredPixelCount(bytes: Uint8Array, kind: RasterKind): number | null {
  if (kind === "png") return pngPixels(bytes);
  if (kind === "gif") return gifPixels(bytes);
  if (kind === "bmp") return bmpPixels(bytes);
  if (kind === "jpeg") return jpegPixels(bytes);
  if (kind === "heif" || kind === "avif") return ispePixels(bytes);
  return null;
}

export function exceedsPixelLimit(bytes: Uint8Array, kind: RasterKind): boolean {
  const count = declaredPixelCount(bytes, kind);
  return count != null && count > photoMaxPixels;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let text = "";
  for (let index = start; index < end && index < bytes.length; index += 1) {
    text += String.fromCharCode(bytes[index] ?? 0);
  }
  return text;
}

function pngPixels(bytes: Uint8Array): number | null {
  if (bytes.length < 24 || ascii(bytes, 12, 16) !== "IHDR") return null;
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  if (width <= 0 || height <= 0) return null;
  return width * height;
}

function gifPixels(bytes: Uint8Array): number | null {
  if (bytes.length < 10) return null;
  const width = bytes[6] + (bytes[7] << 8);
  const height = bytes[8] + (bytes[9] << 8);
  if (width <= 0 || height <= 0) return null;
  return width * height;
}

function bmpPixels(bytes: Uint8Array): number | null {
  if (bytes.length < 26) return null;
  const width = Math.abs(readInt32(bytes, 18));
  const height = Math.abs(readInt32(bytes, 22));
  if (width <= 0 || height <= 0) return null;
  return width * height;
}

function jpegPixels(bytes: Uint8Array): number | null {
  let index = 2;
  while (index + 8 < bytes.length) {
    if (bytes[index] !== 0xff) {
      index += 1;
      continue;
    }
    const marker = bytes[index + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x00 || marker === 0x01) {
      index += 2;
      continue;
    }
    const length = ((bytes[index + 2] ?? 0) << 8) + (bytes[index + 3] ?? 0);
    if (length < 2) return null;
    const startOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (startOfFrame) {
      const height = ((bytes[index + 5] ?? 0) << 8) + (bytes[index + 6] ?? 0);
      const width = ((bytes[index + 7] ?? 0) << 8) + (bytes[index + 8] ?? 0);
      if (width <= 0 || height <= 0) return null;
      return width * height;
    }
    if (marker === 0xda) return null;
    index += 2 + length;
  }
  return null;
}

function ispePixels(bytes: Uint8Array): number | null {
  const token = [0x69, 0x73, 0x70, 0x65];
  for (let index = 0; index + 16 < bytes.length; index += 1) {
    if (token.every((value, offset) => bytes[index + offset] === value)) {
      const width = readUint32(bytes, index + 8);
      const height = readUint32(bytes, index + 12);
      if (width > 0 && height > 0) return width * height;
    }
  }
  return null;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function readInt32(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset] + ((bytes[offset + 1] ?? 0) << 8) + ((bytes[offset + 2] ?? 0) << 16) + ((bytes[offset + 3] ?? 0) << 24);
  return value | 0;
}
