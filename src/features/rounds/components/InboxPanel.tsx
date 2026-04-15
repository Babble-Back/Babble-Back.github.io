import { StatusBadge } from '../../../components/StatusBadge';
import type { Round } from '../types';

interface InboxPanelProps {
  currentUserId: string;
  rounds: Round[];
  selectedRoundId: string | null;
  onSelectRound: (roundId: string) => void;
}

function describeRound(round: Round, currentUserId: string) {
  const isRecipient = round.recipientId === currentUserId;

  if (round.status === 'complete') {
    return round.score === null
      ? 'Round complete.'
      : `Round complete. Score: ${round.score}/10.`;
  }

  if (isRecipient) {
    return round.status === 'attempted'
      ? 'Your attempt is saved. Submit your guess to finish the round.'
      : 'Your turn: listen, imitate, and submit a guess.';
  }

  return round.status === 'attempted'
    ? `${round.recipientUsername} recorded an attempt and still needs to submit a guess.`
    : `Waiting for ${round.recipientUsername} to play the round.`;
}

export function InboxPanel({
  currentUserId,
  rounds,
  selectedRoundId,
  onSelectRound,
}: InboxPanelProps) {
  return (
    <section className="surface">
      <div className="section-header">
        <div>
          <h2>My Rounds</h2>
          <p>
            Only rounds where you are the sender or recipient appear here. Everyone else is blocked
            by row-level security.
          </p>
        </div>
      </div>

      {rounds.length === 0 ? (
        <div className="empty-state">
          No rounds yet. Send one to a friend, or wait for a friend to send one to you.
        </div>
      ) : (
        <div className="round-list">
          {rounds.map((round) => {
            const isRecipient = round.recipientId === currentUserId;

            return (
              <button
                key={round.id}
                className={round.id === selectedRoundId ? 'selected' : undefined}
                onClick={() => onSelectRound(round.id)}
                type="button"
              >
                <div className="round-row">
                  <div>
                    <h4>{isRecipient ? `From ${round.senderUsername}` : `To ${round.recipientUsername}`}</h4>
                    <p>{new Date(round.createdAt).toLocaleString()}</p>
                  </div>
                  <StatusBadge status={round.status} />
                </div>
                <div className="pill-row">
                  <span className={`badge ${isRecipient ? 'attempted' : 'waiting_for_attempt'}`}>
                    {isRecipient ? 'Received' : 'Sent'}
                  </span>
                </div>
                <p className="helper-text">{describeRound(round, currentUserId)}</p>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
