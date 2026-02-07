/* global window, navigator, location */
(() => {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  // Service workers require HTTPS, except on localhost.
  const isLocalhost =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname.endsWith('.localhost');
  if (location.protocol !== 'https:' && !isLocalhost) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Silent fail: PWA is an enhancement.
    });
  });
})();

