import { useCallback, useState } from 'react';

const STORAGE_KEY = 'openingmap-onboarded';

type Phase = 'coach' | 'done';

// First-run onboarding state machine. On first ever visit (storage key absent)
// we start at 'coach' so the coach marks auto-show once the chart has loaded;
// otherwise we start at 'done'. The flag is persisted when the sequence finishes
// so it never auto-shows again. There is no welcome modal — the coach marks are
// the whole flow.
export function useOnboarding() {
  const [phase, setPhase] = useState<Phase>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ? 'done' : 'coach';
    } catch {
      return 'done';
    }
  });

  // Finish (or skip) the coach-mark sequence and persist the flag.
  const finish = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // ignore — onboarding just won't persist
    }
    setPhase('done');
  }, []);

  // Replay the flow on demand (the header "?" button). Does not clear the
  // persisted flag — replaying is intentional, not a first run.
  const replay = useCallback(() => setPhase('coach'), []);

  return {
    showCoachMarks: phase === 'coach',
    finish,
    replay,
  };
}
