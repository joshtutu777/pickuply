import assert from "node:assert/strict";
import test from "node:test";
import { feeProposal } from "./fee-proposal";

test("absorbing card processing keeps the driver share and lowers the customer total", () => {
  for (const dollars of [35, 50, 75, 100, 200]) {
    const proposal = feeProposal(dollars * 100);
    assert.equal(proposal.proposedCustomerCents, dollars * 100);
    assert.ok(proposal.currentCustomerCents > proposal.proposedCustomerCents);
    assert.equal(proposal.driverEarningsCents + proposal.commissionCents, dollars * 100);
    assert.equal(proposal.estimatedNetCents, proposal.commissionCents - proposal.estimatedStripeFeeCents);
    assert.ok(proposal.estimatedStripeFeeCents > 0);
  }
  const hundred = feeProposal(10_000);
  assert.equal(hundred.driverEarningsCents, 8_500);
  assert.equal(hundred.commissionCents, 1_500);
  assert.equal(hundred.estimatedStripeFeeCents, 320);
  assert.equal(hundred.estimatedNetCents, 1_180);
});
