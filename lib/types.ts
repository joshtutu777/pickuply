import type {
  HearAbout,
  ItemSize,
  JunkLoadSize,
  PricingMethod,
  ServiceId,
  StairChoice,
  TimeWindow,
  ZoneSlug,
} from "./constants";

/** Fields the customer edits. Sensitive contact and street values live here only while the page is open. */
export type RequestDraft = {
  service: ServiceId | "";
  description: string;
  listingUrl: string;
  pieces: string;
  size: ItemSize | "";
  itemValue: string;
  alreadyPaid: "" | "yes" | "no";
  sellerHolding: "" | "yes" | "no";
  wantsItemCheck: "" | "yes" | "no";
  pickupStreet: string;
  pickupCity: string;
  pickupZip: string;
  dropoffStreet: string;
  dropoffCity: string;
  dropoffZip: string;
  accessNotes: string;
  stairsPickup: StairChoice | "";
  stairsDropoff: StairChoice | "";
  elevator: "" | "yes" | "no";
  helpLoading: "" | "yes" | "no";
  preferredDate: string;
  timeWindow: TimeWindow | "";
  notes: string;
  junkLoadSize: JunkLoadSize | "";
  junkMaterials: string;
  junkMattress: boolean;
  junkTires: boolean;
  junkAppliances: boolean;
  storeName: string;
  storeOrderNumber: string;
  pricingMethod: PricingMethod | "";
  offerDollars: string;
  budgetMinDollars: string;
  budgetMaxDollars: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  hearAbout: HearAbout | "";
  agreedToTerms: boolean;
};

export const sensitiveDraftFields = [
  "pickupStreet",
  "dropoffStreet",
  "customerPhone",
  "customerEmail",
] as const satisfies readonly (keyof RequestDraft)[];

export type SensitiveDraftField = (typeof sensitiveDraftFields)[number];

/**
 * Public job fields from SPEC §14. Exact addresses, name, phone, email,
 * and access notes are intentionally absent.
 */
export type PublicJob = {
  id: string;
  customer_id: null;
  service: ServiceId;
  status: "requested";
  zone_id: ZoneSlug | null;
  pickup_area: string;
  dropoff_area: string | null;
  description: string;
  pieces: number | null;
  size: ItemSize | null;
  item_value_cents: number | null;
  needs_value_approval: boolean;
  listing_url: string | null;
  already_paid: boolean | null;
  seller_holding: boolean | null;
  wants_item_check: boolean | null;
  stairs_pickup: number;
  stairs_dropoff: number | null;
  elevator: boolean;
  help_loading: boolean;
  junk_load_size: JunkLoadSize | null;
  junk_materials: string | null;
  junk_special_items: {
    mattress: boolean;
    tires: boolean;
    appliances: boolean;
  } | null;
  store_name: string | null;
  store_order_number: string | null;
  preferred_date: string;
  time_window: TimeWindow | null;
  notes: string | null;
  pricing_method: PricingMethod;
  offer_cents: number | null;
  budget_min_cents: number | null;
  budget_max_cents: number | null;
  source: HearAbout | null;
  photo_ids: string[];
  created_at: string;
};

/**
 * Private fields. Email is not a SPEC §14 job_private column (email lives on profiles).
 * The temporary store keeps it here until accounts exist.
 */
export type PrivateJob = {
  job_id: string;
  pickup_address: string;
  dropoff_address: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  access_notes: string | null;
};

export function emptyDraft(service: ServiceId | "" = ""): RequestDraft {
  return {
    service,
    description: "",
    listingUrl: "",
    pieces: "",
    size: "",
    itemValue: "",
    alreadyPaid: "",
    sellerHolding: "",
    wantsItemCheck: "",
    pickupStreet: "",
    pickupCity: "",
    pickupZip: "",
    dropoffStreet: "",
    dropoffCity: "",
    dropoffZip: "",
    accessNotes: "",
    stairsPickup: "0",
    stairsDropoff: "0",
    elevator: "no",
    helpLoading: "no",
    preferredDate: service === "free_item" ? "asap" : "",
    timeWindow: "",
    notes: "",
    junkLoadSize: "",
    junkMaterials: "",
    junkMattress: false,
    junkTires: false,
    junkAppliances: false,
    storeName: "",
    storeOrderNumber: "",
    pricingMethod: "quote",
    offerDollars: "",
    budgetMinDollars: "",
    budgetMaxDollars: "",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    hearAbout: "",
    agreedToTerms: false,
  };
}
