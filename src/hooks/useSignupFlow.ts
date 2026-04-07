import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  EMPTY_SIGNUP_FORM,
  type SignupField,
  type SignupFormData,
  validateSignupForm,
} from '../components/signup/types';
import { fetchPendingGoogleProfile, registerStore } from '../components/signup/signupApi';

const COPY_RESET_MS = 2000;

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useSignupFlow() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pendingKey = searchParams.get('pending');

  const [formData, setFormData] = useState<SignupFormData>(EMPTY_SIGNUP_FORM);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGooglePrefilled, setIsGooglePrefilled] = useState(false);
  const [registeredCode, setRegisteredCode] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        globalThis.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadPendingProfile = async () => {
      if (!pendingKey) {
        return;
      }

      try {
        const profile = await fetchPendingGoogleProfile(pendingKey);
        if (cancelled) {
          return;
        }

        setFormData(prev => ({
          ...prev,
          email: profile.email || prev.email,
          storeName: profile.name || prev.storeName,
        }));
        setIsGooglePrefilled(true);
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError, 'Could not load Google signup details.'));
        }
      }
    };

    void loadPendingProfile();

    return () => {
      cancelled = true;
    };
  }, [pendingKey]);

  const handleFieldChange = useCallback((field: SignupField, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => {
      if (!prev[field]) {
        return prev;
      }

      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const handleZipcodeChange = useCallback(
    (value: string) => {
      handleFieldChange('zipcode', value.replaceAll(/[^\d-]/g, '').slice(0, 10));
    },
    [handleFieldChange]
  );

  const handlePhoneChange = useCallback(
    (value: string) => {
      handleFieldChange('phone', value.replaceAll(/\D/g, '').slice(0, 10));
    },
    [handleFieldChange]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError('');

      const nextErrors = validateSignupForm(formData, isGooglePrefilled);
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      setErrors({});
      setIsSubmitting(true);

      try {
        const result = await registerStore(formData, pendingKey);
        if (result.redirect) {
          navigate(result.redirect);
          return;
        }

        setRegisteredCode(result.storeCode ?? null);
      } catch (submitError) {
        setError(getErrorMessage(submitError, 'Registration failed. Please try again.'));
      } finally {
        setIsSubmitting(false);
      }
    },
    [formData, isGooglePrefilled, navigate, pendingKey]
  );

  const copyRegisteredCode = useCallback(async () => {
    if (!registeredCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(registeredCode);
      setCodeCopied(true);

      if (copyTimerRef.current) {
        globalThis.clearTimeout(copyTimerRef.current);
      }

      copyTimerRef.current = globalThis.setTimeout(() => setCodeCopied(false), COPY_RESET_MS);
    } catch {
      setError('Could not copy store code.');
    }
  }, [registeredCode]);

  const continueToLogin = useCallback(() => {
    navigate('/login');
  }, [navigate]);

  const startGoogleSignup = useCallback(() => {
    globalThis.location.href = '/api/auth/google?intent=signup';
  }, []);

  return {
    formData,
    error,
    errors,
    isSubmitting,
    isGooglePrefilled,
    registeredCode,
    codeCopied,
    handleFieldChange,
    handleZipcodeChange,
    handlePhoneChange,
    handleSubmit,
    copyRegisteredCode,
    continueToLogin,
    startGoogleSignup,
  };
}
