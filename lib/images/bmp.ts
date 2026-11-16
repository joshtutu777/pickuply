import { photoMaxPixels } from "@/lib/constants";

export type DecodedRaster = {
  width: number;
  height: number;
  data: Uint8Array;
};

/** Uncompressed Windows BMP. The picture is returned right-side up with a white-ready alpha channel. */
export function decodeBmp(bytes: Uint8Array): DecodedRaster | null {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  const pixelOffset = readUint32(bytes, 10);
  const headerSize = readUint32(bytes, 14);
  if (headerSize < 40) return null;
  const width = Math.abs(readInt32(bytes, 18));
  const heightRaw = readInt32(bytes, 22);
  const topDown = heightRaw < 0;
  const height = Math.abs(heightRaw);
  const planes = readUint16(bytes, 26);
  const bitCount = readUint16(bytes, 28);
  const compression = readUint32(bytes, 30);
  if (planes !== 1 || (bitCount !== 24 && bitCount !== 32)) return null;
  if (compression !== 0 && compression !== 3) return null;
  if (width <= 0 || height <= 0 || width * height > photoMaxPixels) return null;
  const stride = Math.floor((bitCount * width + 31) / 32) * 4;
  if (pixelOffset + stride * height > bytes.length) return null;
  const data = new Uint8Array(width * height * 4);
  const bytesPerPixel = bitCount / 8;
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const row = pixelOffset + sourceY * stride;
    for (let x = 0; x < width; x += 1) {
      const source = row + x * bytesPerPixel;
      const output = (y * width + x) * 4;
      data[output] = bytes[source + 2] ?? 0;
      data[output + 1] = bytes[source + 1] ?? 0;
      data[output + 2] = bytes[source] ?? 0;
      data[output + 3] = bitCount === 32 ? (bytes[source + 3] ?? 255) : 255;
    }
  }
  return { width, height, data };
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    ((bytes[offset + 1] ?? 0) << 8) +
    ((bytes[offset + 2] ?? 0) << 16) +
    ((bytes[offset + 3] ?? 0) * 0x1000000)
  );
}

function readInt32(bytes: Uint8Array, offset: number): number {
  return readUint32(bytes, offset) | 0;
}
