import { base58Encode } from './utils';

export const detectNetdiskLink = (
  url: string
): {
  provider: 'quark' | 'mobile' | 'baidu' | 'tianyi' | '123' | 'uc' | '115';
  shareUrl: string;
  passcode?: string;
} | null => {
  const trimmed = url.trim();

  const pickPasscode = (...values: Array<string | undefined>) =>
    values.map((item) => item?.trim()).find(Boolean);

  const inlinePasscode = (text: string) =>
    pickPasscode(
      text.match(/(?:提取码|访问码|密码)\s*[:：=]?\s*([a-zA-Z0-9]{4,8})/i)?.[1],
      text.match(/[?&](?:pwd|passcode|accessCode)=([^&\s]+)/i)?.[1]
    );

  if (
    /https:\/\/(?:www\.)?123(?:684|865|912|pan)\.(?:com|cn)\/s\//i.test(trimmed)
  ) {
    return {
      provider: '123',
      shareUrl: trimmed,
      passcode: pickPasscode(
        trimmed.match(/[?&]pwd=([^&]+)/i)?.[1],
        inlinePasscode(trimmed)
      ),
    };
  }

  if (
    /https:\/\/cloud\.189\.cn\/(web\/share\?code=|t\/)/i.test(trimmed) ||
    /https:\/\/h5\.cloud\.189\.cn\/share\.html#\/t\//i.test(trimmed)
  ) {
    return {
      provider: 'tianyi',
      shareUrl: trimmed,
      passcode: pickPasscode(
        trimmed.match(/[?&]pwd=([^&]+)/i)?.[1],
        inlinePasscode(trimmed)
      ),
    };
  }

  if (/pan\.baidu\.com\/(s\/|wap\/init\?surl=)/i.test(trimmed)) {
    return {
      provider: 'baidu',
      shareUrl: trimmed,
      passcode: pickPasscode(
        trimmed.match(/[?&](?:pwd|accessCode)=([^&]+)/i)?.[1],
        inlinePasscode(trimmed)
      ),
    };
  }

  if (/https:\/\/pan\.quark\.cn\/s\//i.test(trimmed)) {
    return {
      provider: 'quark',
      shareUrl: trimmed,
      passcode: pickPasscode(
        trimmed.match(/[?&](?:pwd|passcode)=([^&]+)/i)?.[1],
        inlinePasscode(trimmed)
      ),
    };
  }

  if (/https:\/\/drive\.uc\.cn\/s\//i.test(trimmed)) {
    return {
      provider: 'uc',
      shareUrl: trimmed,
      passcode: pickPasscode(
        trimmed.match(/[?&](?:pwd|passcode)=([^&]+)/i)?.[1],
        inlinePasscode(trimmed)
      ),
    };
  }

  if (/https:\/\/(?:yun|caiyun)\.139\.com\//i.test(trimmed)) {
    return { provider: 'mobile', shareUrl: trimmed };
  }

  if (/https:\/\/(?:115|anxia|115cdn)\.com\/s\//i.test(trimmed)) {
    return {
      provider: '115',
      shareUrl: trimmed,
      passcode: pickPasscode(
        trimmed.match(/[?&](?:password|pwd|passcode)=([^&]+)/i)?.[1],
        inlinePasscode(trimmed)
      ),
    };
  }

  return null;
};

/** Keep the existing player route/encoding and netdisk permission boundary. */
export function buildDirectPlayTarget(
  value: string,
  netdiskTempPlayEnabled: boolean
): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('请输入可直接播放的视频链接');
  const netdisk = detectNetdiskLink(trimmed);
  if (netdisk && !netdiskTempPlayEnabled) {
    throw new Error('无权限使用临时播放');
  }
  if (netdisk) {
    const source = `netdisk-${netdisk.provider}`;
    const id = base58Encode(
      JSON.stringify({
        shareUrl: netdisk.shareUrl,
        passcode: netdisk.passcode || '',
      })
    );
    if (!id) throw new Error('网盘链接编码失败');
    return `/play?source=${encodeURIComponent(source)}&id=${encodeURIComponent(
      id
    )}&title=${encodeURIComponent('网盘直链播放')}`;
  }
  const id = base58Encode(trimmed);
  if (!id) throw new Error('视频链接编码失败');
  return `/play?source=directplay&id=${encodeURIComponent(id)}`;
}
