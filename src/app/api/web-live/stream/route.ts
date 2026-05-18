import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { requireFeaturePermission } from '@/lib/permissions';

function getAntiCode(oldAntiCode: string, streamName: string): string {
  const paramsT = 100;
  const sdkVersion = 2403051612;
  const t13 = Date.now();
  const sdkSid = t13;
  const initUuid = (Math.floor(t13 % 10000000000 * 1000) + Math.floor(1000 * Math.random())) % 4294967295;
  const uid = Math.floor(Math.random() * (1400009999999 - 1400000000000 + 1)) + 1400000000000;
  const seqId = uid + sdkSid;
  const targetUnixTime = Math.floor((t13 + 110624) / 1000);
  const wsTime = targetUnixTime.toString(16).toLowerCase();

  const urlQuery = new URLSearchParams(oldAntiCode);
  const fm = urlQuery.get('fm');
  if (!fm) return oldAntiCode;

  const wsSecretPf = Buffer.from(decodeURIComponent(fm), 'base64').toString().split('_')[0];
  const wsSecretHash = crypto.createHash('md5').update(`${seqId}|${urlQuery.get('ctype')}|${paramsT}`).digest('hex');
  const wsSecret = `${wsSecretPf}_${uid}_${streamName}_${wsSecretHash}_${wsTime}`;
  const wsSecretMd5 = crypto.createHash('md5').update(wsSecret).digest('hex');

  return `wsSecret=${wsSecretMd5}&wsTime=${wsTime}&seqid=${seqId}&ctype=${urlQuery.get('ctype')}&ver=1&fs=${urlQuery.get('fs')}&uuid=${initUuid}&u=${uid}&t=${paramsT}&sv=${sdkVersion}&sdk_sid=${sdkSid}&codec=264`;
}

