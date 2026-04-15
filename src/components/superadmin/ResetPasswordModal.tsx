import React from 'react';
import { KeyRound, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  username: string;
  tempPassword: string;
  prefersReducedMotion: boolean | null;
  onClose: () => void;
}

export function ResetPasswordModal({ username, tempPassword, prefersReducedMotion, onClose }: Props) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        initial={prefersReducedMotion ? false : { opacity: 0 }}
        animate={prefersReducedMotion ? {} : { opacity: 1 }}
        exit={prefersReducedMotion ? {} : { opacity: 0 }}
      >
        <motion.div
          className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm"
          initial={prefersReducedMotion ? false : { scale: 0.95, opacity: 0 }}
          animate={prefersReducedMotion ? {} : { scale: 1, opacity: 1 }}
          exit={prefersReducedMotion ? {} : { scale: 0.95, opacity: 0 }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <KeyRound size={18} className="text-amber-600" />
            </div>
            <div>
              <h3 className="font-bold text-navy-900">Temporary Password</h3>
              <p className="text-xs text-slate-500">For user: <span className="font-semibold">{username}</span></p>
            </div>
          </div>

          <p className="text-sm text-slate-600 mb-3">
            Share this password with the user. They will be prompted to change it right after signing in.
          </p>

          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-4">
            <code className="flex-1 font-mono text-lg font-bold text-navy-900 tracking-widest">{tempPassword}</code>
            <button
              onClick={() => navigator.clipboard.writeText(tempPassword)}
              className="p-1.5 text-slate-400 hover:text-navy-900 hover:bg-slate-200 rounded-lg transition-colors"
              title="Copy to clipboard"
            >
              <Copy size={16} />
            </button>
          </div>

          <p className="text-xs text-amber-600 mb-4 flex items-start gap-1.5">
            <span className="shrink-0 mt-0.5">⚠</span>
            This password will not be shown again. Copy it before closing.
          </p>

          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 bg-navy-900 text-white rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors"
          >
            Done
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
