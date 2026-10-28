/** A phone camera often leaves the file type blank. The name is the backup check. */
export function proofMediaKind(file: { type: string; name: string; size: number }): "photo" | "video" | null {
  if (file.size <= 0) return null;
  const type = file.type.toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "photo";
  const name = file.name.toLowerCase();
  if (/\.(mp4|mov|webm|m4v)$/.test(name)) return "video";
  if (/\.(jpe?g|png|webp|gif|heic|heif)$/.test(name)) return "photo";
  if (type === "") return "photo";
  return null;
}
