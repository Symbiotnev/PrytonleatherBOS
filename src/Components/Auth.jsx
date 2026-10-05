import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  Copy,
  Check,
  RefreshCw,
  Footprints,
  Loader2,
} from 'lucide-react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../Libs/firebase_config.mjs';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const LOGO_URL =
  'https://res.cloudinary.com/dpymwa41m/image/upload/v1791009844/pryton_chttb0.jpg';

const LOTTIE_SRC =
  'https://lottie.host/a7490252-7c01-4c46-97ea-35885e87c5d5/83WQAf9Lfz.json';

const EMAIL_DOMAIN = '@prytonleather.com';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const generateEmailFromName = (fullName) => {
  const parts = fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '';
  return `${parts.join('.')}${EMAIL_DOMAIN}`;
};

const generateSecurePassword = (length = 12) => {
  const charset =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
  if (window.crypto && window.crypto.getRandomValues) {
    const random = new Uint32Array(length);
    window.crypto.getRandomValues(random);
    return Array.from(random, (n) => charset[n % charset.length]).join('');
  }
  // Fallback (non-crypto) — only used if the Web Crypto API is unavailable
  let out = '';
  for (let i = 0; i < length; i++) {
    out += charset[Math.floor(Math.random() * charset.length)];
  }
  return out;
};

// Friendlier copy for the Firebase Auth error codes we're most likely to hit
const friendlyAuthError = (err) => {
  const code = err?.code || '';
  const map = {
    'auth/email-already-in-use': 'An account with that email already exists.',
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/weak-password': 'That password is too weak — try regenerating it.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts — please wait a moment and try again.',
    'auth/network-request-failed': 'Network error — check your connection and try again.',
    'permission-denied': 'Account created, but we could not save your profile. Please contact support.',
  };
  return map[code] || err?.message || 'Something went wrong. Please try again.';
};

// Prompts the browser (Chrome/Edge/etc.) to offer saving the credential to
// the user's Google Password Manager via the Credential Management API.
// This is separate from — and in addition to — the autoComplete attributes
// on the inputs, which are what Firefox/Safari rely on instead.
const offerToSaveCredential = async ({ id, password, name }) => {
  try {
    if (window.PasswordCredential) {
      const credential = new window.PasswordCredential({ id, password, name });
      await navigator.credentials.store(credential);
    }
  } catch {
    // Non-fatal, best-effort enhancement.
  }
};

/* ------------------------------------------------------------------ */
/*  Reusable pill-shaped input                                         */
/* ------------------------------------------------------------------ */

