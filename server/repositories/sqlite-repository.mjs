import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'staycurated.sqlite'));
const schema = fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8');
for (const statement of schema.split(';').map((item) => item.trim()).filter(Boolean)) db.exec(statement);

const audit = (action, entityType, entityId, metadata = null) => db.prepare('INSERT INTO audit_logs (action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?)').run(action, entityType, String(entityId), metadata ? JSON.stringify(metadata) : null);
const stayDates = (checkIn, checkOut) => {
  const dates = [];
  const cursor = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  while (cursor < end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};
const quoteBooking = ({ roomExperienceId, checkIn, checkOut }) => {
  const room = db.prepare('SELECT base_rate FROM room_experiences WHERE id = ?').get(roomExperienceId);
  if (!room) throw new Error('Room experience not found');
  const nightlyAmount = room.base_rate * stayDates(checkIn, checkOut).length;
  const taxAmount = Math.round(nightlyAmount * 0.07);
  return { nightlyAmount, taxAmount, serviceFee: 0, currency: 'THB', totalAmount: nightlyAmount + taxAmount };
};

const seed = db.prepare('SELECT COUNT(*) AS count FROM hotels').get();
if (seed.count === 0) {
  db.prepare('INSERT INTO hotels (id, name, city, type) VALUES (?, ?, ?, ?)').run(1, 'The Slate Phuket', 'Phuket · Nai Yang', 'Resort');
  db.prepare('INSERT INTO hotels (id, name, city, type) VALUES (?, ?, ?, ?)').run(2, '137 Pillars House', 'Chiang Mai · Old Town', 'Boutique');
  db.prepare('INSERT INTO room_experiences (id, hotel_id, name, base_rate, quietness, view, natural_light, privacy, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(1, 1, 'Garden-facing suite', 6850, 'Deeply restful', 'Lush garden', 'Soft morning light', 'Garden-facing', new Date().toISOString());
  for (const [date, rooms, rate] of [['2026-09-12', 3, 6850], ['2026-09-13', 2, 6850], ['2026-09-14', 1, 7200], ['2026-09-15', 4, 6850]]) db.prepare('INSERT INTO inventory (room_experience_id, stay_date, available_rooms, rate) VALUES (?, ?, ?, ?)').run(1, date, rooms, rate);
}

for (const [id, name] of [['customer', 'Customer'], ['hotel_manager', 'Hotel Manager'], ['platform_admin', 'Platform Admin']]) db.prepare('INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)').run(id, name);
db.prepare('INSERT OR IGNORE INTO rate_plans (id, room_experience_id, name, refundable, cancellation_deadline_hours, cancellation_penalty_percent) VALUES (?, ?, ?, ?, ?, ?)').run('flex-1', 1, 'Flexible rate', 1, 48, 0);

export const sqliteRepository = {
  listHotels: () => db.prepare('SELECT * FROM hotels ORDER BY id').all(),
  listBookings: () => db.prepare('SELECT * FROM bookings ORDER BY created_at DESC').all(),
  getBooking: (id) => db.prepare('SELECT * FROM bookings WHERE id = ?').get(id),
  createBooking: (booking) => {
    const insert = db.prepare('INSERT INTO bookings (id, hotel_id, room_experience_id, guest_name, guest_email, check_in, check_out, guest_count, total_amount, status, payment_status, payment_method, transaction_reference, special_request) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    try {
      db.exec('BEGIN IMMEDIATE');
      if (booking.roomExperienceId) {
        const decrement = db.prepare('UPDATE inventory SET available_rooms = available_rooms - 1 WHERE room_experience_id = ? AND stay_date = ? AND available_rooms > 0');
        for (const stayDate of stayDates(booking.checkIn, booking.checkOut)) {
          if (decrement.run(booking.roomExperienceId, stayDate).changes !== 1) throw new Error(`No availability for ${stayDate}`);
        }
      }
      const quote = booking.roomExperienceId ? quoteBooking(booking) : { nightlyAmount: booking.totalAmount, taxAmount: 0, serviceFee: 0, currency: 'THB', totalAmount: booking.totalAmount };
      const totalAmount = quote.totalAmount;
      insert.run(booking.id, booking.hotelId, booking.roomExperienceId ?? null, booking.guestName ?? 'Jane Doe', booking.guestEmail ?? 'jane@example.com', booking.checkIn, booking.checkOut, booking.guestCount, totalAmount, booking.status, booking.paymentStatus, booking.paymentMethod, booking.transactionReference ?? null, booking.specialRequest ?? null);
      db.prepare('INSERT INTO booking_price_breakdowns (booking_id, nightly_amount, tax_amount, service_fee, currency) VALUES (?, ?, ?, ?, ?)').run(booking.id, quote.nightlyAmount, quote.taxAmount, quote.serviceFee, quote.currency);
      if (booking.transactionReference) db.prepare('INSERT INTO payment_transactions (id, booking_id, provider, provider_reference, amount, status) VALUES (?, ?, ?, ?, ?, ?)').run(`payment-${booking.id}`, booking.id, 'manual', booking.transactionReference, totalAmount, booking.paymentStatus);
      audit('booking.created', 'booking', booking.id, { paymentStatus: booking.paymentStatus, roomExperienceId: booking.roomExperienceId ?? null });
      db.exec('COMMIT');
      return db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* transaction was not opened */ }
      throw error;
    }
  },
  updateInventory: ({ roomExperienceId, stayDate, availableRooms, rate }) => {
    db.prepare('INSERT INTO inventory (room_experience_id, stay_date, available_rooms, rate) VALUES (?, ?, ?, ?) ON CONFLICT(room_experience_id, stay_date) DO UPDATE SET available_rooms = excluded.available_rooms, rate = excluded.rate').run(roomExperienceId, stayDate, availableRooms, rate);
    return db.prepare('SELECT * FROM inventory WHERE room_experience_id = ? AND stay_date = ?').get(roomExperienceId, stayDate);
  },
  listRatePlans: () => db.prepare('SELECT * FROM rate_plans ORDER BY name').all(),
  quoteBooking,
  cancelBooking: ({ id, reason = 'Guest cancellation' }) => {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) throw new Error('Booking not found');
    if (booking.status === 'Cancelled') throw new Error('Booking is already cancelled');
    const policy = booking.room_experience_id ? db.prepare('SELECT * FROM rate_plans WHERE room_experience_id = ? ORDER BY created_at LIMIT 1').get(booking.room_experience_id) : null;
    const now = Date.now();
    const checkIn = new Date(`${booking.check_in}T00:00:00Z`).getTime();
    const withinPolicy = !policy?.cancellation_deadline_hours || checkIn - now >= policy.cancellation_deadline_hours * 60 * 60 * 1000;
    const refundAmount = policy?.refundable && withinPolicy ? booking.total_amount : 0;
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare('UPDATE bookings SET status = ?, payment_status = ? WHERE id = ?').run('Cancelled', refundAmount ? 'Refund pending' : booking.payment_status, id);
      if (booking.room_experience_id) for (const stayDate of stayDates(booking.check_in, booking.check_out)) db.prepare('UPDATE inventory SET available_rooms = available_rooms + 1 WHERE room_experience_id = ? AND stay_date = ?').run(booking.room_experience_id, stayDate);
      db.prepare('INSERT INTO booking_cancellations (id, booking_id, reason, refund_amount, status) VALUES (?, ?, ?, ?, ?)').run(`cancel-${id}`, id, reason, refundAmount, refundAmount ? 'Refund pending' : 'No refund');
      audit('booking.cancelled', 'booking', id, { reason, refundAmount });
      db.exec('COMMIT');
      return { booking: db.prepare('SELECT * FROM bookings WHERE id = ?').get(id), refundAmount };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* transaction was not opened */ }
      throw error;
    }
  },
  listPartnerSubmissions: () => db.prepare('SELECT * FROM partner_submissions ORDER BY created_at DESC').all(),
  createPartnerSubmission: (submission) => { db.prepare('INSERT INTO partner_submissions (id, hotel_name, status, details) VALUES (?, ?, ?, ?)').run(submission.id, submission.hotelName, submission.status, submission.details ?? null); audit('partner_submission.created', 'partner_submission', submission.id); return submission; },
  updatePartnerSubmissionStatus: (id, status) => { db.prepare('UPDATE partner_submissions SET status = ? WHERE id = ?').run(status, id); audit('partner_submission.status_updated', 'partner_submission', id, { status }); return db.prepare('SELECT * FROM partner_submissions WHERE id = ?').get(id); },
  listReviews: () => db.prepare('SELECT * FROM reviews ORDER BY created_at DESC').all(),
  createReview: (review) => { const result = db.prepare('INSERT INTO reviews (booking_id, rating, comment) VALUES (?, ?, ?)').run(review.bookingId ?? null, review.rating, review.comment); audit('review.created', 'review', result.lastInsertRowid, { bookingId: review.bookingId ?? null }); return db.prepare('SELECT * FROM reviews WHERE id = ?').get(result.lastInsertRowid); },
  listNotifications: () => db.prepare('SELECT * FROM notifications ORDER BY created_at DESC').all(),
  createNotification: (notice) => { db.prepare('INSERT INTO notifications (id, type, text) VALUES (?, ?, ?)').run(notice.id, notice.type, notice.text); audit('notification.created', 'notification', notice.id); return notice; },
  listPaymentTransactions: () => db.prepare('SELECT * FROM payment_transactions ORDER BY created_at DESC').all(),
  listBookingMessages: (bookingId) => db.prepare('SELECT * FROM booking_messages WHERE booking_id = ? ORDER BY created_at').all(bookingId),
  createBookingMessage: (message) => { db.prepare('INSERT INTO booking_messages (id, booking_id, sender_role, body) VALUES (?, ?, ?, ?)').run(message.id, message.bookingId, message.senderRole, message.body); audit('booking_message.created', 'booking', message.bookingId, { senderRole: message.senderRole }); return message; },
  listSupportCases: () => db.prepare('SELECT * FROM support_cases ORDER BY created_at DESC').all(),
  createSupportCase: (caseItem) => { db.prepare('INSERT INTO support_cases (id, booking_id, category, status, description) VALUES (?, ?, ?, ?, ?)').run(caseItem.id, caseItem.bookingId ?? null, caseItem.category, 'Open', caseItem.description); audit('support_case.created', 'support_case', caseItem.id); return { ...caseItem, status: 'Open' }; },
  requestBookingChange: (request) => { db.prepare('INSERT INTO booking_change_requests (id, booking_id, requested_check_in, requested_check_out, requested_guest_count, status) VALUES (?, ?, ?, ?, ?, ?)').run(request.id, request.bookingId, request.checkIn ?? null, request.checkOut ?? null, request.guestCount ?? null, 'Pending hotel review'); audit('booking_change.requested', 'booking', request.bookingId); return { ...request, status: 'Pending hotel review' }; },
  listBookingChangeRequests: (bookingId) => db.prepare('SELECT * FROM booking_change_requests WHERE booking_id = ? ORDER BY created_at DESC').all(bookingId),
  createEmailDelivery: (delivery) => { db.prepare('INSERT INTO email_deliveries (id, booking_id, recipient, template, status) VALUES (?, ?, ?, ?, ?)').run(delivery.id, delivery.bookingId ?? null, delivery.recipient, delivery.template, 'Queued for provider'); audit('email.queued', 'email_delivery', delivery.id, { template: delivery.template }); return { ...delivery, status: 'Queued for provider' }; },
  listEmailDeliveries: () => db.prepare('SELECT * FROM email_deliveries ORDER BY created_at DESC').all(),
  listPartnerPayouts: () => db.prepare('SELECT * FROM partner_payouts ORDER BY period_end DESC').all(),
  createPartnerPayout: (payout) => { db.prepare('INSERT INTO partner_payouts (id, hotel_id, period_start, period_end, gross_amount, commission_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(payout.id, payout.hotelId, payout.periodStart, payout.periodEnd, payout.grossAmount, payout.commissionAmount, payout.status ?? 'Draft'); audit('partner_payout.created', 'partner_payout', payout.id); return payout; },
  trackEvent: (event) => { db.prepare('INSERT INTO analytics_events (id, event_name, session_id, booking_id, properties) VALUES (?, ?, ?, ?, ?)').run(event.id, event.eventName, event.sessionId ?? null, event.bookingId ?? null, event.properties ? JSON.stringify(event.properties) : null); return event; },
  listAuditLogs: () => db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 100').all(),
};
