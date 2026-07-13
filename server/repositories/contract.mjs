/**
 * Storage contract used by the API. Implement this interface for SQLite now,
 * Supabase later, or D1 on Cloudflare. KV is intentionally reserved for
 * cache/idempotency/notification fan-out, not relational booking records.
 */
export const repositoryContract = [
  'listHotels', 'listBookings', 'getBooking', 'createBooking', 'cancelBooking', 'updateInventory', 'listRatePlans',
  'listPartnerSubmissions', 'createPartnerSubmission',
  'listReviews', 'createReview', 'listNotifications', 'createNotification',
  'listBookingMessages', 'createBookingMessage', 'listSupportCases', 'createSupportCase',
  'listPartnerPayouts', 'createPartnerPayout', 'listPaymentTransactions', 'trackEvent',
];
