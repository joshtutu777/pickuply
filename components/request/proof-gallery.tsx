import { PhotoThumb } from "@/components/ui/photo-thumb";
import { createClient } from "@/lib/supabase/server";

type ProofPhoto = {
  id: string;
  stage: string;
  captured_at: string;
  note: string | null;
  media_kind: string | null;
  url: string;
};

async function proofPhotos(jobId: string, stages: string[]): Promise<ProofPhoto[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_photos")
    .select("id, storage_path, stage, captured_at, note, media_kind")
    .eq("job_id", jobId)
    .in("stage", stages)
    .order("created_at", { ascending: true });
  const photos: ProofPhoto[] = [];
  for (const photo of data ?? []) {
    const signed = await supabase.storage.from("job-photos").createSignedUrl(photo.storage_path, 300);
    if (!signed.data?.signedUrl) continue;
    photos.push({
      id: photo.id,
      stage: photo.stage,
      captured_at: photo.captured_at,
      note: photo.note,
      media_kind: photo.media_kind,
      url: signed.data.signedUrl,
    });
  }
  return photos;
}

export async function DropoffProof({ jobId }: { jobId: string }) {
  const photos = await proofPhotos(jobId, ["dropoff"]);
  if (photos.length === 0) return null;
  return (
    <ul className="grid gap-3">
      {photos.map((photo) => (
        <li key={photo.id}>
              <PhotoThumb src={photo.url} alt="Drop-off proof" />
        </li>
      ))}
    </ul>
  );
}

export async function PickupProof({ jobId, alt = "Pickup proof" }: { jobId: string; alt?: string }) {
  const photos = await proofPhotos(jobId, ["pickup"]);
  if (photos.length === 0) return null;
  return (
    <ul className="mt-3 flex gap-2">
      {photos.map((photo) => (
        <li key={photo.id}>
          <PhotoThumb src={photo.url} alt={alt} />
        </li>
      ))}
    </ul>
  );
}

export async function ProofGallery({ jobId }: { jobId: string }) {
  const photos = await proofPhotos(jobId, ["pickup", "dropoff", "dump_receipt"]);
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
              <PhotoThumb src={photo.url} alt={`${photo.stage.replaceAll("_", " ")} proof`} />
            )}
            {photo.note ? <p className="mt-2 text-base text-ink">{photo.note}</p> : null}
            <p className="mt-1 text-sm text-muted">{new Date(photo.captured_at).toLocaleString()}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
