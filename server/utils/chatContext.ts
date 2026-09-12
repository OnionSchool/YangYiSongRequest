/**
 * Async local storage for transporting context (IP, UA, userId) across async boundaries.
 * Used for non-request contexts (background jobs, scheduled tasks).
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface ChatContext {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

const localStorage = new AsyncLocalStorage<ChatContext>();

export function withChatContext<T>(context: ChatContext, callback: () => T): T {
  return localStorage.run(context, callback);
}

export function getChatContext(): ChatContext | undefined {
  return localStorage.getStore();
}

/** Set request-local context for the current async execution chain. */
export function enterChatContext(context: ChatContext): void {
  localStorage.enterWith(context);
}

export function setChatContext<T>(context: ChatContext, callback: () => T): T {
  let inner: T | undefined;
  return localStorage.run(context, () => {
    inner = callback();
    return inner;
  });
}
