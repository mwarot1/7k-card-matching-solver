import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const SHEET_ID = '16E8p24Gm2jCAR0Ta7bDBq91TuMRDJ0M0xLJLFNJhMEE';
const SHEET_NAME = 'coupon';

// Cache for 1 minute to prevent spamming
export const revalidate = 60;

export async function GET(request: NextRequest) {
  try {
    // Load service account credentials from environment variable or file
    let credentials;
    
    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
      // Use environment variable (for Vercel deployment)
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    } else {
      // Fall back to file (for local development)
      const credentialPath = path.join(process.cwd(), 'config', 'gg_sa_credential.json');
      
      if (!fs.existsSync(credentialPath)) {
        return NextResponse.json(
          { error: 'Service account credentials not found. Please configure GOOGLE_SERVICE_ACCOUNT environment variable or add config/gg_sa_credential.json file.' },
          { status: 500 }
        );
      }

      credentials = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
    }

    // Initialize Google Sheets API
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Read data from the sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:B`, // Read columns A (coupon) and B (expire_flag)
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      return NextResponse.json({ coupons: [] });
    }

    // Parse the data (skip header row)
    const coupons: string[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const couponCode = row[0];
      const expireFlag = row[1];

      // Only include coupons where expire_flag is false
      if (couponCode && (expireFlag === 'FALSE' || expireFlag === 'false' || expireFlag === false)) {
        coupons.push(couponCode);
      }
    }

    return NextResponse.json({ coupons }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
      }
    });
  } catch (error) {
    console.error('Error fetching coupons from Google Sheets:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch coupons',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
