# Production integration boundary

The MVP runs with SQLite and manual payment/partner workflows. These boundaries keep the application ready for real providers without coupling booking code to one vendor.

## Payment provider contract

- `createCheckout({ bookingId, amount, currency, customer })` returns a provider reference and redirect URL.
- `verifyWebhook({ headers, rawBody })` verifies the provider signature before changing `payment_transactions.status` or a booking payment status.
- `refund({ transactionId, amount })` records a provider refund reference and audit entry.

Manual/pay-at-hotel remains a valid provider mode and does not handle card data.

## File storage contract

- `createUploadUrl({ ownerId, contentType, sizeBytes })` returns a short-lived upload URL and storage key.
- `finalizeUpload({ storageKey })` stores the verified metadata in `uploads`.
- `getDownloadUrl({ storageKey })` returns a short-lived private download URL.

Use local storage while developing. For production, use Supabase Storage or Cloudflare R2. Do not store files or payment credentials in SQLite.

## Data migration

Move relational data (`bookings`, inventory, users, reviews, partner approvals) from SQLite to Supabase Postgres or Cloudflare D1. Cloudflare KV is suitable only for cache, rate limits, idempotency keys and ephemeral notifications; it is not the booking database.

## Messaging and PMS contract

Use the notification contract for booking confirmation, cancellation updates and partner alerts. Use the PMS contract to pull availability, push reservations/cancellations, and acknowledge a reservation. The local adapter stays in manual mode until a hotel partner supplies channel-manager or PMS credentials and a sandbox account.
