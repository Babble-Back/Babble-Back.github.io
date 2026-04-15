import { useRef, useState, type TouchEvent } from 'react';
import { StarRating } from '../../../components/StarRating';
import { respondToFriendRequest, sendFriendRequestByUsername } from '../../../lib/friends';
import type { FriendRequestDirection } from '../../social/types';

type HomeTableActionKind = 'open_friend' | 'start_game' | 'pending_request';
type HomeTableActionTone = 'take-turn' | 'their-turn';

export interface HomeTableRow {
  id: string;
  username: string;
  averageStars: number | null;
  actionKind: HomeTableActionKind;
  actionLabel: string;
  actionTone: HomeTableActionTone;
  friendId?: string;
  requestId?: string;
  requestDirection?: FriendRequestDirection;
}

interface HomePanelProps {
  campaignBannerImage?: string | null;
  rows: HomeTableRow[];
  onCreateGame?: (friendId: string) => void;
  onOpenFriend?: (friendId: string) => void;
  onOpenCampaign?: () => void;
  onRefresh?: () => Promise<void>;
}

function formatAverageScore(averageStars: number | null) {
  if (averageStars === null) {
    return 'No score yet';
  }

  return `${averageStars.toFixed(1)} / 3`;
}

function getActionAriaLabel(row: HomeTableRow) {
  if (row.actionKind === 'pending_request') {
    return row.requestDirection === 'incoming'
      ? `${row.username} sent you a friend request. Tap to accept or reject it.`
      : `Friend request to ${row.username} is still pending.`;
  }

  return `${row.actionLabel} with ${row.username}`;
}

