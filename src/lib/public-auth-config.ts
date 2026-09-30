import { cache } from 'react';

import { isKeyLoginEnabled } from './key-login-config';

/** Authentication-page allowlist. Never return full runtime config or keys. */
export const getPublicAuthConfig = cache(async () => {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const base = {
    SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTVPlus',
    STORAGE_TYPE: storageType,
    ENABLE_TV_MODE: process.env.ENABLE_TV_MODE !== 'false',
    KEY_LOGIN_ENABLED: isKeyLoginEnabled(),
    ENABLE_REGISTRATION: false,
    REQUIRE_REGISTRATION_INVITE_CODE: false,
    LOGIN_REQUIRE_TURNSTILE: false,
    REGISTRATION_REQUIRE_TURNSTILE: false,
    TURNSTILE_SITE_KEY: '',
    ENABLE_OIDC_LOGIN: false,
    ENABLE_OIDC_REGISTRATION: false,
    OIDC_BUTTON_TEXT: '',
    ENABLE_TELEGRAM_LOGIN: false,
    TELEGRAM_BOT_USERNAME: '',
    REGISTER_BACKGROUND_IMAGE: '',
  };
  if (storageType === 'localstorage') return base;

  try {
    // Only authentication configuration is needed before login; do not resolve
    // feature permissions, source scripts, recommendations or personal data.
    const { getConfig } = await import('./config');
    const config = await getConfig();
    const site = config.SiteConfig;
    return {
      ...base,
      SITE_NAME: site.SiteName || base.SITE_NAME,
      ENABLE_REGISTRATION: !!site.EnableRegistration,
      REQUIRE_REGISTRATION_INVITE_CODE: !!site.RequireRegistrationInviteCode,
      LOGIN_REQUIRE_TURNSTILE: !!site.LoginRequireTurnstile,
      REGISTRATION_REQUIRE_TURNSTILE: !!site.RegistrationRequireTurnstile,
      TURNSTILE_SITE_KEY: site.TurnstileSiteKey || '',
      ENABLE_OIDC_LOGIN: !!site.EnableOIDCLogin,
      ENABLE_OIDC_REGISTRATION: !!site.EnableOIDCRegistration,
      OIDC_BUTTON_TEXT: site.OIDCButtonText || '',
      ENABLE_TELEGRAM_LOGIN: Boolean(
        config.TelegramConfig?.enabled &&
          config.TelegramConfig?.loginEnabled &&
          (config.TelegramConfig?.botToken || process.env.TELEGRAM_BOT_TOKEN) &&
          (config.TelegramConfig?.botUsername ||
            process.env.TELEGRAM_BOT_USERNAME)
      ),
      TELEGRAM_BOT_USERNAME:
        config.TelegramConfig?.botUsername ||
        process.env.TELEGRAM_BOT_USERNAME ||
        '',
      REGISTER_BACKGROUND_IMAGE:
        config.ThemeConfig?.registerBackgroundImage || '',
    };
  } catch {
    // Still render the login UI on storage failure. Login endpoints themselves
    // fail closed if they cannot load authentication policy or verify a user.
    return base;
  }
});
