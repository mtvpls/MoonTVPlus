export interface AnimeSubscription {
  id: string;
  title: string;
  filterText: string;
  source: 'acgrip' | 'mikan' | 'dmhy';
  enabled: boolean;
  lastCheckTime: number;
  lastEpisode: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

export interface AnimeSubscriptionConfig {
  Enabled: boolean;
  Subscriptions: AnimeSubscription[];
}
