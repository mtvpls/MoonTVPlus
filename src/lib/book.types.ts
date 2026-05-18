export interface BookSourceCapabilities {
  searchSupported: boolean;
  catalogSupported: boolean;
  searchMode: 'opds' | 'template' | 'disabled';
  catalogMode: 'navigation' | 'acquisition' | 'flat' | 'disabled';
  acquisitionTypes: string[];
  lastCheckedAt?: number;
  lastError?: string;
}

export interface BookSource {
  id: string;
  name: string;
  url: string;
  enabled?: boolean;
  authMode?: 'none' | 'basic' | 'header';
  username?: string;
  password?: string;
  headerName?: string;
  headerValue?: string;
  searchTemplate?: string;
  preferFormat?: Array<'epub' | 'pdf'>;
  language?: string;
  capabilities?: BookSourceCapabilities;
}

export interface BookAcquisitionLink {
  rel: string;
  type: string;
  href: string;
  title?: string;
  isIndirect?: boolean;
}

export interface BookNavLink {
  title: string;
  href: string;
  rel?: string;
  type?: string;
}

export interface BookListItem {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  author?: string;
  cover?: string;
  summary?: string;
  language?: string;
  published?: string;
  updated?: string;
  tags?: string[];
  detailHref?: string;
  acquisitionLinks: BookAcquisitionLink[];
}

export interface BookDetail extends BookListItem {
  publisher?: string;
  identifier?: string;
  series?: string;
  categories?: string[];
  navigation?: BookNavLink[];
}

export interface BookCatalogResult {
  sourceId: string;
  sourceName: string;
  title: string;
  subtitle?: string;
  href: string;
  entries: BookListItem[];
  navigation: BookNavLink[];
  nextHref?: string;
  previousHref?: string;
}

export interface BookSearchFailure {
  sourceId: string;
  sourceName: string;
  error: string;
}

export interface BookSearchResult {
  results: BookListItem[];
  failedSources: BookSearchFailure[];
}

export interface BookLocator {
  type: 'epub-cfi' | 'pdf-page' | 'href';
  value: string;
  href?: string;
  chapterTitle?: string;
}

export interface BookShelfItem {
  sourceId: string;
  sourceName: string;
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  format?: 'epub' | 'pdf';
  detailHref?: string;
  acquisitionHref?: string;
  progressPercent?: number;
  lastReadTime?: number;
  lastLocatorType?: BookLocator['type'];
  lastLocatorValue?: string;
  lastChapterTitle?: string;
  saveTime: number;
}

export interface BookReadRecord {
  sourceId: string;
  sourceName: string;
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  format: 'epub' | 'pdf';
  detailHref?: string;
  acquisitionHref?: string;
  locator: BookLocator;
  progressPercent: number;
  chapterTitle?: string;
  chapterHref?: string;
  saveTime: number;
}

export interface BookTtsVoice {
  name: string;
  shortName: string;
  locale: string;
  gender?: string;
  displayName: string;
}

export interface BookTtsBoundary {
  offset: number;
  duration: number;
  text: string;
}

export interface BookTtsProgress {
  sourceId: string;
  bookId: string;
  chapterHref: string;
  chapterTitle?: string;
  chunkIndex: number;
  charOffset: number;
  currentTimeSec?: number;
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
  saveTime: number;
}

export interface BookReadManifest {
  book: BookDetail;
  format: 'epub' | 'pdf';
  fileUrl: string;
  acquisitionHref?: string;
  cacheKey?: string;
  coverUrl?: string;
  lastRecord?: BookReadRecord | null;
}
