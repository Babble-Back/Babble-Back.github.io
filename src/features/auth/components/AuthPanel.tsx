import { useState } from 'react';
import { signInWithIdentifier, signUpWithEmail } from '../../../lib/auth';
import { supabaseConfigError } from '../../../lib/supabase';
import homeLogo from '../../../assets/backtalk-logo.png';

type AuthMode = 'login' | 'register';

function normalizeUsernamePreview(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function AuthPanel() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<'signup' | 'login' | null>(null);

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

  return (
    <section className="surface auth-shell">
      <div className="section-header">
        <div>
          <img alt="BackTalk" className="auth-brand-logo" src={homeLogo} />
          <h2>{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
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
                  setError(null);
                  setInfo(null);
                  setMode('register');
                }}
                type="button"
              >
                Create account
              </button>
            </div>
          </>
        ) : (
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
                  setError(null);
                  setInfo(null);
                  setMode('login');
                }}
                type="button"
              >
                Back to sign in
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
