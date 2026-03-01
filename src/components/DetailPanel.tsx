'use client';

import { Calendar, Clock, Film,Globe, Star, Tag, Users, X } from 'lucide-react';
import Image from 'next/image';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { getTMDBImageUrl } from '@/lib/tmdb.client';
import { processImageUrl } from '@/lib/utils';

import ImageViewer from '@/components/ImageViewer';

interface DetailPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  poster?: string;
  doubanId?: number;
  bangumiId?: number;
  isBangumi?: boolean;
  tmdbId?: number;
  type?: 'movie' | 'tv';
  seasonNumber?: number;
  cmsData?: {
    desc?: string;
    episodes?: string[];
    episodes_titles?: string[];
  };
  // 用于调用 source-detail API
  sourceId?: string;
  source?: string;
}

interface DetailData {
  title: string;
  originalTitle?: string;
  year?: string;
  poster?: string;
  rating?: {
    value: number;
    count: number;
  };
  intro?: string;
  genres?: string[];
  directors?: Array<{ name: string; profile_path?: string }>;
  actors?: Array<{ name: string; character?: string; profile_path?: string }>;
  countries?: string[];
  languages?: string[];
  duration?: string;
  episodesCount?: number;
  releaseDate?: string;
  status?: string;
  tagline?: string;
  seasons?: number;
  overview?: string;
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  seasonNumber?: number;
}

interface Episode {
  id: number;
  name: string;
  episode_number: number;
  still_path: string | null;
  overview: string;
  air_date: string;
}

