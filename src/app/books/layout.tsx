import BooksLayout from '@/components/books/BooksLayout';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <BooksLayout>{children}</BooksLayout>;
}
