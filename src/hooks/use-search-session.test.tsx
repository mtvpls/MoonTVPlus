import { fireEvent, render, screen } from '@testing-library/react';
import { webcrypto } from 'crypto';

import { useSearchSession } from './use-search-session';

function Chat({ storageKey }: { storageKey: string }) {
  const { getSessionId, resetSession } = useSearchSession(storageKey);
  return (
    <>
      <button
        onClick={() => {
          document.title = getSessionId();
        }}
      >
        send
      </button>
      <button onClick={resetSession}>reset</button>
    </>
  );
}

it('keeps one opaque ID across follow-ups/remounts, isolates chats and resets new chat', () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
  sessionStorage.clear();
  const view = render(<Chat storageKey='movie-private-title' />);
  fireEvent.click(screen.getByText('send'));
  const first = document.title;
  expect(first).toMatch(/^[a-f0-9]{32}$/);
  fireEvent.click(screen.getByText('send'));
  expect(document.title).toBe(first);
  view.unmount();
  const next = render(<Chat storageKey='movie-private-title' />);
  fireEvent.click(screen.getByText('send'));
  expect(document.title).toBe(first);
  next.rerender(<Chat storageKey='other-chat' />);
  fireEvent.click(screen.getByText('send'));
  expect(document.title).not.toBe(first);
  const other = document.title;
  fireEvent.click(screen.getByText('reset'));
  fireEvent.click(screen.getByText('send'));
  expect(document.title).not.toBe(other);
  next.rerender(<Chat storageKey='movie-private-title' />);
  fireEvent.click(screen.getByText('send'));
  expect(document.title).toBe(first);
});
