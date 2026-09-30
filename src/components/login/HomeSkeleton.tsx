/** Decorative placeholders only: no real navbar, images, links or data loaders. */
export default function HomeSkeleton() {
  return (
    <div
      aria-hidden='true'
      className='pointer-events-none fixed inset-0 select-none overflow-hidden bg-gray-50 dark:bg-gray-950'
    >
      <div className='flex h-16 items-center justify-between border-b border-gray-200 px-6 dark:border-gray-800 md:px-12'>
        <div className='h-7 w-32 rounded-md bg-gray-300 dark:bg-gray-700' />
        <div className='hidden items-center gap-8 md:flex'>
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className='h-4 w-14 rounded bg-gray-200 dark:bg-gray-800'
            />
          ))}
        </div>
        <div className='h-9 w-9 rounded-full bg-gray-200 dark:bg-gray-800' />
      </div>
      <div className='mx-auto max-w-7xl space-y-8 px-6 py-8 md:px-12 md:py-12'>
        <div className='grid gap-6 md:grid-cols-3'>
          <div className='flex min-h-64 flex-col justify-end gap-4 rounded-2xl bg-gray-200 p-8 dark:bg-gray-800 md:col-span-2'>
            <div className='h-8 w-1/2 rounded bg-gray-300 dark:bg-gray-700' />
            <div className='h-4 w-3/4 rounded bg-gray-300 dark:bg-gray-700' />
            <div className='h-4 w-2/3 rounded bg-gray-300 dark:bg-gray-700' />
          </div>
          <div className='hidden flex-col justify-between rounded-2xl border border-gray-200 p-6 dark:border-gray-800 md:flex'>
            <div className='space-y-4'>
              <div className='h-6 w-2/3 rounded bg-gray-200 dark:bg-gray-800' />
              <div className='h-4 w-full rounded bg-gray-200 dark:bg-gray-800' />
            </div>
            <div className='h-20 rounded-lg bg-gray-200 dark:bg-gray-800' />
          </div>
        </div>
        {[0, 1].map((row) => (
          <div key={row} className='space-y-5'>
            <div className='h-6 w-32 rounded bg-gray-200 dark:bg-gray-800' />
            <div className='grid grid-cols-3 gap-4 md:grid-cols-6'>
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <div key={item} className='space-y-3'>
                  <div className='aspect-[2/3] rounded-xl bg-gray-200 dark:bg-gray-800' />
                  <div className='h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-800' />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
