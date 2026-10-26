import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const supabase = await createClient();
  const { data } = await supabase.from("blog_posts").select("id, cover_path").eq("status", "published").eq("slug", slug).maybeSingle();
  if (!data?.cover_path) return new NextResponse(null, { status: 404 });
  const file = data.cover_path.split("/").at(-1);
  if (!file) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(new URL(`/blog/media/${data.id}/${file}`, _request.url), 302);
}
