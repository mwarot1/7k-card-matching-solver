import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const couponCode = searchParams.get('couponCode');
  const memberId = searchParams.get('memberId');

  if (!couponCode || !memberId) {
    return NextResponse.json(
      { error: 'Missing required parameters: couponCode and memberId' },
      { status: 400 }
    );
  }

  try {
    const url = `https://coupon.netmarble.com/api/coupon/reward?gameCode=tskgb&couponCode=${encodeURIComponent(couponCode)}&langCd=EN_US&pid=${encodeURIComponent(memberId)}`;
    
    console.log('Proxying request to:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error proxying coupon request:', error);
    return NextResponse.json(
      { 
        error: 'Failed to redeem coupon',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
