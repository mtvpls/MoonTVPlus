/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { Bot, Loader2, RefreshCw, Send, Sparkles, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { VideoContext } from '@/lib/ai-orchestrator';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
  retryMessage?: string;
  /** 本回合执行过的工具调用（含参数与返回结果），随 history 回喂服务端 */
  toolCalls?: Array<{
    name: string;
    key?: string;
    args?: any;
    result?: string;
    ok?: boolean;
  }>;
  /** 较早对话被压缩后写回的摘要正文；存在时替换 toolCalls 随 history 回喂（避免下次请求上下文重新膨胀） */
  compressedSummaries?: string[];
}

/** 工具链中的一个工具调用 */
interface ToolChainItem {
  name: string;
  status: 'running' | 'done' | 'failed';
  key?: string;
  args?: any;
  result?: string;
  ok?: boolean;
}

interface AIChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  context?: VideoContext;
  welcomeMessage?: string;
  onStreamingChange?: (isStreaming: boolean) => void;
  useDrawer?: boolean;
  drawerWidth?: string;
}

type MarkdownSegment =
  | { type: 'markdown'; content: string }
  | {
      type: 'table';
      header: string[];
      align: Array<'left' | 'center' | 'right' | undefined>;
      rows: string[][];
    };

const splitMarkdownTableRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '|' && trimmed[i - 1] !== '\\') {
      cells.push(current.replace(/\\\|/g, '|').trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.replace(/\\\|/g, '|').trim());
  return cells;
};

const getTableAlign = (cell: string): 'left' | 'center' | 'right' | undefined => {
  const trimmed = cell.trim();
  if (!/^:?-{3,}:?$/.test(trimmed)) return undefined;
  if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
  if (trimmed.endsWith(':')) return 'right';
  return 'left';
};

const isTableDelimiterRow = (line: string): boolean => {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
};

const normalizeTableRow = (cells: string[], length: number): string[] => {
  if (cells.length === length) return cells;
  if (cells.length > length) return cells.slice(0, length);
  return [...cells, ...Array.from({ length: length - cells.length }, () => '')];
};

const splitMarkdownByTables = (content: string): MarkdownSegment[] => {
  const lines = content.split('\n');
  const segments: MarkdownSegment[] = [];
  const markdownBuffer: string[] = [];
  let inFence = false;
  let i = 0;

  const flushMarkdown = () => {
    const markdown = markdownBuffer.join('\n');
    if (markdown.trim()) {
      segments.push({ type: 'markdown', content: markdown });
    }
    markdownBuffer.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      markdownBuffer.push(line);
      i++;
      continue;
    }

    if (
      !inFence &&
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableDelimiterRow(lines[i + 1])
    ) {
      const header = splitMarkdownTableRow(line);
      const delimiter = splitMarkdownTableRow(lines[i + 1]);

      if (header.length === delimiter.length) {
        flushMarkdown();

        const rows: string[][] = [];
        i += 2;

        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          rows.push(normalizeTableRow(splitMarkdownTableRow(lines[i]), header.length));
          i++;
        }

        segments.push({
          type: 'table',
          header,
          align: delimiter.map(getTableAlign),
          rows,
        });
        continue;
      }
    }

    markdownBuffer.push(line);
    i++;
  }

  flushMarkdown();
  return segments;
};

const transformStrikethrough = (line: string): string => {
  return line;
};

const transformTaskList = (line: string): string => {
  return line.replace(/^(\s*[-*+]\s+)\[(x|X| )\]\s+/g, (_match, prefix: string, checked: string) => {
    return `${prefix}${checked.trim() ? '☑' : '☐'} `;
  });
};

