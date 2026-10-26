import { NextResponse } from "next/server";
import { parseBlocks } from "@/lib/blog/content";
import { createClient } from "@/lib/supabase/server";

const fileName = /^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/i;

export async function GET(_request: Request, context: { params: Promise<{ postId: string; file: string }> }) {
  const { postId, file } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(postId) || !fileName.test(file)) return new NextResponse(null, { status: 404 });
  const path = `${postId}/${file}`;
  const supabase = await createClient();
  const post = await supabase.from("blog_posts").select("status, cover_path, body").eq("id", postId).maybeSingle();
  const blocks = parseBlocks(post.data?.body) ?? [];
  const allowed = post.data?.cover_path === path || blocks.some((block) => block.type === "image" && block.path === path);
  if (!post.data || !allowed) return new NextResponse(null, { status: 404 });
  const downloaded = await supabase.storage.from("blog-images").download(path);
  if (downloaded.error || !downloaded.data) return new NextResponse(null, { status: 404 });
  const type = file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return new NextResponse(downloaded.data, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
