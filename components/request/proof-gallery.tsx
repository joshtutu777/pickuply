import { createClient } from "@/lib/supabase/server";

export async function ProofGallery({ jobId }: { jobId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_photos")
    .select("id, storage_path, stage, captured_at, note, media_kind")
    .eq("job_id", jobId)
    .in("stage", ["pickup", "dropoff", "dump_receipt"])
    .order("created_at", { ascending: true });
  const photos = [];
  for (const photo of data ?? []) {
    const signed = await supabase.storage.from("job-photos").createSignedUrl(photo.storage_path, 300);
    if (!signed.data?.signedUrl) continue;
    photos.push({ ...photo, url: signed.data.signedUrl });
  }
  if (photos.length === 0) return null;
  return (
    <section className="mt-6" aria-label="Proof">
      <h2 className="text-lg font-semibold text-ink">Proof</h2>
      <ul className="mt-3 grid gap-3">
        {photos.map((photo) => (
          <li key={photo.id} className="rounded-2xl bg-paper-raised p-3 ring-1 ring-line">
            <p className="text-sm font-semibold text-muted">{photo.stage.replaceAll("_", " ")}</p>
            {photo.media_kind === "video" ? (
              <video src={photo.url} controls className="mt-2 w-full rounded-2xl" />
            ) : (
              // Signed URL. It expires and is not a public file address.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.url} alt="" className="mt-2 aspect-square w-full rounded-2xl object-cover" />
            )}
            {photo.note ? <p className="mt-2 text-base text-ink">{photo.note}</p> : null}
            <p className="mt-1 text-sm text-muted">{new Date(photo.captured_at).toLocaleString()}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
