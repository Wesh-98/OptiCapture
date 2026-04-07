import { Check, Copy } from 'lucide-react';

interface SignupSuccessCardProps {
  codeCopied: boolean;
  registeredCode: string;
  onContinue: () => void;
  onCopy: () => void;
}

export function SignupSuccessCard({
  codeCopied,
  registeredCode,
  onContinue,
  onCopy,
}: SignupSuccessCardProps) {
  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
        <Check size={32} className="text-emerald-600" />
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-1">Store Created!</h2>
      <p className="text-slate-500 text-sm mb-6">
        Save your store code, you'll need it every time you log in.
      </p>

      <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-xl p-5 mb-6">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
          Your Store Code
        </p>
        <p className="text-4xl font-mono font-bold tracking-[0.3em] text-navy-900">
          {registeredCode}
        </p>
      </div>

      <button
        type="button"
        onClick={onCopy}
        className="flex items-center gap-2 mx-auto mb-6 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700 transition-colors"
      >
        {codeCopied ? (
          <>
            <Check size={15} className="text-emerald-600" /> Copied!
          </>
        ) : (
          <>
            <Copy size={15} /> Copy Code
          </>
        )}
      </button>

      <p className="text-xs text-slate-400 mb-6">
        Share this code with your staff so they can log in to your store.
      </p>

      <button
        type="button"
        onClick={onContinue}
        className="w-full py-2.5 rounded-xl font-semibold text-white bg-navy-900 hover:bg-navy-800 transition-colors text-sm"
      >
        Continue to Login
      </button>
    </div>
  );
}
