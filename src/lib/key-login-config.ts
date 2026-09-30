/** Server-side feature flag shared by login validation and page configuration. */
export function isKeyLoginEnabled(): boolean {
  // PASSWORD is required by the original login too, so its presence alone must
  // not enable the key tab. The ordinary shared key opts into this login entry.
  return (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') !==
      'localstorage' &&
    Boolean(process.env.PASSWORD?.trim()) &&
    Boolean(process.env.SITE_USER_ACCESS_KEY?.trim())
  );
}
