'use client';

import { Languages } from 'lucide-react';

import { useLanguage } from './LanguageProvider';

export function LanguageToggle() {
  const { locale, toggleLocale } = useLanguage();
  const targetLabel = locale === 'zh-CN' ? '繁體中文' : '简体中文';

  return (
    <button
      type='button'
      onClick={toggleLocale}
      className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
      aria-label={`切换到${targetLabel}`}
      title={`切换到${targetLabel}`}
    >
      <Languages className='w-full h-full' aria-hidden='true' />
      <span className='sr-only'>{targetLabel}</span>
    </button>
  );
}
