import { useCallback, useRef } from 'react';

interface UseLongPressOptions {
  onLongPress: () => void;
  onClick?: () => void;
  longPressDelay?: number;
  moveThreshold?: number;
}

interface TouchPosition {
  x: number;
  y: number;
}

export const useLongPress = ({
  onLongPress,
  onClick,
  longPressDelay = 500,
  moveThreshold = 10,
}: UseLongPressOptions) => {
  const isLongPress = useRef(false);
  const pressTimer = useRef<NodeJS.Timeout | null>(null);
  const startPosition = useRef<TouchPosition | null>(null);
  const isActive = useRef(false); // 防止重复触发
  const wasButton = useRef(false); // 记录触摸开始时是否是按钮

  const clearTimer = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const handleStart = useCallback(
    (clientX: number, clientY: number, isButton = false) => {
      // 如果已经有活跃的手势，忽略新的开始
      if (isActive.current) {
        return;
      }

      isActive.current = true;
      isLongPress.current = false;
      startPosition.current = { x: clientX, y: clientY };

      // 记录触摸开始时是否是按钮
      wasButton.current = isButton;

      pressTimer.current = setTimeout(() => {
        // 再次检查是否仍然活跃
        if (!isActive.current) return;

        isLongPress.current = true;

        if (navigator.vibrate) {
          navigator.vibrate(50);
        }

        // 触发长按事件
        onLongPress();
      }, longPressDelay);
    },
    [onLongPress, longPressDelay]
  );

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!startPosition.current || !isActive.current) return;

      const distance = Math.sqrt(
        Math.pow(clientX - startPosition.current.x, 2) +
        Math.pow(clientY - startPosition.current.y, 2)
      );

      // 如果移动距离超过阈值，取消长按
      if (distance > moveThreshold) {
        clearTimer();
        isActive.current = false;
      }
    },
    [clearTimer, moveThreshold]
  );

  const handleEnd = useCallback(() => {
    clearTimer();

    // 根据情况决定是否触发点击事件：
    // 1. 如果是长按，不触发点击
    // 2. 如果不是长按且触摸开始时是按钮，不触发点击
    // 3. 否则触发点击
    const shouldClick = !isLongPress.current && !wasButton.current && onClick && isActive.current;

    if (shouldClick) {
      onClick();
    }

    // 重置所有状态
    isLongPress.current = false;
    startPosition.current = null;
    isActive.current = false;
    wasButton.current = false;
  }, [clearTimer, onClick]);

  // 触摸事件处理器
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // 触摸到标记为 data-button 的交互区域（或其子元素）时：
      // 不启动卡片长按，避免与控件自身手势（如来源数量浮层）冲突
      const target = e.target as HTMLElement;
      if (target.closest('[data-button]')) {
        return;
      }

      const touch = e.touches[0];
      handleStart(touch.clientX, touch.clientY, false);
    },
    [handleStart]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    },
    [handleMove]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      // 只有本 hook 实际接管了触摸手势时才阻止浏览器默认 click。
      // 若 touchstart 命中 data-button 区域会提前 return，不应在 touchend 阶段
      // 再 preventDefault/stopPropagation，否则会吞掉外层卡片点击。
      if (!isActive.current) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      handleEnd();
    },
    [handleEnd]
  );



  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
};
