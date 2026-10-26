import { NextResponse } from "next/server";
import { getOptionalSession } from "@/lib/auth/session";
import { readImageFile, storeBlogImage } from "@/lib/blog/save";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const session = await getOptionalSession();
  if (session?.role !== "admin") return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const form = await request.formData();
  const postId = form.get("postId");
  const alt = form.get("alt");
  if (typeof postId !== "string" || !/^[0-9a-f-]{36}$/i.test(postId)) {
    return NextResponse.json({ error: "Save the article first." }, { status: 400 });
  }
  if (typeof alt !== "string" || alt.trim().length < 1 || alt.trim().length > 180) {
    return NextResponse.json({ error: "Describe the image before uploading it." }, { status: 400 });
  }
  const image = await readImageFile(form.get("file"));
  if (!image) return NextResponse.json({ error: "Choose an image." }, { status: 400 });
  if ("error" in image) return NextResponse.json({ error: image.error }, { status: 400 });
  const supabase = await createClient();
  const post = await supabase.from("blog_posts").select("id").eq("id", postId).maybeSingle();
  if (!post.data) return NextResponse.json({ error: "That article was not found." }, { status: 404 });
  const stored = await storeBlogImage(supabase, postId, image.bytes, image.ext);
  if ("error" in stored) return NextResponse.json({ error: stored.error }, { status: 400 });
  return NextResponse.json({ path: stored.path });
}