function PlayIcon() {
  return (
    <svg
      aria-hidden="true"
      className="game-action-icon"
      fill="currentColor"
      viewBox="0 0 12 12"
    >
      <path d="M3 2.25v7.5L9 6 3 2.25Z" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      className="game-action-icon"
      fill="none"
      viewBox="0 0 12 12"
    >
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M6 5.4v2.3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.25"
      />
      <circle cx="6" cy="3.7" fill="currentColor" r="0.7" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      aria-hidden="true"
      className="home-refresh-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M20 12a8 8 0 1 1-2.35-5.65"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="m20 4-.2 4.95-4.95-.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function HomePanel({
  campaignBannerImage,
  rows,
  onCreateGame,
  onOpenFriend,
  onOpenCampaign,
  onRefresh,
}: HomePanelProps) {
  const pullThreshold = 72;
  const maxPullDistance = 128;
  const [isAddingFriend, setIsAddingFriend] = useState(false);
  const [friendUsername, setFriendUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);

  const handleAddFriendClick = () => {
    setError(null);
    setInfo(null);
    setIsAddingFriend((current) => !current);
  };

  const handleSendFriendRequest = async () => {
    setError(null);
    setInfo(null);
    setIsSending(true);

    try {
      await sendFriendRequestByUsername(friendUsername);
      setFriendUsername('');
      setIsAddingFriend(false);
      setInfo('Friend request sent.');
      await onRefresh?.();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to send the friend request.',
      );
    } finally {
      setIsSending(false);
    }
  };

  const handlePendingRequestAction = async (row: HomeTableRow) => {
    if (row.requestDirection === 'outgoing') {
      setInfo(`Friend request to ${row.username} is still pending.`);
      return;
    }

    if (!row.requestId) {
      return;
    }

    const requestedAction = window.prompt(
      `Friend request from ${row.username}. Type "accept" to accept it or "reject" to reject it.`,
      'accept',
    );

    if (requestedAction === null) {
      return;
    }

    const normalizedAction = requestedAction.trim().toLowerCase();

    if (normalizedAction !== 'accept' && normalizedAction !== 'reject') {
      setError('Type "accept" or "reject" to manage a pending friend request.');
      return;
    }

    const shouldAccept = normalizedAction === 'accept';
    setActiveRequestId(row.requestId);

    try {
      await respondToFriendRequest(row.requestId, shouldAccept);
      setInfo(shouldAccept ? 'Friend request accepted.' : 'Friend request rejected.');
      await onRefresh?.();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to update the friend request.',
      );
    } finally {
      setActiveRequestId(null);
    }
  };

  const handleRowAction = async (row: HomeTableRow) => {
    setError(null);
    setInfo(null);

    if (row.actionKind === 'start_game') {
      if (row.friendId && onCreateGame) {
        onCreateGame(row.friendId);
      }
      return;
    }

    if (row.actionKind === 'open_friend') {
      if (row.friendId && onOpenFriend) {
        onOpenFriend(row.friendId);
      }
      return;
    }

    await handlePendingRequestAction(row);
  };

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (isRefreshing || isAddingFriend) {
      return;
    }

    if (window.scrollY > 0) {
      touchStartYRef.current = null;
      return;
    }

    touchStartYRef.current = event.touches[0]?.clientY ?? null;
    isPullingRef.current = false;
  };

  const handleTouchMove = (event: TouchEvent<HTMLElement>) => {
    if (isRefreshing || isAddingFriend || touchStartYRef.current === null) {
      return;
    }

    const currentY = event.touches[0]?.clientY;

    if (typeof currentY !== 'number') {
      return;
    }

    const deltaY = currentY - touchStartYRef.current;

    if (deltaY <= 0 || window.scrollY > 0) {
      setPullDistance(0);
      isPullingRef.current = false;
      return;
    }

    isPullingRef.current = true;
    event.preventDefault();
    const dampedPull = Math.min(maxPullDistance, deltaY * 0.48);
    setPullDistance(dampedPull);
  };

  const resetPullState = () => {
    touchStartYRef.current = null;
    isPullingRef.current = false;
    setPullDistance(0);
  };

  const handleTouchEnd = async () => {
    const shouldRefresh = isPullingRef.current && pullDistance >= pullThreshold;
    resetPullState();

    if (!shouldRefresh || !onRefresh) {
      return;
    }

    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const refreshHint = isRefreshing
    ? 'Refreshing...'
    : pullDistance >= pullThreshold
      ? 'Release to refresh'
      : 'Pull down to refresh';

  return (
    <section
      className={`surface home-shell ${pullDistance > 0 ? 'has-pull' : ''}`}
      onTouchEnd={() => {
        void handleTouchEnd();
      }}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchStart}
    >
      <div
        aria-live="polite"
        className={`home-refresh-indicator ${isRefreshing ? 'is-refreshing' : ''}`}
      >
        <RefreshIcon />
        <span>{refreshHint}</span>
      </div>

      <div
        className="home-refresh-content"
        style={{ transform: `translateY(${Math.max(0, pullDistance)}px)` }}
      >
        <button
          className="campaign-home-banner"
          onClick={() => onOpenCampaign?.()}
          type="button"
        >
          {campaignBannerImage ? (
            <div
              aria-hidden="true"
              className="campaign-home-banner-image"
              style={{ backgroundImage: `url("${campaignBannerImage}")` }}
            />
          ) : null}
          <span aria-hidden="true" className="campaign-home-banner-play-button">
            <PlayIcon />
            <span>Play</span>
          </span>
        </button>

        <div className="home-games-section">
          <div className="home-panel-header">
            <h2>Current Games</h2>
          </div>

          {rows.length === 0 ? (
            <div className="empty-state home-empty">
              <h3>No current games</h3>
              <p>Add a friend to start your first game.</p>
            </div>
          ) : (
            <div className="game-list" role="list">
              {rows.map((row) => {
                const isActionablePlay =
                  row.actionKind === 'start_game' ||
                  (row.actionKind === 'open_friend' && row.actionTone === 'take-turn');

                return (
                  <div className="game-row" key={row.id} role="listitem">
                    <div className="game-row-main">
                      <div className="game-row-copy">
                        <strong>{row.username}</strong>
                      </div>

                      <div
                        className="game-score"
                        aria-label={`Average score ${formatAverageScore(row.averageStars)}`}
                      >
                        <span className="game-score-label">Average Score</span>
                        <StarRating
                          label={`Average score ${formatAverageScore(row.averageStars)}`}
                          value={row.averageStars ?? 0}
                        />
                        <span className="game-score-value">
                          {formatAverageScore(row.averageStars)}
                        </span>
                      </div>
                    </div>

                    <div className="game-actions">
                      <button
                        aria-label={getActionAriaLabel(row)}
                        className={`button game-action-button ${
                          row.actionTone === 'take-turn'
                            ? 'game-action-button-take-turn'
                            : 'game-action-button-their-turn'
                        }`}
                        disabled={activeRequestId === row.requestId}
                        onClick={() => {
                          void handleRowAction(row);
                        }}
                        type="button"
                      >
                        {isActionablePlay ? <PlayIcon /> : <InfoIcon />}
                        <span>{row.actionLabel}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {isAddingFriend ? (
          <div className="surface nested-surface home-create-picker">
            <h3>Add Friend</h3>
            <p className="helper-text">Enter a username to send a friend request.</p>
            <div className="field-row">
              <div className="field flex-field">
                <label htmlFor="homeFriendUsername">Friend username</label>
                <input
                  id="homeFriendUsername"
                  onChange={(event) => setFriendUsername(event.target.value)}
                  placeholder="friendname"
                  value={friendUsername}
                />
              </div>
              <button
                className="button primary"
                disabled={!friendUsername.trim() || isSending}
                onClick={() => {
                  void handleSendFriendRequest();
                }}
                type="button"
              >
                {isSending ? 'Sending...' : 'Send request'}
              </button>
            </div>
          </div>
        ) : null}

        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <div className="success-banner">{info}</div> : null}

        <div className="home-footer">
          <div className="button-row">
            <button className="button primary" onClick={handleAddFriendClick} type="button">
              Add Friend
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
