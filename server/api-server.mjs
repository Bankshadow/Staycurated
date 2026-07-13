import http from 'node:http';
import { sqliteRepository as repository } from './repositories/sqlite-repository.mjs';

const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(value)); };
const body = async (req) => { let data = ''; for await (const chunk of req) data += chunk; return data ? JSON.parse(data) : {}; };

const routes = {
  '/api/hotels': ['GET', () => repository.listHotels()],
  '/api/bookings': ['GET', () => repository.listBookings()],
  '/api/rate-plans': ['GET', () => repository.listRatePlans()],
  '/api/partner-submissions': ['GET', () => repository.listPartnerSubmissions()],
  '/api/reviews': ['GET', () => repository.listReviews()],
  '/api/notifications': ['GET', () => repository.listNotifications()],
  '/api/audit-logs': ['GET', () => repository.listAuditLogs()],
  '/api/payment-transactions': ['GET', () => repository.listPaymentTransactions()],
  '/api/support-cases': ['GET', () => repository.listSupportCases()],
  '/api/partner-payouts': ['GET', () => repository.listPartnerPayouts()],
  '/api/email-deliveries': ['GET', () => repository.listEmailDeliveries()],
};

http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const route = routes[req.url];
    if (route && req.method === route[0]) return send(res, 200, route[1]());
    if (req.method === 'POST' && req.url === '/api/booking-quotes') return send(res, 200, repository.quoteBooking(await body(req)));
    if (req.method === 'POST' && req.url === '/api/bookings') return send(res, 201, repository.createBooking(await body(req)));
    if (req.method === 'POST' && req.url.startsWith('/api/bookings/') && req.url.endsWith('/cancel')) return send(res, 200, repository.cancelBooking({ id: req.url.split('/')[3], ...(await body(req)) }));
    if (req.method === 'GET' && req.url.startsWith('/api/bookings/') && req.url.endsWith('/messages')) return send(res, 200, repository.listBookingMessages(req.url.split('/')[3]));
    if (req.method === 'POST' && req.url.startsWith('/api/bookings/') && req.url.endsWith('/messages')) return send(res, 201, repository.createBookingMessage({ bookingId: req.url.split('/')[3], ...(await body(req)) }));
    if (req.method === 'GET' && req.url.startsWith('/api/bookings/') && req.url.endsWith('/change-requests')) return send(res, 200, repository.listBookingChangeRequests(req.url.split('/')[3]));
    if (req.method === 'POST' && req.url.startsWith('/api/bookings/') && req.url.endsWith('/change-requests')) return send(res, 201, repository.requestBookingChange({ bookingId: req.url.split('/')[3], ...(await body(req)) }));
    if (req.method === 'POST' && req.url === '/api/inventory') return send(res, 200, repository.updateInventory(await body(req)));
    if (req.method === 'POST' && req.url === '/api/partner-submissions') return send(res, 201, repository.createPartnerSubmission(await body(req)));
    if (req.method === 'PATCH' && req.url.startsWith('/api/partner-submissions/')) return send(res, 200, repository.updatePartnerSubmissionStatus(req.url.split('/').pop(), (await body(req)).status));
    if (req.method === 'POST' && req.url === '/api/reviews') return send(res, 201, repository.createReview(await body(req)));
    if (req.method === 'POST' && req.url === '/api/notifications') return send(res, 201, repository.createNotification(await body(req)));
    if (req.method === 'POST' && req.url === '/api/support-cases') return send(res, 201, repository.createSupportCase(await body(req)));
    if (req.method === 'POST' && req.url === '/api/partner-payouts') return send(res, 201, repository.createPartnerPayout(await body(req)));
    if (req.method === 'POST' && req.url === '/api/analytics/events') return send(res, 202, repository.trackEvent(await body(req)));
    if (req.method === 'POST' && req.url === '/api/email-deliveries') return send(res, 201, repository.createEmailDelivery(await body(req)));
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    return send(res, 422, { error: error instanceof Error ? error.message : 'Request failed' });
  }
}).listen(8787, () => console.log('SQLite API ready on http://127.0.0.1:8787'));
