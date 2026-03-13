/* eslint-disable @typescript-eslint/no-explicit-any */

import { NFOMetadata, parseNFO } from './nfo-parser';
import { parseVideoFileName } from './video-parser';
import { XiaoyaClient } from './xiaoya.client';

export interface XiaoyaMetadata {
  tmdbId?: number;
  title: string;
  year?: string;
  rating?: number;
  genres?: string[];
  plot?: string;
  poster?: string;
  background?: string;
  mediaType: 'movie' | 'tv';
  source: 'folder' | 'nfo' | 'tmdb' | 'file';
}

/**
 * 从文件夹名提取 TMDb ID 和年份
 * 格式: "标题 (年份) {tmdb-id}"
 */
function parseFolderName(folderName: string | undefined): {
  title?: string;
  year?: string;
  tmdbId?: number;
} {
  if (!folderName || typeof folderName !== 'string') {
    return {};
  }
  const match = folderName.match(/^(.+?)\s*\((\d{4})\)\s*\{tmdb-(\d+)\}$/);
  if (match) {
    return {
      title: match[1].trim(),
      year: match[2],
      tmdbId: parseInt(match[3]),
    };
  }
  return {};
}

/**
 * 查找 NFO 文件并解析
 */
async function findNFO(
  xiaoyaClient: XiaoyaClient,
  videoPath: string,
): Promise<NFOMetadata | null> {
  const pathParts = videoPath.split('/').filter(Boolean);

  // 判断是否为文件路径
  const videoExtensions = [
    '.mp4',
    '.mkv',
    '.avi',
    '.m3u8',
    '.flv',
    '.ts',
    '.mov',
    '.wmv',
    '.webm',
  ];
  const isFilePath = videoExtensions.some((ext) =>
    videoPath.toLowerCase().endsWith(ext),
  );

  let isInSeasonDir = false;

  if (isFilePath) {
    // 文件路径：判断父目录是否为季度目录
    const parentDir = pathParts[pathParts.length - 2];
    isInSeasonDir = /(season\s*\d+|s\d+)/i.test(parentDir);
  } else {
    // 目录路径：判断当前目录是否为季度目录
    const currentDir = pathParts[pathParts.length - 1];
    isInSeasonDir = /(season\s*\d+|s\d+)/i.test(currentDir);
  }

  const nfoSearchPaths: string[] = [];

  if (isInSeasonDir) {
    // 电视剧：查父级的 tvshow.nfo
    const grandParentDir = pathParts.slice(0, isFilePath ? -2 : -1).join('/');
    nfoSearchPaths.push(`/${grandParentDir}/tvshow.nfo`);
  } else {
    // 电影：查同级的 movie.nfo
    const parentDir = pathParts
      .slice(0, isFilePath ? -1 : pathParts.length)
      .join('/');
    nfoSearchPaths.push(`/${parentDir}/movie.nfo`);
  }

  for (const nfoPath of nfoSearchPaths) {
    try {
      const content = await xiaoyaClient.getFileContent(nfoPath);
      const metadata = await parseNFO(content);
      if (metadata) {
        return metadata;
      }
    } catch (error) {
      continue;
    }
  }

  return null;
}

/**
 * 获取小雅视频的元数据
 */
