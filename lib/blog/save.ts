import "server-only";

import { acceptImage } from "@/lib/blog/content";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function readImageFile(file: FormDataEntryValue | null): Promise<{ bytes: Uint8Array; ext: "jpg" | "png" | "webp" } | { error: string } | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = acceptImage(bytes);
  if (!checked.ok) return { error: checked.error };
  return { bytes, ext: checked.ext };
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
