"use client";

import "tdesign-react/es/_util/react-19-adapter";
import { LocaleProvider } from "@/components/locale-provider";

type ClientProvidersProps = {
  children: React.ReactNode;
};

export function ClientProviders({ children }: ClientProvidersProps) {
  return <LocaleProvider>{children}</LocaleProvider>;
}
