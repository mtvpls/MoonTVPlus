/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { Bot, Loader2, Send, Sparkles, Trash2,X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { VideoContext } from '@/lib/ai-orchestrator';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AIChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  context?: VideoContext;
  welcomeMessage?: string;
  onStreamingChange?: (isStreaming: boolean) => void;
}

export default function AIChatPanel({
  isOpen,
  onClose,
  context,
  welcomeMessage = '你好！我是MoonTVPlus的AI影视助手，有什么可以帮你的吗？',
  onStreamingChange,
}: AIChatPanelProps) {
  // 使用 useMemo 稳定 storage key，只在实际内容变化时才改变
  const storageKey = useMemo(() => {
    if (context?.title) {
      return `ai-chat-${context.title}-${context.year || ''}-${context.type || ''}`;
    }
    return 'ai-chat-general';
  }, [context?.title, context?.year, context?.type]);

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: welcomeMessage },
  ]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevStorageKeyRef = useRef<string>(storageKey);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasLoadedRef = useRef(false);

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 从sessionStorage加载消息记录
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 如果已经加载过当前 storageKey，跳过
    if (hasLoadedRef.current) return;

    const savedMessages = sessionStorage.getItem(storageKey);

    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      } catch (error) {
        console.error('加载聊天记录失败:', error);
      }
    }

    // 标记为已加载
    hasLoadedRef.current = true;
  }, [storageKey]); // 当 storageKey 变化时重新加载

  // 保存消息记录到sessionStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    } catch (error) {
      console.error('保存聊天记录失败:', error);
    }
  }, [messages, storageKey]); // 消息变化时保存

  // 检测VideoContext变化，清除旧的聊天记录
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (prevStorageKeyRef.current !== storageKey) {
      // 上下文变化了，取消正在进行的请求
      if (abortControllerRef.current) {
        console.log('视频上下文变化，取消正在进行的AI请求');
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        setIsStreaming(false);
      }

      // 清除消息并重置为欢迎消息
      console.log('视频上下文变化，清除聊天记录');
      setMessages([{ role: 'assistant', content: welcomeMessage }]);

      // 重置加载标记，允许加载新视频的聊天记录
      hasLoadedRef.current = false;

      prevStorageKeyRef.current = storageKey;
    }
  }, [storageKey, welcomeMessage]); // 监听 storageKey 变化

  // 通知父组件 streaming 状态变化
  useEffect(() => {
    onStreamingChange?.(isStreaming);
  }, [isStreaming, onStreamingChange]);

  // 自动聚焦输入框和防止背景滚动
  useEffect(() => {
    if (isOpen) {
      // 检测是否为移动设备
      const checkMobile = () => {
        setIsMobile(window.innerWidth < 768);
      };
      checkMobile();

      // 只在非移动设备上聚焦输入框
      if (inputRef.current && window.innerWidth >= 768) {
        inputRef.current.focus();
      }

      // 防止背景滚动
      const originalOverflow = document.body.style.overflow;
      const originalPaddingRight = document.body.style.paddingRight;

      // 获取滚动条宽度
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

      document.body.style.overflow = 'hidden';
      document.body.style.paddingRight = `${scrollbarWidth}px`;

      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.paddingRight = originalPaddingRight;
      };
    }
  }, [isOpen]);

  const handleSendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput('');

    // 添加用户消息
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);

    // 开始流式响应
    setIsStreaming(true);

    // 先添加一个空的助手消息用于流式更新或显示错误
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    // 创建新的 AbortController
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          context,
    history: messages.filter((m) => m.role !== 'assistant' || m.content !== welcomeMessage),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
     const errorMsg = errorData.error || errorData.details || `请求失败 (${response.status})`;
        throw new Error(errorMsg);
      }

      // 检查响应类型：流式(text/event-stream)或非流式(application/json)
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('text/event-stream')) {
        // 处理流式响应
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error('无法读取响应流');
        }

        let assistantMessage = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter((line) => line.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);

              if (data === '[DONE]') {
                break;
              }

              try {
                const json = JSON.parse(data);
                const text = json.text || '';

                if (text) {
                  assistantMessage += text;

              // 更新最后一条消息
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = {
                      role: 'assistant',
                      content: assistantMessage,
               };
                    return newMessages;
                  });
                }
              } catch (e) {
                console.error('解析SSE数据失败:', e);
              }
            }
          }
        }
      } else {
        // 处理非流式响应
        const data = await response.json();
        const content = data.content || '';

        // 更新最后一条消息为完整响应
        setMessages((prev) => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = {
            role: 'assistant',
            content: content,
          };
          return newMessages;
        });
      }
    } catch (error) {
      // 如果是主动取消的请求（切换视频或其他原因），不显示错误
      if ((error as Error).name === 'AbortError') {
        console.log('请求已取消');
        return;
      }

      console.error('发送消息失败:', error);

      // 更新最后一条空消息为错误消息
      setMessages((prev) => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = {
          role: 'assistant',
          content: `❌ 抱歉，出现了错误：\n\n${(error as Error).message}\n\n请检查：\n- AI服务配置是否正确\n- API密钥是否有效\n- 网络连接是否正常`,
        };
        return newMessages;
      });
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 清空聊天上下文
  const handleClearContext = () => {
    if (typeof window === 'undefined') return;

    // 清除sessionStorage
    sessionStorage.removeItem(storageKey);

    // 重置消息为欢迎消息
    setMessages([{ role: 'assistant', content: welcomeMessage }]);

    console.log('已清空聊天上下文');
  };

  const modalContent = (
    <div
      className={`fixed inset-0 z-[1002] flex items-center justify-center bg-black/50 backdrop-blur-sm overflow-hidden transition-opacity duration-200 ${
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      onClick={(e) => {
        // 点击遮罩层关闭弹窗
        if (e.target === e.currentTarget && isOpen) {
          onClose();
        }
      }}
    >
      <div className='relative mx-4 my-auto flex h-[85vh] sm:h-[80vh] max-h-[90vh] sm:max-h-[600px] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-gray-900'>
        {/* 头部 */}
        <div className='flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700'>
          <div className='flex items-center gap-3 min-w-0 flex-1'>
            <div className='flex h-10 w-10 items-center justify-center rounded-full bg-purple-500 flex-shrink-0'>
              <Sparkles size={20} className='text-white' />
            </div>
            <div className='min-w-0 flex-1'>
        <h2 className='text-lg font-semibold text-gray-900 dark:text-white'>
                AI影视助手
              </h2>
              {context?.title && (
                <p className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                  正在讨论: {context.title}
                  {context.year && ` (${context.year})`}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className='rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 flex-shrink-0'
          >
         <X size={20} />
          </button>
        </div>

        {/* 消息列表 */}
        <div className='flex-1 overflow-y-auto p-4'>
          <div className='space-y-4'>
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`flex max-w-[80%] gap-3 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {/* 头像 */}
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      message.role === 'user'
                        ? 'bg-blue-500'
                        : 'bg-purple-500'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <span className='text-xs font-semibold text-white'>
                        U
                      </span>
                    ) : (
                      <Bot size={16} className='text-white' />
                    )}
                  </div>

                  {/* 消息内容 */}
                  <div
                    className={`rounded-2xl px-4 py-2 ${
                      message.role === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <p className='whitespace-pre-wrap break-words text-sm leading-relaxed'>
                        {message.content}
                      </p>
                    ) : (
                      <div className='prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-p:leading-relaxed prose-pre:bg-gray-800 prose-pre:text-gray-100 dark:prose-pre:bg-gray-900 prose-code:text-purple-600 dark:prose-code:text-purple-400 prose-code:bg-purple-50 dark:prose-code:bg-purple-900/20 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-strong:text-gray-900 dark:prose-strong:text-white prose-ul:my-2 prose-ol:my-2 prose-li:my-1'>
                        <ReactMarkdown remarkPlugins={[remarkGfm as any]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* 加载指示器 */}
            {isStreaming && (
              <div className='flex justify-start'>
                <div className='flex max-w-[80%] gap-3'>
                  <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-500'>
                    <Bot size={16} className='text-white' />
                  </div>
                  <div className='flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-2 dark:bg-gray-800'>
                    <Loader2 size={16} className='animate-spin text-gray-500' />
                    <span className='text-sm text-gray-500 dark:text-gray-400'>
                      AI正在思考...
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 输入区域 */}
        <div className='border-t border-gray-200 p-4 dark:border-gray-700'>
          <div className='flex gap-2'>
            <button
              onClick={handleClearContext}
              className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-300 text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800'
              title='清空聊天记录'
              disabled={isStreaming}
            >
              <Trash2 size={20} />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isMobile ? '输入你的问题...' : '输入你的问题... (Shift+Enter换行)'}
              disabled={isStreaming}
              rows={1}
              className='flex-1 resize-none rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 dark:focus:border-purple-400'
              style={{
                minHeight: '48px',
                maxHeight: '120px',
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
              }}
            />
            <button
              onClick={handleSendMessage}
              disabled={!input.trim() || isStreaming}
              className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500 text-white transition-colors hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isStreaming ? (
                <Loader2 size={20} className='animate-spin' />
              ) : (
                <Send size={20} />
              )}
            </button>
          </div>

          {/* 快捷提示 */}
          {messages.length === 1 && !isStreaming && (
            <div className='mt-3 flex flex-wrap gap-2'>
              <button
                onClick={() => setInput('推荐一些高分电影')}
                className='rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
              >
                推荐高分电影
              </button>
              <button
                onClick={() => setInput('最近有什么新电影上映？')}
                className='rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
              >
                最新上映
              </button>
              {context?.title && (
                <button
                  onClick={() =>
                    setInput(`${context.title}讲的是什么故事？`)
                  }
                  className='rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                >
                  剧情介绍
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return typeof window !== 'undefined'
    ? createPortal(modalContent, document.body)
    : null;
}
