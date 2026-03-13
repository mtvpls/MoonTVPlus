/* eslint-disable @typescript-eslint/no-explicit-any */

import { parseString } from 'xml2js';

export interface NFOMetadata {
  tmdbId?: number;
  title?: string;
  originalTitle?: string;
  year?: number;
  plot?: string;
  rating?: number;
  genres?: string[];
  mediaType: 'movie' | 'tv';
}

/**
 * 解析 NFO 文件（XML 格式）
 */
export async function parseNFO(
  xmlContent: string,
): Promise<NFOMetadata | null> {
  return new Promise((resolve) => {
    parseString(xmlContent, { explicitArray: false }, (err, result) => {
      if (err || !result) {
        resolve(null);
        return;
      }

      const data = result.movie || result.tvshow;
      if (!data) {
        resolve(null);
        return;
      }

      const metadata: NFOMetadata = {
        tmdbId: data.tmdbid ? parseInt(data.tmdbid) : undefined,
        title: data.title,
        originalTitle: data.originaltitle,
        year: data.year ? parseInt(data.year) : undefined,
        plot: data.plot,
        rating: data.rating ? parseFloat(data.rating) : undefined,
        genres: Array.isArray(data.genre)
          ? data.genre
          : data.genre
            ? [data.genre]
            : [],
        mediaType: result.movie ? 'movie' : 'tv',
      };

      resolve(metadata);
    });
  });
}
