export const documentUploadHref: Record<string, string> = {
  license: "/driver/ready/license",
  insurance: "/driver/ready/insurance",
  vehicle: "/driver/ready/vehicle",
  equipment: "/driver/ready/equipment",
  services: "/driver/ready/services",
  training: "/driver/ready/training",
  agreement: "/terms/driver",
};

export function uploadLabel(item: string): string {
  return `Upload ${item} now`;
}
