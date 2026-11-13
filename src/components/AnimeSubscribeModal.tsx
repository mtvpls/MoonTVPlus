'use client';

import { FlaskConical, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  type FansubRecognition,
  type FansubRecognizeResult,
  type FansubVariant,
  buildFilterTextFromRecognition,
} from '@/lib/anime-fansub-recognize';
import {
  type AnimeExcludePreset,
  type AnimeFansubPreset,
  ANIME_EXCLUDE_PRESETS,
  ANIME_FANSUB_PRESETS,
  applyExcludeSingleSelect,
  applyFansubSingleSelect,
  isExcludePresetActive,
  isFansubPresetActive,
} from '@/lib/anime-filter-presets';

import OpenListPathInput from '@/components/OpenListPathInput';
import { MAIN_SOURCE_NAME } from '@/lib/openlist-sources';
import { type EpisodeTestResult } from '@/types/anime-subscription';

export interface AnimeSubscribeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 预填番剧名（搜索词） */
  initialTitle: string;
  /** 继续观看时可预填已看集数 */
  initialLastEpisode?: number;
  onSuccess?: () => void;
}

type SourceType = 'acgrip' | 'mikan' | 'dmhy' | 'nyaa';

/**
 * VideoCard / 管理入口共用的「添加追番订阅」轻量弹层（仅 admin API）
 */