async function getBilibiliStream(roomId: string) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://live.bilibili.com/'
  };

  // 获取房间初始化信息
  const roomInitRes = await fetch(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${roomId}`, {
    headers
  });
  const roomInitData = await roomInitRes.json();

  if (roomInitData.code !== 0) {
    throw new Error(roomInitData.message || '获取房间信息失败');
  }

  const roomData = roomInitData.data;
  const realRoomId = roomData.room_id;
  const liveStatus = roomData.live_status; // 0=未开播, 1=直播中, 2=轮播
  const uid = roomData.uid;

  if (liveStatus !== 1) {
    throw new Error('直播未开启');
  }

  // 获取主播信息
  let ownerName = '';
  try {
    const userRes = await fetch(`https://api.live.bilibili.com/live_user/v1/Master/info?uid=${uid}`, {
      headers
    });
    const userData = await userRes.json();
    if (userData.code === 0) {
      ownerName = userData.data?.info?.uname || '';
    }
  } catch (err) {
    console.warn('获取主播信息失败:', err);
  }

  // 获取房间详细信息（包含标题）
  let title = '';
  try {
    const roomInfoRes = await fetch(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${realRoomId}`, {
      headers
    });
    const roomInfoData = await roomInfoRes.json();
    if (roomInfoData.code === 0) {
      title = roomInfoData.data?.title || '';
    }
  } catch (err) {
    console.warn('获取房间标题失败:', err);
  }

  // 获取播放地址 (原画质量 qn=10000)
  const playInfoRes = await fetch(
    `https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${realRoomId}&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&ptype=8`,
    { headers }
  );
  const playInfoData = await playInfoRes.json();

  if (playInfoData.code !== 0) {
    throw new Error(playInfoData.message || '获取播放信息失败');
  }

  const playurl = playInfoData.data?.playurl_info?.playurl;
  if (!playurl) {
    throw new Error('未找到播放地址');
  }

  // 提取m3u8地址
  let m3u8Url = '';
  const streamList = playurl.stream || [];

  for (const stream of streamList) {
    const formatList = stream.format || [];
    for (const fmt of formatList) {
      if (fmt.format_name === 'ts') {
        const codecList = fmt.codec || [];
        for (const codec of codecList) {
          const urlInfoList = codec.url_info || [];
          const baseUrl = codec.base_url || '';

          if (urlInfoList.length > 0 && baseUrl) {
            const host = urlInfoList[0].host || '';
            const extra = urlInfoList[0].extra || '';
            m3u8Url = `${host}${baseUrl}${extra}`;
            break;
          }
        }
        if (m3u8Url) break;
      }
    }
    if (m3u8Url) break;
  }

  if (!m3u8Url) {
    throw new Error('未找到m3u8地址');
  }

  return {
    url: m3u8Url,
    name: ownerName,
    title: title
  };
}

async function getDouyinStream(roomId: string) {
  const cookies = 'ttwid=1%7C2iDIYVmjzMcpZ20fcaFde0VghXAA3NaNXE_SLR68IyE%7C1761045455%7Cab35197d5cfb21df6cbb2fa7ef1c9262206b062c315b9d04da746d0b37dfbc7d';

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.97 Safari/537.36',
    'Referer': 'https://live.douyin.com/',
    'Cookie': cookies
  };

  // 构建API参数
  const params = new URLSearchParams({
    aid: '6383',
    app_name: 'douyin_web',
    live_id: '1',
    device_platform: 'web',
    language: 'zh-CN',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Chrome',
    browser_version: '116.0.0.0',
    web_rid: roomId,
    msToken: ''
  });

  const apiUrl = `https://live.douyin.com/webcast/room/web/enter/?${params.toString()}`;

  const response = await fetch(apiUrl, { headers });
  const jsonData = await response.json();

  if (!jsonData.data || !jsonData.data.data) {
    throw new Error('获取直播间信息失败');
  }

  const roomData = jsonData.data.data[0];
  const status = roomData.status;

  if (status !== 2) {
    throw new Error('直播未开启');
  }

  const streamUrl = roomData.stream_url;
  if (!streamUrl) {
    throw new Error('未找到流地址');
  }

  // 获取m3u8地址
  const hlsPullUrlMap = streamUrl.hls_pull_url_map;
  if (!hlsPullUrlMap) {
    throw new Error('未找到m3u8地址');
  }

  // 尝试获取原画质，如果没有则获取第一个可用的
  let m3u8Url = hlsPullUrlMap.ORIGIN || hlsPullUrlMap.FULL_HD1 || hlsPullUrlMap.HD1 || hlsPullUrlMap.SD1 || hlsPullUrlMap.SD2;

  if (!m3u8Url) {
    // 如果上述都没有，获取第一个可用的
    const urls = Object.values(hlsPullUrlMap);
    if (urls.length > 0) {
      m3u8Url = urls[0] as string;
    }
  }

  if (!m3u8Url) {
    throw new Error('未找到可用的m3u8地址');
  }

  // 返回流地址和主播信息
  return {
    url: m3u8Url,
    name: jsonData.data.user?.nickname || '',
    title: roomData.title || ''
  };
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'web_live', '无权限访问网络直播');
    if (authResult instanceof NextResponse) return authResult;
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get('platform');
    const roomId = searchParams.get('roomId');

    if (!platform || !roomId) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    if (platform === 'huya') {
      const res = await fetch(`https://www.huya.com/${roomId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const html = await res.text();

      const match = html.match(/stream:\s*(\{"data".*?),"iWebDefaultBitRate"/);
      if (!match) {
        return NextResponse.json({ error: '未找到直播数据' }, { status: 404 });
      }

      const jsonData = JSON.parse(match[1] + '}');
      const gameLiveInfo = jsonData.data?.[0]?.gameLiveInfo;
      const streamInfo = jsonData.data?.[0]?.gameStreamInfoList?.[0];

      if (!streamInfo) {
        return NextResponse.json({ error: '直播未开启' }, { status: 404 });
      }

      const { sFlvUrl, sStreamName, sFlvUrlSuffix, sFlvAntiCode } = streamInfo;
      const newAntiCode = getAntiCode(sFlvAntiCode, sStreamName);
      const streamUrl = `${sFlvUrl}/${sStreamName}.${sFlvUrlSuffix}?${newAntiCode}`;
      const proxyUrl = `/api/web-live/proxy/proxy.flv?url=${encodeURIComponent(streamUrl)}`;

      return NextResponse.json({
        url: proxyUrl,
        originalUrl: streamUrl,
        name: gameLiveInfo?.nick || '',
        title: gameLiveInfo?.introduction || ''
      });
    }

    if (platform === 'bilibili') {
      const streamData = await getBilibiliStream(roomId);
      const proxyUrl = `/api/web-live/proxy/proxy.m3u8?url=${encodeURIComponent(streamData.url)}`;

      return NextResponse.json({
        url: proxyUrl,
        originalUrl: streamData.url,
        name: streamData.name,
        title: streamData.title
      });
    }

    if (platform === 'douyin') {
      const streamData = await getDouyinStream(roomId);
      const proxyUrl = `/api/web-live/proxy/proxy.m3u8?url=${encodeURIComponent(streamData.url)}`;

      return NextResponse.json({
        url: proxyUrl,
        originalUrl: streamData.url,
        name: streamData.name,
        title: streamData.title
      });
    }

    return NextResponse.json({ error: '不支持的平台' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