export async function getXiaoyaMetadata(
  xiaoyaClient: XiaoyaClient,
  videoPath: string,
  tmdbApiKey?: string,
  tmdbProxy?: string,
  tmdbReverseProxy?: string,
): Promise<XiaoyaMetadata> {
  const pathParts = videoPath.split('/').filter(Boolean);

  // 验证路径格式
  if (pathParts.length < 1) {
    throw new Error(`无效的视频路径格式: ${videoPath}`);
  }

  // 判断是否为文件路径（包含视频扩展名）
  const videoExtensions = [
    '.mp4',
    '.mkv',
    '.avi',
    '.m3u8',
    '.flv',
    '.ts',
    '.mov',
    '.wmv',
    '.webm',
  ];
  const isFilePath = videoExtensions.some((ext) =>
    videoPath.toLowerCase().endsWith(ext),
  );

  // 如果是文件路径，检查是否在季度目录中
  const isInSeasonDir =
    isFilePath &&
    pathParts.length >= 2 &&
    /(season\s*\d+|s\d+)/i.test(pathParts[pathParts.length - 2]);

  // 验证路径长度是否足够
  if (isInSeasonDir && pathParts.length < 3) {
    throw new Error(`Season目录路径格式不正确: ${videoPath}`);
  }

  // 确定元数据目录和文件夹名
  let metadataDir: string;
  let folderName: string;

  if (isFilePath) {
    // 文件路径
    metadataDir = isInSeasonDir
      ? pathParts.slice(0, -2).join('/')
      : pathParts.slice(0, -1).join('/');
    folderName =
      pathParts[isInSeasonDir ? pathParts.length - 3 : pathParts.length - 2];
  } else {
    // 目录路径
    if (pathParts.length === 1) {
      // 只有一级目录
      metadataDir = '';
      folderName = pathParts[0];
    } else {
      // 判断当前目录是否为季度目录
      const currentDirName = pathParts[pathParts.length - 1];
      const isSeasonDir = /(season\s*\d+|s\d+)/i.test(currentDirName);

      if (isSeasonDir && pathParts.length >= 2) {
        // 季度目录：使用父级目录名
        metadataDir = pathParts.slice(0, -2).join('/');
        folderName = pathParts[pathParts.length - 2];
      } else {
        metadataDir = pathParts.slice(0, -1).join('/');
        folderName = pathParts[pathParts.length - 1];
      }
    }
  }

  // 验证 folderName 是否有效
  if (!folderName) {
    throw new Error(`无法从路径中提取文件夹名: ${videoPath}`);
  }

  // 优先级 1: 从文件夹名提取 TMDb ID
  const folderInfo = parseFolderName(folderName);
  if (folderInfo.tmdbId) {
    const baseUrl = xiaoyaClient.getBaseURL();
    const posterUrl = `${baseUrl}/d/${metadataDir}/poster.jpg`;
    const backgroundUrl = `${baseUrl}/d/${metadataDir}/background.jpg`;

    // 尝试读取 NFO 获取详细信息
    const nfoData = await findNFO(xiaoyaClient, videoPath);

    return {
      tmdbId: folderInfo.tmdbId,
      title: nfoData?.title || folderInfo.title || folderName,
      year: folderInfo.year,
      rating: nfoData?.rating,
      genres: nfoData?.genres,
      plot: nfoData?.plot,
      poster: posterUrl,
      background: backgroundUrl,
      mediaType: isInSeasonDir ? 'tv' : 'movie',
      source: nfoData ? 'nfo' : isFilePath ? 'file' : 'folder',
    };
  }

  // 优先级 2: 读取 NFO 文件
  const nfoData = await findNFO(xiaoyaClient, videoPath);
  if (nfoData && nfoData.tmdbId) {
    const baseUrl = xiaoyaClient.getBaseURL();
    const posterUrl = `${baseUrl}/d/${metadataDir}/poster.jpg`;
    const backgroundUrl = `${baseUrl}/d/${metadataDir}/background.jpg`;

    return {
      tmdbId: nfoData.tmdbId,
      title: nfoData.title || folderName,
      year: nfoData.year?.toString(),
      rating: nfoData.rating,
      genres: nfoData.genres,
      plot: nfoData.plot,
      poster: posterUrl,
      background: backgroundUrl,
      mediaType: nfoData.mediaType,
      source: 'nfo',
    };
  }

  // 优先级 3: 实时搜索 TMDb（使用文件名）
  if (tmdbApiKey) {
    const fileName = pathParts[pathParts.length - 1];
    const searchQuery = fileName
      .replace(/\.(mp4|mkv|avi|m3u8|flv|ts)$/i, '')
      .replace(/[[\]()]/g, ' ')
      .trim();

    // 如果文件名是纯数字（可能带小数点）或者是 SxxExx 格式，跳过文件名搜索，直接使用文件夹名
    const isPureNumber = /^[\d.]+$/.test(searchQuery);
    const isSeasonEpisode = /^S\d+E\d+/i.test(searchQuery);

    if (!isPureNumber && !isSeasonEpisode) {
      const { searchTMDB, getTMDBImageUrl } = await import('./tmdb.search');
      const tmdbResult = await searchTMDB(
        tmdbApiKey,
        searchQuery,
        tmdbProxy,
        undefined,
        tmdbReverseProxy,
      );

      if (tmdbResult.code === 200 && tmdbResult.result) {
        return {
          tmdbId: tmdbResult.result.id,
          title:
            tmdbResult.result.title || tmdbResult.result.name || folderName,
          year:
            tmdbResult.result.release_date?.substring(0, 4) ||
            tmdbResult.result.first_air_date?.substring(0, 4),
          rating: tmdbResult.result.vote_average,
          plot: tmdbResult.result.overview,
          poster: tmdbResult.result.poster_path
            ? getTMDBImageUrl(tmdbResult.result.poster_path)
            : undefined,
          mediaType: tmdbResult.result.media_type,
          source: isFilePath ? 'file' : 'tmdb',
        };
      }
    }
  }

  // 优先级 4: 实时搜索 TMDb（使用文件夹名）
  if (tmdbApiKey) {
    const searchQuery = folderName
      .replace(/[[\](){}]/g, ' ')
      .replace(/\d{4}/g, '')
      .trim();

    const { searchTMDB, getTMDBImageUrl } = await import('./tmdb.search');
    const tmdbResult = await searchTMDB(
      tmdbApiKey,
      searchQuery,
      tmdbProxy,
      undefined,
      tmdbReverseProxy,
    );

    if (tmdbResult.code === 200 && tmdbResult.result) {
      return {
        tmdbId: tmdbResult.result.id,
        title: tmdbResult.result.title || tmdbResult.result.name || folderName,
        year:
          tmdbResult.result.release_date?.substring(0, 4) ||
          tmdbResult.result.first_air_date?.substring(0, 4),
        rating: tmdbResult.result.vote_average,
        plot: tmdbResult.result.overview,
        poster: tmdbResult.result.poster_path
          ? getTMDBImageUrl(tmdbResult.result.poster_path)
          : undefined,
        mediaType: tmdbResult.result.media_type,
        source: 'tmdb',
      };
    }
  }

  // 降级：只返回文件夹名
  return {
    title: folderName,
    mediaType: isInSeasonDir ? 'tv' : 'movie',
    source: 'folder',
  };
}

