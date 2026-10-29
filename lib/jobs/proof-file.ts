type ProofFile = { type: string; name: string; size: number };

/** The file the driver chose. The change event is not required, because a camera capture input can keep the file without firing one. */
export function proofInputFile(chosen: ProofFile | null, input: { files?: ArrayLike<ProofFile> | null } | null): ProofFile | null {
  if (chosen && proofMediaKind(chosen)) return chosen;
  const file = input?.files?.[0] ?? null;
  if (file && proofMediaKind(file)) return file;
  return null;
}

/** A phone camera often leaves the file type blank. The name is the backup check. */
export function proofMediaKind(file: ProofFile): "photo" | "video" | null {
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