const transformBareLinks = (line: string): string => {
  return line.replace(/(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/g, (match, _url: string, offset: number, source: string) => {
    const before = source.slice(Math.max(0, offset - 2), offset);
    const previousChar = source[offset - 1];
    const lastOpenBracket = source.lastIndexOf('[', offset);
    const lastCloseBracket = source.lastIndexOf(']', offset);
    const nextCloseBracket = source.indexOf(']', offset + match.length);
    const nextOpenParen = nextCloseBracket >= 0 ? source.slice(nextCloseBracket, nextCloseBracket + 2) : '';

    // 已经是 Markdown 链接目标或链接文本时不重复转换。
    if (before === '](' || previousChar === '<' || (lastOpenBracket > lastCloseBracket && nextOpenParen === '](')) {
      return match;
    }

    const trailing = match.match(/[.,!?;:，。！？；：]+$/)?.[0] || '';
    const cleanUrl = trailing ? match.slice(0, -trailing.length) : match;
    const href = cleanUrl.startsWith('www.') ? `https://${cleanUrl}` : cleanUrl;

    return `[${cleanUrl}](${href})${trailing}`;
  });
};

const transformLightweightGfm = (content: string): string => {
  const lines = content.split('\n');
  let inFence = false;

  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }

    if (inFence) return line;

    return transformBareLinks(transformStrikethrough(transformTaskList(line)));
  }).join('\n');
};

const renderStrikethroughNodes = (children: React.ReactNode): React.ReactNode => {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      const parts: React.ReactNode[] = [];
      const regex = /~~([^~\n]+)~~/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(child)) !== null) {
        if (match.index > lastIndex) {
          parts.push(child.slice(lastIndex, match.index));
        }

        parts.push(<del key={`${match.index}-${match[1]}`}>{match[1]}</del>);
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < child.length) {
        parts.push(child.slice(lastIndex));
      }

      return parts.length > 0 ? parts : child;
    }

    if (React.isValidElement(child) && (child as any).props?.children) {
      return React.cloneElement(child as any, {
        children: renderStrikethroughNodes((child as any).props.children),
      });
    }

    return child;
  });
};

