/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

export interface TMDBMovie {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  overview: string;
  vote_average: number;
}

export interface TMDBTVShow {
  id: number;
  name: string;
  poster_path: string | null;
  first_air_date: string;
  overview: string;
  vote_average: number;
}

// 统一的类型，用于显示
export interface TMDBItem {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  overview: string;
  vote_average: number;
  media_type: 'movie' | 'tv';
}

interface TMDBUpcomingResponse {
  results: TMDBMovie[];
  page: number;
  total_pages: number;
  total_results: number;
}

interface TMDBTVAiringTodayResponse {
  results: TMDBTVShow[];
  page: number;
  total_pages: number;
  total_results: number;
}

/**
 * 获取即将上映的电影
 * @param apiKey - TMDB API Key
 * @param page - 页码
 * @param region - 地区代码，默认 CN (中国)
 * @returns 即将上映的电影列表
 */
export async function getTMDBUpcomingMovies(
  apiKey: string,
  page: number = 1,
  region: string = 'CN'
): Promise<{ code: number; list: TMDBMovie[] }> {
  try {
    if (!apiKey) {
      return { code: 400, list: [] };
    }

    const response = await fetch(
      `https://api.themoviedb.org/3/movie/upcoming?api_key=${apiKey}&language=zh-CN&page=${page}&region=${region}`
    );

    if (!response.ok) {
      console.error('TMDB API 请求失败:', response.status, response.statusText);
      return { code: response.status, list: [] };
    }

    const data: TMDBUpcomingResponse = await response.json();

    return {
      code: 200,
      list: data.results,
    };
  } catch (error) {
    console.error('获取 TMDB 即将上映电影失败:', error);
    return { code: 500, list: [] };
  }
}

/**
 * 获取正在播出的电视剧
 * @param apiKey - TMDB API Key
 * @param page - 页码
 * @returns 正在播出的电视剧列表
 */
export async function getTMDBUpcomingTVShows(
  apiKey: string,
  page: number = 1
): Promise<{ code: number; list: TMDBTVShow[] }> {
  try {
    if (!apiKey) {
      return { code: 400, list: [] };
    }

    // 使用 on_the_air 接口获取正在播出的电视剧
    const response = await fetch(
      `https://api.themoviedb.org/3/tv/on_the_air?api_key=${apiKey}&language=zh-CN&page=${page}`
    );

    if (!response.ok) {
      console.error('TMDB TV API 请求失败:', response.status, response.statusText);
      return { code: response.status, list: [] };
    }

    const data: TMDBTVAiringTodayResponse = await response.json();

    return {
      code: 200,
      list: data.results,
    };
  } catch (error) {
    console.error('获取 TMDB 正在播出电视剧失败:', error);
    return { code: 500, list: [] };
  }
}

/**
 * 获取即将上映/播出的内容（电影+电视剧）
 * @param apiKey - TMDB API Key
 * @returns 统一格式的即将上映/播出列表
 */
export async function getTMDBUpcomingContent(
  apiKey: string
): Promise<{ code: number; list: TMDBItem[] }> {
  try {
    if (!apiKey) {
      return { code: 400, list: [] };
    }

    // 并行获取电影和电视剧数据
    const [moviesResult, tvShowsResult] = await Promise.all([
      getTMDBUpcomingMovies(apiKey),
      getTMDBUpcomingTVShows(apiKey),
    ]);

    // 检查是否有错误
    if (moviesResult.code !== 200 && tvShowsResult.code !== 200) {
      // 两个请求都失败，返回错误
      return { code: moviesResult.code, list: [] };
    }

    // 获取今天的日期（本地时区）
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 转换电影数据为统一格式，并过滤掉已上映的
    const movies: TMDBItem[] = moviesResult.code === 200
      ? moviesResult.list
          .filter((movie) => {
            // 只保留未来上映的电影
            return movie.release_date && movie.release_date >= todayStr;
          })
          .map((movie) => ({
            id: movie.id,
            title: movie.title,
            poster_path: movie.poster_path,
            release_date: movie.release_date,
            overview: movie.overview,
            vote_average: movie.vote_average,
            media_type: 'movie' as const,
          }))
      : [];

    // 转换电视剧数据为统一格式，并过滤掉已播出的
    const tvShows: TMDBItem[] = tvShowsResult.code === 200
      ? tvShowsResult.list
          .filter((tv) => {
            // 只保留未来播出的电视剧
            return tv.first_air_date && tv.first_air_date >= todayStr;
          })
          .map((tv) => ({
            id: tv.id,
            title: tv.name,
            poster_path: tv.poster_path,
            release_date: tv.first_air_date,
            overview: tv.overview,
            vote_average: tv.vote_average,
            media_type: 'tv' as const,
          }))
      : [];

    // 合并并返回
    const allContent = [...movies, ...tvShows];

    return {
      code: 200,
      list: allContent,
    };
  } catch (error) {
    console.error('获取 TMDB 即将上映内容失败:', error);
    return { code: 500, list: [] };
  }
}

/**
 * 获取 TMDB 图片完整 URL
 * @param path - 图片路径
 * @param size - 图片尺寸，默认 w500
 * @returns 完整的图片 URL
 */
export function getTMDBImageUrl(
  path: string | null,
  size: string = 'w500'
): string {
  if (!path) return '';
  return `https://image.tmdb.org/t/p/${size}${path}`;
}
