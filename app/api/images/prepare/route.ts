import { connection } from "next/server";
import { photoSourceMaxBytes } from "@/lib/constants";
import { photoConversionEnabled } from "@/lib/images/conversion";
import { processImage, type ImageUse } from "@/lib/images/process-image";

export async function GET() {
  await connection();
  return Response.json({ enabled: photoConversionEnabled(process.env.PHOTO_CONVERSION) });
}

export async function POST(request: Request) {
  await connection();
  if (!photoConversionEnabled(process.env.PHOTO_CONVERSION)) {
    return new Response("Photo conversion is off.", { status: 409 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const use: ImageUse = form?.get("use") === "document" ? "document" : "photo";
  if (!(file instanceof File) || file.size === 0) {
    return new Response("Choose a photo.", { status: 400 });
  }
  if (file.size > photoSourceMaxBytes) {
    return new Response("That photo is too large. Take a new picture instead.", { status: 400 });
  }
  try {
    const processed = await processImage(new Uint8Array(await file.arrayBuffer()), use);
    return new Response(new Uint8Array(processed.bytes), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "no-store",
        "x-image-width": String(processed.width),
        "x-image-height": String(processed.height),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "This photo couldn't be prepared. Try again.";
    console.error(
      JSON.stringify({
        event: "photo_conversion_failed",
        use,
        bytes: file.size,
        message,
      }),
    );
    return new Response(message, { status: 400 });
  }
}
