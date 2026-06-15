import TVBrowsePage from '@/components/tv/TVBrowsePage';

export default function TVSeriesPage() {
  return <TVBrowsePage title='剧集' subtitle='热播、更新、国产剧、日韩美剧集中浏览。' sections={[
    { title: '热播剧集', kind: 'tv', tag: '热门', type: 'tv' },
    { title: '国产剧', kind: 'tv', tag: '国产剧', type: 'tv' },
    { title: '美剧', kind: 'tv', tag: '美剧', type: 'tv' },
    { title: '韩剧', kind: 'tv', tag: '韩剧', type: 'tv' },
  ]} />;
}
