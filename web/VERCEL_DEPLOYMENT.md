# Vercel Deployment Guide

This Next.js app is configured for Vercel deployment with full feature support.

## Features

1. **Card Matching Solver** - Works on all platforms (client-side)
2. **Coupon Redemption** - Requires server-side API routes (Vercel/Netlify only)

## Deploy to Vercel

### Step 1: Push to GitHub
```bash
git add .
git commit -m "Ready for Vercel deployment"
git push
```

### Step 2: Import to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Click "Import Project"
3. Select your GitHub repository
4. Vercel will auto-detect Next.js settings

### Step 3: Configure Google Sheets (Optional)
If you want to use the "Load from Sheet" feature:

1. In Vercel project settings, go to **Environment Variables**
2. Add a new variable:
   - **Name**: `GOOGLE_SERVICE_ACCOUNT`
   - **Value**: Your entire `config/gg_sa_credential.json` content as a single-line JSON string
   
   Example:
   ```
   {"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}
   ```

3. Redeploy the project

**Without this variable:**
- ✅ Card solver works
- ✅ Coupon redemption works (using JSON config)
- ❌ "Load from Sheet" button will show error

**With this variable:**
- ✅ Everything works including Google Sheets integration

### Step 4: Deploy
Click "Deploy" - Vercel handles the rest automatically!

Your app will be live at: `https://your-project.vercel.app`

## Local Development

For local development, you can either:

**Option 1: Use config/coupons.json (Simple)**
- Edit `config/coupons.json` to add/remove coupons
- No Google Sheets setup needed

**Option 2: Use Google Sheets (Advanced)**
- Place your service account JSON in `config/gg_sa_credential.json`
- The file is git-ignored for security
- "Load from Sheet" button will work locally

## GitHub Pages (Limited Support)

GitHub Pages only supports the Card Solver feature. To deploy:

1. Uncomment these lines in `next.config.mjs`:
   ```js
   output: 'export',
   basePath: '/7k-card-matching-solver',
   assetPrefix: '/7k-card-matching-solver',
   ```

2. Build: `npm run build`
3. Deploy the `out` folder

**Note:** Coupon redemption won't work on GitHub Pages (no API routes).
