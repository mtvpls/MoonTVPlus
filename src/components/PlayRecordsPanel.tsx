'use client';

import { AlertTriangle, Check, History, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { PlayRecord } from '@/lib/db.client';
import {
  clearAllPlayRecords,
  deletePlayRecords,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import VideoCard from '@/components/VideoCard';

type PlayRecordItem = PlayRecord & {
  key: string;
};

interface PlayRecordsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const parseKey = (key: string) => {
  const [source, id] = key.split('+');
  return { source, id };
};

const getProgress = (record: PlayRecord) => {
  if (record.total_time === 0) return 0;
  return (record.play_time / record.total_time) * 100;
};

export default function PlayRecordsPanel({
  isOpen,
  onClose,
}: PlayRecordsPanelProps) {
  const [playRecords, setPlayRecords] = useState<PlayRecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [showDeleteSelectedDialog, setShowDeleteSelectedDialog] =
    useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);

  const loadPlayRecords = async () => {
    setLoading(true);
    try {
      const allRecords = await getAllPlayRecords();
      const sorted = Object.entries(allRecords)
        .map(([key, record]) => ({
          ...record,
          key,
        }))
        .sort((a, b) => b.save_time - a.save_time);
      setPlayRecords(sorted);
      setSelectedKeys((prev) => {
        if (prev.size === 0) return prev;
        const availableKeys = new Set(sorted.map((record) => record.key));
        return new Set(
          Array.from(prev).filter((key) => availableKeys.has(key))
        );
      });
    } catch (error) {
      console.error('加载播放记录失败:', error);
      setPlayRecords([]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearAll = async () => {
    try {
      await clearAllPlayRecords();
      setPlayRecords([]);
      setSelectedKeys(new Set());
      setEditMode(false);
      setShowConfirmDialog(false);
    } catch (error) {
      console.error('清空播放记录失败:', error);
    }
  };

  const toggleEditMode = () => {
    setEditMode((prev) => {
      if (prev) {
        setSelectedKeys(new Set());
      }
      return !prev;
    });
  };

  const toggleSelected = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedKeys(new Set(playRecords.map((record) => record.key)));
  };

  const handleDeleteSelected = async () => {
    if (selectedKeys.size === 0) return;

    setDeletingSelected(true);
    try {
      const keysToDelete = Array.from(selectedKeys);
      await deletePlayRecords(keysToDelete);
      setPlayRecords((prev) =>
        prev.filter((record) => !selectedKeys.has(record.key))
      );
      setSelectedKeys(new Set());
      setEditMode(false);
      setShowDeleteSelectedDialog(false);
    } catch (error) {
      console.error('删除选中播放记录失败:', error);
    } finally {
      setDeletingSelected(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadPlayRecords();
  }, [isOpen]);

  useEffect(() => {
    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        if (!isOpen) return;
        const sorted = Object.entries(newRecords)
          .map(([key, record]) => ({
            ...record,
            key,
          }))
          .sort((a, b) => b.save_time - a.save_time);
        setPlayRecords(sorted);
        setSelectedKeys((prev) => {
          if (prev.size === 0) return prev;
          const availableKeys = new Set(sorted.map((record) => record.key));
          return new Set(
            Array.from(prev).filter((key) => availableKeys.has(key))
          );
        });
      }
    );

    return () => {
      unsubscribe();
    };
  }, [isOpen]);

  const selectedCount = selectedKeys.size;
  const allSelected =
    playRecords.length > 0 && selectedCount === playRecords.length;

  return (
    <>
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={onClose}
      />

      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl max-h-[85vh] bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] flex flex-col overflow-hidden'>
        <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
          <div className='flex items-center gap-2'>
            <History className='w-5 h-5 text-sky-500' />
            <h3 className='text-lg font-bold text-gray-800 dark:text-gray-200'>
              播放记录
            </h3>
            {playRecords.length > 0 && (
              <span className='px-2 py-0.5 text-xs font-medium bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300 rounded-full'>
                {playRecords.length} 项
              </span>
            )}
          </div>
          <div className='flex items-center gap-2'>
            {playRecords.length > 0 &&
              (editMode ? (
                <>
                  <button
                    onClick={
                      allSelected ? () => setSelectedKeys(new Set()) : selectAll
                    }
                    className='text-xs text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors'
                  >
                    {allSelected ? '取消全选' : '全选'}
                  </button>
                  <button
                    onClick={() => setShowDeleteSelectedDialog(true)}
                    disabled={selectedCount === 0 || deletingSelected}
                    className='inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 dark:hover:text-red-300 transition-colors'
                  >
                    <Trash2 className='w-3.5 h-3.5' />
                    删除{selectedCount > 0 ? `(${selectedCount})` : ''}
                  </button>
                  <button
                    onClick={toggleEditMode}
                    className='text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors'
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={toggleEditMode}
                    className='text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 transition-colors'
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => setShowConfirmDialog(true)}
                    className='text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors'
                  >
                    清空全部
                  </button>
                </>
              ))}
            <button
              onClick={onClose}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>
        </div>

        <div className='flex-1 overflow-y-auto p-6'>
          {loading ? (
            <div className='flex items-center justify-center py-12'>
              <div className='w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin'></div>
            </div>
          ) : playRecords.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400'>
              <History className='w-12 h-12 mb-3 opacity-30' />
              <p className='text-sm'>暂无播放记录</p>
            </div>
          ) : (
            <div className='grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
              {playRecords.map((record) => {
                const { source, id } = parseKey(record.key);
                const checked = selectedKeys.has(record.key);

                return (
                  <div key={record.key} className='relative w-full'>
                    <VideoCard
                      id={id}
                      title={record.title}
                      poster={record.cover}
                      year={record.year}
                      source={source}
                      source_name={record.source_name}
                      progress={getProgress(record)}
                      episodes={record.total_episodes}
                      currentEpisode={record.index}
                      query={record.search_title}
                      from='playrecord'
                      onDelete={() =>
                        setPlayRecords((prev) =>
                          prev.filter((item) => item.key !== record.key)
                        )
                      }
                      type={record.total_episodes > 1 ? 'tv' : ''}
                      origin={record.origin}
                      playTime={record.play_time}
                      totalTime={record.total_time}
                    />
                    {editMode && (
                      <button
                        type='button'
                        aria-label={
                          checked ? '取消选择播放记录' : '选择播放记录'
                        }
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleSelected(record.key);
                        }}
                        className={`absolute inset-0 z-20 rounded-lg transition-colors ${
                          checked
                            ? 'bg-sky-500/15 ring-2 ring-sky-500'
                            : 'bg-black/5 hover:bg-sky-500/10 dark:bg-black/20'
                        }`}
                      >
                        <span
                          className={`absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 shadow-md transition-colors ${
                            checked
                              ? 'border-sky-500 bg-sky-500 text-white'
                              : 'border-white bg-black/40 text-transparent'
                          }`}
                        >
                          <Check className='h-4 w-4' />
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showConfirmDialog &&
        createPortal(
          <div
            className='fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4 transition-opacity duration-300'
            onClick={() => setShowConfirmDialog(false)}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full border border-red-200 dark:border-red-800 transition-all duration-300'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-start gap-4 mb-4'>
                  <div className='flex-shrink-0'>
                    <AlertTriangle className='w-8 h-8 text-red-500' />
                  </div>
                  <div className='flex-1'>
                    <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
                      清空播放记录
                    </h3>
                    <p className='text-sm text-gray-600 dark:text-gray-400'>
                      确定要清空所有播放记录吗？此操作不可恢复。
                    </p>
                  </div>
                </div>

                <div className='flex gap-3 mt-6'>
                  <button
                    onClick={() => setShowConfirmDialog(false)}
                    className='flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors'
                  >
                    取消
                  </button>
                  <button
                    onClick={handleClearAll}
                    className='flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors'
                  >
                    确定清空
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showDeleteSelectedDialog &&
        createPortal(
          <div
            className='fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4 transition-opacity duration-300'
            onClick={() =>
              !deletingSelected && setShowDeleteSelectedDialog(false)
            }
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full border border-red-200 dark:border-red-800 transition-all duration-300'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-start gap-4 mb-4'>
                  <div className='flex-shrink-0'>
                    <AlertTriangle className='w-8 h-8 text-red-500' />
                  </div>
                  <div className='flex-1'>
                    <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
                      删除播放记录
                    </h3>
                    <p className='text-sm text-gray-600 dark:text-gray-400'>
                      确定要删除选中的 {selectedCount}{' '}
                      条播放记录吗？此操作不可恢复。
                    </p>
                  </div>
                </div>

                <div className='flex gap-3 mt-6'>
                  <button
                    onClick={() => setShowDeleteSelectedDialog(false)}
                    disabled={deletingSelected}
                    className='flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-60 rounded-lg transition-colors'
                  >
                    取消
                  </button>
                  <button
                    onClick={handleDeleteSelected}
                    disabled={deletingSelected}
                    className='flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-lg transition-colors'
                  >
                    {deletingSelected ? '删除中...' : '确定删除'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
