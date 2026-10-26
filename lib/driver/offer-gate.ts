/** Whether the offer form may call the database. The database also rejects an offline driver. */
export function offerMaySubmit(input: { online: boolean; approved: boolean; vehicleOk: boolean }): boolean {
  return input.online && input.approved && input.vehicleOk;
}

/** The offline notice is for an approved driver. It does not replace a setup or vehicle block. */
export function showOfflineOfferNotice(input: { online: boolean; approved: boolean }): boolean {
  return input.approved && !input.online;
}
