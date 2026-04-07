import { motion, useReducedMotion } from 'motion/react';
import { SignupBrandPanel } from './SignupBrandPanel';
import { SignupFormCard } from './SignupFormCard';
import { SignupSuccessCard } from './SignupSuccessCard';
import { useSignupFlow } from '../../hooks/useSignupFlow';

export function SignupScreen() {
  const prefersReducedMotion = useReducedMotion();
  const signup = useSignupFlow();

  return (
    <div className="min-h-screen flex bg-navy-900">
      <SignupBrandPanel />

      <div className="w-full lg:w-3/5 flex items-start justify-center p-6 bg-slate-50 overflow-y-auto">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
          animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
          className="w-full max-w-lg py-8"
        >
          {signup.registeredCode ? (
            <SignupSuccessCard
              codeCopied={signup.codeCopied}
              registeredCode={signup.registeredCode}
              onContinue={signup.continueToLogin}
              onCopy={signup.copyRegisteredCode}
            />
          ) : (
            <>
              <div className="lg:hidden text-center mb-8">
                <h1 className="text-3xl font-bold tracking-tight text-navy-900">OptiCapture</h1>
                <p className="text-slate-500 mt-1">Create your store account</p>
              </div>

              <SignupFormCard
                error={signup.error}
                errors={signup.errors}
                formData={signup.formData}
                isGooglePrefilled={signup.isGooglePrefilled}
                isSubmitting={signup.isSubmitting}
                onFieldChange={signup.handleFieldChange}
                onGoogleSignup={signup.startGoogleSignup}
                onPhoneChange={signup.handlePhoneChange}
                onSubmit={signup.handleSubmit}
                onZipcodeChange={signup.handleZipcodeChange}
              />
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
