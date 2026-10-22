import { photoMaxEdgePx, videoMaxBytes, videoMaxSeconds } from "./constants";

export async function compressImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This photo couldn't be prepared. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, photoMaxEdgePx / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("This photo couldn't be prepared. Try a JPEG or PNG.");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.8);
  });
  if (!blob) throw new Error("This photo couldn't be prepared. Try a JPEG or PNG.");
  return blob;
}

/** Re-encodes a short clip so the stored file does not keep the original location metadata. */
export async function prepareProofVideo(file: File): Promise<Blob> {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  video.src = url;
  video.muted = true;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("This video couldn't be prepared."));
    });
    if (!Number.isFinite(video.duration) || video.duration > videoMaxSeconds) {
      throw new Error("Video must be 30 seconds or less.");
    }
    const capture = (
      video as HTMLVideoElement & { captureStream?: () => MediaStream }
    ).captureStream;
    if (!capture || typeof MediaRecorder === "undefined") {
      throw new Error("This browser cannot prepare a video. Add a photo instead.");
    }
    await video.play();
    const recorder = new MediaRecorder(capture.call(video));
    const chunks: Blob[] = [];
    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
      recorder.onerror = () => reject(new Error("This video couldn't be prepared."));
      recorder.start();
      video.onended = () => recorder.stop();
      window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, Math.ceil(video.duration * 1000) + 500);
    });
    if (blob.size > videoMaxBytes) {
      throw new Error("That video is too large. Record a shorter clip.");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
