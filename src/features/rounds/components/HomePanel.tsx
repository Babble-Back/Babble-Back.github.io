import { useMemo, useRef, useState, type TouchEvent } from 'react';
import { StarRating } from '../../../components/StarRating';

interface HomeFriendSummary {
  id: string;
  username: string;
  averageStars: number | null;
  isYourTurn: boolean;
}

interface CreateGameOption {
  id: string;
  username: string;
}

interface HomePanelProps {
  campaignBannerImage?: string | null;
  friends: HomeFriendSummary[];
  createGameOptions?: CreateGameOption[];
  onCreateGame?: (friendId: string) => void;
  onOpenFriend?: (friendId: string) => void;
  onOpenFriends?: () => void;
  onOpenCampaign?: () => void;
  onRefresh?: () => Promise<void>;
}

function formatAverageScore(averageStars: number | null) {
  if (averageStars === null) {
    return 'No score yet';
  }

  return `${averageStars.toFixed(1)} / 3`;
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
  friends,
  createGameOptions,
  onCreateGame,
  onOpenFriend,
  onOpenFriends,
  onOpenCampaign,
  onRefresh,
}: HomePanelProps) {
  const pullThreshold = 72;
  const maxPullDistance = 128;
  const [isChoosingFriend, setIsChoosingFriend] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);
  const sortedCreateGameOptions = useMemo(
    () =>
      [...(createGameOptions ?? [])].sort((left, right) =>
        left.username.localeCompare(right.username),
      ),
    [createGameOptions],
  );

  const handleCreateGameClick = () => {
    if (!sortedCreateGameOptions.length) {
      onOpenFriends?.();
      return;
    }

    if (!onCreateGame) {
      return;
    }

    if (sortedCreateGameOptions.length === 1) {
      onCreateGame(sortedCreateGameOptions[0].id);
      setIsChoosingFriend(false);
      return;
    }

    setIsChoosingFriend((current) => !current);
  };

  const handleSelectCreateGameFriend = (friendId: string) => {
    if (!onCreateGame) {
      return;
    }

    setIsChoosingFriend(false);
    onCreateGame(friendId);
  };

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (isRefreshing || isChoosingFriend) {
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
    if (isRefreshing || isChoosingFriend || touchStartYRef.current === null) {
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
    ? 'Refreshing…'
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

          {friends.length === 0 ? (
            <div className="empty-state home-empty">
              <h3>No current games</h3>
              <p>Create a game to start your first one.</p>
            </div>
          ) : (
            <div className="game-list" role="list">
              {friends.map((friend) => (
                <div className="game-row" key={friend.id} role="listitem">
                  <div className="game-row-main">
                    <div className="game-row-copy">
                      <strong>{friend.username}</strong>
                    </div>

                    <div
                      className="game-score"
                      aria-label={`Average score ${formatAverageScore(friend.averageStars)}`}
                    >
                      <span className="game-score-label">Average Score</span>
                      <StarRating
                        label={`Average score ${formatAverageScore(friend.averageStars)}`}
                        value={friend.averageStars ?? 0}
                      />
                      <span className="game-score-value">
                        {formatAverageScore(friend.averageStars)}
                      </span>
                    </div>
                  </div>

                  <div className="game-actions">
                    <button
                      className={`button game-action-button ${
                        friend.isYourTurn
                          ? 'game-action-button-take-turn'
                          : 'game-action-button-their-turn'
                      }`}
                      onClick={() => {
                        onOpenFriend?.(friend.id);
                      }}
                      type="button"
                    >
                      {friend.isYourTurn ? <PlayIcon /> : <InfoIcon />}
                      <span>{friend.isYourTurn ? 'Take Turn' : 'Their Turn'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {isChoosingFriend ? (
          <div className="surface nested-surface home-create-picker">
            <h3>Create Game</h3>
            <div className="home-create-options">
              {sortedCreateGameOptions.map((friend) => (
                <button
                  className="home-create-option"
                  key={friend.id}
                  onClick={() => {
                    handleSelectCreateGameFriend(friend.id);
                  }}
                  type="button"
                >
                  <span>{friend.username}</span>
                  <span>Start</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="home-footer">
          <div className="button-row">
            <button className="button primary" onClick={handleCreateGameClick} type="button">
              Create game
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
