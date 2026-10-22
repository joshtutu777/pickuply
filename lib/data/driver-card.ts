import "server-only";

import { createClient } from "@/lib/supabase/server";

export type DriverCard = {
  firstName: string;
  photoUrl: string | null;
  vehicle: string;
};

export async function getAssignedDriverCard(jobId: string): Promise<DriverCard | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("assigned_driver_card", { target_job: jobId });
    const row = (data ?? [])[0] as
      | { first_name: string; photo_path: string | null; vehicle_label: string | null }
      | undefined;
    if (error || !row?.first_name) return null;
    let photoUrl: string | null = null;
    if (row.photo_path) {
      const signed = await supabase.storage.from("driver-docs").createSignedUrl(row.photo_path, 300);
      photoUrl = signed.data?.signedUrl ?? null;
    }
    return {
      firstName: row.first_name,
      photoUrl,
      vehicle: row.vehicle_label?.trim() ?? "",
    };
  } catch {
    return null;
  }
}
