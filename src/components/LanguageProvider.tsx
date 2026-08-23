'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type ChineseLocale = 'zh-CN' | 'zh-TW';

interface LanguageContextValue {
  locale: ChineseLocale;
  setLocale: (locale: ChineseLocale) => void;
  toggleLocale: () => void;
}

const STORAGE_KEY = 'moontv-language';
const CONVERTED_ATTRIBUTES = ['alt', 'aria-label', 'placeholder', 'title'];
const LanguageContext = createContext<LanguageContextValue | null>(null);

function convertSubtree(root: Node, converter: (text: string) => string) {
  const convertTextNode = (node: Node) => {
    const parent = node.parentElement;
    if (
      !node.nodeValue ||
      parent?.closest(
        'script, style, textarea, code, pre, [contenteditable="true"]'
      )
    ) {
      return;
    }
    node.nodeValue = converter(node.nodeValue);
  };

  if (root.nodeType === Node.TEXT_NODE) {
    convertTextNode(root);
    return;
  }

  if (root instanceof Element) {
    for (const attribute of CONVERTED_ATTRIBUTES) {
      const value = root.getAttribute(attribute);
      if (value) root.setAttribute(attribute, converter(value));
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      convertTextNode(node);
    } else if (node instanceof Element) {
      for (const attribute of CONVERTED_ATTRIBUTES) {
        const value = node.getAttribute(attribute);
        if (value) node.setAttribute(attribute, converter(value));
      }
    }
    node = walker.nextNode();
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<ChineseLocale>('zh-CN');

  useEffect(() => {
    const savedLocale = window.localStorage.getItem(STORAGE_KEY);
    if (savedLocale === 'zh-TW') setLocaleState('zh-TW');
  }, []);

  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | undefined;

    const applyLocale = async () => {
      const OpenCC = await import('opencc-js');
      if (cancelled) return;

      const converter =
        locale === 'zh-TW'
          ? OpenCC.Converter({ from: 'cn', to: 'tw' })
          : OpenCC.Converter({ from: 'tw', to: 'cn' });

      document.documentElement.lang = locale;
      convertSubtree(document.body, converter);

      observer = new MutationObserver((mutations) => {
        observer?.disconnect();
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') {
            convertSubtree(mutation.target, converter);
          } else {
            mutation.addedNodes.forEach((node) =>
              convertSubtree(node, converter)
            );
          }
        }
        observer?.observe(document.body, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      });
      observer.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    };

    void applyLocale();
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [locale]);

  const setLocale = useCallback((nextLocale: ChineseLocale) => {
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
    setLocaleState(nextLocale);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'zh-CN' ? 'zh-TW' : 'zh-CN');
  }, [locale, setLocale]);

  const value = useMemo(
    () => ({ locale, setLocale, toggleLocale }),
    [locale, setLocale, toggleLocale]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context)
    throw new Error('useLanguage must be used within LanguageProvider');
  return context;
}
