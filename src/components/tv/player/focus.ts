/** 播放器固定在视口内，聚焦时只滚动内部列表，保留白框所需的 8px 空间。 */
export function scrollTVPlayerControlIntoView(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  let top = rect.top;
  let bottom = rect.bottom;
  let left = rect.left;
  let right = rect.right;
  let parent = element.parentElement;
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';

  while (parent && !parent.hasAttribute('data-tv-player-root')) {
    const style = window.getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    let nextTop = parent.scrollTop;
    let nextLeft = parent.scrollLeft;
    if (/(auto|scroll)/.test(style.overflowY)) {
      const delta =
        top < bounds.top + 8
          ? top - bounds.top - 8
          : bottom > bounds.bottom - 8
          ? bottom - bounds.bottom + 8
          : 0;
      nextTop = Math.max(
        0,
        Math.min(parent.scrollHeight - parent.clientHeight, nextTop + delta)
      );
    }
    if (/(auto|scroll)/.test(style.overflowX)) {
      const delta =
        left < bounds.left + 8
          ? left - bounds.left - 8
          : right > bounds.right - 8
          ? right - bounds.right + 8
          : 0;
      nextLeft = Math.max(
        0,
        Math.min(parent.scrollWidth - parent.clientWidth, nextLeft + delta)
      );
    }
    top -= nextTop - parent.scrollTop;
    bottom -= nextTop - parent.scrollTop;
    left -= nextLeft - parent.scrollLeft;
    right -= nextLeft - parent.scrollLeft;
    if (nextTop !== parent.scrollTop || nextLeft !== parent.scrollLeft) {
      parent.scrollTo({ top: nextTop, left: nextLeft, behavior });
    }
    parent = parent.parentElement;
  }
}
