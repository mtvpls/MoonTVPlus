'use client';

import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/react';
import { Check, Filter } from 'lucide-react';

import { cn } from '@/lib/cn';
import { MangaSource } from '@/lib/manga.types';

import {
  LIBRARY_FOCUS,
  LIBRARY_MENU_ITEM,
  LIBRARY_MUTED,
  LIBRARY_PANEL,
} from '@/components/media/library';

interface MangaSearchScopeProps {
  sources: MangaSource[];
  value: string;
  onChange: (sourceId: string) => void;
}

export default function MangaSearchScope({
  sources,
  value,
  onChange,
}: MangaSearchScopeProps) {
  const selectedSource = sources.find((source) => source.id === value);
  const selectedName = selectedSource?.displayName || selectedSource?.name;
  const scopeLabel = value ? selectedName || '指定来源' : '全部来源';
  const options = [
    { id: '', label: '全部来源' },
    ...sources.map((source) => ({
      id: source.id,
      label: source.displayName || source.name,
    })),
  ];

  return (
    <div className='mr-1 shrink-0'>
      <Listbox value={value} onChange={onChange}>
        <ListboxButton
          type='button'
          aria-label={`搜索范围：${scopeLabel}`}
          title={`搜索范围：${scopeLabel}`}
          data-filtered={Boolean(value)}
          className={cn(
            LIBRARY_FOCUS,
            'flex h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded px-3 text-sm transition-colors duration-150 focus-visible:ring-inset',
            value
              ? 'bg-library-ochre-tint text-library-ochre dark:bg-library-night-ochre-tint dark:text-library-night-ochre'
              : [
                  LIBRARY_MUTED,
                  'hover:bg-library-ochre-tint/60 hover:text-library-ochre dark:hover:bg-library-night-ochre-tint dark:hover:text-library-night-ochre',
                ]
          )}
        >
          <Filter className='h-4 w-4 shrink-0' strokeWidth={1.5} aria-hidden />
          {value && selectedName && (
            <span className='hidden max-w-36 truncate md:block'>
              {selectedName}
            </span>
          )}
        </ListboxButton>
        <ListboxOptions
          anchor='bottom end'
          modal={false}
          aria-label='选择漫画来源'
          className={cn(
            LIBRARY_PANEL,
            'z-50 max-h-72 w-56 max-w-[calc(100vw-2rem)] overflow-y-auto p-1 font-sans shadow-lg outline-none [--anchor-gap:8px] [--anchor-padding:16px] dark:shadow-none'
          )}
        >
          {options.map((option) => (
            <ListboxOption
              key={option.id}
              value={option.id}
              className={({ focus, selected }) =>
                cn(
                  LIBRARY_MENU_ITEM,
                  'min-h-11 rounded px-3 py-2 duration-150',
                  (focus || selected) &&
                    'bg-library-ochre-tint text-library-ochre dark:bg-library-night-ochre-tint dark:text-library-night-ochre',
                  selected && 'font-medium'
                )
              }
            >
              {({ selected }) => (
                <>
                  <span className='min-w-0 flex-1 break-words'>
                    {option.label}
                  </span>
                  {selected && (
                    <Check
                      className='h-4 w-4 shrink-0'
                      strokeWidth={1.5}
                      aria-hidden
                    />
                  )}
                </>
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
    </div>
  );
}
