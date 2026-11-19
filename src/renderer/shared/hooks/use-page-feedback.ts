import { useState } from "react";

/**
 * Keeps a page's error/success banners mutually exclusive.
 */
export function usePageFeedback() {
  const [error, setErrorState] = useState<string | null>(null);
  const [success, setSuccessState] = useState<string | null>(null);

  return {
    error,
    success,
    setError: (message: string | null) => {
      setSuccessState(null);
      setErrorState(message);
    },
    setSuccess: (message: string | null) => {
      setErrorState(null);
      setSuccessState(message);
    },
    clear: () => {
      setErrorState(null);
      setSuccessState(null);
    }
  };
}
