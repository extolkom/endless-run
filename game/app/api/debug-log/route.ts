import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.error(' [DEBUG LOG FROM CLIENT] ', JSON.stringify(body, null, 2));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(' [DEBUG LOG ERROR] ', error);
    return NextResponse.json({ success: false, error: String(error) });
  }
}