/**
 * 获取视频集数列表
 */
export async function getXiaoyaEpisodes(
  xiaoyaClient: XiaoyaClient,
  videoPath: string,
): Promise<Array<{ path: string; title: string }>> {
  const pathParts = videoPath.split('/').filter(Boolean);

  // 判断是否为文件路径（包含视频扩展名）
  const videoExtensions = [
    '.mp4',
    '.mkv',
    '.avi',
    '.m3u8',
    '.flv',
    '.ts',
    '.mov',
    '.wmv',
    '.webm',
  ];
  const isFilePath = videoExtensions.some((ext) =>
    videoPath.toLowerCase().endsWith(ext),
  );

  // 如果是文件路径，检查是否在季度目录中
  const isInSeasonDir =
    isFilePath && /(season\s*\d+|s\d+)/i.test(pathParts[pathParts.length - 2]);

  if (isInSeasonDir) {
    // 电视剧：列出当前季的所有集
    const seasonDir = pathParts.slice(0, -1).join('/');
    const listResponse = await xiaoyaClient.listDirectory(
      `/${seasonDir}`,
      1,
      100,
      false,
    );

    const videoFiles = listResponse.content
      .filter(
        (item) =>
          !item.is_dir &&
          videoExtensions.some((ext) => item.name.toLowerCase().endsWith(ext)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    return videoFiles.map((file) => {
      const parsed = parseVideoFileName(file.name);
      console.log('[xiaoya-metadata] 解析文件名:', file.name, '结果:', parsed);
      let title = file.name;

      if (parsed.season && parsed.episode) {
        title = `S${parsed.season.toString().padStart(2, '0')}E${parsed.episode.toString().padStart(2, '0')}`;
      } else if (parsed.episode) {
        title = parsed.isOVA
          ? `OVA ${parsed.episode}`
          : `第${parsed.episode}集`;
      }

      return {
        path: `/${seasonDir}/${file.name}`,
        title,
      };
    });
  } else {
    // 目录路径或电影文件路径：列出该目录下的所有视频
    const targetDir = isFilePath
      ? pathParts.slice(0, -1).join('/')
      : pathParts.join('/');
    const listResponse = await xiaoyaClient.listDirectory(
      `/${targetDir}`,
      1,
      100,
      false,
    );

    const videoFiles = listResponse.content
      .filter(
        (item) =>
          !item.is_dir &&
          videoExtensions.some((ext) => item.name.toLowerCase().endsWith(ext)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    return videoFiles.map((file) => ({
      path: `/${targetDir}/${file.name}`,
      title: file.name,
    }));
  }
}
