"use client";

import { useRef, useState } from "react";
import { AdvanceButton } from "@/components/driver/advance-button";
import { ProofForm } from "@/components/driver/proof-form";
import { saveDriverProof } from "@/lib/driver/save-proof";
import { proofMediaKind } from "@/lib/jobs/proof-file";
import { missingProofWarning, proofAfterSave, proofStageForStep } from "@/lib/jobs/proof-warning";

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
  const [saved, setSaved] = useState({ pickup: false, dropoff: false, receipt: false });
  const [chosen, setChosen] = useState<File | null>(null);
  const [savingProof, setSavingProof] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const saveLock = useRef(false);
  const proof = {
    pickup: saved.pickup || hasPickup,
    dropoff: saved.dropoff || hasDropoff,
    receipt: saved.receipt || hasReceipt,
  };
  const snapshot = {
    service,
    status,
    nextStatus,
    hasPickup: proof.pickup,
    hasDropoff: proof.dropoff,
    needsReceipt,
    hasReceipt: proof.receipt,
  };
  const blockedMessage = missingProofWarning(snapshot);

  function markSaved(stage: string) {
    setSaved((current) => ({
      pickup: current.pickup || stage === "pickup",
      dropoff: current.dropoff || stage === "dropoff",
      receipt: current.receipt || stage === "dump_receipt",
    }));
  }

  async function saveChosen(): Promise<string | null> {
    if (saveLock.current) return "Saving proof…";
    if (!chosen) return "Choose a photo or a short video.";
    const stage = proofStageForStep(snapshot);
    if (!stage) return null;
    saveLock.current = true;
    setSavingProof(true);
    const form = document.getElementById("driver-proof");
    const note = form?.querySelector<HTMLInputElement>('input[name="note"]')?.value ?? "";
    const share = form?.querySelector<HTMLInputElement>('input[name="shareLocation"]')?.checked ?? false;
    try {
      await saveDriverProof({
        jobId,
        stage,
        file: chosen,
        note,
        shareLocation: share,
        locationEnabled,
      });
      const remaining = proofAfterSave(snapshot, stage);
      markSaved(stage);
      setChosen(null);
      if (remaining) {
        saveLock.current = false;
        setSavingProof(false);
        setFormKey((key) => key + 1);
        return remaining;
      }
      return null;
    } catch (error) {
      saveLock.current = false;
      setSavingProof(false);
      return error instanceof Error ? error.message : "The proof could not be saved.";
    }
  }

  return (
    <>
      <AdvanceButton
        jobId={jobId}
        nextStatus={nextStatus}
        label={label}
        blockedMessage={blockedMessage}
        fileChosen={chosen != null && proofMediaKind(chosen) != null}
        prepare={chosen ? saveChosen : undefined}
      />
      <ProofForm
        key={formKey}
        jobId={jobId}
        locationEnabled={locationEnabled}
        defaultStage={proofStage}
        formId="driver-proof"
        locked={savingProof}
        onFile={setChosen}
        onSaved={markSaved}
      />
    </>
  );
}
