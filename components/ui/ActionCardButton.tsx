"use client";

import { Button } from "tdesign-react";
import type { ReactNode } from "react";

type ActionCardButtonProps = {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  "aria-current"?: "page";
};

export function ActionCardButton({
  children,
  className,
  disabled,
  onClick,
  "aria-current": ariaCurrent
}: ActionCardButtonProps) {
  return (
    <Button
      block
      aria-current={ariaCurrent}
      className={className}
      disabled={disabled}
      onClick={onClick}
      theme="default"
      type="button"
      variant="text"
    >
      {children}
    </Button>
  );
}
