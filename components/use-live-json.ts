"use client";

import { useEffect, useState } from "react";

export function useLiveJson<T>(url: string, shouldPoll: (data: T) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const response = await fetch(url, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
        if (cancelled) return;
        if (!response.ok || !body) {
          setError(body?.error ?? "The page could not load this data.");
          setLoading(false);
          return;
        }
        setData(body);
        setError(null);
        setLoading(false);
        if (shouldPoll(body)) timer = setTimeout(load, 1000);
      } catch {
        if (cancelled) return;
        setError("The page could not reach the scanner.");
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [url, attempt, shouldPoll]);

  return {
    data,
    error,
    loading,
    retry() {
      setLoading(true);
      setError(null);
      setAttempt((value) => value + 1);
    },
  };
}
