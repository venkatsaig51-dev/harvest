# FarmDirect

FarmDirect connects Indian farmers with households and business buyers. The app supports produce discovery, farmer listings and order management, buyer checkout and tracking, business bulk requests, product reviews, and basic admin moderation.

## Run locally

From the workspace root:

```bash
pnpm install
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/farmdirect run dev
```

The web app uses the shared API at `/api`. The API creates a local SQLite database at `artifacts/api-server/data/farmdirect.sqlite` on first start and seeds sample listings and demo orders. Set `FARMDIRECT_DB_PATH` to use another database file.

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@farmdirect.com | admin123 |
| Farmer | farmer@farmdirect.com | farmer123 |
| Buyer | buyer@farmdirect.com | buyer123 |

Business accounts can be created from the registration screen.

## Marketplace behavior

- Product prices and order totals are in Indian rupees; product quantities are measured in kilograms by default.
- Checkout uses cash on delivery only. No payment gateway is connected.
- Order statuses move through Pending, Confirmed, Processing, Shipped, and Delivered. Buyers can cancel a pending order.
- Reviews are available after a delivered order.
- Product images use an image URL supplied with the listing.
- The API signs sessions with the `SESSION_SECRET` environment secret. Passwords are hashed with bcrypt.
