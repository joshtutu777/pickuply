import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { createLedgerTransfer, findTransferByLedger } from "./transfer-stripe";

const key = process.env.STRIPE_SECRET_KEY ?? process.env.STRIPE_TEST_SECRET_KEY ?? "";
const destination = "acct_1UVgsND5IFSb3cY3";

test(
  "a test charge transfers once and a second send does not create another",
  { skip: key.startsWith("sk_test_") ? false : "Stripe test key is not set" },
  async () => {
    const stripe = new Stripe(key);
    const entryId = crypto.randomUUID();
    // tok_bypassPending is Stripe's test token for 4000000000000077. Raw card numbers are turned off.
    const method = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_bypassPending" },
    });
    const intent = await stripe.paymentIntents.create({
      amount: 100,
      currency: "usd",
      payment_method: method.id,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    });
    const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
    assert.ok(chargeId);
    let transferId = "";
    try {
      assert.equal(await findTransferByLedger(stripe, entryId), null);
      transferId = await createLedgerTransfer(stripe, {
        entryId,
        amountCents: 100,
        destination,
        chargeId,
      });
      assert.match(transferId, /^tr_/);
      const again = await createLedgerTransfer(stripe, {
        entryId,
        amountCents: 100,
        destination,
        chargeId,
      });
      assert.equal(again, transferId);
      const listed = await stripe.transfers.list({ transfer_group: entryId, limit: 10 });
      assert.equal(listed.data.length, 1);
      assert.equal(listed.data[0]?.id, transferId);
    } finally {
      if (transferId) await stripe.transfers.createReversal(transferId);
      if (chargeId) await stripe.refunds.create({ charge: chargeId });
    }
  },
);
