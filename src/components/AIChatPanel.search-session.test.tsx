/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'crypto';

import AIChatPanel from './AIChatPanel';

jest.mock('next/navigation', () => ({ usePathname: () => '/' }));
jest.mock('@/lib/auth', () => ({ getAuthInfoFromBrowserCookie: () => null }));
jest.mock('react-markdown', () => ({ __esModule: true, default: () => null }));

it('sends one opaque ID for chat follow-ups, restores it with history and changes it on clear/context switch', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
  HTMLElement.prototype.scrollIntoView = jest.fn();
  sessionStorage.clear();
  const ids: string[] = [];
  const histories: unknown[] = [];
  global.fetch = jest.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    ids.push(body.searchSessionId);
    histories.push(body.history);
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ content: 'Fixture answer' }),
    } as unknown as Response;
  });
  const props = { isOpen: true, onClose: jest.fn(), useDrawer: true };
  const view = render(<AIChatPanel {...props} />);
  const send = async () => {
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'film news' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input).not.toBeDisabled());
  };
  await send();
  await send();
  expect(ids[0]).toMatch(/^[a-f0-9]{32}$/);
  expect(ids[1]).toBe(ids[0]);
  view.unmount();
  const remount = render(<AIChatPanel {...props} />);
  await send();
  expect(ids[2]).toBe(ids[0]);
  fireEvent.click(screen.getByTitle('清空聊天记录'));
  await send();
  expect(ids[3]).not.toBe(ids[0]);
  remount.rerender(
    <AIChatPanel {...props} context={{ title: 'Private Film' }} />
  );
  expect(screen.queryAllByText('film news')).toHaveLength(0);
  await send();
  expect(histories[4]).toEqual([]);
  expect(ids[4]).not.toBe(ids[3]);
  expect(ids[4]).not.toContain('Private');
  remount.rerender(<AIChatPanel {...props} />);
  expect(screen.queryAllByText('film news')).toHaveLength(0);
  await send();
  expect(histories[5]).toEqual([]);
  expect(ids[5]).not.toBe(ids[3]);
  expect(ids[5]).not.toBe(ids[4]);
});
