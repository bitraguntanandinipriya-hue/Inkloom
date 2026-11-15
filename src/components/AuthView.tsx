import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Eye, EyeOff, KeyRound, Mail, ArrowRight } from 'lucide-react';
import { api, ApiError } from '../lib/api';
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

  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api.getAuthConfig().then((cfg) => {
      setGoogleClientId(cfg.googleClientId);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!googleClientId || mode === 'reset' || !googleBtnRef.current) return;
    const scriptId = 'google-gsi-client';
    const initGsi = () => {
      const g = (window as unknown as {
        google?: {
          accounts: {
            id: {
              initialize: (opts: unknown) => void;
              renderButton: (el: HTMLElement, opts: unknown) => void;
            };
          };
        };
      }).google;
      if (!g || !googleBtnRef.current) return;
      g.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response: { credential?: string }) => {
          if (!response.credential) return;
          setLoading(true);
          setError(null);
          try {
            const { user } = await api.googleSignIn(response.credential);
            onAuthenticated(user);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Google Sign-In failed');
          } finally {
            setLoading(false);
          }
        },
      });
      g.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline',
        size: 'large',
        width: '100%',
      });
    };

    if (document.getElementById(scriptId)) {
      initGsi();
      return;
    }
    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = initGsi;
    document.head.appendChild(script);
  }, [googleClientId, mode, onAuthenticated]);

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
              {googleClientId ? (
                <div ref={googleBtnRef} className="w-full flex justify-center" />
              ) : (
                <p className="text-xs text-[var(--ink-text-muted)] text-center">
                  Google Sign-In activates automatically when <span className="font-mono-tabular">VITE_GOOGLE_CLIENT_ID</span> is configured.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
