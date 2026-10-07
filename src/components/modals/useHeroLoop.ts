import { useCallback, useEffect, useRef, useState } from 'react';

import { playWelcomeLoop, type HeroLoop } from './welcomeMotion';

// The welcome drawing's loop, and whether it rests so Play again can show (KAN-464).
export function useHeroLoop() {
  const loop = useRef<HeroLoop | null>(null);
  const [isResting, setIsResting] = useState(false);

  const play = useCallback((hero: HTMLElement) => {
    loop.current?.cancel();
    setIsResting(false);
    const current = playWelcomeLoop(hero);
    loop.current = current;
    void current.done.then((ran) => {
      if (ran && loop.current === current) setIsResting(true);
    });
  }, []);

  // Get started: every beat jumps to its end, and Play again stays hidden.
  const finish = useCallback(() => {
    const current = loop.current;
    loop.current = null;
    current?.finish();
  }, []);

  const cancel = useCallback(() => {
    const current = loop.current;
    loop.current = null;
    current?.cancel();
  }, []);

  useEffect(() => cancel, [cancel]);

  return { isResting, play, finish, cancel };
}
