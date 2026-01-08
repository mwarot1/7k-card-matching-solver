This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 7K Minigame Tools

Collection of tools to help with Seven Knights minigames.

### Features

1. **Card Matching Solver** (`/7k-card-matching-solver`)
   - AI-powered card matching solver
   - Screen recording & video upload support
   - Real-time card detection

2. **Coupon Redemption** (`/coupon-usage`)
   - Batch redeem multiple coupons
   - Pre-configured coupon list from `config/coupons.json`
   - Add/remove coupons manually

### Configuration

Edit `config/coupons.json` to update the default coupon list:

```json
{
  "coupons": [
    "COUPON1",
    "COUPON2",
    "COUPON3"
  ]
}
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
