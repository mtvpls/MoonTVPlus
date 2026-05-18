import MangaLayout from '@/components/manga/MangaLayout';

export default function MangaAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MangaLayout>{children}</MangaLayout>;
}
