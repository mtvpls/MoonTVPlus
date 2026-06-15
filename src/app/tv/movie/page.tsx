import TVBrowsePage from '@/components/tv/TVBrowsePage';

export default function TVMoviePage() {
  return <TVBrowsePage title='电影' subtitle='影院感海报墙，遥控器快速选片。' sections={[
    { title: '热门电影', kind: 'movie', tag: '热门', type: 'movie' },
    { title: '高分电影', kind: 'movie', tag: '高分', type: 'movie' },
    { title: '动作电影', kind: 'movie', tag: '动作', type: 'movie' },
    { title: '科幻电影', kind: 'movie', tag: '科幻', type: 'movie' },
  ]} />;
}