const FloatingField = ({
  id,
  label,
  icon: Icon,
  type = 'text',
  value,
  onChange,
  autoComplete,
  name,
  rightAdornment,
  required = true,
}) => {
  const [focused, setFocused] = useState(false);
  const isActive = focused || (value && value.length > 0);

  return (
    <div className="relative">
      <motion.label
        htmlFor={id}
        initial={false}
        animate={
          isActive
            ? { top: '-0.55rem', left: '2.6rem', fontSize: '0.7rem', color: '#1E6BA8' }
            : { top: '0.9rem', left: '3rem', fontSize: '0.95rem', color: '#8496A6' }
        }
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-none absolute z-10 select-none rounded-full bg-[#FBF8F3] px-1.5 font-medium tracking-wide"
        style={{ backgroundColor: isActive ? '#FBF8F3' : 'transparent' }}
      >
        {label}
      </motion.label>

      <motion.div
        animate={{
          borderColor: focused ? '#1E6BA8' : '#E4EBF1',
          boxShadow: focused
            ? '0 0 0 4px rgba(30,107,168,0.10)'
            : '0 0 0 0px rgba(30,107,168,0)',
        }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="flex items-center gap-3 rounded-full border-2 bg-white px-4 py-3 sm:px-5 sm:py-3.5"
      >
        <motion.span
          animate={{ scale: focused ? 1.12 : 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 15 }}
          className="flex shrink-0"
        >
          <Icon
            size={18}
            strokeWidth={2}
            className={`transition-colors duration-300 ${
              focused ? 'text-[#1E6BA8]' : 'text-[#9FB4C7]'
            }`}
          />
        </motion.span>
        <input
          id={id}
          name={name || id}
          type={type}
          value={value}
          onChange={onChange}
          required={required}
          autoComplete={autoComplete}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="w-full bg-transparent text-base text-[#16324F] outline-none placeholder-transparent sm:text-[15px]"
        />
        {rightAdornment}
      </motion.div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Decorative stitched curve dividers                                 */
/* ------------------------------------------------------------------ */

const StitchedCurveDesktop = () => (
  <svg
    className="pointer-events-none absolute -right-px top-0 hidden h-full w-24 lg:block"
    viewBox="0 0 100 800"
    preserveAspectRatio="none"
    fill="none"
  >
    <path
      d="M55,0 C85,90 25,180 55,270 C85,360 25,450 55,540 C85,630 25,710 55,800 L100,800 L100,0 Z"
      fill="#FBF8F3"
    />
    <motion.path
      d="M55,0 C85,90 25,180 55,270 C85,360 25,450 55,540 C85,630 25,710 55,800"
      stroke="#FFFFFF"
      strokeWidth="2"
      strokeDasharray="6 8"
      strokeLinecap="round"
      opacity="0.65"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 1.8, ease: 'easeInOut', delay: 0.2 }}
    />
  </svg>
);

const StitchedCurveMobile = () => (
  <svg
    className="pointer-events-none absolute -bottom-px left-0 block h-9 w-full lg:hidden"
    viewBox="0 0 800 60"
    preserveAspectRatio="none"
    fill="none"
  >
    <path
      d="M0,30 C100,60 200,0 300,30 C400,60 500,0 600,30 C700,60 750,15 800,32 L800,60 L0,60 Z"
      fill="#FBF8F3"
    />
    <motion.path
      d="M0,30 C100,60 200,0 300,30 C400,60 500,0 600,30 C700,60 750,15 800,32"
      stroke="#FFFFFF"
      strokeWidth="2"
      strokeDasharray="5 7"
      strokeLinecap="round"
      opacity="0.65"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 1.4, ease: 'easeInOut', delay: 0.15 }}
    />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function Auth({ onLogin, onSignup, onNotify }) {
  const notify = onNotify || (() => {});

  const [mode, setMode] = useState('login'); // 'login' | 'signup'

  // login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // signup state
  const [fullName, setFullName] = useState('');
  const [generatedEmail, setGeneratedEmail] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [showGeneratedPassword, setShowGeneratedPassword] = useState(false);
  const [copiedField, setCopiedField] = useState(null); // 'email' | 'password' | null

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // keep the generated email in sync with the name as they type
  useEffect(() => {
    const email = generateEmailFromName(fullName);
    setGeneratedEmail(email);
    if (email && !generatedPassword) {
      setGeneratedPassword(generateSecurePassword());
    }
    if (!email) {
      setGeneratedPassword('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullName]);

  const regeneratePassword = useCallback(() => {
    setGeneratedPassword(generateSecurePassword());
  }, []);

  const copyToClipboard = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1600);
    } catch {
      // clipboard access denied — fail silently
    }
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        loginEmail,
        loginPassword
      );

      offerToSaveCredential({
        id: loginEmail,
        password: loginPassword,
        name: credential.user.displayName || loginEmail,
      });

      notify({
        type: 'success',
        message: `Welcome back${credential.user.displayName ? `, ${credential.user.displayName.split(' ')[0]}` : ''}!`,
      });

      if (onLogin) {
        await onLogin({
          uid: credential.user.uid,
          email: loginEmail,
          password: loginPassword,
        });
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Admin-only signup. Matches the self-create branch of the `users`
  // rule: uid == auth uid, email == auth email, role == 'admin', and
  // keys include uid, fullName, email, role, createdAt.
  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!generatedEmail || !generatedPassword) {
      setError('Enter your full name so we can set up your account.');
      return;
    }
    setIsSubmitting(true);
    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        generatedEmail,
        generatedPassword
      );

      await updateProfile(credential.user, { displayName: fullName.trim() });

      await setDoc(doc(db, 'users', credential.user.uid), {
        uid: credential.user.uid,
        fullName: fullName.trim(),
        email: generatedEmail,
        role: 'admin',
        createdAt: serverTimestamp(),
      });

      offerToSaveCredential({
        id: generatedEmail,
        password: generatedPassword,
        name: fullName.trim(),
      });

      notify({
        type: 'success',
        message: `Account created — welcome, ${fullName.trim().split(' ')[0]}!`,
      });

      if (onSignup) {
        await onSignup({
          uid: credential.user.uid,
          fullName,
          email: generatedEmail,
          password: generatedPassword,
        });
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="flex min-h-screen w-full flex-col bg-[#FBF8F3] [min-height:100dvh] lg:flex-row"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Left panel — brand / lottie */}
      <div className="relative flex h-56 w-full shrink-0 flex-col overflow-hidden bg-gradient-to-br from-[#0F3355] via-[#1B4F80] to-[#2C7CB8] sm:h-72 lg:h-auto lg:w-[58%]">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-[#8FD3FF]/10 blur-3xl" />

        <div className="absolute left-5 top-5 z-20 flex items-center gap-2.5 lg:left-8 lg:top-8">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/95 shadow-lg shadow-black/10 lg:h-14 lg:w-14">
            <img
              src={LOGO_URL}
              alt="Pryton Leather logo"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="leading-tight text-white lg:hidden">
            <p className="text-[13px] font-semibold">Pryton Leather</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/60">
              BOS · Business Operating Software
            </p>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 flex flex-1 items-center justify-center p-3 pt-10 lg:p-10"
        >
          <div className="w-full max-w-[11rem] sm:max-w-xs lg:max-w-xl">
            <DotLottieReact src={LOTTIE_SRC} loop autoplay />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
          className="relative z-20 hidden pb-10 text-center lg:block"
        >
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            Pryton Leather <span className="text-[#8FD3FF]">BOS</span>
          </h2>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.2em] text-white/50">
            Business Operating Software
          </p>
        </motion.div>

        <div className="relative z-20 flex justify-center pb-3 lg:hidden">
          <div className="h-1 w-9 rounded-full bg-white/35" />
        </div>

        <StitchedCurveDesktop />
        <StitchedCurveMobile />
      </div>

      {/* Right panel — auth form */}
      <div className="relative flex flex-1 items-center justify-center px-5 py-8 sm:px-10 sm:py-12 lg:px-16">
        <div className="pointer-events-none absolute right-10 top-10 h-40 w-40 rounded-full bg-[#1E6BA8]/[0.05] blur-3xl" />
        <div className="pointer-events-none absolute bottom-10 left-10 h-52 w-52 rounded-full bg-[#1E6BA8]/[0.04] blur-3xl" />

        <motion.div layout className="relative w-full max-w-sm">
          {/* mode toggle */}
          <div className="relative mb-7 flex rounded-full bg-[#EFEAE0] p-1 sm:mb-10">
            {['login', 'signup'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError('');
                }}
                className="relative z-10 flex-1 rounded-full py-2.5 text-sm font-medium transition-colors duration-300"
                style={{ color: mode === m ? '#FFFFFF' : '#6B7C8C' }}
              >
                {mode === m && (
                  <motion.div
                    layoutId="auth-tab-pill"
                    className="absolute inset-0 -z-10 rounded-full bg-[#1E6BA8] shadow-md shadow-[#1E6BA8]/30"
                    transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                  />
                )}
                <motion.span
                  animate={{ scale: mode === m ? 1.03 : 1 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="inline-block"
                >
                  {m === 'login' ? 'Log in' : 'Sign up'}
                </motion.span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="popLayout" initial={false}>
            {mode === 'login' ? (
              <motion.form
                key="login"
                layout
                onSubmit={handleLoginSubmit}
                initial={{ opacity: 0, y: 10, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.985 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-7 sm:space-y-10"
              >
                <div>
                  <div className="mb-1 flex items-center gap-2 text-[#16324F]">
                    <Footprints size={20} className="text-[#1E6BA8]" />
                    <h1 className="text-xl font-semibold sm:text-2xl">Welcome back</h1>
                  </div>
                  <p className="text-sm text-[#8496A6]">
                    Sign in with your Pryton Leather admin account.
                  </p>
                </div>

                <div className="space-y-6 sm:space-y-7">
                  <FloatingField
                    id="login-email"
                    name="email"
                    label="Email"
                    icon={Mail}
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    autoComplete="username"
                  />
                  <FloatingField
                    id="login-password"
                    name="password"
                    label="Password"
                    icon={Lock}
                    type={showLoginPassword ? 'text' : 'password'}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    autoComplete="current-password"
                    rightAdornment={
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword((s) => !s)}
                        className="-m-2 shrink-0 rounded-full p-2 text-[#9FB4C7] transition-colors hover:text-[#1E6BA8] active:scale-90 active:bg-[#1E6BA8]/10"
                        aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span
                            key={showLoginPassword ? 'hide' : 'show'}
                            initial={{ opacity: 0, rotate: -8 }}
                            animate={{ opacity: 1, rotate: 0 }}
                            exit={{ opacity: 0, rotate: 8 }}
                            transition={{ duration: 0.18 }}
                            className="flex"
                          >
                            {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                          </motion.span>
                        </AnimatePresence>
                      </button>
                    }
                  />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span />
                  <button
                    type="button"
                    className="font-medium text-[#1E6BA8] transition-opacity hover:opacity-70"
                  >
                    Forgot password?
                  </button>
                </div>

                {error && (
                  <p className="text-sm text-[#B3413B]" role="alert">
                    {error}
                  </p>
                )}

                <motion.button
                  type="submit"
                  disabled={isSubmitting}
                  initial="rest"
                  whileHover="hover"
                  whileTap={{ scale: 0.97, y: 0 }}
                  variants={{
                    rest: { y: 0, boxShadow: '0 10px 25px -8px rgba(30,107,168,0.35)' },
                    hover: { y: -2, boxShadow: '0 16px 32px -8px rgba(30,107,168,0.45)' },
                  }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[#1E6BA8] py-3.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
                >
                  {isSubmitting && (
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                      className="flex"
                    >
                      <Loader2 size={16} />
                    </motion.span>
                  )}
                  {isSubmitting ? 'Signing in…' : 'Log in'}
                  {!isSubmitting && (
                    <motion.span
                      variants={{ rest: { x: 0 }, hover: { x: 3 } }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                      className="flex"
                    >
                      <ArrowRight size={16} />
                    </motion.span>
                  )}
                </motion.button>
              </motion.form>
            ) : (
              <motion.form
                key="signup"
                layout
                onSubmit={handleSignupSubmit}
                initial={{ opacity: 0, y: 10, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.985 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-6 sm:space-y-8"
              >
                <div>
                  <div className="mb-1 flex items-center gap-2 text-[#16324F]">
                    <Footprints size={20} className="text-[#1E6BA8]" />
                    <h1 className="text-xl font-semibold sm:text-2xl">Create your account</h1>
                  </div>
                  <p className="text-sm text-[#8496A6]">
                    Enter your name — we'll set up your admin email and password.
                  </p>
                </div>

                <FloatingField
                  id="signup-name"
                  name="name"
                  label="Full name"
                  icon={User}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                />

                {/* Hidden fields so form-based password managers (Firefox,
                    Safari) have something to associate with a save prompt. */}
                <input type="hidden" name="email" autoComplete="username" value={generatedEmail} readOnly />
                <input type="hidden" name="password" autoComplete="new-password" value={generatedPassword} readOnly />

                <AnimatePresence>
                  {generatedEmail && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.35, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-4 rounded-2xl border border-dashed border-[#BFD6E8] bg-[#1E6BA8]/[0.04] p-4 sm:p-5">
                        <p className="text-xs font-medium uppercase tracking-wide text-[#1E6BA8]">
                          Your admin credentials
                        </p>

                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[11px] text-[#8496A6]">Email</p>
                            <p className="truncate text-sm font-medium text-[#16324F]">
                              {generatedEmail}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(generatedEmail, 'email')}
                            className="-m-2 shrink-0 rounded-full p-2 text-[#9FB4C7] transition-colors hover:text-[#1E6BA8] active:scale-90 active:bg-[#1E6BA8]/10"
                            aria-label="Copy email"
                          >
                            {copiedField === 'email' ? (
                              <Check size={16} className="text-[#1E6BA8]" />
                            ) : (
                              <Copy size={16} />
                            )}
                          </button>
                        </div>

                        <div className="h-px w-full bg-[#DCE6EE]" />

                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[11px] text-[#8496A6]">Password</p>
                            <p className="truncate text-sm font-medium tracking-wide text-[#16324F]">
                              {showGeneratedPassword
                                ? generatedPassword
                                : '•'.repeat(Math.min(generatedPassword.length, 12))}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <motion.button
                              type="button"
                              onClick={regeneratePassword}
                              whileTap={{ rotate: 180, scale: 0.9 }}
                              transition={{ duration: 0.35, ease: 'easeInOut' }}
                              className="-m-2 rounded-full p-2 text-[#9FB4C7] transition-colors hover:text-[#1E6BA8] active:bg-[#1E6BA8]/10"
                              aria-label="Generate a new password"
                            >
                              <RefreshCw size={15} />
                            </motion.button>
                            <button
                              type="button"
                              onClick={() => setShowGeneratedPassword((s) => !s)}
                              className="-m-2 rounded-full p-2 text-[#9FB4C7] transition-colors hover:text-[#1E6BA8] active:scale-90 active:bg-[#1E6BA8]/10"
                              aria-label={showGeneratedPassword ? 'Hide password' : 'Show password'}
                            >
                              <AnimatePresence mode="wait" initial={false}>
                                <motion.span
                                  key={showGeneratedPassword ? 'hide' : 'show'}
                                  initial={{ opacity: 0, rotate: -8 }}
                                  animate={{ opacity: 1, rotate: 0 }}
                                  exit={{ opacity: 0, rotate: 8 }}
                                  transition={{ duration: 0.18 }}
                                  className="flex"
                                >
                                  {showGeneratedPassword ? (
                                    <EyeOff size={16} />
                                  ) : (
                                    <Eye size={16} />
                                  )}
                                </motion.span>
                              </AnimatePresence>
                            </button>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(generatedPassword, 'password')}
                              className="-m-2 shrink-0 rounded-full p-2 text-[#9FB4C7] transition-colors hover:text-[#1E6BA8] active:scale-90 active:bg-[#1E6BA8]/10"
                              aria-label="Copy password"
                            >
                              {copiedField === 'password' ? (
                                <Check size={16} className="text-[#1E6BA8]" />
                              ) : (
                                <Copy size={16} />
                              )}
                            </button>
                          </div>
                        </div>

                        <p className="text-[11px] leading-relaxed text-[#8496A6]">
                          Save these somewhere safe — you'll need them to log in
                          next time.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {error && (
                  <p className="text-sm text-[#B3413B]" role="alert">
                    {error}
                  </p>
                )}

                <motion.button
                  type="submit"
                  disabled={isSubmitting || !generatedEmail}
                  initial="rest"
                  whileHover="hover"
                  whileTap={{ scale: 0.97, y: 0 }}
                  variants={{
                    rest: { y: 0, boxShadow: '0 10px 25px -8px rgba(30,107,168,0.35)' },
                    hover: { y: -2, boxShadow: '0 16px 32px -8px rgba(30,107,168,0.45)' },
                  }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[#1E6BA8] py-3.5 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                >
                  {isSubmitting && (
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                      className="flex"
                    >
                      <Loader2 size={16} />
                    </motion.span>
                  )}
                  {isSubmitting ? 'Creating account…' : 'Create account'}
                  {!isSubmitting && (
                    <motion.span
                      variants={{ rest: { x: 0 }, hover: { x: 3 } }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                      className="flex"
                    >
                      <ArrowRight size={16} />
                    </motion.span>
                  )}
                </motion.button>
              </motion.form>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}