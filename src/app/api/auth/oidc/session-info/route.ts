import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const oidcSessionCookie = request.cookies.get('oidc_session')?.value;

    if (!oidcSessionCookie) {
      return NextResponse.json({ error: 'OIDC会话不存在' }, { status: 404 });
    }

    let oidcSession;
    try {
      oidcSession = JSON.parse(oidcSessionCookie);
    } catch {
      return NextResponse.json({ error: 'OIDC会话无效' }, { status: 400 });
    }

    // 检查session是否过期(10分钟)
    if (Date.now() - oidcSession.timestamp > 600000) {
      return NextResponse.json({ error: 'OIDC会话已过期' }, { status: 400 });
    }

    // 返回用户信息(不包含sub)
    return NextResponse.json({
      email: oidcSession.email,
      name: oidcSession.name,
      trust_level: oidcSession.trust_level,
    });
  } catch (error) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
