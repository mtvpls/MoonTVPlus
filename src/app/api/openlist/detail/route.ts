/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { OpenListClient } from '@/lib/openlist.client';
import {
  getCachedVideoInfo,
  setCachedVideoInfo,
  VideoInfo,
} from '@/lib/openlist-cache';
import { parseVideoFileName } from '@/lib/video-parser';

export const runtime = 'nodejs';

/**
 * GET /api/openlist/detail?folder=xxx
 * 获取视频文件夹的详细信息
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const folderName = searchParams.get('folder');

    if (!folderName) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    if (
      !openListConfig ||
      !openListConfig.Enabled ||
      !openListConfig.URL ||
      !openListConfig.Username ||
      !openListConfig.Password
    ) {
      return NextResponse.json({ error: 'OpenList 未配置或未启用' }, { status: 400 });
    }

    // folderName 已经是完整路径，直接使用
    const folderPath = folderName;
    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    // 1. 尝试读取缓存的 videoinfo.json
    let videoInfo: VideoInfo | null = getCachedVideoInfo(folderPath);

    if (!videoInfo) {
      // 2. 尝试从 OpenList 读取 videoinfo.json
      try {
        const videoinfoPath = `${folderPath}/videoinfo.json`;
        const fileResponse = await client.getFile(videoinfoPath);

        if (fileResponse.code === 200 && fileResponse.data.raw_url) {
          const downloadUrl = fileResponse.data.raw_url;
          const contentResponse = await fetch(downloadUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
          });
          const content = await contentResponse.text();
          videoInfo = JSON.parse(content);

          // 缓存
          if (videoInfo) {
            setCachedVideoInfo(folderPath, videoInfo);
          }
        }
      } catch (error) {
        console.log('videoinfo.json 不存在，将解析文件名');
      }
    }

    // 3. 如果没有 videoinfo.json，列出文件夹并解析
    if (!videoInfo) {
      const listResponse = await client.listDirectory(folderPath);

      if (listResponse.code !== 200) {
        return NextResponse.json(
          { error: 'OpenList 列表获取失败3' },
          { status: 500 }
        );
      }

      // 过滤视频文件
      const videoFiles = listResponse.data.content.filter(
        (item) =>
          !item.is_dir &&
          !item.name.endsWith('.json') && // 排除 JSON 文件
          !item.name.startsWith('.') && // 排除隐藏文件
          (item.name.endsWith('.mp4') ||
            item.name.endsWith('.mkv') ||
            item.name.endsWith('.avi') ||
            item.name.endsWith('.m3u8') ||
            item.name.endsWith('.flv') ||
            item.name.endsWith('.ts'))
      );

      videoInfo = {
        episodes: {},
        last_updated: Date.now(),
      };

      // 按文件名排序，确保顺序一致
      videoFiles.sort((a, b) => a.name.localeCompare(b.name));

      // 解析文件名
      for (let i = 0; i < videoFiles.length; i++) {
        const file = videoFiles[i];
        const parsed = parseVideoFileName(file.name);

        videoInfo.episodes[file.name] = {
          episode: parsed.episode || (i + 1), // 如果解析失败，使用索引+1作为集数
          season: parsed.season,
          title: parsed.title,
          parsed_from: 'filename',
          isOVA: parsed.isOVA,
        };
      }

      // 仅缓存到内存，不再持久化到 OpenList
      setCachedVideoInfo(folderPath, videoInfo);
    }

    // 4. 获取视频文件列表（不获取播放链接，使用懒加载）
    const listResponse = await client.listDirectory(folderPath);

    // 定义视频文件扩展名（不区分大小写）
    const videoExtensions = [
      '.mp4', '.mkv', '.avi', '.m3u8', '.flv', '.ts',
      '.mov', '.wmv', '.webm', '.rmvb', '.rm', '.mpg',
      '.mpeg', '.3gp', '.f4v', '.m4v', '.vob'
    ];

    const videoFiles = listResponse.data.content.filter((item) => {
      // 排除文件夹
      if (item.is_dir) return false;

      // 排除隐藏文件
      if (item.name.startsWith('.')) return false;

      // 排除 JSON 文件
      if (item.name.endsWith('.json')) return false;

      // 检查是否是视频文件（不区分大小写）
      const lowerName = item.name.toLowerCase();
      return videoExtensions.some(ext => lowerName.endsWith(ext));
    });

    // 5. 构建集数信息（不包含播放链接）
    // 确保所有视频文件都被显示，即使 videoInfo 中没有记录
    const episodes = videoFiles
      .map((file, index) => {
        // 总是重新解析文件名，确保使用最新的解析逻辑
        const parsed = parseVideoFileName(file.name);

        // 如果解析成功，使用解析结果；否则使用 videoInfo 中的记录或索引
        let episodeInfo;
        if (parsed.episode) {
          episodeInfo = {
            episode: parsed.episode,
            season: parsed.season,
            title: parsed.title,
            parsed_from: 'filename',
            isOVA: parsed.isOVA,
          };
        } else {
          // 如果解析失败，尝试从 videoInfo 获取
          episodeInfo = videoInfo!.episodes[file.name];
          if (!episodeInfo) {
            // 如果 videoInfo 中也没有，使用索引
            episodeInfo = {
              episode: index + 1,
              season: undefined,
              title: undefined,
              parsed_from: 'filename',
            };
          }
        }

        // 优先使用解析出的标题，其次是"第X集"格式，最后才是文件名
        let displayTitle = episodeInfo.title;
        if (!displayTitle && episodeInfo.episode) {
          displayTitle = episodeInfo.isOVA ? `OVA ${episodeInfo.episode}` : `第${episodeInfo.episode}集`;
        }
        if (!displayTitle) {
          displayTitle = file.name;
        }

        return {
          fileName: file.name,
          episode: episodeInfo.episode || 0,
          season: episodeInfo.season,
          title: displayTitle,
          size: file.size,
          isOVA: episodeInfo.isOVA,
        };
      })
      .sort((a, b) => {
        // OVA 排在最后
        if (a.isOVA && !b.isOVA) return 1;
        if (!a.isOVA && b.isOVA) return -1;
        // 确保排序稳定，即使 episode 相同也按文件名排序
        if (a.episode !== b.episode) {
          return a.episode - b.episode;
        }
        return a.fileName.localeCompare(b.fileName);
      });

    return NextResponse.json({
      success: true,
      folder: folderName,
      episodes,
      videoInfo,
    });
  } catch (error) {
    console.error('获取视频详情失败:', error);
    return NextResponse.json(
      { error: '获取失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
