import { useEffect, useMemo, useState } from 'react';
import { WaveformLoader } from '../../../components/WaveformLoader';
import {
  listMonthlyFriendMatchLeaderboards,
  type FriendMatchLeaderboardEntry,
  type FriendMatchLeaderboardKey,
} from '../../../lib/leaderboards';

interface FriendMatchLeaderboardsModalProps {
  currentUserId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface LeaderboardSectionDefinition {
  description: string;
  emptyMessage: string;
  key: FriendMatchLeaderboardKey;
  title: string;
}

const LEADERBOARD_SECTIONS: LeaderboardSectionDefinition[] = [
  {
    key: 'best_team_coins',
    title: 'Best Team',
    description: 'Most BB Coins earned together this month.',
    emptyMessage: 'No friend-match coin earnings are on the board yet this month.',
  },
  {
    key: 'best_event_team',
    title: 'Best Event Team',
    description: 'Most current campaign items earned from your games together this month.',
    emptyMessage: 'No current campaign item drops from friend matches yet this month.',
  },
  {
    key: 'best_speaker',
    title: 'Best Speaker',
    description: 'Highest average stars as the player sending the phrase.',
    emptyMessage: 'No speaker scores are available yet this month.',
  },
  {
    key: 'best_babbler',
    title: 'Best Babbler',
    description: 'Highest average stars as the player babbling and guessing.',
    emptyMessage: 'No babbler scores are available yet this month.',
  },
  {
    key: 'best_three_star_streak',
    title: 'Longest 3-Star Streak',
    description: 'Longest run of perfect rounds in a single friend thread this month.',
    emptyMessage: 'No 3-star streaks have started yet this month.',
  },
];

function getMonthRange() {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return {
    label: now.toLocaleString(undefined, {
      month: 'long',
      year: 'numeric',
    }),
    periodEnd: periodEnd.toISOString(),
    periodStart: periodStart.toISOString(),
  };
}

function formatMetric(
  entry: FriendMatchLeaderboardEntry,
  leaderboardKey: FriendMatchLeaderboardKey,
) {
  if (leaderboardKey === 'best_team_coins') {
    return `${Math.round(entry.metricValue).toLocaleString()} BB Coins`;
  }

  if (leaderboardKey === 'best_event_team') {
    return `${Math.round(entry.metricValue).toLocaleString()} items`;
  }

  if (leaderboardKey === 'best_three_star_streak') {
    return `${Math.round(entry.metricValue)} straight 3-star rounds`;
  }

  const roundedAverage = Math.round(entry.metricValue * 10) / 10;
  return `${roundedAverage.toFixed(1)} avg stars`;
}

function formatSample(entry: FriendMatchLeaderboardEntry, leaderboardKey: FriendMatchLeaderboardKey) {
  if (leaderboardKey === 'best_three_star_streak') {
    return `${entry.sampleSize} rounds played`;
  }

  return `${entry.sampleSize} round${entry.sampleSize === 1 ? '' : 's'}`;
}

function formatEntryName(entry: FriendMatchLeaderboardEntry, currentUserId: string) {
  if (!entry.secondaryUserId || !entry.secondaryUsername) {
    return entry.primaryUserId === currentUserId ? 'You' : entry.primaryUsername;
  }

  if (entry.primaryUserId === currentUserId) {
    return `You + ${entry.secondaryUsername}`;
  }

  if (entry.secondaryUserId === currentUserId) {
    return `${entry.primaryUsername} + You`;
  }

  return `${entry.primaryUsername} + ${entry.secondaryUsername}`;
}

export function FriendMatchLeaderboardsModal({
  currentUserId,
  isOpen,
  onClose,
}: FriendMatchLeaderboardsModalProps) {
  const [entries, setEntries] = useState<FriendMatchLeaderboardEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const monthRange = getMonthRange();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    const loadLeaderboards = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const nextEntries = await listMonthlyFriendMatchLeaderboards({
          limit: 5,
          periodEnd: monthRange.periodEnd,
          periodStart: monthRange.periodStart,
        });

        if (!cancelled) {
          setEntries(nextEntries);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load the monthly leaderboards.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadLeaderboards();

    return () => {
      cancelled = true;
    };
  }, [isOpen, monthRange.periodEnd, monthRange.periodStart]);

  const entriesBySection = useMemo(() => {
    return entries.reduce<Record<FriendMatchLeaderboardKey, FriendMatchLeaderboardEntry[]>>(
      (groupedEntries, entry) => {
        if (!groupedEntries[entry.leaderboardKey]) {
          groupedEntries[entry.leaderboardKey] = [];
        }

        groupedEntries[entry.leaderboardKey].push(entry);
        return groupedEntries;
      },
      {
        best_babbler: [],
        best_event_team: [],
        best_speaker: [],
        best_team_coins: [],
        best_three_star_streak: [],
      },
    );
  }, [entries]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="campaign-leaderboard-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-modal="true"
        className="campaign-leaderboard-modal friend-match-leaderboards-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="campaign-leaderboard-header">
          <div>
            <div className="eyebrow">Leaderboards</div>
            <h3>{monthRange.label}</h3>
            <p>Monthly friend-match standings. These reset every month.</p>
          </div>
          <button className="button ghost" onClick={onClose} type="button">
            Close
          </button>
        </div>

        {isLoading ? (
          <div className="round-loader-callout" aria-live="polite" role="status">
            <WaveformLoader className="round-loader-callout-spinner" size={82} strokeWidth={3.4} />
            <div>
              <strong>Loading leaderboards...</strong>
            </div>
          </div>
        ) : (
          <div className="friend-match-leaderboards-grid">
            {error ? <div className="error-banner">{error}</div> : null}

            {LEADERBOARD_SECTIONS.map((section) => {
              const sectionEntries = entriesBySection[section.key];

              return (
                <section className="friend-match-leaderboard-card" key={section.key}>
                  <div className="friend-match-leaderboard-card-header">
                    <div>
                      <div className="eyebrow">{section.title}</div>
                      <h4>{section.description}</h4>
                    </div>
                  </div>

                  {sectionEntries.length === 0 ? (
                    <p className="helper-text friend-match-leaderboard-empty">
                      {section.emptyMessage}
                    </p>
                  ) : (
                    <div className="campaign-leaderboard-list" role="list">
                      {sectionEntries.map((entry) => (
                        <div
                          className="campaign-leaderboard-row friend-match-leaderboard-row"
                          key={`${section.key}-${entry.rank}-${entry.primaryUserId}-${entry.secondaryUserId ?? 'solo'}`}
                          role="listitem"
                        >
                          <span className="campaign-leaderboard-rank">#{entry.rank}</span>
                          <div className="friend-match-leaderboard-copy">
                            <strong>{formatEntryName(entry, currentUserId)}</strong>
                            <span>{formatSample(entry, section.key)}</span>
                          </div>
                          <strong className="friend-match-leaderboard-metric">
                            {formatMetric(entry, section.key)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <p className="friend-match-leaderboard-note">
          Older rounds archived before leaderboard tracking was added may not appear here yet.
        </p>
      </div>
    </div>
  );
}
