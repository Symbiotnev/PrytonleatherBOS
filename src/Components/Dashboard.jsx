import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home,
  Briefcase,
  Store,
  Users,
  BarChart3,
  LogOut,
  ChevronDown,
  Footprints,
  RefreshCw,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { collection, getCountFromServer } from 'firebase/firestore';
import { auth, db } from '../Libs/firebase_config.mjs';

import Operations from './Operations';
import Staff from './Staff';
import Stores from './Stores';
import Reports from './Reports';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const LOGO_URL =
  'https://res.cloudinary.com/dpymwa41m/image/upload/v1791009844/pryton_chttb0.jpg';

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'operations', label: 'Operations', icon: Briefcase },
  { id: 'staff', label: 'Staff', icon: Users },
  { id: 'stores', label: 'Stores', icon: Store },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const getInitials = (nameOrEmail) => {
  if (!nameOrEmail) return '?';
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail;
  const parts = base.trim().split(/[\s.]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const statCardVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

const HeroCurve = () => (
  <svg
    className="pointer-events-none absolute inset-x-0 -bottom-px h-9 w-full sm:h-11"
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
      stroke="rgba(255,255,255,0.5)"
      strokeWidth="2"
      strokeDasharray="5 7"
      strokeLinecap="round"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 1.3, ease: 'easeInOut', delay: 0.3 }}
    />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function Dashboard({ user, onNotify }) {
  const notify = onNotify || (() => {});

  const [activeNav, setActiveNav] = useState('home');
  const [profileOpen, setProfileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Store count via a server-side aggregation (no documents transferred),
  // fetched on mount and whenever the admin returns to Home.
  const [storeCount, setStoreCount] = useState(null);
  const [staffCount, setStaffCount] = useState(null);
  const [countsLoading, setCountsLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    setCountsLoading(true);
    try {
      const [storesSnap, staffSnap] = await Promise.all([
        getCountFromServer(collection(db, 'stores')),
        getCountFromServer(collection(db, 'staff')),
      ]);
      setStoreCount(storesSnap.data().count);
      setStaffCount(staffSnap.data().count);
    } catch (err) {
      notify({ type: 'error', message: 'Could not load counts.' });
    } finally {
      setCountsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeNav === 'home') fetchCounts();
  }, [activeNav, fetchCounts]);

  const fullName = user?.displayName || user?.email?.split('@')[0] || 'there';
  const firstName = fullName.split(' ')[0];
  const initials = useMemo(
    () => getInitials(user?.displayName || user?.email),
    [user]
  );

  const handleSignOut = async () => {
    setSigningOut(true);
    setProfileOpen(false);
    try {
      notify({ type: 'success', message: `See you soon, ${firstName}!` });
      await signOut(auth);
      // App.js listens for auth state changes and routes back to <Auth />.
    } catch {
      setSigningOut(false);
    }
  };

  const statCards = [
    { label: 'Operations', value: 'Manage operations', icon: Briefcase, nav: 'operations' },
    {
      label: 'Team members',
      value: staffCount === null ? '—' : staffCount,
      icon: Users,
      nav: 'staff',
    },
    {
      label: 'Active stores',
      value: storeCount === null ? '—' : storeCount,
      icon: Store,
      nav: 'stores',
    },
    { label: 'Reports', value: 'View reports', icon: BarChart3, nav: 'reports' },
  ];

  const renderActiveView = () => {
    switch (activeNav) {
      case 'operations':
        return <Operations onNotify={notify} currentUser={user} />;
      case 'staff':
        return <Staff onNotify={notify} currentUser={user} />;
      case 'stores':
        return <Stores onNotify={notify} currentUser={user} />;
      case 'reports':
        return <Reports onNotify={notify} currentUser={user} />;
      default:
        return null; // 'home' is rendered inline below
    }
  };

  return (
    <div
      className="min-h-screen w-full bg-[#FBF8F3] [min-height:100dvh]"
      style={{
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Top navbar */}
      <header
        className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#E4EBF1] bg-white/90 px-4 backdrop-blur-md sm:px-6"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-[#E4EBF1]">
            <img
              src={LOGO_URL}
              alt="Pryton Leather logo"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="hidden leading-tight sm:block">
            <p className="text-sm font-semibold text-[#16324F]">Pryton Leather</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-[#16324F]">
              BOS · Business Operating Software
            </p>
          </div>
        </div>

        {/* Profile */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setProfileOpen((o) => !o)}
            className="flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-2.5 transition-colors hover:bg-[#1E6BA8]/[0.06] sm:pr-3"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 20 }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1B4F80] to-[#2C7CB8] text-xs font-semibold text-white shadow-sm shadow-[#1E6BA8]/30"
            >
              {initials}
            </motion.div>
            <div className="hidden text-left sm:block">
              <p className="max-w-[10rem] truncate text-sm font-medium text-[#16324F]">
                {fullName}
              </p>
              <p className="text-[11px] font-medium text-[#16324F]">Admin</p>
            </div>
            <motion.span
              animate={{ rotate: profileOpen ? 180 : 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="text-[#9FB4C7]"
            >
              <ChevronDown size={16} />
            </motion.span>
          </button>

          <AnimatePresence>
            {profileOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setProfileOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-2xl border border-[#E4EBF1] bg-white shadow-xl shadow-black/5"
                >
                  <div className="flex items-center gap-3 border-b border-[#EFEAE0] px-4 py-3.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1B4F80] to-[#2C7CB8] text-xs font-semibold text-white">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#16324F]">
                        {fullName}
                      </p>
                      <p className="truncate text-xs text-[#16324F]">{user?.email}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="flex w-full items-center gap-2.5 px-4 py-3 text-sm font-medium text-[#B3413B] transition-colors hover:bg-[#B3413B]/[0.06] disabled:opacity-60"
                  >
                    <LogOut size={16} />
                    {signingOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar — desktop only */}
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 flex-col justify-between overflow-hidden border-r border-[#0F3355]/40 bg-gradient-to-b from-[#0F3355] via-[#163F68] to-[#1B4F80] px-3 py-6 lg:flex">
          <div className="pointer-events-none absolute -right-10 top-16 h-40 w-40 rounded-full bg-white/5 blur-3xl" />
          {/* flex-1 + justify-evenly: the nav claims all the height above the
              footer note and spreads the five items evenly down it, so there
              is no empty block below Reports on any screen height. */}
          <nav className="relative flex min-h-0 flex-1 flex-col justify-evenly pb-4">
            {NAV_ITEMS.map((item) => {
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className="relative flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-[15px] font-medium transition-colors hover:text-white"
                  style={{ color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.55)' }}
                >
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active-pill"
                      className="absolute inset-0 rounded-xl bg-white/10 ring-1 ring-white/15"
                      transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                    />
                  )}
                  <item.icon size={20} className="relative z-10 shrink-0" />
                  <span className="relative z-10">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="relative rounded-xl border border-dashed border-white/15 px-3.5 py-3 text-[11px] leading-relaxed text-white/45">
            Pryton Leather BOS — handcrafted for the team.
          </div>
        </aside>

        {/* Main content */}
        <main className="min-h-[calc(100dvh-4rem)] w-full flex-1 px-5 py-8 pb-28 sm:px-8 sm:py-10 lg:pb-10">
          {activeNav === 'home' ? (
            <>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0F3355] via-[#1B4F80] to-[#2C7CB8] px-6 pb-14 pt-8 text-white sm:px-10 sm:pb-16 sm:pt-11"
              >
                <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-16 left-10 h-48 w-48 rounded-full bg-[#8FD3FF]/10 blur-3xl" />

                <div className="relative flex items-center gap-2 text-white/70">
                  <Footprints size={18} />
                  <span className="text-xs font-medium uppercase tracking-[0.2em]">
                    Welcome back
                  </span>
                </div>
                <h1 className="relative mt-2 max-w-xl text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
                  Welcome, {fullName}{' '}
                  <span className="text-[#8FD3FF]">to Pryton Leather BOS</span>
                </h1>
                <p className="relative mt-2 max-w-md text-sm text-white/70">
                  Here's a quick look at where things stand across the business
                  today.
                </p>

                <HeroCurve />
              </motion.div>

              <div className="mt-6 flex items-center justify-between sm:mt-8">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#8496A6]">
                  Quick stats
                </p>
                <button
                  type="button"
                  onClick={fetchCounts}
                  disabled={countsLoading}
                  title="Refresh counts"
                  className="flex items-center gap-1.5 rounded-full border border-[#E4EBF1] bg-white px-3 py-1.5 text-xs font-medium text-[#6B7C8C] transition-colors hover:border-[#1E6BA8] hover:text-[#1E6BA8] disabled:opacity-60"
                >
                  <motion.span
                    animate={countsLoading ? { rotate: 360 } : { rotate: 0 }}
                    transition={countsLoading ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : {}}
                  >
                    <RefreshCw size={12} />
                  </motion.span>
                  Refresh
                </button>
              </div>
              <motion.div
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } }}
                className="mt-3 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
              >
                {statCards.map((stat) => (
                  <motion.div
                    key={stat.label}
                    variants={statCardVariants}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    onClick={() => setActiveNav(stat.nav)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setActiveNav(stat.nav);
                    }}
                    className="cursor-pointer rounded-2xl border border-[#E4EBF1] bg-white p-4 shadow-sm shadow-black/[0.02] transition-shadow hover:shadow-md sm:p-5"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1E6BA8]/[0.08] text-[#1E6BA8]">
                      <stat.icon size={17} />
                    </div>
                    <p className="mt-3 text-xl font-semibold text-[#16324F]">
                      {stat.value}
                    </p>
                    <p className="text-xs font-medium text-[#16324F]">{stat.label}</p>
                  </motion.div>
                ))}
              </motion.div>
            </>
          ) : (
            renderActiveView()
          )}
        </main>
      </div>

      {/* Bottom bar — mobile only */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-[#E4EBF1] bg-white/95 px-1 backdrop-blur-md lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveNav(item.id)}
              className="relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium"
            >
              {isActive && (
                <motion.div
                  layoutId="bottombar-active-pill"
                  className="absolute top-1 h-8 w-8 rounded-full bg-[#1E6BA8]/10"
                  transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                />
              )}
              <item.icon
                size={18}
                className="relative z-10"
                style={{ color: isActive ? '#1E6BA8' : '#9FB4C7' }}
              />
              <span
                className="relative z-10"
                style={{ color: isActive ? '#1E6BA8' : '#16324F' }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}