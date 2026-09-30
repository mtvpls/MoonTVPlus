'use client';

import {
  ChevronRight,
  MessageCircle,
  MessageSquare,
  Search,
  Send,
  Sparkles,
  Star,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import styles from './HomeDashboard.module.css';

import {
  AI_CHAT_HISTORY_CHANGED,
  getAIChatStorageKey,
  getAIChatUsername,
  readAIChatHistory,
} from '@/lib/ai-chat-history';
import { useAIChatUsername } from '@/hooks/useAIChatUsername';

interface HomeAISearchProps {
  enabled: boolean;
  busy: boolean;
  isChatOpen: boolean;
  onAsk: (question: string) => void;
  onOpenHistory: () => void;
}

const suggestions = [
  '推荐一些类似《盗梦空间》的烧脑科幻电影',
  '想找一部悬疑剧，可以帮我介绍剧情和演员吗？',
  '有哪些评分很高的治愈系动漫？',
];
const promptTools = [
  { label: '影视推荐', prompt: '请根据我的喜好推荐几部电影：' },
  { label: '剧情解析', prompt: '我想了解这部作品的剧情：' },
  { label: '角色介绍', prompt: '请介绍这个角色和演员：' },
  { label: '相似推荐', prompt: '请推荐与这部作品相似的影视：' },
];
const questionIcons = [Search, MessageSquare, Star];

function AssistantMascot() {
  return (
    <svg
      className={styles.mascot}
      viewBox='0 0 96 96'
      fill='none'
      aria-hidden='true'
    >
      <defs>
        <linearGradient
          id='home-bot-shell'
          x1='12'
          y1='18'
          x2='77'
          y2='87'
          gradientUnits='userSpaceOnUse'
        >
          <stop stopColor='#b08aff' />
          <stop offset='.43' stopColor='#80bcfc' />
          <stop offset='1' stopColor='#10e8c5' />
        </linearGradient>
        <linearGradient
          id='home-bot-ear'
          x1='4'
          y1='35'
          x2='24'
          y2='65'
          gradientUnits='userSpaceOnUse'
        >
          <stop stopColor='#d7a6ff' />
          <stop offset='1' stopColor='#817ee8' />
        </linearGradient>
        <linearGradient
          id='home-bot-highlight'
          x1='32'
          y1='25'
          x2='65'
          y2='55'
          gradientUnits='userSpaceOnUse'
        >
          <stop stopColor='#b8e8ff' stopOpacity='.85' />
          <stop offset='1' stopColor='#62d6e5' stopOpacity='0' />
        </linearGradient>
      </defs>
      <path d='M44 21L49 5Q51 2 53 8L55 24' fill='#a9e8f4' />
      <rect
        x='4'
        y='38'
        width='20'
        height='32'
        rx='10'
        fill='url(#home-bot-ear)'
      />
      <rect x='73' y='38' width='19' height='32' rx='9.5' fill='#35dcc9' />
      <rect
        x='15'
        y='20'
        width='67'
        height='66'
        rx='27'
        fill='url(#home-bot-shell)'
      />
      <rect
        x='21'
        y='24'
        width='55'
        height='45'
        rx='22'
        fill='url(#home-bot-highlight)'
      />
      <rect x='26' y='33' width='46' height='40' rx='16' fill='#083044' />
      <ellipse cx='40' cy='50' rx='4.1' ry='6' fill='#a4e9ff' />
      <ellipse cx='59' cy='50' rx='4.1' ry='6' fill='#94f2ee' />
      <path
        d='M45 62Q49 66 53 62'
        stroke='#71dfed'
        strokeWidth='2.5'
        strokeLinecap='round'
      />
      <path
        d='M28 30Q44 20 62 29'
        stroke='#d3dcff'
        strokeOpacity='.55'
        strokeWidth='3'
        strokeLinecap='round'
      />
    </svg>
  );
}

export default function HomeAISearch(props: HomeAISearchProps) {
  const username = useAIChatUsername();
  return (
    <HomeAISearchForUser
      key={JSON.stringify(username)}
      {...props}
      username={username}
      enabled={props.enabled && username !== null}
    />
  );
}

function HomeAISearchForUser({
  enabled,
  busy,
  isChatOpen,
  onAsk,
  onOpenHistory,
  username,
}: HomeAISearchProps & { username: string | null }) {
  const [question, setQuestion] = useState('');
  const [recentQuestions, setRecentQuestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const historyKey = getAIChatStorageKey(username);

  // The preview and full panel share exactly the same user-scoped history key.
  useEffect(() => {
    if (!enabled || !historyKey) {
      setRecentQuestions([]);
      return;
    }
    if (isChatOpen) return;
    const load = () => {
      const questions = readAIChatHistory(historyKey)
        .filter((message) => message.role === 'user' && message.content.trim())
        .map((message) => message.content.trim())
        .reverse();
      setRecentQuestions(Array.from(new Set(questions)).slice(0, 3));
    };
    const onHistoryChange = (event: Event) => {
      if ((event as CustomEvent<{ key: string }>).detail?.key === historyKey)
        load();
    };
    const onStorageChange = (event: StorageEvent) => {
      if (event.key === null || event.key === historyKey) load();
    };
    load();
    window.addEventListener(AI_CHAT_HISTORY_CHANGED, onHistoryChange);
    window.addEventListener('storage', onStorageChange);
    return () => {
      window.removeEventListener(AI_CHAT_HISTORY_CHANGED, onHistoryChange);
      window.removeEventListener('storage', onStorageChange);
    };
  }, [enabled, historyKey, isChatOpen]);

  const submit = () => {
    const text = question.trim();
    if (!enabled || busy || !text || getAIChatUsername() !== username) return;
    onAsk(text);
    setQuestion('');
  };
  const questions = recentQuestions.length ? recentQuestions : suggestions;

  return (
    <section
      className={`${styles.panel} ${styles.aiPanel}`}
      aria-labelledby='home-ai-title'
    >
      <div className={styles.aiHeading}>
        <AssistantMascot />
        <div>
          <h2 id='home-ai-title' className={styles.aiTitle}>
            AI 对话搜索
          </h2>
          <p className={styles.subtitle}>与 AI 聊天，快速找到你想看的内容</p>
        </div>
      </div>
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor='home-ai-question' className='sr-only'>
          向 AI 提问
        </label>
        <textarea
          ref={inputRef}
          id='home-ai-question'
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit();
            }
          }}
          disabled={!enabled || busy}
          placeholder={
            enabled
              ? '问我任何关于电影、剧集、角色、剧情的问题…'
              : 'AI 对话功能暂未开启'
          }
          maxLength={4000}
          aria-describedby={!enabled ? 'home-ai-disabled' : undefined}
        />
        <div className={styles.composerFooter}>
          <div className={styles.promptTools}>
            <Sparkles aria-hidden='true' />
            {promptTools.map((tool) => (
              <button
                key={tool.label}
                type='button'
                className={styles.promptTool}
                disabled={!enabled || busy}
                onClick={() => {
                  setQuestion(tool.prompt);
                  inputRef.current?.focus();
                }}
              >
                {tool.label}
              </button>
            ))}
          </div>
          <button
            type='submit'
            className={styles.sendButton}
            disabled={!enabled || busy || !question.trim()}
            aria-label={busy ? 'AI 正在回复' : '发送提问'}
          >
            <Send aria-hidden='true' />
          </button>
        </div>
      </form>
      {!enabled && (
        <p id='home-ai-disabled' className={styles.disabledNote}>
          本站暂未开启 AI 问片。你仍可通过影片推荐和搜索寻找内容。
        </p>
      )}
      <h3 className={styles.recentHeader}>
        <MessageCircle aria-hidden='true' />
        {recentQuestions.length ? '最近对话' : '试试这样问'}
      </h3>
      <ul className={styles.recentList}>
        {questions.map((text, index) => {
          const Icon = questionIcons[index % questionIcons.length];
          return (
            <li key={text}>
              <button
                type='button'
                className={styles.recentQuestion}
                disabled={!enabled || busy}
                title={text}
                onClick={() => {
                  if (recentQuestions.length) onOpenHistory();
                  else {
                    setQuestion(text);
                    inputRef.current?.focus();
                  }
                }}
              >
                <Icon aria-hidden='true' />
                <span className={styles.questionText}>{text}</span>
                {recentQuestions.length > 0 && (
                  <span className={styles.questionTime}>本次会话</span>
                )}
                <ChevronRight aria-hidden='true' />
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type='button'
        className={styles.historyMore}
        onClick={onOpenHistory}
        disabled={!enabled}
      >
        {recentQuestions.length ? '查看更多对话记录' : '打开 AI 对话'}
        <ChevronRight aria-hidden='true' />
      </button>
    </section>
  );
}
