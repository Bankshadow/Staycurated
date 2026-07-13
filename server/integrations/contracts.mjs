/**
 * Provider-neutral integration contracts. Local development intentionally uses
 * manual operations; production adapters must be selected through environment
 * configuration and keep provider secrets server-side.
 */
export const paymentContract = ['createCheckout', 'verifyWebhook', 'refund'];
export const storageContract = ['createUploadUrl', 'finalizeUpload', 'getDownloadUrl'];
export const notificationContract = ['sendBookingConfirmation', 'sendCancellationUpdate', 'sendPartnerAlert'];
export const pmsContract = ['pullAvailability', 'pushReservation', 'pushCancellation', 'acknowledgeReservation'];

export const manualAdapters = {
  payment: { createCheckout: async () => ({ mode: 'manual' }), verifyWebhook: async () => false, refund: async () => ({ mode: 'manual' }) },
  notification: { sendBookingConfirmation: async () => ({ queued: true, channel: 'in_app' }), sendCancellationUpdate: async () => ({ queued: true, channel: 'in_app' }), sendPartnerAlert: async () => ({ queued: true, channel: 'in_app' }) },
  pms: { pullAvailability: async () => [], pushReservation: async () => ({ mode: 'manual' }), pushCancellation: async () => ({ mode: 'manual' }), acknowledgeReservation: async () => ({ mode: 'manual' }) },
};
