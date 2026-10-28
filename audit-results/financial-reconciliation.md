# Financial reconciliation

Environment: local database settings, plus one isolated Stripe test PaymentIntent. No production job was read or changed. Stripe stayed in test mode.

## Settings used by `price_breakdown`

| Item | Value |
| --- | --- |
| Commission | 1,500 bps (15%) |
| Service fee | 500 bps (5%) |
| Example offer | 5,000 cents ($50.00) |
| Pickuply commission | 750 cents ($7.50) |
| Driver earnings | 4,250 cents ($42.50), 85% of the offer |
| Customer service fee | 250 cents ($2.50) |
| Customer total | 5,250 cents ($52.50) |

The database ledger for the completed local delivery was 4,250 cents. A $5.00 tip wrote one ledger row of 500 cents. A second confirm of the same tip returned `duplicate` and did not add a second row. A tip marked live was rejected with "live payments are not enabled."

## What this does not prove

| Piece | Result |
| --- | --- |
| Booking authorization | An isolated test PaymentIntent for 5,250 cents reached `requires_capture`, then was canceled. It was not a customer booking and was not attached to a Pickuply Stripe customer. |
| Capture | `record_capture` moved the local job to `completed` / `captured`. Stripe was not asked to capture a booking. |
| Platform commission | 750 cents on the $50 example, taken from the offer. |
| Driver earnings | 4,250 cents on that offer, then 500 cents for the tip with no commission and no service fee on the tip. |
| Stripe Connect transfer | Not created. |
| Bank payout | Not tested. A Connect transfer would still not be a bank deposit. Test mode cannot pay a real bank account. |

Cancellation of the unpaid local assignment returned outcome `free` and status `cancelled`. No late-cancel fee was charged, which matches the current zero fee settings.
