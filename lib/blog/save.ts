import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { acceptImage } from "@/lib/blog/content";
import { photoConversionEnabled } from "@/lib/images/conversion";
import { processImage } from "@/lib/images/process-image";

export async function readImageFile(
  file: FormDataEntryValue | null,
): Promise<{ bytes: Uint8Array; ext: "jpg" | "png" | "webp" } | { error: string } | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!photoConversionEnabled(process.env.PHOTO_CONVERSION)) {
    const checked = acceptImage(bytes);
    if (!checked.ok) return { error: checked.error };
    return { bytes, ext: checked.ext };
  }
  try {
    const processed = await processImage(bytes, "photo");
    return { bytes: processed.bytes, ext: "jpg" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "That image could not be prepared.";
    console.error(JSON.stringify({ event: "photo_conversion_failed", use: "blog", bytes: bytes.byteLength, message }));
    return { error: message };
  }
}

export async function storeBlogImage(
  supabase: SupabaseClient,
  postId: string,
  bytes: Uint8Array,
  ext: "jpg" | "png" | "webp",
): Promise<{ path: string } | { error: string }> {
  const path = `${postId}/${crypto.randomUUID()}.${ext}`;
  const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const file = new Blob([Buffer.from(bytes)], { type });
  const saved = await supabase.storage.from("blog-images").upload(path, file, { contentType: type, upsert: false });
  if (saved.error) return { error: "The image could not be saved." };
  return { path };
}
