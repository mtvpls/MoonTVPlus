export interface TVItem {
  id: string;
  title: string;
  poster?: string;
  rate?: string;
  year?: string;
  type?: 'movie' | 'tv';
  href?: string;
}


export interface TVSection {
  title: string;
  subtitle?: string;
  href?: string;
  items: TVItem[];
}
