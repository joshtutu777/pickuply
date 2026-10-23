"use client";

import { useState } from "react";
import { CoverageEditor } from "@/components/driver/coverage-editor";
import type { CoverageDraft } from "@/lib/driver/coverage";

export function AreasForm({ coverage }: { coverage: CoverageDraft }) {
  const [value, setValue] = useState(coverage);
  return <CoverageEditor value={value} onChange={setValue} persist />;
}
