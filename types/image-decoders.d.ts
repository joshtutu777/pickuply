declare module "heic-decode" {
  export default function decode(input: { buffer: Uint8Array }): Promise<{
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }>;
}

declare module "utif" {
  interface TiffPage {
    width: number;
    height: number;
  }

  const UTIF: {
    decode(bytes: Uint8Array): TiffPage[];
    decodeImage(bytes: Uint8Array, page: TiffPage): void;
    toRGBA8(page: TiffPage): Uint8Array;
  };

  export default UTIF;
}
