export type CoverageDraft = {
  cities: string[];
  zips: string[];
  radius: number | null;
  radiusZip: string;
};

export function coverageSummary(input: {
  cities: string[];
  zips: string[];
  radiusMiles: number | null;
}): string {
  const places = [...input.cities, ...input.zips].map((place) => place.trim()).filter(Boolean);
  if (input.radiusMiles && places.length === 0) return `Within ${input.radiusMiles} mi`;
  if (input.radiusMiles) return `${places.join(", ")} +${input.radiusMiles} mi`;
  return places.join(", ");
}

export const defaultCoverage: CoverageDraft = {
  cities: [],
  zips: [],
  radius: 25,
  radiusZip: "",
};
