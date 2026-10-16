import { historyCursor } from '../../core/app/rules/history.js';

export function cursorOptions(url, badRequest) {
  const beforeCursor = url.searchParams.get('beforeCursor');
  const afterCursor = url.searchParams.get('afterCursor');
  if ((beforeCursor !== null && !historyCursor(beforeCursor)) || (afterCursor !== null && !historyCursor(afterCursor)) || (beforeCursor !== null && afterCursor !== null)) {
    throw badRequest('bad_cursor', 'Use one valid beforeCursor or afterCursor.');
  }
  return { beforeCursor, afterCursor };
}
