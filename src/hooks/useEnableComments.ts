import { useEffect, useState } from 'react';

interface RuntimeConfig {
  EnableComments: boolean;
}

export function useEnableComments(): boolean {
  const [enableComments, setEnableComments] = useState(true);

  useEffect(() => {
    // 在客户端获取运行时配置
    if (typeof window !== 'undefined') {
      const runtimeConfig = (window as any).RUNTIME_CONFIG as RuntimeConfig;
      setEnableComments(runtimeConfig?.EnableComments ?? true);
    }
  }, []);

  return enableComments;
}
