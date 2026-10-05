import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Toast — fixed, top-center notification.                            */
/*  Pass `toast` as either null or { type: 'success' | 'error', message }*/
/*  Auto-dismisses after `duration` ms (default 3200ms); `onClose`      */
/*  is also wired to a manual close button.                            */
/* ------------------------------------------------------------------ */

export default function Toast({ toast, onClose, duration = 3200 }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [toast, duration, onClose]);

  const isSuccess = toast?.type !== 'error';

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4 sm:top-6">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.message}
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-full border bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm sm:px-5"
            style={{
              borderColor: isSuccess ? '#BFE0CE' : '#F1C4C1',
              boxShadow: isSuccess
                ? '0 12px 28px -10px rgba(30,168,107,0.35)'
                : '0 12px 28px -10px rgba(179,65,59,0.35)',
            }}
            role="status"
          >
            <motion.span
              initial={{ scale: 0.6, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.05 }}
              className="flex shrink-0"
              style={{ color: isSuccess ? '#1EA86B' : '#B3413B' }}
            >
              {isSuccess ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
            </motion.span>

            <p className="text-sm font-medium leading-snug text-[#16324F]">
              {toast.message}
            </p>

            <button
              type="button"
              onClick={onClose}
              className="-m-1.5 shrink-0 rounded-full p-1.5 text-[#9FB4C7] transition-colors hover:text-[#16324F]"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}