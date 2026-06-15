import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const data = new URL(request.url).searchParams.get('data') || '';

    if (!data) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
    }

    const svg = await QRCode.toString(data, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });

    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || '二维码生成失败' },
      { status: 500 }
    );
  }
}
