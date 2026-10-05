import { useEffect } from 'react';
import { useDispatch } from 'react-redux';

import type { AppDispatch } from '../redux/store';
import { showInFullView } from '../redux/fullViewShow';
import { isShowInFullViewMessage } from '../utils/functions/popOut';
import { isTabView } from '../utils/functions/viewMode';

// The worker names the full view it focused; any other page ignores the message.
export function useFullViewShowRequests(): void {
  const dispatch: AppDispatch = useDispatch();
  useEffect(() => {
    if (!isTabView()) return;
    let ownTabId: number | undefined;
    let isLive = true;
    void chrome.tabs.getCurrent().then((tab) => {
      if (isLive) ownTabId = tab?.id;
    });
    const onMessage = (message: unknown) => {
      if (isShowInFullViewMessage(message) && message.tabId === ownTabId) {
        dispatch(showInFullView(message.show));
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      isLive = false;
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [dispatch]);
}