export default function AIChatPanel({
  isOpen,
  onClose,
  context,
  welcomeMessage = '你好！我是MoonTVPlus的AI影视助手，有什么可以帮你的吗？',
  onStreamingChange,
  useDrawer = false,
  drawerWidth = 'w-full md:w-[25%]',
}: AIChatPanelProps) {
  const pathname = usePathname();

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
  const [currentUsername, setCurrentUsername] = useState('用户');
  // 工具链：每个工具调用一行，记录工具名、关键参数、状态（独立于消息，不写入 sessionStorage）
  const [toolChain, setToolChain] = useState<ToolChainItem[]>([]);
  // 工具链实时镜像，供流式结束固化到消息时读取最新状态（setState 是异步的）
  const toolChainRef = useRef<ToolChainItem[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevStorageKeyRef = useRef<string>(storageKey);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasLoadedRef = useRef(false);
  /** 本次请求服务端上下文压缩产生的摘要，流式结束后随本消息固化回喂 */
  const compressionSummariesRef = useRef<string[]>([]);

  // 工具名称 → 展示文案
  const TOOL_LABELS: Record<string, string> = {
    get_current_time: '获取当前时间',
    web_search: '联网搜索',
    fetch_page: '抓取网页',
    douban_lookup: '豆瓣数据',
    tmdb_lookup: 'TMDB 数据',
    get_user_favorites: '读取收藏',
    get_user_recent: '最近观看',
  };

  // 工具名称 → 关键参数提取（用于工具链展示）
  const TOOL_KEY_EXTRACTORS: Record<string, (args: any) => string | undefined> = {
    web_search: (a) => a?.query,
    fetch_page: (a) => a?.url,
    douban_lookup: (a) => a?.query || (a?.id ? `ID:${a.id}` : undefined),
    tmdb_lookup: (a) =>
      a?.trending ? '热榜' : a?.query || (a?.id ? `ID:${a.id}` : undefined),
  };

  // 工具链：追加一个进行中的工具调用
  const pushToolChain = (name: string, args?: any) => {
    const extractor = TOOL_KEY_EXTRACTORS[name];
    const key = extractor ? extractor(args) : undefined;
    const item: ToolChainItem = { name, status: 'running', key, args };
    toolChainRef.current = [...toolChainRef.current, item];
    setToolChain(toolChainRef.current);
  };

  // 工具链：将某个进行中的工具标记为完成
  const finishToolChain = (name: string, done?: { result?: string; ok?: boolean }) => {
    toolChainRef.current = toolChainRef.current.map((item) =>
      item.name === name && item.status === 'running'
        ? {
            ...item,
            status: done && done.ok === false ? 'failed' : 'done',
            ...(done && { result: done.result, ok: done.ok }),
          }
        : item
    );
    setToolChain(toolChainRef.current);
  };

  // 工具链：全部重置（新请求 / 上下文切换 / 清空）
  const clearToolChain = () => {
    toolChainRef.current = [];
    setToolChain([]);
  };

  // 工具链渲染：显示每个工具调用的状态与关键参数（live=流式中，显示 spinner；否则显示完成状态）
  const renderToolChain = (items: ToolChainItem[], live: boolean) => {
    if (!items.length) return null;
    return (
      <div className='w-full space-y-1.5'>
        {items.map((item, i) => {
          const label = TOOL_LABELS[item.name] || item.name;
          // 持久化链没有 status，按 ok 推导；live 链自带 status
          const status = item.status || (item.ok === false ? 'failed' : 'done');
          const keyText =
            item.key && item.key.length > 60
              ? `${item.key.slice(0, 60)}...`
              : item.key;
          return (
            <div
              key={i}
              className='flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300'
            >
              {live && status === 'running' ? (
                <Loader2 size={14} className='animate-spin text-purple-500' />
              ) : (
                <span
                  className={
                    status === 'failed'
                      ? 'text-red-500'
                      : 'text-green-500'
                  }
                >
                  {status === 'failed' ? '✕' : '✓'}
                </span>
              )}
              <span className='flex-1 whitespace-nowrap'>{label}</span>
              {keyText && (
                <span className='max-w-[60%] truncate text-xs text-gray-400 dark:text-gray-500'>
                  {keyText}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // 将《》包裹的影视名称转换为链接
  const convertTitleToLink = (content: string): string => {
    return content.replace(/《([^》]+)》/g, (match, title) => {
      const encodedTitle = encodeURIComponent(title);
      return `[《${title}》](/play?title=${encodedTitle})`;
    });
  };

  const markdownComponents = useMemo(() => ({
    del: ({ children }: any) => <del>{children}</del>,
    p: ({ children }: any) => <p>{renderStrikethroughNodes(children)}</p>,
    li: ({ children }: any) => <li>{renderStrikethroughNodes(children)}</li>,
    h1: ({ children }: any) => <h1>{renderStrikethroughNodes(children)}</h1>,
    h2: ({ children }: any) => <h2>{renderStrikethroughNodes(children)}</h2>,
    h3: ({ children }: any) => <h3>{renderStrikethroughNodes(children)}</h3>,
    h4: ({ children }: any) => <h4>{renderStrikethroughNodes(children)}</h4>,
    h5: ({ children }: any) => <h5>{renderStrikethroughNodes(children)}</h5>,
    h6: ({ children }: any) => <h6>{renderStrikethroughNodes(children)}</h6>,
    a: ({ href, children, ...props }: any) => {
      // 如果是内部链接（以 / 开头），使用 Next.js Link
      if (href?.startsWith('/')) {
        // 如果当前在 /play 页面且链接也是 /play，不做处理（返回纯文本）
        if (pathname === '/play' && href.startsWith('/play')) {
          return <span>{children}</span>;
        }
        return (
          <Link href={href} {...props}>
            {children}
          </Link>
        );
      }
      // 外部链接使用普通 a 标签
      return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
    },
  }), [pathname]);

  const inlineMarkdownComponents = useMemo(() => ({
    ...markdownComponents,
    p: ({ children }: any) => <span>{renderStrikethroughNodes(children)}</span>,
  }), [markdownComponents]);

  const renderAssistantContent = (content: string) => {
    return splitMarkdownByTables(content).map((segment, segmentIndex) => {
      if (segment.type === 'markdown') {
        return (
          <ReactMarkdown key={segmentIndex} components={markdownComponents}>
            {transformLightweightGfm(convertTitleToLink(segment.content))}
          </ReactMarkdown>
        );
      }

      return (
        <div
          key={segmentIndex}
          className='not-prose overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm ring-1 ring-black/5 dark:border-gray-700 dark:bg-gray-900 dark:ring-white/10'
        >
          <div className='overflow-x-auto'>
            <table className='m-0 min-w-full border-separate border-spacing-0 text-left text-sm'>
              <thead>
                <tr className='bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/40 dark:to-blue-950/40'>
                {segment.header.map((cell, cellIndex) => (
                  <th
                    key={cellIndex}
                    className='whitespace-nowrap border-b border-gray-200 px-4 py-3 font-semibold text-gray-800 first:rounded-tl-xl last:rounded-tr-xl dark:border-gray-700 dark:text-gray-100'
                    style={{ textAlign: segment.align[cellIndex] }}
                  >
                    <ReactMarkdown components={inlineMarkdownComponents}>
                      {transformLightweightGfm(convertTitleToLink(cell))}
                    </ReactMarkdown>
                  </th>
                ))}
                </tr>
              </thead>
              <tbody className='divide-y divide-gray-100 dark:divide-gray-800'>
              {segment.rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className='transition-colors odd:bg-white even:bg-gray-50/70 hover:bg-purple-50/70 dark:odd:bg-gray-900 dark:even:bg-gray-800/40 dark:hover:bg-purple-950/25'
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className='px-4 py-3 align-top leading-relaxed text-gray-700 dark:text-gray-200'
                      style={{ textAlign: segment.align[cellIndex] }}
                    >
                      <ReactMarkdown components={inlineMarkdownComponents}>
                        {transformLightweightGfm(convertTitleToLink(cell))}
                      </ReactMarkdown>
                    </td>
                  ))}
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    });
  };

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const authInfo = getAuthInfoFromBrowserCookie();
    setCurrentUsername(authInfo?.username || '用户');
  }, []);

  const userAvatarText = currentUsername.trim().charAt(0).toUpperCase() || '用';

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
      clearToolChain();
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

      // 只在非抽屉模式下防止背景滚动
      if (!useDrawer) {
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
    }
  }, [isOpen, useDrawer]);

  const handleSendMessage = async (retryMessage?: string) => {
    const isRetry = typeof retryMessage === 'string';
    if (isStreaming || (!isRetry && !input.trim())) return;

    const userMessage = isRetry ? retryMessage.trim() : input.trim();
    const requestHistory = (isRetry ? messages.slice(0, -2) : messages).filter(
      (m) => m.role !== 'assistant' || m.content !== welcomeMessage
    );
    if (!isRetry) setInput('');
    clearToolChain();
    compressionSummariesRef.current = [];

    // 重试时移除原来的用户消息和错误消息，避免历史记录重复。
    setMessages((prev) => [
      ...(isRetry ? prev.slice(0, -2) : prev),
      { role: 'user', content: userMessage },
      { role: 'assistant', content: '' },
    ]);

    // 新请求开始时清空本次实时工具链（历史消息里的工具已固化，不影响）
    clearToolChain();

    setIsStreaming(true);

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
          history: requestHistory,
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
        let streamError = '';
        let buffer = ''; // 缓冲区，用于保存不完整的行

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          // 将新chunk与缓冲区拼接
          const text = buffer + chunk;
          // 按换行符分割，最后一个元素可能是不完整的行
          const parts = text.split('\n');
          // 保存最后一个不完整的行到缓冲区
          buffer = parts.pop() || '';

          // 处理完整的行
          const lines = parts.filter((line) => line.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);

              if (data === '[DONE]') {
                break;
              }

              try {
                const json = JSON.parse(data);

                // 新版工具式调用的工具进度事件
                if (json.type === 'tool') {
                  if (json.status === 'start') {
                    pushToolChain(json.name, json.args);
                  } else if (json.status === 'done') {
                    finishToolChain(json.name, {
                      result: json.result,
                      ok: json.ok,
                    });
                  } else if (json.status === 'failed') {
                    // 工具执行失败也标记为完成，但可在链上保留
                    finishToolChain(json.name, { result: json.result, ok: false });
                  }
                  continue;
                }

                if (json.error) {
                  streamError = String(json.error);
                  continue;
                }

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

        // 处理缓冲区中剩余的数据
        if (buffer.trim()) {
          const line = buffer.trim();
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data && data !== '[DONE]') {
              try {
                const json = JSON.parse(data);
                if (json.error) {
                  streamError = String(json.error);
                }

                // 上下文压缩事件：摘要存入 ref，待流式结束后随本消息固化回喂
                if (json.type === 'context_compressed' && json.summary) {
                  compressionSummariesRef.current.push(`【较早对话已压缩】\n${json.summary}`);
                } else {
                  const text = json.text || '';
                  if (text) {
                    assistantMessage += text;
                    setMessages((prev) => {
                      const newMessages = [...prev];
                      newMessages[newMessages.length - 1] = {
                        role: 'assistant',
                        content: assistantMessage,
                      };
                      return newMessages;
                    });
                  }
                }
              } catch (e) {
                console.error('解析最终缓冲区数据失败:', e);
              }
            }
          }
        }

        // 流式结束：把本次实时工具链固化到最后一条 assistant 消息，
        // 使其跨消息持久显示，并随 history 回喂服务端（避免同一会话重复调工具）。
        const finishedTools = toolChainRef.current.map((t) => ({
          name: t.name,
          key: t.key,
          args: t.args,
          result: t.result,
          ok: t.ok,
        }));
        if (finishedTools.length || compressionSummariesRef.current.length) {
          setMessages((prev) => {
            const newMessages = [...prev];
            newMessages[newMessages.length - 1] = {
              role: 'assistant',
              content: assistantMessage,
              ...(finishedTools.length ? { toolCalls: finishedTools } : {}),
              ...(compressionSummariesRef.current.length
                ? { compressedSummaries: compressionSummariesRef.current }
                : {}),
            };
            return newMessages;
          });
        }

        if (streamError) throw new Error(streamError);
        if (!assistantMessage.trim()) {
          throw new Error('AI服务未返回有效内容，请检查 API 密钥和服务配置');
        }
      } else {
        // 处理非流式响应
        const data = await response.json();
        if (data.error) throw new Error(String(data.error));
        const content = data.content || '';

        // 更新最后一条消息为完整响应
        setMessages((prev) => {
          const newMessages = [...prev];
          // 非流式压缩发生在本轮循环内，摘要随 JSON 返回
          const compressed = data.compressedSummary
            ? `【较早对话已压缩】\n${data.compressedSummary}`
            : undefined;
          newMessages[newMessages.length - 1] = {
            role: 'assistant',
            content: content,
            ...(compressed
              ? {
                  compressedSummaries: [
                    ...((prev[prev.length - 1] as ChatMessage)?.compressedSummaries || []),
                    compressed,
                  ],
                }
              : {}),
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
          content: `❌ 抱歉，出现了错误：\n\n${(error as Error).message}`,
          error: true,
          retryMessage: userMessage,
        };
        return newMessages;
      });
    } finally {
      setIsStreaming(false);
      // 流式/非流式结束后，实时工具链已固化到消息，这里清空 live 链
      clearToolChain();
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
    clearToolChain();
    setMessages([{ role: 'assistant', content: welcomeMessage }]);

    console.log('已清空聊天上下文');
  };

  const modalContent = useDrawer ? (
    // 抽屉模式
    <div
      className={`fixed inset-0 z-[1002] flex items-center justify-end transition-opacity duration-200 pointer-events-none ${
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div
        className={`relative ${drawerWidth} h-full bg-white dark:bg-gray-900 shadow-2xl flex flex-col transition-transform duration-300 ease-out pointer-events-auto ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
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
                  className={`flex gap-3 ${
                    message.role === 'user'
                      ? 'max-w-[80%] flex-row-reverse'
                      : 'w-full'
                  }`}
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
                        {userAvatarText}
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
                        : 'flex-1 bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <p className='whitespace-pre-wrap break-words text-sm leading-relaxed'>
                        {message.content}
                      </p>
                    ) : (
                      <div className='w-full'>
                        {/* 历史消息中已固化的工具调用：持续显示 */}
                        {message.toolCalls && message.toolCalls.length > 0 && (
                          <div className='mb-2'>
                            {renderToolChain(
                              message.toolCalls as ToolChainItem[],
                              false
                            )}
                          </div>
                        )}
                        {/* 流式中的最后一个 assistant 消息：实时工具链合并显示在气泡内 */}
                        {isStreaming &&
                          index === messages.length - 1 &&
                          renderToolChain(toolChain, true)}
                        <div className='prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-p:leading-relaxed prose-pre:bg-gray-800 prose-pre:text-gray-100 dark:prose-pre:bg-gray-900 prose-code:text-purple-600 dark:prose-code:text-purple-400 prose-code:bg-purple-50 dark:prose-code:bg-purple-900/20 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-a:text-inherit dark:prose-a:text-inherit prose-a:no-underline hover:prose-a:underline prose-strong:text-gray-900 dark:prose-strong:text-white prose-ul:my-2 prose-ol:my-2 prose-li:my-1'>
                          {renderAssistantContent(message.content)}
                        </div>
                        {message.error &&
                          index === messages.length - 1 &&
                          !isStreaming &&
                          message.retryMessage && (
                            <button
                              type='button'
                              onClick={() => handleSendMessage(message.retryMessage)}
                              className='mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-200 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
                            >
                              <RefreshCw size={14} />
                              重试
                            </button>
                          )}
                        {/* 流式但还没有任何文本时显示“AI正在思考...” */}
                        {isStreaming &&
                          index === messages.length - 1 &&
                          !message.content &&
                          toolChain.length === 0 && (
                            <div className='flex items-center gap-2'>
                              <Loader2 size={16} className='animate-spin text-gray-500' />
                              <span className='text-sm text-gray-500 dark:text-gray-400'>
                                AI正在思考...
                              </span>
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

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
              onClick={() => handleSendMessage()}
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
  ) : (
    // 原有的居中弹窗模式
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
                  className={`flex gap-3 ${
                    message.role === 'user'
                      ? 'max-w-[80%] flex-row-reverse'
                      : 'w-full'
                  }`}
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
                        {userAvatarText}
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
                        : 'flex-1 bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <p className='whitespace-pre-wrap break-words text-sm leading-relaxed'>
                        {message.content}
                      </p>
                    ) : (
                      <div className='w-full'>
                        {/* 历史消息中已固化的工具调用：持续显示 */}
                        {message.toolCalls && message.toolCalls.length > 0 && (
                          <div className='mb-2'>
                            {renderToolChain(
                              message.toolCalls as ToolChainItem[],
                              false
                            )}
                          </div>
                        )}
                        {/* 流式中的最后一个 assistant 消息：实时工具链合并显示在气泡内 */}
                        {isStreaming &&
                          index === messages.length - 1 &&
                          renderToolChain(toolChain, true)}
                        <div className='prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-p:leading-relaxed prose-pre:bg-gray-800 prose-pre:text-gray-100 dark:prose-pre:bg-gray-900 prose-code:text-purple-600 dark:prose-code:text-purple-400 prose-code:bg-purple-50 dark:prose-code:bg-purple-900/20 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-a:text-inherit dark:prose-a:text-inherit prose-a:no-underline hover:prose-a:underline prose-strong:text-gray-900 dark:prose-strong:text-white prose-ul:my-2 prose-ol:my-2 prose-li:my-1'>
                          {renderAssistantContent(message.content)}
                        </div>
                        {message.error &&
                          index === messages.length - 1 &&
                          !isStreaming &&
                          message.retryMessage && (
                            <button
                              type='button'
                              onClick={() => handleSendMessage(message.retryMessage)}
                              className='mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-200 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
                            >
                              <RefreshCw size={14} />
                              重试
                            </button>
                          )}
                        {/* 流式但还没有任何文本时显示“AI正在思考...” */}
                        {isStreaming &&
                          index === messages.length - 1 &&
                          !message.content &&
                          toolChain.length === 0 && (
                            <div className='flex items-center gap-2'>
                              <Loader2 size={16} className='animate-spin text-gray-500' />
                              <span className='text-sm text-gray-500 dark:text-gray-400'>
                                AI正在思考...
                              </span>
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

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
              onClick={() => handleSendMessage()}
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
