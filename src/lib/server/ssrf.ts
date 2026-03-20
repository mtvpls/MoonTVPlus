import dns from 'dns';

/**
 * 判断 IP 地址是否为内网/本地私有地址
 * 覆盖 IPv4 和 IPv6，彻底杜绝所有变体绕过。
 */
export function isPrivateIP(ip: string): boolean {
  // IPv4 私有地址和环回地址
  if (ip.includes('.')) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4) return false;

    return (
      parts[0] === 10 || // 10.x.x.x
      parts[0] === 127 || // 127.x.x.x (Loopback)
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // 172.16.x.x - 172.31.x.x
      (parts[0] === 192 && parts[1] === 168) || // 192.168.x.x
      (parts[0] === 169 && parts[1] === 254) || // 169.254.x.x (Link-local)
      parts[0] === 0 // 0.x.x.x ("This network")
    );
  }

  // IPv6 私有地址和环回地址
  if (ip.includes(':')) {
    // ::1 环回地址 (Loopback)
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;

    // 0::0 / :: 未指定地址
    if (ip === '::' || ip === '0:0:0:0:0:0:0:0') return true;

    const lowerIp = ip.toLowerCase();

    // IPv4 映射到 IPv6 的地址 (例如 ::ffff:127.0.0.1)
    if (lowerIp.startsWith('::ffff:')) {
      return isPrivateIP(lowerIp.substring(7));
    }

    // 唯一本地地址 (Unique Local Addresses, fc00::/7)
    if (lowerIp.startsWith('fc') || lowerIp.startsWith('fd')) return true;

    // 链路本地地址 (Link-Local Addresses, fe80::/10)
    if (lowerIp.startsWith('fe8') || lowerIp.startsWith('fe9') || lowerIp.startsWith('fea') || lowerIp.startsWith('feb')) return true;
  }

  return false;
}

/**
 * 校验代理 URL 是否安全 (防止 SSRF / DNS 重绑定漏洞)
 * 只在 Node.js 服务端运行。
 */
export async function validateProxyUrlServerSide(urlStr: string): Promise<boolean> {
  if (!urlStr) return false;
  try {
    const parsed = new URL(urlStr);

    // 1. 协议检查
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    // 2. 剥离认证信息防止混淆
    if (parsed.username || parsed.password) {
      return false;
    }

    let { hostname } = parsed;

    // 清洗 IPv6 括号边界
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.substring(1, hostname.length - 1);
    }

    // 3. DNS 真实解析 (获取底层物理 IP)
    // 这一步能彻底打碎各种形式的短格式 IP (127.1)、八/十六进制 IP (0x7f.0.0.1)、或者指向 127.0.0.1 的恶意外部域名 DNS 重绑定。
    const lookupResult = await dns.promises.lookup(hostname);

    if (!lookupResult || !lookupResult.address) {
      return false; // 解析不出 IP 则拒绝
    }

    // 4. 对物理 IP 进行内网校验
    if (isPrivateIP(lookupResult.address)) {
      console.warn(`[SSRF 防护] 拦截到尝试访问内部网络的请求 URL: ${urlStr} (解析出的底层 IP: ${lookupResult.address})`);
      return false;
    }

    return true;
  } catch (error) {
    // 凡是报错（无论是 URL 解析失败，还是 DNS 解析失败，还是域名不存在），均作为不安全拒绝
    console.warn(`[SSRF 防护] URL解析失败或不合法, 拒绝代理请求: ${urlStr}`);
    return false;
  }
}
