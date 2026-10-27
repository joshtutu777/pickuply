"use client";

import { useState } from "react";
import { AdvanceButton } from "@/components/driver/advance-button";
import { ProofForm } from "@/components/driver/proof-form";
import { missingProofWarning } from "@/lib/jobs/proof-warning";

export function DriverActions({
  jobId,
  nextStatus,
  label,
  service,
  status,
  hasPickup,
  hasDropoff,
  needsReceipt,
  hasReceipt,
  locationEnabled,
  proofStage,
}: {
  jobId: string;
  nextStatus: string;
  label: string;
  service: string;
  status: string;
  hasPickup: boolean;
  hasDropoff: boolean;
  needsReceipt: boolean;
  hasReceipt: boolean;
  locationEnabled: boolean;
  proofStage: "pickup" | "dropoff" | "dump_receipt" | "no_show";
}) {
  const [saved, setSaved] = useState({ pickup: hasPickup, dropoff: hasDropoff, receipt: hasReceipt });
  const blockedMessage = missingProofWarning({
    service,
    status,
    nextStatus,
    hasPickup: saved.pickup,
    hasDropoff: saved.dropoff,
    needsReceipt,
    hasReceipt: saved.receipt,
  });

  return (
    <>
      <AdvanceButton jobId={jobId} nextStatus={nextStatus} label={label} blockedMessage={blockedMessage} />
      <ProofForm
        jobId={jobId}
        locationEnabled={locationEnabled}
        defaultStage={proofStage}
        onSaved={(stage) =>
          setSaved((current) => ({
            pickup: current.pickup || stage === "pickup",
            dropoff: current.dropoff || stage === "dropoff",
            receipt: current.receipt || stage === "dump_receipt",
          }))
        }
      />
    </>
  );
}
