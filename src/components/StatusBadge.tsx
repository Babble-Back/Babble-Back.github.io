import type { RoundStatus } from '../features/rounds/types';

interface StatusBadgeProps {
  status: RoundStatus;
}

const STATUS_LABELS: Record<RoundStatus, string> = {
  waiting_for_attempt: 'Live',
  attempted: 'Guess Next',
  complete: 'Finished',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`badge status-badge ${status}`} data-status={status}>
      {STATUS_LABELS[status]}
    </span>
  );
}