export default function AnimeSubscribeModal({
  isOpen,
  onClose,
  initialTitle,
  initialLastEpisode = 0,
  onSuccess,
}: AnimeSubscribeModalProps) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recognizing, setRecognizing] = useState(false);
  const [recognizeError, setRecognizeError] = useState('');
  const [recognition, setRecognition] = useState<FansubRecognizeResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [testResult, setTestResult] = useState<EpisodeTestResult | null>(null);
  const [form, setForm] = useState({
    title: '',
    filterText: '',
    excludeText: '',
    source: 'mikan' as SourceType,
    lastEpisode: 0,
    enabled: true,
    onePerEpisode: false,
    refillMissingEpisodes: false,
    episodeRegex: '',
    downloadPath: '',
  });
  /** 可选的 OpenList 源名（主源在前），供「覆盖路径」选源 */
  const [sourceNames, setSourceNames] = useState<string[]>([MAIN_SOURCE_NAME]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);

  // 只在打开时拉一次（VideoCard 会为每张卡片实例化本组件，别在挂载时就请求）
  useEffect(() => {
    if (!isOpen || sourcesLoaded) return;
    let cancelled = false;
    fetch('/api/openlist/sources')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data?.sources) && data.sources.length) {
          setSourceNames(data.sources);
          setSourcesLoaded(true);
        }
      })
      .catch(() => {
        // 拉取失败时只保留主源，路径仍可手填
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, sourcesLoaded]);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      setError('');
      setRecognizeError('');
      setRecognition(null);
      setTestError('');
      setTestResult(null);
      setForm({
        title: initialTitle || '',
        filterText: '',
        excludeText: '',
        source: 'mikan',
        lastEpisode:
          typeof initialLastEpisode === 'number' && initialLastEpisode > 0
            ? initialLastEpisode
            : 0,
        enabled: true,
        onePerEpisode: false,
        refillMissingEpisodes: false,
        episodeRegex: '',
        downloadPath: '',
      });
    } else {
      setVisible(false);
    }
  }, [isOpen, initialTitle, initialLastEpisode]);

  if (!isOpen) return null;

  const chipClass = (active: boolean) =>
    `px-2 py-0.5 text-xs rounded-full border transition-colors ${
      active
        ? 'bg-green-600 text-white border-green-600'
        : 'bg-gray-50 dark:bg-gray-700/60 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600'
    }`;

  const handleFansubSelect = (preset: AnimeFansubPreset) => {
    setForm((prev) => ({
      ...prev,
      filterText: applyFansubSingleSelect(prev.filterText, preset),
    }));
  };

  const handleExcludeSelect = (preset: AnimeExcludePreset) => {
    setForm((prev) => ({
      ...prev,
      excludeText: applyExcludeSingleSelect(prev.excludeText, preset),
    }));
  };

  /** 智能识别：按番剧名在当前源搜一次，对结果做字幕组 × 字幕形态分组 */
  const handleRecognize = async () => {
    const keyword = form.title.trim();
    if (!keyword) {
      setRecognizeError('请先填写番剧名称');
      return;
    }
    try {
      setRecognizing(true);
      setRecognizeError('');
      const res = await fetch('/api/admin/anime-subscription/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: keyword, source: form.source }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '智能识别失败');
      }
      const data: FansubRecognizeResult = await res.json();
      setRecognition(data);
    } catch (e) {
      setRecognition(null);
      setRecognizeError(e instanceof Error ? e.message : '智能识别失败');
    } finally {
      setRecognizing(false);
    }
  };

  /** 点击识别结果：将「字幕组&字幕形态」写入过滤关键词（替换） */
  const applyRecognition = (fansub: FansubRecognition, variant: FansubVariant) => {
    setForm((prev) => ({
      ...prev,
      filterText: buildFilterTextFromRecognition(
        fansub.fansubFilter,
        variant.filter
      ),
    }));
  };

  /** 校验自定义集数正则（客户端快速反馈） */
  const checkEpisodeRegex = (regex: string): string | null => {
    const trimmed = regex.trim();
    if (!trimmed) return null;
    try {
      // eslint-disable-next-line no-new
      new RegExp(trimmed);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : '正则无效';
    }
  };

  /** 测试：按当前表单实际搜索一次，展示关键词命中与集数提取结果 */
  const handleTest = async () => {
    const keyword = form.title.trim();
    if (!keyword) {
      setTestError('请先填写番剧名称');
      return;
    }
    if (!form.filterText.trim()) {
      setTestError('请先填写过滤关键词');
      return;
    }
    const regexError = checkEpisodeRegex(form.episodeRegex);
    if (regexError) {
      setTestError(`集数正则无效: ${regexError}`);
      return;
    }
    try {
      setTesting(true);
      setTestError('');
      const res = await fetch('/api/admin/anime-subscription/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: keyword,
          filterText: form.filterText.trim(),
          excludeText: form.excludeText.trim(),
          source: form.source,
          episodeRegex: form.episodeRegex.trim(),
          lastEpisode: form.lastEpisode,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '测试失败');
      }
      const data: EpisodeTestResult = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult(null);
      setTestError(e instanceof Error ? e.message : '测试失败');
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.filterText.trim()) {
      setError('番剧名称和过滤关键词不能为空');
      return;
    }
    const regexError = checkEpisodeRegex(form.episodeRegex);
    if (regexError) {
      setError(`集数正则无效: ${regexError}`);
      return;
    }
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/admin/anime-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          filterText: form.filterText.trim(),
          excludeText: form.excludeText.trim(),
          source: form.source,
          enabled: form.enabled,
          lastEpisode: form.lastEpisode,
          onePerEpisode: form.onePerEpisode,
          refillMissingEpisodes: form.refillMissingEpisodes,
          episodeRegex: form.episodeRegex.trim(),
          downloadPath: form.downloadPath.trim(),
        }),
      });
      if (res.status === 403) {
        setError('无权限：仅管理员可添加追番订阅');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '创建订阅失败');
        return;
      }
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建订阅失败');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className='fixed inset-0 z-[10000] flex items-center justify-center p-4'>
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-200 ${
          visible ? 'opacity-50' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        className={`relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-800 shadow-xl transition-all duration-200 ${
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      >
        <div className='sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'>
          <h3 className='text-base font-semibold text-gray-900 dark:text-white'>
            添加追番订阅
          </h3>
          <button
            type='button'
            onClick={onClose}
            className='p-1 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
          >
            <X size={18} />
          </button>
        </div>

        <div className='p-4 space-y-3'>
          <p className='text-xs text-gray-500 dark:text-gray-400'>
            将按番剧名在 ACG 源搜索，过滤后自动离线下载（仅管理员）。
          </p>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
              番剧名称 *
            </label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm'
              placeholder='搜索用的番剧名'
            />
          </div>

          <div>
            <div className='flex items-center justify-between mb-1'>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
                过滤关键词 *
              </label>
              <button
                type='button'
                onClick={handleRecognize}
                disabled={recognizing}
                title='按番剧名搜索一次，识别字幕组与字幕形态'
                className='flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-blue-300 dark:border-blue-500/60 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50'
              >
                {recognizing ? (
                  <Loader2 size={12} className='animate-spin' />
                ) : (
                  <Sparkles size={12} />
                )}
                智能识别
              </button>
            </div>
            <input
              value={form.filterText}
              onChange={(e) => setForm({ ...form, filterText: e.target.value })}
              className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm'
              placeholder='喵萌奶茶屋&简日双语'
            />
            {recognizeError ? (
              <p className='mt-1 text-xs text-red-600 dark:text-red-400'>
                {recognizeError}
              </p>
            ) : null}
            {recognition ? (
              <div className='mt-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 space-y-2.5'>
                <div className='flex items-center justify-between'>
                  <p className='text-[11px] text-gray-500 dark:text-gray-400'>
                    识别到 {recognition.total} 条种子，点击填入过滤关键词
                  </p>
                  <button
                    type='button'
                    onClick={() => setRecognition(null)}
                    className='p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
                  >
                    <X size={12} />
                  </button>
                </div>
                {recognition.fansubs.length === 0 ? (
                  <p className='text-xs text-gray-400'>搜索结果为空</p>
                ) : (
                  recognition.fansubs.map((fansub) => (
                    <div key={fansub.fansub}>
                      <div className='flex items-baseline gap-1.5'>
                        <span className='text-xs font-medium text-gray-800 dark:text-gray-100'>
                          {fansub.fansub}
                        </span>
                        <span className='text-[10px] text-gray-400'>
                          {fansub.count} 条
                        </span>
                      </div>
                      <div className='mt-1 flex flex-wrap gap-1.5'>
                        {fansub.variants.map((variant) => (
                          <button
                            key={variant.id}
                            type='button'
                            title={variant.sampleTitle}
                            onClick={() => applyRecognition(fansub, variant)}
                            className={chipClass(
                              form.filterText ===
                                buildFilterTextFromRecognition(
                                  fansub.fansubFilter,
                                  variant.filter
                                )
                            )}
                          >
                            {variant.label} ×{variant.count}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : null}
            <p className='mt-1 text-[11px] text-gray-400'>字幕组</p>
            <div className='mt-1.5 flex flex-wrap gap-1.5'>
              {ANIME_FANSUB_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type='button'
                  title={p.hint ? `${p.insert}\n${p.hint}` : p.insert}
                  onClick={() => handleFansubSelect(p)}
                  className={chipClass(isFansubPresetActive(form.filterText, p))}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
              排除关键词
            </label>
            <input
              value={form.excludeText}
              onChange={(e) => setForm({ ...form, excludeText: e.target.value })}
              className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm'
              placeholder='先行|预告|PV'
            />
            <div className='mt-2 flex flex-wrap gap-1.5'>
              {ANIME_EXCLUDE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type='button'
                  title={p.insert}
                  onClick={() => handleExcludeSelect(p)}
                  className={chipClass(isExcludePresetActive(form.excludeText, p))}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className='flex items-center justify-between mb-1'>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
                集数提取正则
              </label>
              <button
                type='button'
                onClick={handleTest}
                disabled={testing}
                title='按当前表单实际搜索一次，查看能过滤到哪些集数'
                className='flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-blue-300 dark:border-blue-500/60 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50'
              >
                {testing ? (
                  <Loader2 size={12} className='animate-spin' />
                ) : (
                  <FlaskConical size={12} />
                )}
                测试
              </button>
            </div>
            <input
              value={form.episodeRegex}
              onChange={(e) => setForm({ ...form, episodeRegex: e.target.value })}
              className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm'
              placeholder='第(\d{1,3})[话話集]'
            />
            <p className='mt-1 text-[11px] text-gray-400'>
              可选；首个捕获组将作为集数，留空使用内置规则
            </p>
            {testError ? (
              <p className='mt-1 text-xs text-red-600 dark:text-red-400'>
                {testError}
              </p>
            ) : null}
            {testResult ? (
              <div className='mt-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 space-y-2.5'>
                <div className='flex items-center justify-between'>
                  <p className='text-[11px] text-gray-500 dark:text-gray-400'>
                    搜索到 {testResult.total} 条 · 关键词命中 {testResult.matched} 条
                  </p>
                  <button
                    type='button'
                    onClick={() => setTestResult(null)}
                    className='p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
                  >
                    <X size={12} />
                  </button>
                </div>
                {testResult.matched === 0 ? (
                  <p className='text-xs text-gray-400'>没有种子命中过滤条件</p>
                ) : (
                  <>
                    <div className='flex flex-wrap gap-1.5'>
                      {testResult.episodes.map((ep) => {
                        const isNew = testResult.newEpisodes.includes(ep);
                        return (
                          <span
                            key={ep}
                            className={`px-2 py-0.5 text-xs rounded-full border ${
                              isNew
                                ? 'bg-green-600 text-white border-green-600'
                                : 'bg-gray-50 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'
                            }`}
                            title={isNew ? '新集数，会触发下载' : '不大于当前集数，不会下载'}
                          >
                            第 {ep} 集{isNew ? ' ·新' : ''}
                          </span>
                        );
                      })}
                      {testResult.unparsed > 0 ? (
                        <span
                          className='px-2 py-0.5 text-xs rounded-full border border-amber-300 dark:border-amber-500/60 text-amber-600 dark:text-amber-400'
                          title='命中过滤关键词但未能提取集数'
                        >
                          {testResult.unparsed} 条未识别集数
                        </span>
                      ) : null}
                    </div>
                    {testResult.newEpisodes.length > 0 ? (
                      <p className='text-[11px] text-gray-500 dark:text-gray-400'>
                        当前集数 {testResult.lastEpisode}，会下载新集数：
                        {testResult.newEpisodes.join('、')}
                      </p>
                    ) : (
                      <p className='text-[11px] text-gray-500 dark:text-gray-400'>
                        当前集数 {testResult.lastEpisode}，没有需要下载的新集数
                      </p>
                    )}
                    <div className='max-h-48 overflow-y-auto space-y-1'>
                      {testResult.items.map((item, idx) => (
                        <div
                          key={`${idx}-${item.title}`}
                          className='flex items-start gap-1.5 text-[11px] leading-relaxed'
                        >
                          <span
                            className={`flex-shrink-0 mt-px px-1.5 rounded ${
                              item.episode == null
                                ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'
                                : 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700'
                            }`}
                          >
                            {item.episode == null ? '未识别' : `第${item.episode}集`}
                          </span>
                          <span className='break-all text-gray-500 dark:text-gray-400'>
                            {item.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                搜索源
              </label>
              <select
                value={form.source}
                onChange={(e) =>
                  setForm({ ...form, source: e.target.value as SourceType })
                }
                className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm'
              >
                <option value='mikan'>蜜柑</option>
                <option value='acgrip'>ACG.RIP</option>
                <option value='dmhy'>动漫花园</option>
                <option value='nyaa'>Nyaa</option>
              </select>
            </div>
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                当前集数
              </label>
              <input
                type='number'
                min={0}
                value={form.lastEpisode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    lastEpisode: parseInt(e.target.value, 10) || 0,
                  })
                }
                className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm'
              />
            </div>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
              覆盖路径
            </label>
            <OpenListPathInput
              value={form.downloadPath}
              onChange={(value) => setForm({ ...form, downloadPath: value })}
              sourceNames={sourceNames}
              placeholder='/anime'
              fieldClass='px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm'
            />
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              可选；留空用「离线下载目录/番剧名称」
            </p>
          </div>

          <label className='flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300'>
            <input
              type='checkbox'
              checked={form.onePerEpisode}
              onChange={(e) =>
                setForm({ ...form, onePerEpisode: e.target.checked })
              }
              className='rounded border-gray-300'
            />
            单集只下载一次（同集多种子时只入队一条）
          </label>
          <label className='flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300'>
            <input
              type='checkbox'
              checked={form.refillMissingEpisodes}
              onChange={(e) =>
                setForm({ ...form, refillMissingEpisodes: e.target.checked })
              }
              className='rounded border-gray-300'
            />
            缺集重新检索（跳集时按「番名+集数」补搜）
          </label>

          {error ? (
            <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
          ) : null}

          <div className='flex justify-end gap-2 pt-1'>
            <button
              type='button'
              onClick={onClose}
              disabled={loading}
              className='px-4 py-2 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
            >
              取消
            </button>
            <button
              type='button'
              onClick={handleSubmit}
              disabled={loading}
              className='px-4 py-2 rounded-lg text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center gap-2'
            >
              {loading ? <Loader2 size={16} className='animate-spin' /> : null}
              添加订阅
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