const DetailPanel: React.FC<DetailPanelProps> = ({
  isOpen,
  onClose,
  title,
  poster,
  doubanId,
  bangumiId,
  isBangumi,
  tmdbId,
  type = 'movie',
  seasonNumber,
  cmsData,
  sourceId,
  source,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [detailData, setDetailData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seasonData, setSeasonData] = useState<{ seasons: any[]; episodes: Episode[] } | null>(null);
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<number>>(new Set());
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [seasonsLoaded, setSeasonsLoaded] = useState(false);
  const [showImageViewer, setShowImageViewer] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string>('');

  // 数据源状态管理
  const [currentSource, setCurrentSource] = useState<'douban' | 'bangumi' | 'cms' | 'tmdb'>('tmdb');
  const [originalSource, setOriginalSource] = useState<'douban' | 'bangumi' | 'cms' | 'tmdb'>('tmdb');
  const [isUsingTmdb, setIsUsingTmdb] = useState(false);
  const [originalDetailData, setOriginalDetailData] = useState<DetailData | null>(null);

  // 拖动滚动状态
  const [isDragging, setIsDragging] = useState(false);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const episodesScrollRef = React.useRef<HTMLDivElement>(null);
  const actorsScrollRef = React.useRef<HTMLDivElement>(null);
  const [isActorsDragging, setIsActorsDragging] = useState(false);
  const [isActorsMouseDown, setIsActorsMouseDown] = useState(false);
  const [actorsStartX, setActorsStartX] = useState(0);
  const [actorsScrollLeft, setActorsScrollLeft] = useState(0);

  // 图片点击处理
  const handleImageClick = (imageUrl: string) => {
    setSelectedImage(imageUrl);
    setShowImageViewer(true);
  };

  // 确保组件在客户端挂载后才渲染 Portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // 控制动画状态
  useEffect(() => {
    let animationId: number;
    let timer: NodeJS.Timeout;

    if (isOpen) {
      setIsVisible(true);
      animationId = requestAnimationFrame(() => {
        animationId = requestAnimationFrame(() => {
          setIsAnimating(true);
        });
      });
    } else {
      setIsAnimating(false);
      timer = setTimeout(() => {
        setIsVisible(false);
      }, 200);
    }

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isOpen]);

  // 阻止背景滚动
  useEffect(() => {
    if (isVisible) {
      // 保存当前滚动位置
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      const body = document.body;
      const html = document.documentElement;

      // 获取滚动条宽度
      const scrollBarWidth = window.innerWidth - html.clientWidth;

      // 保存原始样式
      const originalBodyStyle = {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        paddingRight: body.style.paddingRight,
        overflow: body.style.overflow,
      };

      // 设置body样式来阻止滚动，但保持原位置
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = `-${scrollX}px`;
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
      body.style.paddingRight = `${scrollBarWidth}px`;

      return () => {
        // 恢复所有原始样式
        body.style.position = originalBodyStyle.position;
        body.style.top = originalBodyStyle.top;
        body.style.left = originalBodyStyle.left;
        body.style.right = originalBodyStyle.right;
        body.style.width = originalBodyStyle.width;
        body.style.paddingRight = originalBodyStyle.paddingRight;
        body.style.overflow = originalBodyStyle.overflow;

        // 使用 requestAnimationFrame 确保样式恢复后再滚动
        requestAnimationFrame(() => {
          window.scrollTo(scrollX, scrollY);
        });
      };
    }
  }, [isVisible]);

  // ESC键关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [isVisible, onClose]);

  // 获取详情数据
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const fetchDetail = async () => {
      setLoading(true);
      setError(null);

      try {
        // 如果正在使用 TMDB 数据，强制使用 TMDB
        if (isUsingTmdb && title) {
          await fetchTmdbData();
          return;
        }

        // 优先使用苹果CMS数据（短剧等）
        // 如果 cmsData 存在但 desc 为空，尝试通过 source-detail API 获取
        if (cmsData) {
          setCurrentSource('cms');
          setOriginalSource('cms');
          if (cmsData.desc) {
            // 有 desc，直接使用
            const data = {
              title: title,
              intro: cmsData.desc,
              episodesCount: cmsData.episodes?.length,
              poster: poster ? processImageUrl(poster) : poster,
            };
            setDetailData(data);
            setOriginalDetailData(data);
            setLoading(false);
            return;
          }

          // cmsData 存在但 desc 为空，尝试通过 API 获取详情
          if (sourceId && source) {
            try {
              const response = await fetch(
                `/api/source-detail?id=${encodeURIComponent(sourceId)}&source=${encodeURIComponent(source)}&title=${encodeURIComponent(title)}`
              );
              if (response.ok) {
                const data = await response.json();
                const detailData = {
                  title: data.title || title,
                  intro: data.desc || '',
                  episodesCount: data.episodes?.length || cmsData.episodes?.length,
                  poster: data.poster ? processImageUrl(data.poster) : poster,
                  year: data.year,
                };
                setDetailData(detailData);
                setOriginalDetailData(detailData);
                setLoading(false);
                return;
              }
            } catch (err) {
              console.error('获取source-detail失败:', err);
              // 继续执行后续逻辑
            }
          }
        }

        // 优先使用 Bangumi ID（因为 isBangumi 为 true 时，doubanId 实际上是 bangumiId）
        if (bangumiId || (isBangumi && doubanId)) {
          setCurrentSource('bangumi');
          setOriginalSource('bangumi');
          const actualBangumiId = bangumiId || doubanId;
          const response = await fetch(`https://api.bgm.tv/v0/subjects/${actualBangumiId}`);
          if (!response.ok) {
            throw new Error('获取Bangumi详情失败');
          }
          const data = await response.json();

          const detailData = {
            title: data.name_cn || data.name,
            originalTitle: data.name,
            year: data.date ? data.date.substring(0, 4) : undefined,
            poster: data.images?.large ? processImageUrl(data.images.large) : poster,
            rating: data.rating
              ? {
                  value: data.rating.score,
                  count: data.rating.total,
                }
              : undefined,
            intro: data.summary,
            genres: data.tags?.map((tag: any) => tag.name).slice(0, 5),
            episodesCount: data.eps,
            releaseDate: data.date,
          };
          setDetailData(detailData);
          setOriginalDetailData(detailData);
          return;
        }

        // 使用豆瓣ID
        if (doubanId && !isBangumi) {
          setCurrentSource('douban');
          setOriginalSource('douban');
          const response = await fetch(`/api/douban/detail?id=${doubanId}`);
          if (!response.ok) {
            throw new Error('获取豆瓣详情失败');
          }
          const data = await response.json();

          const detailData = {
            title: data.title,
            originalTitle: data.original_title,
            year: data.year,
            poster: (data.pic?.large || data.pic?.normal) ? processImageUrl(data.pic?.large || data.pic?.normal) : poster,
            rating: data.rating
              ? {
                  value: data.rating.value,
                  count: data.rating.count,
                }
              : undefined,
            intro: data.intro,
            genres: data.genres,
            directors: data.directors,
            actors: data.actors,
            countries: data.countries,
            languages: data.languages,
            duration: data.durations?.[0],
            episodesCount: data.episodes_count,
          };
          setDetailData(detailData);
          setOriginalDetailData(detailData);
          return;
        }

        // 使用 TMDB 搜索
        if (title) {
          setCurrentSource('tmdb');
          setOriginalSource('tmdb');
          await fetchTmdbData();
          return;
        }

        throw new Error('缺少必要的查询参数');
      } catch (err) {
        console.error('获取详情失败:', err);
        setError(err instanceof Error ? err.message : '获取详情失败');
      } finally {
        setLoading(false);
      }
    };

    // 提取 TMDB 数据获取逻辑为独立函数
    const fetchTmdbData = async () => {
      setCurrentSource('tmdb');
      // 移除季度信息进行搜索
      let searchTitle = title;
      let extractedSeasonNumber = seasonNumber;

      // 匹配各种季度格式: 第一季、第1季、第一部、Season 1、S1等
      const seasonPatterns = [
        /第([一二三四五六七八九十\d]+)[季部]/,
        /Season\s*(\d+)/i,
        /S(\d+)/i,
      ];

      for (const pattern of seasonPatterns) {
        const match = title.match(pattern);
        if (match) {
          searchTitle = title.replace(pattern, '').trim();
          // 如果没有传入seasonNumber,尝试从标题中提取
          if (!extractedSeasonNumber) {
            const seasonStr = match[1];
            // 中文数字转数字
            const chineseNumbers: Record<string, number> = {
              '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
              '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
            };
            extractedSeasonNumber = chineseNumbers[seasonStr] || parseInt(seasonStr) || undefined;
          }
          break;
        }
      }

      const searchResponse = await fetch(
        `/api/tmdb/search?query=${encodeURIComponent(searchTitle)}`
      );
      if (!searchResponse.ok) {
        throw new Error('搜索失败');
      }
      const searchData = await searchResponse.json();

      if (searchData.results && searchData.results.length > 0) {
        const result = searchData.results[0];
        const detailId = result.id;
        const mediaType = result.media_type || type;

        // 获取详情
        const detailResponse = await fetch(`/api/tmdb/detail?id=${detailId}&type=${mediaType}`);
        if (!detailResponse.ok) {
          throw new Error('获取TMDB详情失败');
        }
        const detailResult = await detailResponse.json();

        // 如果有季度信息,尝试获取季度详情
        let seasonData = null;
        if (extractedSeasonNumber && mediaType === 'tv') {
          try {
            const seasonResponse = await fetch(
              `/api/tmdb/seasons?id=${detailId}&season=${extractedSeasonNumber}`
            );
            if (seasonResponse.ok) {
              seasonData = await seasonResponse.json();
            }
          } catch (err) {
            console.error('获取季度信息失败', err);
          }
        }

        setDetailData({
          title: mediaType === 'movie' ? detailResult.title : detailResult.name,
          originalTitle:
            mediaType === 'movie' ? detailResult.original_title : detailResult.original_name,
          year:
            mediaType === 'movie'
              ? detailResult.release_date?.substring(0, 4)
              : detailResult.first_air_date?.substring(0, 4),
          poster: detailResult.poster_path
            ? processImageUrl(getTMDBImageUrl(detailResult.poster_path, 'w500'))
            : poster,
          rating: detailResult.vote_average
            ? {
                value: detailResult.vote_average,
                count: detailResult.vote_count,
              }
            : undefined,
          intro: seasonData?.overview || detailResult.overview,
          genres: detailResult.genres?.map((g: any) => g.name),
          countries: detailResult.production_countries?.map((c: any) => c.name),
          languages: detailResult.spoken_languages?.map((l: any) => l.name),
          duration: detailResult.runtime ? `${detailResult.runtime}分钟` : undefined,
          episodesCount: seasonData?.episodes?.length || detailResult.number_of_episodes,
          releaseDate:
            mediaType === 'movie' ? detailResult.release_date : detailResult.first_air_date,
          status: detailResult.status,
          tagline: detailResult.tagline,
          seasons: detailResult.number_of_seasons,
          overview: detailResult.overview,
          tmdbId: detailId,
          mediaType: mediaType,
          seasonNumber: extractedSeasonNumber,
        });
        return;
      }

      throw new Error('未找到相关内容');
    };

    fetchDetail();
  }, [isOpen, doubanId, bangumiId, isBangumi, tmdbId, title, type, seasonNumber, poster, cmsData, sourceId, source, isUsingTmdb]);

  // 切换数据源的函数
  const handleToggleSource = async () => {
    if (currentSource === 'tmdb') {
      // 切换回原始数据源
      if (originalDetailData) {
        setDetailData(originalDetailData);
        setCurrentSource(originalSource);
        setError(null);
      }
    } else {
      // 切换到 TMDB
      // 保存当前数据
      if (detailData && !originalDetailData) {
        setOriginalDetailData(detailData);
      }

      setLoading(true);
      setError(null);
      try {
        await fetchTmdbDataForToggle();
      } catch (err) {
        console.error('切换到TMDB失败:', err);
        setError(err instanceof Error ? err.message : '切换到TMDB失败');
        // 切换失败，但保持 currentSource 为 tmdb，这样可以显示切换回按钮
        setCurrentSource('tmdb');
      } finally {
        setLoading(false);
      }
    }
  };

  // 用于切换时获取 TMDB 数据
  const fetchTmdbDataForToggle = async () => {
    // 移除季度信息进行搜索
    let searchTitle = title;
    let extractedSeasonNumber = seasonNumber;

    // 匹配各种季度格式: 第一季、第1季、第一部、Season 1、S1等
    const seasonPatterns = [
      /第([一二三四五六七八九十\d]+)[季部]/,
      /Season\s*(\d+)/i,
      /S(\d+)/i,
    ];

    for (const pattern of seasonPatterns) {
      const match = title.match(pattern);
      if (match) {
        searchTitle = title.replace(pattern, '').trim();
        // 如果没有传入seasonNumber,尝试从标题中提取
        if (!extractedSeasonNumber) {
          const seasonStr = match[1];
          // 中文数字转数字
          const chineseNumbers: Record<string, number> = {
            '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
            '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
          };
          extractedSeasonNumber = chineseNumbers[seasonStr] || parseInt(seasonStr) || undefined;
        }
        break;
      }
    }

    const searchResponse = await fetch(
      `/api/tmdb/search?query=${encodeURIComponent(searchTitle)}`
    );
    if (!searchResponse.ok) {
      throw new Error('搜索失败');
    }
    const searchData = await searchResponse.json();

    if (searchData.results && searchData.results.length > 0) {
      const result = searchData.results[0];
      const detailId = result.id;
      const mediaType = result.media_type || type;

      // 获取详情
      const detailResponse = await fetch(`/api/tmdb/detail?id=${detailId}&type=${mediaType}`);
      if (!detailResponse.ok) {
        throw new Error('获取TMDB详情失败');
      }
      const detailResult = await detailResponse.json();

      // 如果有季度信息,尝试获取季度详情
      let seasonData = null;
      if (extractedSeasonNumber && mediaType === 'tv') {
        try {
          const seasonResponse = await fetch(
            `/api/tmdb/seasons?id=${detailId}&season=${extractedSeasonNumber}`
          );
          if (seasonResponse.ok) {
            seasonData = await seasonResponse.json();
          }
        } catch (err) {
          console.error('获取季度信息失败', err);
        }
      }

      setDetailData({
        title: mediaType === 'movie' ? detailResult.title : detailResult.name,
        originalTitle:
          mediaType === 'movie' ? detailResult.original_title : detailResult.original_name,
        year:
          mediaType === 'movie'
            ? detailResult.release_date?.substring(0, 4)
            : detailResult.first_air_date?.substring(0, 4),
        poster: detailResult.poster_path
          ? processImageUrl(getTMDBImageUrl(detailResult.poster_path, 'w500'))
          : poster,
        rating: detailResult.vote_average
          ? {
              value: detailResult.vote_average,
              count: detailResult.vote_count,
            }
          : undefined,
        intro: seasonData?.overview || detailResult.overview,
        genres: detailResult.genres?.map((g: any) => g.name),
        countries: detailResult.production_countries?.map((c: any) => c.name),
        languages: detailResult.spoken_languages?.map((l: any) => l.name),
        duration: detailResult.runtime ? `${detailResult.runtime}分钟` : undefined,
        episodesCount: seasonData?.episodes?.length || detailResult.number_of_episodes,
        releaseDate:
          mediaType === 'movie' ? detailResult.release_date : detailResult.first_air_date,
        status: detailResult.status,
        tagline: detailResult.tagline,
        seasons: detailResult.number_of_seasons,
        overview: detailResult.overview,
        tmdbId: detailId,
        mediaType: mediaType,
        seasonNumber: extractedSeasonNumber,
      });
      setCurrentSource('tmdb');
      return;
    }

    throw new Error('未找到相关内容');
  };

  // 异步获取季度和集数详情（仅TMDB）
  useEffect(() => {
    if (!detailData?.tmdbId || !detailData?.mediaType || detailData.mediaType !== 'tv' || seasonsLoaded) {
      return;
    }

    const fetchSeasonData = async () => {
      setLoadingSeasons(true);
      try {
        // 获取所有季度
        const seasonsResponse = await fetch(`/api/tmdb/seasons?tvId=${detailData.tmdbId}`);
        if (!seasonsResponse.ok) return;
        const seasonsData = await seasonsResponse.json();

        // 设置默认选中季度
        const defaultSeason = detailData.seasonNumber || 1;
        setSelectedSeason(defaultSeason);

        // 获取默认季度的集数详情
        const episodesResponse = await fetch(
          `/api/tmdb/episodes?id=${detailData.tmdbId}&season=${defaultSeason}`
        );
        if (!episodesResponse.ok) return;
        const episodesData = await episodesResponse.json();

        setSeasonData({
          seasons: seasonsData.seasons || [],
          episodes: episodesData.episodes || [],
        });
        setSeasonsLoaded(true);
      } catch (err) {
        console.error('获取季度和集数详情失败:', err);
      } finally {
        setLoadingSeasons(false);
      }
    };

    fetchSeasonData();
  }, [detailData?.tmdbId, detailData?.mediaType, detailData?.seasonNumber, seasonsLoaded]);

  // 异步获取演职人员信息（仅TMDB）
  useEffect(() => {
    if (!detailData?.tmdbId || !detailData?.mediaType || currentSource !== 'tmdb') {
      return;
    }

    // 如果已经有演员信息，不重复获取
    if (detailData.actors && detailData.actors.length > 0) {
      return;
    }

    const fetchCredits = async () => {
      try {
        const creditsResponse = await fetch(
          `/api/tmdb/credits?id=${detailData.tmdbId}&type=${detailData.mediaType}`
        );
        if (!creditsResponse.ok) return;
        const creditsData = await creditsResponse.json();

        // 更新演员和导演信息
        setDetailData(prev => prev ? {
          ...prev,
          directors: creditsData.crew
            ?.filter((person: any) => person.job === 'Director')
            .slice(0, 5)
            .map((person: any) => ({
              name: person.name,
              profile_path: person.profile_path,
            })) || prev.directors,
          actors: creditsData.cast
            ?.slice(0, 15)
            .map((person: any) => ({
              name: person.name,
              character: person.character,
              profile_path: person.profile_path,
            })) || prev.actors,
        } : null);
      } catch (err) {
        console.error('获取演职人员信息失败:', err);
      }
    };

    fetchCredits();
  }, [detailData?.tmdbId, detailData?.mediaType, currentSource, detailData?.actors]);

  // 切换季度时获取集数
  const handleSeasonChange = async (seasonNumber: number) => {
    if (!detailData?.tmdbId || selectedSeason === seasonNumber) return;

    setSelectedSeason(seasonNumber);
    setLoadingSeasons(true);
    try {
      const episodesResponse = await fetch(
        `/api/tmdb/episodes?id=${detailData.tmdbId}&season=${seasonNumber}`
      );
      if (!episodesResponse.ok) return;
      const episodesData = await episodesResponse.json();

      // 从当前 seasonData 中查找季度信息
      const season = seasonData?.seasons.find((s: any) => s.season_number === seasonNumber);

      setSeasonData(prev => ({
        seasons: prev?.seasons || [],
        episodes: episodesData.episodes || [],
      }));

      // 更新季度元信息
      setDetailData(prev => prev ? {
        ...prev,
        title: episodesData.name || season?.name || prev.title,
        intro: episodesData.overview || season?.overview || prev.overview,
        poster: season?.poster_path ? processImageUrl(getTMDBImageUrl(season.poster_path, 'w500')) : prev.poster,
        releaseDate: episodesData.air_date || season?.air_date || prev.releaseDate,
        year: episodesData.air_date?.substring(0, 4) || season?.air_date?.substring(0, 4) || prev.year,
        episodesCount: episodesData.episodes?.length || season?.episode_count || prev.episodesCount,
      } : null);

      setExpandedEpisodes(new Set());
    } catch (err) {
      console.error('获取集数详情失败:', err);
    } finally {
      setLoadingSeasons(false);
    }
  };

  // 拖动滚动处理函数
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!episodesScrollRef.current) return;
    setIsMouseDown(true);
    setStartX(e.pageX - episodesScrollRef.current.offsetLeft);
    setScrollLeft(episodesScrollRef.current.scrollLeft);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isMouseDown || !episodesScrollRef.current) return;

    const x = e.pageX - episodesScrollRef.current.offsetLeft;
    const distance = Math.abs(x - startX);

    // 只有移动超过5px才进入拖动模式
    if (distance > 5 && !isDragging) {
      setIsDragging(true);
      episodesScrollRef.current.style.cursor = 'grabbing';
      episodesScrollRef.current.style.userSelect = 'none';
    }

    if (isDragging) {
      e.preventDefault();
      const walk = (x - startX) * 2; // 滚动速度倍数
      episodesScrollRef.current.scrollLeft = scrollLeft - walk;
    }
  };

  const handleMouseUp = () => {
    setIsMouseDown(false);
    setIsDragging(false);
    if (episodesScrollRef.current) {
      episodesScrollRef.current.style.cursor = 'grab';
      episodesScrollRef.current.style.userSelect = 'auto';
    }
  };

  const handleMouseLeave = () => {
    if (isMouseDown || isDragging) {
      setIsMouseDown(false);
      setIsDragging(false);
      if (episodesScrollRef.current) {
        episodesScrollRef.current.style.cursor = 'grab';
        episodesScrollRef.current.style.userSelect = 'auto';
      }
    }
  };

  // 演员列表拖动滚动处理函数
  const handleActorsMouseDown = (e: React.MouseEvent) => {
    if (!actorsScrollRef.current) return;
    setIsActorsMouseDown(true);
    setActorsStartX(e.pageX - actorsScrollRef.current.offsetLeft);
    setActorsScrollLeft(actorsScrollRef.current.scrollLeft);
  };

  const handleActorsMouseMove = (e: React.MouseEvent) => {
    if (!isActorsMouseDown || !actorsScrollRef.current) return;

    const x = e.pageX - actorsScrollRef.current.offsetLeft;
    const distance = Math.abs(x - actorsStartX);

    // 只有移动超过5px才进入拖动模式
    if (distance > 5 && !isActorsDragging) {
      setIsActorsDragging(true);
      actorsScrollRef.current.style.cursor = 'grabbing';
      actorsScrollRef.current.style.userSelect = 'none';
    }

    if (isActorsDragging) {
      e.preventDefault();
      const walk = (x - actorsStartX) * 2; // 滚动速度倍数
      actorsScrollRef.current.scrollLeft = actorsScrollLeft - walk;
    }
  };

  const handleActorsMouseUp = () => {
    setIsActorsMouseDown(false);
    setIsActorsDragging(false);
    if (actorsScrollRef.current) {
      actorsScrollRef.current.style.cursor = 'grab';
      actorsScrollRef.current.style.userSelect = 'auto';
    }
  };

  const handleActorsMouseLeave = () => {
    if (isActorsMouseDown || isActorsDragging) {
      setIsActorsMouseDown(false);
      setIsActorsDragging(false);
      if (actorsScrollRef.current) {
        actorsScrollRef.current.style.cursor = 'grab';
        actorsScrollRef.current.style.userSelect = 'auto';
      }
    }
  };

  if (!isVisible || !mounted) return null;

  const content = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ease-out ${
          isAnimating ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        style={{
          backdropFilter: 'blur(4px)',
          willChange: 'opacity',
        }}
      />

      {/* 详情面板 */}
      <div
        className="relative w-full max-w-2xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden transition-all duration-200 ease-out"
        style={{
          willChange: 'transform, opacity',
          backfaceVisibility: 'hidden',
          transform: isAnimating ? 'scale(1) translateZ(0)' : 'scale(0.95) translateZ(0)',
          opacity: isAnimating ? 1 : 0,
        }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">详情</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-150"
          >
            <X size={20} className="text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="overflow-y-auto max-h-[calc(90vh-4rem)]">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
            </div>
          )}

          {error && (
            <div className="p-6">
              <div className="text-center mb-6">
                <p className="text-red-500 dark:text-red-400">{error}</p>
              </div>

              {/* 数据源显示和切换 - 错误时也显示 */}
              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 dark:text-gray-400">数据来源:</span>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 uppercase">
                      {currentSource === 'douban' && 'Douban'}
                      {currentSource === 'bangumi' && 'Bangumi'}
                      {currentSource === 'cms' && 'CMS'}
                      {currentSource === 'tmdb' && 'TMDB'}
                    </span>
                  </div>
                  {currentSource !== 'tmdb' && (
                    <button
                      onClick={handleToggleSource}
                      disabled={loading}
                      className="px-3 py-1.5 text-sm rounded-lg bg-green-500 hover:bg-green-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      切换到 TMDB
                    </button>
                  )}
                  {currentSource === 'tmdb' && originalSource !== 'tmdb' && originalDetailData && (
                    <button
                      onClick={handleToggleSource}
                      disabled={loading}
                      className="px-3 py-1.5 text-sm rounded-lg bg-gray-500 hover:bg-gray-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      切换回 {originalSource === 'douban' ? 'Douban' : originalSource === 'bangumi' ? 'Bangumi' : 'CMS'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!loading && !error && detailData && (
            <div className="p-6">
              {/* 海报和基本信息 */}
              <div className="flex gap-6 mb-6">
                {detailData.poster && (
                  <div
                    className="relative w-32 h-48 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 flex-shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => handleImageClick(detailData.poster!)}
                  >
                    <Image src={detailData.poster} alt={detailData.title} fill className="object-cover" draggable={false} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                    {detailData.title}
                  </h3>
                  {detailData.originalTitle && detailData.originalTitle !== detailData.title && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                      {detailData.originalTitle}
                    </p>
                  )}

                  {/* 评分 */}
                  {detailData.rating && (
                    <div className="flex items-center gap-2 mb-3">
                      <Star
                        size={20}
                        className="text-yellow-500 fill-yellow-500"
                      />
                      <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {detailData.rating.value.toFixed(1)}
                      </span>
                      {detailData.rating.count > 0 && (
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          ({detailData.rating.count} 评价)
                        </span>
                      )}
                    </div>
                  )}

                  {/* 类型标签 */}
                  {detailData.genres && detailData.genres.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {detailData.genres.map((genre, index) => (
                        <span
                          key={index}
                          className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                        >
                          {genre}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 年份和时长 */}
                  <div className="flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
                    {detailData.year && (
                      <div className="flex items-center gap-1">
                        <Calendar size={16} />
                        <span>{detailData.year}</span>
                      </div>
                    )}
                    {detailData.duration && (
                      <div className="flex items-center gap-1">
                        <Clock size={16} />
                        <span>{detailData.duration}</span>
                      </div>
                    )}
                    {detailData.episodesCount && (
                      <div className="flex items-center gap-1">
                        <Film size={16} />
                        <span>{detailData.episodesCount} 集</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 简介 */}
              {(detailData.intro || detailData.overview) && (
                <div className="mb-6">
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    简介
                  </h4>
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {detailData.intro || detailData.overview}
                  </p>
                </div>
              )}

              {/* 导演和演员 */}
              {detailData.directors && detailData.directors.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                    <Users size={16} />
                    导演
                  </h4>
                  <p className="text-gray-700 dark:text-gray-300">
                    {detailData.directors.map((d) => d.name).join(', ')}
                  </p>
                </div>
              )}

              {detailData.actors && detailData.actors.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                    <Users size={16} />
                    演员
                  </h4>
                  {currentSource === 'tmdb' ? (
                    <div
                      ref={actorsScrollRef}
                      onMouseDown={handleActorsMouseDown}
                      onMouseMove={handleActorsMouseMove}
                      onMouseUp={handleActorsMouseUp}
                      onMouseLeave={handleActorsMouseLeave}
                      className="overflow-x-auto -mx-6 px-6 cursor-grab active:cursor-grabbing"
                      style={{
                        scrollbarWidth: 'thin',
                        scrollBehavior: isActorsDragging ? 'auto' : 'smooth'
                      }}
                    >
                      <div className="flex gap-4 pb-2">
                        {detailData.actors.map((actor, index) => (
                          <div
                            key={index}
                            className="flex flex-col items-center flex-shrink-0"
                            style={{ pointerEvents: isActorsDragging ? 'none' : 'auto' }}
                          >
                            {actor.profile_path ? (
                              <div
                                className="relative w-20 h-20 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 mb-2 cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => handleImageClick(processImageUrl(getTMDBImageUrl(actor.profile_path || null, 'w185')))}
                              >
                                <Image
                                  src={processImageUrl(getTMDBImageUrl(actor.profile_path || null, 'w185'))}
                                  alt={actor.name}
                                  fill
                                  className="object-cover"
                                  draggable={false}
                                />
                              </div>
                            ) : (
                              <div className="w-20 h-20 rounded-full bg-gray-200 dark:bg-gray-700 mb-2 flex items-center justify-center">
                                <Users size={28} className="text-gray-400" />
                              </div>
                            )}
                            <a
                              href={`https://baike.baidu.com/item/${encodeURIComponent(actor.name)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-medium text-gray-900 dark:text-gray-100 text-center w-20 line-clamp-2 hover:text-green-600 dark:hover:text-green-400 transition-colors cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {actor.name}
                            </a>
                            {actor.character && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 text-center w-20 line-clamp-2">
                                {actor.character}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-700 dark:text-gray-300">
                      {detailData.actors.slice(0, 10).map((a) => a.name).join(', ')}
                    </p>
                  )}
                </div>
              )}

              {/* 制作信息 */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                {detailData.countries && detailData.countries.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-1">
                      <Globe size={14} />
                      国家/地区
                    </h4>
                    <p className="text-gray-700 dark:text-gray-300">
                      {detailData.countries.join(', ')}
                    </p>
                  </div>
                )}

                {detailData.languages && detailData.languages.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-1">
                      <Tag size={14} />
                      语言
                    </h4>
                    <p className="text-gray-700 dark:text-gray-300">
                      {detailData.languages.join(', ')}
                    </p>
                  </div>
                )}

                {detailData.releaseDate && (
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-1">
                      <Calendar size={14} />
                      上映日期
                    </h4>
                    <p className="text-gray-700 dark:text-gray-300">{detailData.releaseDate}</p>
                  </div>
                )}

                {detailData.status && (
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">状态</h4>
                    <p className="text-gray-700 dark:text-gray-300">{detailData.status}</p>
                  </div>
                )}
              </div>

              {/* 季度和集数信息（仅TMDB电视剧） */}
              {detailData.mediaType === 'tv' && (
                <div className="mt-6">
                  {loadingSeasons && (
                    <div className="flex items-center justify-center py-4">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
                    </div>
                  )}

                  {!loadingSeasons && seasonData && (
                    <>
                      {/* 季度列表 */}
                      {seasonData.seasons.length > 0 && (
                        <div className="mb-6">
                          <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
                            季度
                          </h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {seasonData.seasons.map((season: any) => (
                              <div
                                key={season.id}
                                onClick={() => handleSeasonChange(season.season_number)}
                                className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                                  selectedSeason === season.season_number
                                    ? 'bg-green-100 dark:bg-green-900/30 ring-2 ring-green-500'
                                    : 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
                                }`}
                              >
                                {season.poster_path && (
                                  <div
                                    className="relative w-12 h-16 rounded overflow-hidden bg-gray-200 dark:bg-gray-700 flex-shrink-0 hover:opacity-80 transition-opacity"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleImageClick(processImageUrl(getTMDBImageUrl(season.poster_path, 'w500')));
                                    }}
                                  >
                                    <Image
                                      src={processImageUrl(getTMDBImageUrl(season.poster_path, 'w92'))}
                                      alt={season.name}
                                      fill
                                      className="object-cover"
                                      draggable={false}
                                    />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                    {season.name}
                                  </p>
                                  <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {season.episode_count} 集
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 集数列表 */}
                      {seasonData.episodes.length > 0 && (
                        <div>
                          <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
                            {seasonData.seasons.find((s: any) => s.season_number === selectedSeason)?.name || `第${selectedSeason}季`}
                          </h4>
                          <div
                            ref={episodesScrollRef}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseLeave}
                            className="overflow-x-auto -mx-6 px-6 cursor-grab active:cursor-grabbing"
                            style={{
                              scrollbarWidth: 'thin',
                              scrollBehavior: isDragging ? 'auto' : 'smooth'
                            }}
                          >
                            <div className="flex gap-3 pb-2">
                              {seasonData.episodes.map((episode: Episode) => {
                                const isExpanded = expandedEpisodes.has(episode.id);
                                return (
                                  <div
                                    key={episode.id}
                                    className="flex-shrink-0 w-64 p-3 rounded bg-gray-50 dark:bg-gray-800"
                                    style={{ pointerEvents: isDragging ? 'none' : 'auto' }}
                                  >
                                    {episode.still_path && (
                                      <div
                                        className="relative w-full h-36 rounded overflow-hidden bg-gray-200 dark:bg-gray-700 mb-2 cursor-pointer hover:opacity-90 transition-opacity"
                                        onClick={() => handleImageClick(processImageUrl(getTMDBImageUrl(episode.still_path, 'w500')))}
                                      >
                                        <Image
                                          src={processImageUrl(getTMDBImageUrl(episode.still_path, 'w300'))}
                                          alt={episode.name}
                                          fill
                                          className="object-cover"
                                          draggable={false}
                                        />
                                      </div>
                                    )}
                                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                                      第{episode.episode_number}集: {episode.name}
                                    </p>
                                    {episode.overview && (
                                      <p
                                        onClick={() => {
                                          const newExpanded = new Set(expandedEpisodes);
                                          if (isExpanded) {
                                            newExpanded.delete(episode.id);
                                          } else {
                                            newExpanded.add(episode.id);
                                          }
                                          setExpandedEpisodes(newExpanded);
                                        }}
                                        className={`text-xs text-gray-600 dark:text-gray-400 cursor-pointer ${isExpanded ? '' : 'line-clamp-3'}`}
                                      >
                                        {episode.overview}
                                      </p>
                                    )}
                                    {episode.air_date && (
                                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                                        {episode.air_date}
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* 数据源显示和切换 */}
              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 dark:text-gray-400">数据来源:</span>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 uppercase">
                      {currentSource === 'douban' && 'Douban'}
                      {currentSource === 'bangumi' && 'Bangumi'}
                      {currentSource === 'cms' && 'CMS'}
                      {currentSource === 'tmdb' && 'TMDB'}
                    </span>
                  </div>
                  {currentSource !== 'tmdb' && (
                    <button
                      onClick={handleToggleSource}
                      disabled={loading}
                      className="px-3 py-1.5 text-sm rounded-lg bg-green-500 hover:bg-green-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      切换到 TMDB
                    </button>
                  )}
                  {currentSource === 'tmdb' && originalSource !== 'tmdb' && originalDetailData && (
                    <button
                      onClick={handleToggleSource}
                      disabled={loading}
                      className="px-3 py-1.5 text-sm rounded-lg bg-gray-500 hover:bg-gray-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      切换回 {originalSource === 'douban' ? 'Douban' : originalSource === 'bangumi' ? 'Bangumi' : 'CMS'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 图片查看器 */}
      {showImageViewer && (
        <ImageViewer
          isOpen={showImageViewer}
          onClose={() => setShowImageViewer(false)}
          imageUrl={selectedImage}
          alt={detailData?.title || title}
        />
      )}
    </div>
  );

  return createPortal(content, document.body);
};

export default DetailPanel;
