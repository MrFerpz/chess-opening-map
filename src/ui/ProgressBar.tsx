import type { SyncRunState } from '../hooks/useGameSync';

interface Props {
  state: SyncRunState;
}

export function ProgressBar({ state }: Props) {
  let label = '';
  if (state.status === 'loading-cache') label = 'Loading cached games…';
  else if (state.status === 'fetching')
    label = `Fetching… ${state.fetched} new${state.fromCache ? ` (${state.fromCache} cached)` : ''}`;
  else if (state.status === 'done')
    label = `Done — ${state.fetched} new fetched${state.fromCache ? `, ${state.fromCache} from cache` : ''}`;
  else if (state.status === 'error') label = `Error: ${state.error ?? 'unknown'}`;
  else return null;

  const isWorking = state.status === 'loading-cache' || state.status === 'fetching';

  return (
    <div style={{ color: state.status === 'error' ? 'var(--loss)' : 'var(--text-muted)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
      {isWorking && <Spinner />}
      <span>{label}</span>
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      width: 12, height: 12,
      border: '2px solid var(--accent)',
      borderTopColor: 'transparent',
      borderRadius: '50%',
      display: 'inline-block',
      animation: 'cv-spin 0.8s linear infinite',
    }} />
  );
}
