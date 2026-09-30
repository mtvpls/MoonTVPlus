/** Only return same-origin page paths after any login method succeeds. */
export function getSafeLoginRedirect(value: string | null): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    )
  ) {
    return '/';
  }
  try {
    const target = new URL(value, 'https://login.invalid');
    if (
      target.origin !== 'https://login.invalid' ||
      /^\/(login|api)(\/|$)/.test(target.pathname)
    ) {
      return '/';
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}
