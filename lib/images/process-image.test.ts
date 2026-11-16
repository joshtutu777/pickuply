import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { photoMaxEdgePx, photoSourceMaxBytes, photoTargetBytes } from "../constants";
import { processImage } from "./process-image";
import { sniffImage } from "./sniff";

test("common pictures become JPEGs within the size and edge limits", async () => {
  const cases = [
    ["jpeg", await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "red" } }).jpeg().toBuffer()],
    ["png", await sharp({ create: { width: 30, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()],
    ["webp", await sharp({ create: { width: 80, height: 40, channels: 3, background: "blue" } }).webp().toBuffer()],
    ["gif", await sharp({ create: { width: 16, height: 16, channels: 3, background: "green" } }).gif().toBuffer()],
    ["tiff", await sharp({ create: { width: 64, height: 32, channels: 3, background: "orange" } }).tiff().toBuffer()],
    ["avif", await sharp({ create: { width: 50, height: 40, channels: 3, background: "purple" } }).avif().toBuffer()],
    ["bmp", bmp(4, 3, [255, 0, 0])],
  ] as const;

  for (const [name, bytes] of cases) {
    const processed = await processImage(bytes, "photo");
    assert.equal(processed.bytes[0], 0xff, name);
    assert.equal(processed.bytes[1], 0xd8, name);
    assert.equal(processed.bytes[2], 0xff, name);
    assert.ok(processed.width <= photoMaxEdgePx, name);
    assert.ok(processed.height <= photoMaxEdgePx, name);
    assert.ok(processed.bytes.length <= photoTargetBytes, name);
    const meta = await sharp(processed.bytes).metadata();
    assert.equal(meta.format, "jpeg", name);
    assert.equal(meta.exif, undefined, name);
  }
});

test("a small photo is not stretched", async () => {
  const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).jpeg().toBuffer();
  const processed = await processImage(bytes, "photo");
  assert.equal(processed.width, 20);
  assert.equal(processed.height, 10);
});

test("a wide photo is limited to 1920 pixels on the long edge", async () => {
  const noise = Buffer.alloc(2400 * 1400 * 3);
  for (let index = 0; index < noise.length; index += 1) noise[index] = (index * 17) % 256;
  const bytes = await sharp(noise, { raw: { width: 2400, height: 1400, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  const processed = await processImage(bytes, "photo");
  assert.equal(processed.width, 1920);
  assert.equal(processed.height, 1120);
  assert.ok(processed.bytes.length <= photoTargetBytes);
});

test("a transparent picture is flattened onto white", async () => {
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  const processed = await processImage(bytes, "photo");
  const pixels = await sharp(processed.bytes).removeAlpha().raw().toBuffer();
  assert.equal(pixels[0], 255);
  assert.equal(pixels[1], 255);
  assert.equal(pixels[2], 255);
});

test("camera orientation is applied and location metadata is removed", async () => {
  const wide = await sharp({ create: { width: 40, height: 16, channels: 3, background: "red" } }).jpeg().toBuffer();
  const turned = await sharp(wide).withMetadata({ orientation: 6 }).toBuffer();
  const processed = await processImage(turned, "photo");
  assert.equal(processed.width, 16);
  assert.equal(processed.height, 40);
  assert.equal((await sharp(processed.bytes).metadata()).exif, undefined);
});

test("the file name is ignored and a corrupt picture is rejected", async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  assert.equal(sniffImage(png), "png");
  const processed = await processImage(png, "photo");
  assert.equal(processed.bytes[0], 0xff);

  await assert.rejects(() => processImage(Buffer.from("<html><script>no</script>"), "photo"), /isn't a photo/);
  await assert.rejects(() => processImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "photo"), /couldn't be read/);
});

test("an enormous file and a pixel bomb are rejected before they are stored", async () => {
  await assert.rejects(() => processImage(Buffer.alloc(photoSourceMaxBytes + 1), "photo"), /too large/);
  const bomb = Buffer.alloc(32);
  bomb.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
  bomb.write("IHDR", 12);
  bomb.writeUInt32BE(20_000, 16);
  bomb.writeUInt32BE(20_000, 20);
  await assert.rejects(() => processImage(bomb, "photo"), /too large/);
});

test("a document photo stays a readable JPEG", async () => {
  const bytes = await sharp({ create: { width: 800, height: 500, channels: 3, background: "white" } }).png().toBuffer();
  const processed = await processImage(bytes, "document");
  assert.equal(processed.width, 800);
  assert.equal(processed.height, 500);
  assert.equal((await sharp(processed.bytes).metadata()).format, "jpeg");
});

const heicSample = process.env.PICKUPLY_HEIC_SAMPLE;
test("a real HEIC photo becomes a JPEG", { skip: heicSample == null || !fs.existsSync(heicSample) }, async () => {
  const bytes = fs.readFileSync(heicSample ?? "");
  const processed = await processImage(bytes, "photo");
  assert.equal(sniffImage(bytes), "heif");
  assert.ok(processed.width <= photoMaxEdgePx);
  assert.ok(processed.height <= photoMaxEdgePx);
  assert.ok(processed.bytes.length <= photoTargetBytes);
  assert.equal(processed.bytes[0], 0xff);
});

function bmp(width: number, height: number, rgb: [number, number, number]): Buffer {
  const stride = Math.floor((24 * width + 31) / 32) * 4;
  const pixels = stride * height;
  const file = Buffer.alloc(54 + pixels);
  file.write("BM", 0);
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(54, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = 54 + y * stride + x * 3;
      file[offset] = rgb[2];
      file[offset + 1] = rgb[1];
      file[offset + 2] = rgb[0];
    }
  }
  return file;
}
