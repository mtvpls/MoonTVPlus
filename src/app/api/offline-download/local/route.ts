/**
 * 本地下载视频播放代理 API
 */

import * as fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import * as path from 'path';

import { getAuthInfoFromCookie } from '@/lib/auth';

// 检查是否启用离线下载功能
const OFFLINE_DOWNLOAD_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD === 'true';
const OFFLINE_DOWNLOAD_DIR = process.env.OFFLINE_DOWNLOAD_DIR || '/data';

/**
 * 检查用户权限（仅管理员和站长）
 */
function checkPermission(request: NextRequest): boolean {
  if (!OFFLINE_DOWNLOAD_ENABLED) {
    return false;
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return false;
  }

  // 只有管理员和站长可以访问
  return authInfo.role === 'owner' || authInfo.role === 'admin';
}

/**
 * GET - 代理本地视频文件
 */
export async function GET(request: NextRequest) {
  if (!checkPermission(request)) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const videoId = searchParams.get('videoId');
    const episodeIndex = searchParams.get('episodeIndex');
    const file = searchParams.get('file'); // 'playlist.m3u8', 'segment_00001.ts', 'key.key' 等

    if (!source || !videoId || episodeIndex === null || !file) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    // 构建文件路径
    const downloadDir = path.join(
      OFFLINE_DOWNLOAD_DIR,
      source,
      videoId,
      `ep${parseInt(episodeIndex) + 1}`,
    );
    const filePath = path.join(downloadDir, file);

    // 安全检查：确保文件路径在下载目录内
    const normalizedFilePath = path.normalize(filePath);
    const normalizedDownloadDir = path.normalize(downloadDir);
    if (!normalizedFilePath.startsWith(normalizedDownloadDir)) {
      return NextResponse.json({ error: '非法路径' }, { status: 403 });
    }

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    // 读取文件
    const fileBuffer = fs.readFileSync(filePath);

    // 如果是 m3u8 文件，需要修改内容使片段指向代理地址
    if (file === 'playlist.m3u8') {
      let content = fileBuffer.toString('utf-8');
      const lines = content.split('\n');
      const modifiedLines: string[] = [];

      for (const line of lines) {
        const trimmedLine = line.trim();

        // 处理 Key URI
        if (trimmedLine.startsWith('#EXT-X-KEY:')) {
          const modifiedLine = trimmedLine.replace(
            /URI="([^"]+)"/,
            `URI="/api/offline-download/local?source=${source}&videoId=${videoId}&episodeIndex=${episodeIndex}&file=$1"`,
          );
          modifiedLines.push(modifiedLine);
        }
        // 处理 ts 片段
        else if (trimmedLine && !trimmedLine.startsWith('#')) {
          modifiedLines.push(
            `/api/offline-download/local?source=${source}&videoId=${videoId}&episodeIndex=${episodeIndex}&file=${trimmedLine}`,
          );
        } else {
          modifiedLines.push(line);
        }
      }

      content = modifiedLines.join('\n');

      return new NextResponse(content, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // 其他文件（ts、key 等）直接返回
    const contentType = file.endsWith('.ts')
      ? 'video/mp2t'
      : file.endsWith('.key')
        ? 'application/octet-stream'
        : 'application/octet-stream';

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('代理本地文件失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '代理失败' },
      { status: 500 },
    );
  }
}
