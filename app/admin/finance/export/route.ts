import { NextResponse } from "next/server";
import { filterJobs, parseFinanceFilters, sortJobs, toCsv } from "@/lib/admin/finance";
import { loadFinanceJobs } from "@/lib/admin/finance-load";
import { requireAdmin } from "@/lib/auth/session";

export async function GET(request: Request) {
  await requireAdmin("/admin/finance");
  const url = new URL(request.url);
  const filters = parseFinanceFilters(url.searchParams);
  const loaded = await loadFinanceJobs();
  if (loaded.error) return NextResponse.json({ ok: false }, { status: 500 });
  const rows = sortJobs(filterJobs(loaded.jobs, filters), filters);
  return new NextResponse(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=\"pickuply-finance.csv\"",
    },
  });
}
