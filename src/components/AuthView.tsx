import React, { useState } from 'react';
import { BookOpen, Eye, EyeOff, KeyRound, Mail, ArrowRight } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { formatReadableFirestoreError, useFirebase } from '../lib/FirebaseContext';
import type { UserProfile } from '../types';

interface AuthViewProps {
  onAuthenticated: (user: UserProfile) => void;
}

export const AuthView: React.FC<AuthViewProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Password reset state
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetRequested, setResetRequested] = useState(false);
  const [issuedLocalToken, setIssuedLocalToken] = useState<string | null>(null);

  const { signInWithGoogle } = useFirebase();

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setError(null);
    setNotice(null);
    setGoogleLoading(true);
    try {
      const user = await signInWithGoogle();
      onAuthenticated(user);
    } catch (err) {
      const msg = formatReadableFirestoreError(err);
      if (msg.includes('popup-closed-by-user')) {
        setError('Google sign-in popup was closed before completing.');
      } else {
        setError(msg);
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        const { user } = await api.login(email, password);
        onAuthenticated(user);
      } else if (mode === 'register') {
        const { user } = await api.register(email, password, name);
        onAuthenticated(user);
      } else if (!resetRequested) {
        const res = await api.requestPasswordReset(email);
        setResetRequested(true);
        setIssuedLocalToken(res.localResetToken);
        if (res.localResetToken) setResetToken(res.localResetToken);
        setNotice(res.message);
      } else {
        const res = await api.completePasswordReset(resetToken, newPassword);
        setNotice(res.message);
        setMode('login');
        setResetRequested(false);
        setIssuedLocalToken(null);
        setPassword('');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Request failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--ink-bg)] text-[var(--ink-text)] flex flex-col lg:flex-row">
      {/* Left Editorial Column */}
      <div className="lg:w-1/2 p-8 sm:p-12 lg:p-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-[var(--ink-border)]">
        <div className="flex items-center gap-2.5">
          <BookOpen className="w-5 h-5 text-[var(--ink-accent)]" />
          <span className="text-lg font-semibold tracking-tight">Inkloom</span>
        </div>

        <div className="my-12 max-w-xl">
          <p className="text-xs font-medium tracking-wider text-[var(--ink-accent)] mb-4">
            Long-Form Novel Studio
          </p>
          <h1 className="font-lora text-3xl sm:text-4xl lg:text-5xl font-semibold leading-tight tracking-tight mb-6 text-balance">
            Write novels with living continuity and author-owned canon.
          </h1>
          <p className="text-base text-[var(--ink-text-muted)] leading-relaxed mb-8">
            Build deep character psychology, manage a three-layer Story Bible, draft full chapters with streaming AI co-authoring, and keep every revision editable offline or in the cloud.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6 border-t border-[var(--ink-border)] text-sm">
            <div>
              <p className="font-medium mb-1">Three-Layer Story Bible</p>
              <p className="text-[var(--ink-text-muted)] text-xs leading-relaxed">
                Story DNA, author-approved Pinned Canon, and chronologically retrieved chapter summaries.
              </p>
            </div>
            <div>
              <p className="font-medium mb-1">Full Revision Control</p>
              <p className="text-[var(--ink-text-muted)] text-xs leading-relaxed">
                Confirmed chapters stay editable, versioned, recoverable from Trash, and exportable to DOCX.
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-[var(--ink-text-muted)]">
          Multi-provider AI · Local-first draft recovery · Private encrypted credentials
        </p>
      </div>

      {/* Right Auth Form Column */}
      <div className="lg:w-1/2 p-8 sm:p-12 lg:p-16 flex items-center justify-center">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-6 border-b border-[var(--ink-border)] mb-8">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                setNotice(null);
              }}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                mode === 'login'
                  ? 'border-[var(--ink-accent)] text-[var(--ink-text)]'
                  : 'border-transparent text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
                setNotice(null);
              }}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                mode === 'register'
                  ? 'border-[var(--ink-accent)] text-[var(--ink-text)]'
                  : 'border-transparent text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]'
              }`}
            >
              Create Account
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('reset');
                setResetRequested(false);
                setError(null);
                setNotice(null);
              }}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                mode === 'reset'
                  ? 'border-[var(--ink-accent)] text-[var(--ink-text)]'
                  : 'border-transparent text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]'
              }`}
            >
              Reset Password
            </button>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mb-2">
            {mode === 'login'
              ? 'Welcome back to your desk'
              : mode === 'register'
                ? 'Start your novel workspace'
                : 'Recover account access'}
          </h2>
          <p className="text-sm text-[var(--ink-text-muted)] mb-6">
            {mode === 'login'
              ? 'Sign in to access your manuscripts, Story Bibles, and encrypted provider keys.'
              : mode === 'register'
                ? 'Your novels, character portraits, and drafts are privately isolated to your account.'
                : 'Request a single-use recovery token to update your password.'}
          </p>

          {error && (
            <div className="mb-5 p-3.5 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {notice && (
            <div className="mb-5 p-3.5 rounded-lg border border-[var(--ink-accent)]/40 bg-[var(--ink-accent)]/10 text-sm">
              <p>{notice}</p>
              {issuedLocalToken && (
                <p className="mt-2 font-mono-tabular text-xs break-all text-[var(--ink-text-muted)]">
                  Recovery Token: {issuedLocalToken}
                </p>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1.5">
                  Author Name / Pen Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Elena Vance"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm focus:outline-none focus:border-[var(--ink-accent)]"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[var(--ink-text-muted)] absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="author@domain.com"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm focus:outline-none focus:border-[var(--ink-accent)]"
                />
              </div>
            </div>

            {mode !== 'reset' && (
              <div>
                <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-[var(--ink-text-muted)] absolute left-3.5 top-3" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full pl-10 pr-10 py-2.5 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm focus:outline-none focus:border-[var(--ink-accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-2.5 text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {mode === 'reset' && resetRequested && (
              <>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1.5">
                    Reset Token
                  </label>
                  <input
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    placeholder="Paste recovery token"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm font-mono-tabular focus:outline-none focus:border-[var(--ink-accent)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1.5">
                    New Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm focus:outline-none focus:border-[var(--ink-accent)]"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-[var(--ink-accent)] hover:bg-[var(--ink-accent-hover)] text-white font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <span>
                {loading
                  ? 'Working...'
                  : mode === 'login'
                    ? 'Sign In'
                    : mode === 'register'
                      ? 'Create Account'
                      : resetRequested
                        ? 'Update Password'
                        : 'Generate Recovery Token'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {mode !== 'reset' && (
            <div className="mt-6 pt-6 border-t border-[var(--ink-border)]">
              <button
                type="button"
                disabled={loading || googleLoading}
                onClick={handleGoogleSignIn}
                className="w-full py-2.5 px-4 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-surface)] hover:border-[var(--ink-accent)] text-sm font-medium transition-colors flex items-center justify-center gap-2.5 disabled:opacity-60"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                  />
                </svg>
                <span>{googleLoading ? 'Connecting to Google...' : 'Continue with Google'}</span>
              </button>
              <p className="text-[11px] text-[var(--ink-text-muted)] text-center mt-2.5">
                Syncs manuscripts and Story Bibles securely with Cloud Firestore.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
