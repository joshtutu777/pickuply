import { photoMaxPixels } from "@/lib/constants";
import UTIF from "utif";
import type { DecodedRaster } from "./bmp";

/** First page of a TIFF. Used when the browser cannot paint the file itself. */
export function decodeTiff(bytes: Uint8Array): DecodedRaster {
  const pages = UTIF.decode(bytes);
  const page = pages[0];
  if (!page || page.width <= 0 || page.height <= 0) {
    throw new Error("That photo couldn't be read. Try another picture, or take a new one.");
  }
  if (page.width * page.height > photoMaxPixels) {
    throw new Error("That photo is too large. Take a new picture instead.");
  }
  UTIF.decodeImage(bytes, page);
  return { width: page.width, height: page.height, data: UTIF.toRGBA8(page) };
}
