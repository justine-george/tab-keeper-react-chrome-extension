import { useEffect, useState } from 'react';

import { hasTabsToSave } from '../utils/functions/capture';

// KAN-866. Whether Replace with current window is offered: the current window
// is a normal one holding a tab other than Tab Keeper's. Hidden until
// answered: the item sits in a menu, so there is no icon to pop in. Asked again
// whenever the page is shown or focused, since the full view's own window can
// gain tabs while it is open; the handler asks once more and says so if empty.
export function useCanReplaceWithCurrentWindow(): boolean {
  const [canReplace, setCanReplace] = useState(false);
  useEffect(() => {
    let mounted = true;
    const ask = () => {
      if (document.visibilityState === 'hidden') return;
      void hasTabsToSave('current-window')
        .then((has) => {
          if (mounted) setCanReplace(has);
        })
        // Unanswered, it keeps its last answer.
        .catch(() => {});
    };
    ask();
    document.addEventListener('visibilitychange', ask);
    window.addEventListener('focus', ask);
    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', ask);
      window.removeEventListener('focus', ask);
    };
  }, []);
  return canReplace;
}
