import { useEffect, useState } from 'react';

interface RuntimeConfig {
  AIConfig?: {
    EnableAIComments?: boolean;
  };
}

export function useEnableAIComments(): boolean {
  const [enableAIComments, setEnableAIComments] = useState(false);

  useEffect(() => {
    // 在客户端获取运行时配置
    if (typeof window !== 'undefined') {
      const runtimeConfig = (window as any).RUNTIME_CONFIG as RuntimeConfig;
      setEnableAIComments(runtimeConfig?.AIConfig?.EnableAIComments ?? false);
    }
  }, []);

  return enableAIComments;
}
