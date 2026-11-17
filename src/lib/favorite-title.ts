const NON_TITLE_CHARACTERS = new RegExp('[^\\p{L}\\p{N}]', 'gu');

function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(NON_TITLE_CHARACTERS, '');
}

/**
 * 仅在标题明显不同的情况下判定源站复用了 ID。
 * 忽略格式差异，允许原名附加版本说明及少量文字修正；空标题不作为失效依据。
 */
export function hasFavoriteTitleChanged(
  savedTitle: string,
  latestTitle: string
): boolean {
  const saved = normalizeTitle(savedTitle);
  const latest = normalizeTitle(latestTitle);
  if (!saved || !latest || saved.includes(latest) || latest.includes(saved)) {
    return false;
  }

  // 编辑距离超过较长标题的一半，视为完全变更。
  const savedChars = Array.from(saved);
  const latestChars = Array.from(latest);
  let previous = Array.from({ length: latestChars.length + 1 }, (_, i) => i);
  for (let i = 0; i < savedChars.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < latestChars.length; j++) {
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + (savedChars[i] === latestChars[j] ? 0 : 1)
      );
    }
    previous = current;
  }

  return (
    previous[latestChars.length] >
    Math.max(savedChars.length, latestChars.length) / 2
  );
}
