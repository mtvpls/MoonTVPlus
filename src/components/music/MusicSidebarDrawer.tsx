import type { MusicSource } from '@/lib/music/types';

interface MusicSidebarDrawerProps {
  currentSource: MusicSource;
  isOpen: boolean;
  pathname: string | null;
  onClose: () => void;
  onNavigate: (href: string) => void;
}

const musicNavItems = [
  { key: 'rankings', label: '排行榜', href: '/music/rankings', icon: 'M3 4h18M8 8h13M3 12h18M8 16h13M3 20h18' },
  { key: 'songlists', label: '推荐歌单', href: '/music/songlists', icon: 'M4 6h16M4 12h10M4 18h14' },
  { key: 'search', label: '搜索', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
  { key: 'my-playlists', label: '我的歌单', href: '/music/my-playlists', icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' },
];

export default function MusicSidebarDrawer({
  currentSource,
  isOpen,
  pathname,
  onClose,
  onNavigate,
}: MusicSidebarDrawerProps) {
  if (!isOpen) return null;

  const navigate = (href: string) => {
    onClose();
    onNavigate(href);
  };

  return (
    <div className="fixed inset-0 z-[10000]">
      <button
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={onClose}
        aria-label="关闭菜单"
      />
      <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-r border-white/10 bg-zinc-950/80 backdrop-blur-xl px-5 py-6 shadow-[20px_0_40px_rgba(0,0,0,0.5)] animate-in slide-in-from-left duration-300 ease-out">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-green-400 to-emerald-600 text-white shadow-lg shadow-green-500/20">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
              </svg>
            </div>
            <div>
              <div className="text-lg font-bold text-white tracking-wide">音乐菜单</div>
              <div className="text-[10px] uppercase tracking-wider text-green-400/80">Music Navigation</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-zinc-400 transition-all hover:bg-white/10 hover:text-white hover:rotate-90"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="space-y-3 relative z-10">
          {musicNavItems.map((item) => {
            const href = item.key === 'search' ? `/music/search?source=${currentSource}` : item.href ?? '/music/rankings';
            const active = item.key === 'rankings'
              ? pathname?.startsWith('/music/rankings') || pathname === '/music'
              : pathname?.startsWith(`/music/${item.key}`);

            return (
              <button
                key={item.key}
                onClick={() => navigate(href)}
                className={`group flex w-full items-center gap-4 rounded-2xl px-4 py-3.5 text-left transition-all duration-300 ${
                  active
                    ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/5 text-white shadow-inner border border-green-500/20'
                    : 'bg-transparent text-zinc-400 hover:bg-white/5 hover:text-white border border-transparent'
                }`}
              >
                <div className={`flex items-center justify-center transition-colors ${active ? 'text-green-400' : 'text-zinc-500 group-hover:text-white'}`}>
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={item.icon} />
                  </svg>
                </div>
                <span className="text-sm font-semibold">{item.label}</span>
                {active && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)] animate-pulse" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto relative z-10 pt-6">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <button
            onClick={() => navigate('/')}
            className="group flex w-full items-center gap-4 rounded-2xl border border-white/5 bg-white/5 px-4 py-3.5 text-left text-zinc-400 transition-all duration-300 hover:bg-white/10 hover:text-white hover:border-white/10 hover:shadow-lg"
          >
            <div className="flex items-center justify-center text-zinc-500 group-hover:text-white transition-colors">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </div>
            <span className="text-sm font-semibold">返回主页</span>
          </button>
        </div>

        <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-green-500/10 blur-[80px]" />
      </aside>
    </div>
  );
}
