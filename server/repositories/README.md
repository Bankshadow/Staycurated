# Storage migration path

The UI and API use the repository contract in `contract.mjs`.

- Local MVP: `sqlite-repository.mjs` with Node SQLite.
- Supabase: create a `supabase-repository.mjs` implementing the same methods; map the SQL schema to Postgres migrations and enforce RLS by user role.
- Cloudflare: use D1 for bookings, inventory, reviews and partner records. Use KV only for cache, idempotency keys, rate limiting or notification fan-out; it is not a replacement for relational booking data.
