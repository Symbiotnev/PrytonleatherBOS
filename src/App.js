import React, { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './Libs/firebase_config.mjs';
import Auth from './Components/Auth';
import Dashboard from './Components/Dashboard';
import Toast from './Components/Toast';

const LOGO_URL =
  'https://res.cloudinary.com/dpymwa41m/image/upload/v1791009844/pryton_chttb0.jpg';

/* ------------------------------------------------------------------ */
/*  LoadingScreen — shown once, only while Firebase resolves whether   */
/*  a session already exists. Kept subtle and brief on purpose.        */
/* ------------------------------------------------------------------ */

function LoadingScreen() {
  return (
    <motion.div
      key="loading"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-[#FBF8F3] [min-height:100dvh]"
    >
      <motion.div
        animate={{ scale: [1, 1.08, 1], opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-lg shadow-[#1E6BA8]/25"
      >
        <img
          src={LOGO_URL}
          alt="Pryton Leather logo"
          className="h-full w-full object-cover"
        />
      </motion.div>

      <motion.div
        className="h-1 w-28 overflow-hidden rounded-full bg-[#E4EBF1]"
        aria-hidden="true"
      >
        <motion.div
          className="h-full w-1/3 rounded-full bg-[#1E6BA8]"
          animate={{ x: ['-100%', '220%'] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
        />
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  App — Pryton Leather BOS                                            */
/* ------------------------------------------------------------------ */

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    // Fires once with the current session (or null), then on every
    // sign-in/sign-out — this drives routing between Auth and Dashboard.
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  const notify = useCallback((next) => setToast(next), []);
  const dismissToast = useCallback(() => setToast(null), []);

  return (
    <div className="App">
      <Toast toast={toast} onClose={dismissToast} />

      <AnimatePresence mode="wait">
        {authLoading ? (
          <LoadingScreen />
        ) : user ? (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            <Dashboard user={user} onNotify={notify} />
          </motion.div>
        ) : (
          <motion.div
            key="auth"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            <Auth onNotify={notify} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;