import sharp from "sharp";
import {
  photoMaxBytes,
  photoMaxEdgePx,
  photoMaxPixels,
  photoSourceMaxBytes,
  photoTargetBytes,
} from "@/lib/constants";
import { decodeBmp } from "./bmp";
import { exceedsPixelLimit, sniffImage, type RasterKind } from "./sniff";

export type ImageUse = "photo" | "document";

export type ProcessedImage = {
  bytes: Buffer;
  width: number;
  height: number;
};

const tooLarge = "That photo is too large. Take a new picture instead.";
const notAPhoto = "That file isn't a photo. Choose a picture from your camera or photo library.";
const unreadable = "That photo couldn't be read. Try another picture, or take a new one.";

const sharpOptions = {
  limitInputPixels: photoMaxPixels,
  sequentialRead: true,
  failOn: "error" as const,
  pages: 1,
  animated: false,
};

/**
 * Turns a supported picture into a JPEG with no location metadata.
 * Documents keep more detail than ordinary photos.
 */
export async function processImage(input: Uint8Array, use: ImageUse = "photo"): Promise<ProcessedImage> {
  if (input.byteLength === 0) throw new Error("Choose a photo.");
  if (input.byteLength > photoSourceMaxBytes) throw new Error(tooLarge);
  const kind = sniffImage(input);
  if (!kind) throw new Error(notAPhoto);
  if (exceedsPixelLimit(input, kind)) throw new Error(tooLarge);

  try {
    const decoded = await decodeToPng(input, kind);
    const master = await sharp(decoded, sharpOptions)
      .rotate()
      .resize({
        width: photoMaxEdgePx,
        height: photoMaxEdgePx,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .removeAlpha()
      .png()
      .toBuffer();
    const bytes = await compress(master, use);
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new Error(unreadable);
    }
    if (meta.exif || meta.xmp || meta.iptc) throw new Error(unreadable);
    return { bytes, width: meta.width, height: meta.height };
  } catch (error) {
    if (error instanceof Error && [tooLarge, notAPhoto, unreadable, "Choose a photo."].includes(error.message)) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : "";
    if (/pixel limit|exceeds pixel/i.test(detail)) throw new Error(tooLarge);
    throw new Error(unreadable);
  }
}

async function decodeToPng(input: Uint8Array, kind: RasterKind): Promise<Buffer> {
  if (kind === "bmp") {
    const raster = decodeBmp(input);
    if (!raster) throw new Error(unreadable);
    return sharp(raster.data, { raw: { width: raster.width, height: raster.height, channels: 4 } }).png().toBuffer();
  }
  if (kind === "heif") return decodeHeif(input);
  return sharp(input, sharpOptions).rotate().png().toBuffer();
}

async function decodeHeif(input: Uint8Array): Promise<Buffer> {
  try {
    return await sharp(input, sharpOptions).png().toBuffer();
  } catch {
    const decode = (await import("heic-decode")).default;
    const image = await decode({ buffer: input });
    if (image.width * image.height > photoMaxPixels) throw new Error(tooLarge);
    return sharp(Buffer.from(image.data), {
      raw: { width: image.width, height: image.height, channels: 4 },
    })
      .png()
      .toBuffer();
  }
}

async function compress(master: Buffer, use: ImageUse): Promise<Buffer> {
  const qualities = use === "document" ? [90, 85, 80] : [83, 75, 67];
  const edges = use === "document" ? [photoMaxEdgePx, 1600] : [photoMaxEdgePx, 1600, 1280, 1024];
  let last: Buffer | null = null;
  for (const edge of edges) {
    for (const quality of qualities) {
      last = await sharp(master)
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .jpeg({
          quality,
          mozjpeg: true,
          chromaSubsampling: use === "document" ? "4:4:4" : "4:2:0",
        })
        .toBuffer();
      if (last.length <= photoTargetBytes) return last;
      if (use === "document" && quality === 80 && last.length <= photoMaxBytes) return last;
    }
    if (use === "document" && last && last.length <= photoMaxBytes) return last;
  }
  if (last && last.length <= photoMaxBytes) return last;
  throw new Error(tooLarge);
}
