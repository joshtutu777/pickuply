import { PhotoThumb } from "@/components/ui/photo-thumb";
import { createClient } from "@/lib/supabase/server";

const proofStages = ["pickup", "dropoff", "dump_receipt"] as const;

type ProofStage = (typeof proofStages)[number];

type SignedProof = {
  id: string;
  stage: ProofStage;
  url: string;
};

type ProofGroup = {
  label: string;
  empty: string;
  photos: SignedProof[];
};

export async function DeliveryProof({
  jobId,
  service,
  receiptRequired,
}: {
  jobId: string;
  service: string;
  receiptRequired: boolean;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_photos")
    .select("id, storage_path, stage")
    .eq("job_id", jobId)
    .in("stage", [...proofStages])
    .order("created_at", { ascending: true });

  if (error) {
    return (
      <section className="mt-6" aria-label="Delivery proof">
        <h2 className="text-lg font-semibold text-ink">Delivery proof</h2>
        <p className="mt-2 text-base text-danger">Delivery proof could not be loaded. Refresh the page.</p>
      </section>
    );
  }

  const photos: SignedProof[] = [];
  let unsigned = 0;
  for (const photo of data ?? []) {
    const signed = await supabase.storage.from("job-photos").createSignedUrl(photo.storage_path, 300);
    if (!signed.data?.signedUrl) {
      unsigned += 1;
      continue;
    }
    photos.push({ id: photo.id, stage: photo.stage as ProofStage, url: signed.data.signedUrl });
  }

  const groups = proofGroups(service, receiptRequired, photos);

  return (
    <section className="mt-6" aria-label="Delivery proof">
      <h2 className="text-lg font-semibold text-ink">Delivery proof</h2>
      <div className="mt-3 grid gap-4">
        {groups.map((group) => (
          <div key={group.label}>
            <h3 className="text-base font-semibold text-ink">{group.label}</h3>
            {group.photos.length === 0 ? (
              <p className="mt-1 text-base text-muted">{group.empty}</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {group.photos.map((photo) => (
                  <li key={photo.id}>
                    <PhotoThumb src={photo.url} alt={group.label} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {unsigned > 0 ? (
        <p className="mt-3 text-base text-muted">A photo could not be opened. Refresh the page for a new link.</p>
      ) : null}
    </section>
  );
}

function proofGroups(service: string, receiptRequired: boolean, photos: SignedProof[]): ProofGroup[] {
  const junk = service === "junk";
  const of = (stage: ProofStage) => photos.filter((photo) => photo.stage === stage);
  const pickup = of("pickup");
  const dropoff = of("dropoff");
  const receipts = of("dump_receipt");
  const groups: ProofGroup[] = [
    junk
      ? { label: "Removal completion photo", empty: "No removal completion photo yet.", photos: pickup }
      : { label: "Pickup proof", empty: "No pickup proof yet.", photos: pickup },
  ];
  if (!junk || dropoff.length > 0) {
    groups.push({ label: "Drop-off proof", empty: "No drop-off proof yet.", photos: dropoff });
  }
  if (receiptRequired || receipts.length > 0) {
    groups.push({ label: "Disposal receipt", empty: "No disposal receipt yet.", photos: receipts });
  }
  return groups;
}
