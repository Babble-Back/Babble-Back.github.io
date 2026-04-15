import { useMemo, useState } from 'react';
import type { FriendRequest } from '../types';
import type { Friend } from '../types';
import { respondToFriendRequest, sendFriendRequestByUsername } from '../../../lib/friends';

interface FriendsPanelProps {
  friends: Friend[];
  requests: FriendRequest[];
  onRefresh: () => Promise<void>;
}

export function FriendsPanel({ friends, requests, onRefresh }: FriendsPanelProps) {
  const [friendUsername, setFriendUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  const incomingRequests = useMemo(
    () => requests.filter((request) => request.direction === 'incoming'),
    [requests],
  );
  const outgoingRequests = useMemo(
    () => requests.filter((request) => request.direction === 'outgoing'),
    [requests],
  );

  const handleSendRequest = async () => {
    setError(null);
    setInfo(null);
    setIsSending(true);

    try {
      await sendFriendRequestByUsername(friendUsername);
      setFriendUsername('');
      setInfo('Friend request sent.');
      await onRefresh();
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

  const handleRespondToRequest = async (requestId: string, accept: boolean) => {
    setError(null);
    setInfo(null);
    setActiveRequestId(requestId);

    try {
      await respondToFriendRequest(requestId, accept);
      setInfo(accept ? 'Friend request accepted.' : 'Friend request rejected.');
      await onRefresh();
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

  return (
    <section className="surface panel-shell">
      <div className="eyebrow">Crew</div>
      <div className="section-header">
        <div>
          <h2>Invite your people</h2>
          <p>Add a friend by username. Once they accept, they appear in the home list and can start a thread.</p>
        </div>
      </div>

      <div className="stack panel-stack">
        <div className="surface nested-surface panel-card">
          <div className="section-header">
            <div>
              <h3>Add a friend</h3>
              <p>Both accounts need to exist before the invite can be sent.</p>
            </div>
          </div>

          <div className="field-row">
            <div className="field flex-field">
              <label htmlFor="friendUsername">Friend username</label>
              <input
                id="friendUsername"
                onChange={(event) => setFriendUsername(event.target.value)}
                placeholder="friendname"
                value={friendUsername}
              />
            </div>
            <button
              className="button primary"
              disabled={!friendUsername.trim() || isSending}
              onClick={() => {
                void handleSendRequest();
              }}
              type="button"
            >
              {isSending ? 'Sending...' : 'Send invite'}
            </button>
          </div>
        </div>

        <div className="split-panel">
          <div className="surface nested-surface panel-card">
            <div className="section-header compact-header">
              <div>
                <h3>Incoming</h3>
                <p>Accept to make the pair available for threads.</p>
              </div>
            </div>

            {incomingRequests.length === 0 ? (
              <div className="empty-state compact-empty">No incoming invites right now.</div>
            ) : (
              <div className="stack mini-stack">
                {incomingRequests.map((request) => (
                  <div className="list-card" key={request.id}>
                    <div>
                      <strong>{request.otherUserUsername}</strong>
                      <p className="helper-text">
                        Sent {new Date(request.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="button-row">
                      <button
                        className="button primary"
                        disabled={activeRequestId === request.id}
                        onClick={() => {
                          void handleRespondToRequest(request.id, true);
                        }}
                        type="button"
                      >
                        Accept
                      </button>
                      <button
                        className="button ghost"
                        disabled={activeRequestId === request.id}
                        onClick={() => {
                          void handleRespondToRequest(request.id, false);
                        }}
                        type="button"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="surface nested-surface panel-card">
            <div className="section-header compact-header">
              <div>
                <h3>Outgoing</h3>
                <p>Invites that are still waiting on the other side.</p>
              </div>
            </div>

            {outgoingRequests.length === 0 ? (
              <div className="empty-state compact-empty">No outgoing invites yet.</div>
            ) : (
              <div className="stack mini-stack">
                {outgoingRequests.map((request) => (
                  <div className="list-card" key={request.id}>
                    <div>
                      <strong>{request.otherUserUsername}</strong>
                      <p className="helper-text">
                        Sent {new Date(request.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className="badge waiting_for_attempt">Pending</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="surface nested-surface panel-card">
          <div className="section-header compact-header">
            <div>
              <h3>Friend List</h3>
              <p>Confirmed friends are the only people who can receive rounds.</p>
            </div>
          </div>

          {friends.length === 0 ? (
            <div className="empty-state compact-empty">
              No friends yet. Send an invite and wait for the accept.
            </div>
          ) : (
            <div className="stack mini-stack">
              {friends.map((friend) => (
                <div className="list-card friend-card" key={friend.id}>
                  <div className="friend-copy">
                    <strong>{friend.username}</strong>
                    <p className="helper-text">
                      Friends since {new Date(friend.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="badge complete">Ready</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <div className="success-banner">{info}</div> : null}
      </div>
    </section>
  );
}
