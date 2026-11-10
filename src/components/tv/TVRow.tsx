'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import TVCard, { TVCardMenuHandler } from './TVCard';
import { TVSection } from './types';

export default function TVRow({
  section,
  onItemMenu,
}: {
  section: TVSection;
  onItemMenu?: TVCardMenuHandler;
}) {
  return (
    <section className='mt-8 first:mt-0'>
      <div className='mb-2 flex items-end justify-between gap-4'>
        <div>
          <h2 className='text-2xl font-medium leading-8 text-[#ededed] lg:text-3xl lg:leading-10'>
            {section.title}
          </h2>
          {section.subtitle && (
            <p className='mt-1 text-lg text-[#a1a1a6]'>{section.subtitle}</p>
          )}
        </div>
        {section.href && (
          <Link
            href={section.href}
            className='tv-focusable flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-lg text-[#a1a1a6] outline-none hover:bg-[#232325] hover:text-[#ededed]'
          >
            查看更多{' '}
            <ChevronRight
              className='h-[18px] w-[18px]'
              strokeWidth={1.5}
              aria-hidden='true'
            />
          </Link>
        )}
      </div>
      <div
        data-tv-focus-row='horizontal'
        className='-mx-2 flex gap-4 overflow-x-auto overscroll-x-contain p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      >
        {section.items.map((item) => (
          <TVCard
            key={`${section.title}-${item.id}`}
            item={item}
            onMenu={onItemMenu}
          />
        ))}
      </div>
    </section>
  );
}
