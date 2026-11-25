# Hubtel bank payouts

Paylio's Hubtel payout adapter uses the published v1 **Send to Bank** API. It does not use the legacy `/v1/merchantaccount/.../transfers/out` endpoint or SMS Client ID / Client Secret credentials.

## Required environment

Configure these only in the backend secret manager; never commit credentials:

- `HUBTEL_API_ID` and `HUBTEL_API_KEY`: payment API credentials (HTTP Basic authentication)
- `HUBTEL_COLLECTION_ACCOUNT`: used for bank-account name verification
- `HUBTEL_DISBURSEMENT_ACCOUNT`: funds payouts and is used for payout status checks
- `HUBTEL_PAYOUT_CALLBACK_URL`: public HTTPS URL ending in `/api/webhooks/hubtel`
- `HUBTEL_TRANSFER_CONTRACT_VERIFIED=true`: set only after sandbox verification of the merchant's Send to Bank contract
- `HUBTEL_CALLBACK_INGRESS_ALLOWLIST_VERIFIED=true`: set only after the trusted ingress/firewall allowlists the documented Hubtel payout callback source and the trusted proxy chain is verified

The published Send Money / Send to Bank callback source is `18.202.122.131`. The app checks `req.ip` against `HUBTEL_CALLBACK_SOURCE_IPS`, which defaults to that address. If Hubtel confirms additional source addresses for this merchant/product, configure a comma-separated list only after validating them with Hubtel.

**Do not enable the ingress flag merely to make the endpoint work.** Hubtel's published production v1 contract does not define a verifiable callback signature. The sandbox signature header is not evidence of production signing support. The flag is an operator assertion that network-level ingress allowlisting and proxy trust are already correctly configured. If the hosting platform cannot enforce this safely, leave the flag disabled and keep live Hubtel payouts disabled.

## Payout flow

1. A finalized payroll item is claimed atomically with a fresh, unique client reference.
2. Before sending money, Paylio asks Hubtel to verify the bank account name and compares the normalized holder name with the employee record. A mismatch blocks payout.
3. A durable status-reconciliation job is committed with the claim before the provider request. A database failure after provider acceptance therefore does not leave the payout without a scheduled status check.
4. Paylio submits to `POST https://smp.hubtel.com/api/merchants/{disbursementAccount}/send/bank/gh/{bankCode}` using API ID/API Key HTTP Basic authentication.
5. Response code `0000` is treated as immediate success. `0001` remains PROCESSING. Ambiguous provider responses remain PROCESSING; they are never released for a blind retry.
6. A callback is only a signal to enqueue reconciliation. The worker checks the payout directly with Hubtel by client reference and verifies the returned reference and amount before updating payment state.
7. If no callback arrives, the scheduled worker checks status after five minutes. Pending/unknown results are retried with bounded backoff; exhausted jobs require manual investigation.

Run the background worker in production (`npm run worker`) as a separate process. Monitor failed `HUBTEL_PAYOUT_RECONCILIATION` jobs and investigate them before any manual retry.

## Important safety boundary

The callback body never directly marks a payroll item PAID or FAILED. Only a matching authoritative Hubtel status response can do that. Do not manually change a stuck PROCESSING item to FAILED until the provider confirms its final status; an uncertain payout may already have moved funds.
