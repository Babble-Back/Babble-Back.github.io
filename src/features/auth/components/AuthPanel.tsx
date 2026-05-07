import { useEffect, useState } from 'react';
import {
  requestPasswordReset,
  signInWithIdentifier,
  signUpWithEmail,
  updateRecoveredPassword,
} from '../../../lib/auth';
import { supabaseConfigError } from '../../../lib/supabase';
import homeLogo from '../../../assets/backtalk-logo.png';

export type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

interface AuthPanelProps {
  initialMode?: AuthMode;
  onPasswordResetComplete?: () => void;
}

type AuthAction = 'signup' | 'login' | 'reset-request' | 'password-update';

function normalizeUsernamePreview(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getAuthTitle(mode: AuthMode) {
  if (mode === 'register') {
    return 'Create account';
  }

  if (mode === 'forgot') {
    return 'Reset password';
  }

  if (mode === 'reset') {
    return 'Choose new password';
  }

  return 'Sign in';
}

export function AuthPanel({
  initialMode = 'login',
  onPasswordResetComplete,
}: AuthPanelProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<AuthAction | null>(null);

  useEffect(() => {
    setMode(initialMode);
    setError(null);
    setInfo(null);
    setActiveAction(null);
  }, [initialMode]);

  const clearFeedback = () => {
    setError(null);
    setInfo(null);
  };

  const handleSignUp = async () => {
    const normalizedUsername = normalizeUsernamePreview(username);

    if (normalizedUsername.length < 3) {
      setError('Choose a username with at least 3 letters, numbers, or underscores.');
      setInfo(null);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      setInfo(null);
      return;
    }

    setError(null);
    setInfo(null);
    setActiveAction('signup');

    try {
      const result = await signUpWithEmail({
        email,
        username: normalizedUsername,
        password,
      });
      setInfo(
        result.requiresEmailConfirmation
          ? 'Account created. Check your email to confirm the account before logging in.'
          : 'Account created and signed in.',
      );
      setPassword('');
      setConfirmPassword('');
      setMode('login');
      setIdentifier(normalizedUsername);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to create the account.',
      );
    } finally {
      setActiveAction(null);
    }
  };

  const handleLogin = async () => {
    setError(null);
    setInfo(null);
    setActiveAction('login');

    try {
      await signInWithIdentifier({ identifier, password });
      setInfo('Logged in.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to log in.');
    } finally {
      setActiveAction(null);
    }
  };

  const handlePasswordResetRequest = async () => {
    setError(null);
    setInfo(null);
    setActiveAction('reset-request');

    try {
      await requestPasswordReset(email);
      setInfo('If an account exists for that email, a reset link has been sent.');
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to send the reset email.',
      );
    } finally {
      setActiveAction(null);
    }
  };

  const handleRecoveredPasswordUpdate = async () => {
    if (password.length < 6) {
      setError('Choose a password with at least 6 characters.');
      setInfo(null);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      setInfo(null);
      return;
    }

    setError(null);
    setInfo(null);
    setActiveAction('password-update');

    try {
      await updateRecoveredPassword(password);
      setPassword('');
      setConfirmPassword('');
      setInfo('Password updated.');

      if (onPasswordResetComplete) {
        onPasswordResetComplete();
      } else {
        setMode('login');
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to update your password.',
      );
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <section className="surface auth-shell">
      <div className="section-header">
        <div>
          <img alt="BackTalk" className="auth-brand-logo" src={homeLogo} />
          <h2>{getAuthTitle(mode)}</h2>
        </div>
      </div>

      {supabaseConfigError ? <div className="error-banner">{supabaseConfigError}</div> : null}

      <div className="stack">
        {mode === 'login' ? (
          <>
            <div className="field">
              <label htmlFor="authIdentifier">Username or email</label>
              <input
                id="authIdentifier"
                autoComplete="username"
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="your_name or you@example.com"
                type="text"
                value={identifier}
              />
            </div>

            <div className="field">
              <label htmlFor="authPassword">Password</label>
              <input
                id="authPassword"
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                type="password"
                value={password}
              />
            </div>

            <div className="button-row auth-actions">
              <button
                className="button primary"
                disabled={!identifier.trim() || !password.trim() || activeAction !== null}
                onClick={() => {
                  void handleLogin();
                }}
                type="button"
              >
                {activeAction === 'login' ? 'Logging in...' : 'Sign in'}
              </button>
              <button
                className="button ghost"
                disabled={activeAction !== null}
                onClick={() => {
                  clearFeedback();
                  setMode('register');
                }}
                type="button"
              >
                Create account
              </button>
              <button
                className="button ghost"
                disabled={activeAction !== null}
                onClick={() => {
                  clearFeedback();
                  if (identifier.trim().includes('@')) {
                    setEmail(identifier.trim());
                  }
                  setPassword('');
                  setMode('forgot');
                }}
                type="button"
              >
                Forgot password?
              </button>
            </div>
          </>
        ) : mode === 'register' ? (
          <>
            <div className="field-grid two-up">
              <div className="field">
                <label htmlFor="authUsername">Username</label>
                <input
                  id="authUsername"
                  autoComplete="username"
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="your_name"
                  type="text"
                  value={username}
                />
                <div className="helper-text">
                  {username.trim()
                    ? `Will be saved as ${normalizeUsernamePreview(username) || 'invalid username'}`
                    : 'Letters, numbers, and underscores only.'}
                </div>
              </div>

              <div className="field">
                <label htmlFor="authEmail">Email address</label>
                <input
                  id="authEmail"
                  autoComplete="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  value={email}
                />
              </div>
            </div>

            <div className="field-grid two-up">
              <div className="field">
                <label htmlFor="authNewPassword">Password</label>
                <input
                  id="authNewPassword"
                  autoComplete="new-password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 6 characters"
                  type="password"
                  value={password}
                />
              </div>

              <div className="field">
                <label htmlFor="authConfirmPassword">Repeat password</label>
                <input
                  id="authConfirmPassword"
                  autoComplete="new-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Type it again"
                  type="password"
                  value={confirmPassword}
                />
              </div>
            </div>

            <div className="button-row auth-actions">
              <button
                className="button secondary"
                disabled={
                  !username.trim() ||
                  !email.trim() ||
                  !password.trim() ||
                  !confirmPassword.trim() ||
                  activeAction !== null
                }
                onClick={() => {
                  void handleSignUp();
                }}
                type="button"
              >
                {activeAction === 'signup' ? 'Creating account...' : 'Register'}
              </button>
              <button
                className="button ghost"
                disabled={activeAction !== null}
                onClick={() => {
                  clearFeedback();
                  setMode('login');
                }}
                type="button"
              >
                Back to sign in
              </button>
            </div>
          </>
        ) : mode === 'forgot' ? (
          <>
            <div className="field">
              <label htmlFor="authResetEmail">Email address</label>
              <input
                id="authResetEmail"
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                type="email"
                value={email}
              />
            </div>

            <div className="button-row auth-actions">
              <button
                className="button primary"
                disabled={!email.trim() || activeAction !== null}
                onClick={() => {
                  void handlePasswordResetRequest();
                }}
                type="button"
              >
                {activeAction === 'reset-request' ? 'Sending...' : 'Send reset link'}
              </button>
              <button
                className="button ghost"
                disabled={activeAction !== null}
                onClick={() => {
                  clearFeedback();
                  setMode('login');
                }}
                type="button"
              >
                Back to sign in
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="field-grid two-up">
              <div className="field">
                <label htmlFor="authRecoveredPassword">New password</label>
                <input
                  id="authRecoveredPassword"
                  autoComplete="new-password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 6 characters"
                  type="password"
                  value={password}
                />
              </div>

              <div className="field">
                <label htmlFor="authRecoveredConfirmPassword">Repeat password</label>
                <input
                  id="authRecoveredConfirmPassword"
                  autoComplete="new-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Type it again"
                  type="password"
                  value={confirmPassword}
                />
              </div>
            </div>

            <div className="button-row auth-actions">
              <button
                className="button primary"
                disabled={
                  !password.trim() || !confirmPassword.trim() || activeAction !== null
                }
                onClick={() => {
                  void handleRecoveredPasswordUpdate();
                }}
                type="button"
              >
                {activeAction === 'password-update' ? 'Updating...' : 'Update password'}
              </button>
            </div>
          </>
        )}

        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <div className="info-banner">{info}</div> : null}
      </div>
    </section>
  );
}
