# Paystack Ghana salary payout setup

Paylio's selected live salary-disbursement provider is Paystack. The first supported payout rail is Ghana bank-account transfer in GHS. Mobile-money payroll is not included in this initial bank-account flow.

## Implementation contract

The Paystack payout path uses:

1. Create a transfer recipient with type `ghipss`, employee account name, account number, Paystack bank code, and currency `GHS`.
2. Initiate a transfer from Paystack balance with currency `GHS`, a stable Paylio payment reference, and amount expressed in pesewas (GHS × 100).
3. Keep the payroll item in `PROCESSING` after Paystack accepts the request.
4. Mark the payroll item `PAID` only after a verified `transfer.success` webhook. A verified `transfer.failed` or `transfer.reversed` event moves it to `FAILED`.

A successful HTTP response or a Paystack `pending` / `otp` transfer response is not proof that an employee has received funds. Do not mark salary as paid from the transfer-initiation response.

The bank code is a Paystack bank identifier, not the human-readable bank name. Use Paystack's List Banks API for Ghana and the `GHS` currency, filter to the `ghipss` bank channel, and exclude Bank of Ghana as Paystack currently advises. Confirm the exact code and account details before authorizing payroll.

## Render backend environment

Configure these values in the Render backend service. Never put secret values in Vercel frontend environment variables, source control, issue comments, or chat.

- `PAYSTACK_SECRET_KEY`: Paystack TEST secret key in staging; LIVE secret key only after all release gates pass.
- `PAYSTACK_WEBHOOK_SECRET`: webhook signing secret used by the deployed verifier. If your Paystack dashboard/documentation for the account uses the standard HMAC secret-key scheme, set this to the same environment's Paystack secret key. Do not mix test and live credentials.
- `ENABLE_LIVE_PAYOUTS=false` until all tests and manual checks pass.
- `PAYSTACK_TRANSFER_CONFIGURATION_VERIFIED=false` until Paystack confirms transfers are enabled for this Ghana business and the complete sandbox/reconciliation checklist is signed off.

The code's fail-closed gate requires both payout flags to be explicitly set to `true`, valid Paystack credentials, and an employee bank code before live transfer requests can be sent. Do not switch these flags on merely to test login, payroll calculations, or payslip generation.

## Paystack Dashboard and account onboarding

- Complete the business profile and compliance/KYC steps; use the registered business profile that owns Paylio's Paystack integration.
- Confirm with Paystack that the Ghana business account is eligible and enabled for the Transfers product, not merely for accepting customer payments.
- Confirm the account's transfer balance/funding and payout schedule. Transfers draw from the Paystack balance and require the transfer amount plus fees.
- Ask Paystack to confirm Ghana bank-transfer recipient support, allowed transfer limits, fees, settlement expectations, and the current bank-code list.
- Confirm how transfer OTP and URL approval are configured for this merchant. Paylio currently does not implement an interactive OTP approval flow. Do not assume an `otp` response is a completed transfer; have Paystack confirm the supported automated approval configuration or implement the required approval flow before production.
- Add the public webhook URL `https://usepaylio-backend.onrender.com/api/webhooks/paystack` to the correct Paystack environment (test first, then live). Confirm the exact URL if the backend hostname changes.
- Subscribe to/enable transfer events and verify that `transfer.success`, `transfer.failed`, and `transfer.reversed` reach the endpoint.
- Confirm webhook signature verification against the exact Paystack secret/signing scheme for the account. Do not disable signature verification.

## Sandbox acceptance tests

Use Paystack TEST keys and non-production employee data. Do not use real payroll or live employee bank data for test transfers.

- Fetch the Ghana bank list and validate each selected bank code against Paystack's current response.
- Validate employee name, bank, and account number using Paystack's supported account-resolution flow before creating a recipient.
- Create a `ghipss` recipient and confirm its returned details match the intended beneficiary.
- Initiate a low-value GHS test transfer and verify the amount sent is exactly the expected pesewa integer.
- Verify that the payroll item stays `PROCESSING` after transfer initiation.
- Deliver valid test `transfer.success`, `transfer.failed`, and `transfer.reversed` events and verify each final state.
- Replay the same webhook and confirm it does not cause duplicate side effects or an invalid state transition.
- Send a webhook with an invalid signature and confirm it is rejected.
- Simulate API timeout / 5xx after request submission. The item must remain `PROCESSING` for reconciliation; do not blindly retry an ambiguous transfer.
- Confirm a duplicate transfer reference cannot cause a second salary payment.
- Reconcile Paylio's payment reference, Paystack transfer record, amount, fees, and final state.

## First live payroll controls

- Obtain written approval from the employer/customer payroll approver.
- Confirm Paystack balance covers the entire payroll batch and applicable fees.
- Reconfirm the payroll period, employee count, net-pay total, and each beneficiary bank account.
- Start with a small, controlled, explicitly approved live test payment.
- Reconcile the Paystack dashboard and the employee's receipt before processing the remaining payroll.
- Keep the global live payout switch off outside the approved disbursement window.
- Maintain a documented manual reconciliation and support process for transfers stuck in `PROCESSING`, failed, or reversed.

## References

- Paystack Ghana single transfers: https://paystack.com/docs/transfers/single-transfers/
- Paystack transfer recipients: https://paystack.com/docs/transfers/creating-transfer-recipients/
- Paystack transfer API: https://paystack.com/docs/api/transfer/
- Paystack bank list API: https://paystack.com/docs/api/miscellaneous/
- Paystack webhooks: https://paystack.com/docs/payments/webhooks/
