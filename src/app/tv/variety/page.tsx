import TVBrowsePage from '@/components/tv/TVBrowsePage';

export default function TVVarietyPage() {
  return (
    <TVBrowsePage
      title='综艺'
      subtitle='浏览热门综艺、大陆综艺、韩国综艺与脱口秀'
      sections={[
        { title: '热门综艺', kind: 'tv', tag: '综艺', type: 'tv' },
        { title: '大陆综艺', kind: 'tv', tag: '大陆综艺', type: 'tv' },
        { title: '韩国综艺', kind: 'tv', tag: '韩国综艺', type: 'tv' },
        { title: '脱口秀', kind: 'tv', tag: '脱口秀', type: 'tv' },
      ]}
    />
  );
}
