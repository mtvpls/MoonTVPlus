'use client';

import type {
  TVRemoteKey,
  TVRemoteKeyCommand,
  TVRemoteTextCommand,
} from './tv-remote-types';

const keyConfigs: Record<
  TVRemoteKey,
  { key: string; code: string; keyCode: number }
> = {
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  ok: { key: 'Enter', code: 'Enter', keyCode: 13 },
  back: { key: 'Escape', code: 'Escape', keyCode: 27 },
  menu: { key: 'ContextMenu', code: 'ContextMenu', keyCode: 93 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  playPause: { key: 'Enter', code: 'Enter', keyCode: 13 },
  pageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  digit: { key: '0', code: 'Digit0', keyCode: 48 },
};

function dispatchKeyboardEvent(type: 'keydown' | 'keyup', cfg: {
  key: string;
  code: string;
  keyCode: number;
}, repeat = false) {
  const event = new KeyboardEvent(type, {
    key: cfg.key,
    code: cfg.code,
    repeat,
    bubbles: true,
    cancelable: true,
  });

  Object.defineProperty(event, 'keyCode', { get: () => cfg.keyCode });
  Object.defineProperty(event, 'which', { get: () => cfg.keyCode });

  document.activeElement?.dispatchEvent(event);
  window.dispatchEvent(event);
  document.dispatchEvent(event);
}

export function fireTVRemoteKey(command: TVRemoteKey | TVRemoteKeyCommand, repeat = false) {
  const normalized =
    typeof command === 'string'
      ? { key: command, repeat }
      : command;
  let cfg = keyConfigs[normalized.key];

  if (normalized.key === 'digit') {
    const digit = /^[0-9]$/.test(normalized.digit || '')
      ? normalized.digit || '0'
      : '0';
    cfg = {
      key: digit,
      code: `Digit${digit}`,
      keyCode: 48 + Number(digit),
    };
  }

  dispatchKeyboardEvent('keydown', cfg, Boolean(normalized.repeat));
  dispatchKeyboardEvent('keyup', cfg, Boolean(normalized.repeat));
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
}

function getTextTarget() {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return active;
  }

  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])'
  );
}

export function applyTVRemoteText(command: TVRemoteTextCommand) {
  const target = getTextTarget();
  if (!target) return false;

  target.focus({ preventScroll: true });

  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  const text = command.text || '';
  let next = target.value;
  let nextCaret = start;

  if (command.mode === 'replace') {
    next = text;
    nextCaret = next.length;
  } else if (command.mode === 'append') {
    next = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
    nextCaret = start + text.length;
  } else if (command.mode === 'backspace') {
    if (start !== end) {
      next = `${target.value.slice(0, start)}${target.value.slice(end)}`;
      nextCaret = start;
    } else if (start > 0) {
      next = `${target.value.slice(0, start - 1)}${target.value.slice(end)}`;
      nextCaret = start - 1;
    }
  } else if (command.mode === 'clear') {
    next = '';
    nextCaret = 0;
  }

  setNativeValue(target, next);
  target.setSelectionRange(nextCaret, nextCaret);
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
