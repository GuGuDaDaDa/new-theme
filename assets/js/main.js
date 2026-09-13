/** Browser entry point for persistent shell and replaceable page content. */
import { createId } from './core/ids.js';
import { initShell, initPage } from './core/lifecycle.js';
import { initNavigation } from './core/navigation.js';

initShell(document);
// Establish history identity before list initialization captures it.
history.replaceState(
  {
    ...history.state,
    nightNavigation: history.state?.nightNavigation || {
      schema: 1,
      entryId: createId(),
      url: location.href,
      scrollX,
      scrollY,
      fromEntryId: null,
    },
  },
  '',
);
const page = initPage(document);
page.ready.then(() => initNavigation(document, initPage, page));
