/**
 * PHOTO_CONVERSION is server-only. "on" uses the JPEG converter.
 * Any other value, including a blank value, keeps the previous upload path.
 * Changing this does not read or rewrite photos that are already stored.
 */
export function photoConversionEnabled(value: string | undefined): boolean {
  return value === "on";
}
