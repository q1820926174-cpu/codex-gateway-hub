"use client";

import {
  createElement,
  forwardRef,
  type ChangeEventHandler
} from "react";

type HiddenFileInputProps = {
  accept?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
};

export const HiddenFileInput = forwardRef<HTMLInputElement, HiddenFileInputProps>(
  function HiddenFileInput({ accept, onChange }, ref) {
    return createElement("input", {
      ref,
      type: "file",
      accept,
      style: { display: "none" },
      onChange
    });
  }
);
