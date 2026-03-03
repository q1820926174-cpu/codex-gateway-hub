"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type LocaleCode = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = "gateway_console_locale";
const LOCALE_COOKIE_KEY = "gateway_console_locale";
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type LocaleContextValue = {
  locale: LocaleCode;
  setLocale: (value: LocaleCode) => void;
  t: (zh: string, en: string) => string;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: "zh-CN",
  setLocale: () => {},
  t: (zh) => zh
});

function normalizeLocale(value: string | null | undefined): LocaleCode {
  if (!value) {
    return "zh-CN";
  }
  const next = value.toLowerCase();
  if (next.startsWith("en")) {
    return "en-US";
  }
  return "zh-CN";
}

function readLocaleFromCookie() {
  if (typeof document === "undefined") {
    return null;
  }
  const entries = document.cookie.split(";").map((item) => item.trim());
  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    const [key, ...rest] = entry.split("=");
    if (key !== LOCALE_COOKIE_KEY) {
      continue;
    }
    const value = rest.join("=");
    if (!value) {
      continue;
    }
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function writeLocaleCookie(value: LocaleCode) {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = `${LOCALE_COOKIE_KEY}=${encodeURIComponent(value)};path=/;max-age=${LOCALE_COOKIE_MAX_AGE};SameSite=Lax`;
}

type LocaleProviderProps = {
  children: React.ReactNode;
};

export function LocaleProvider({ children }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<LocaleCode>("zh-CN");

  useEffect(() => {
    const fromStorage =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LOCALE_STORAGE_KEY)
        : null;
    const fromCookie = readLocaleFromCookie();
    const browser = typeof navigator !== "undefined" ? navigator.language : "";
    const next = normalizeLocale(fromStorage || fromCookie || browser);
    setLocaleState(next);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    }
    writeLocaleCookie(locale);
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const contextValue = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale: (value) => setLocaleState(value),
      t: (zh, en) => (locale === "en-US" ? en : zh)
    }),
    [locale]
  );

  return <LocaleContext.Provider value={contextValue}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
