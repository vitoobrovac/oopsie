"use client";

import { useEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from "react";

type ModalProps = {
  titleId: string;
  pending?: boolean;
  onClose: () => void;
  children: ReactNode;
};

const position = {
  center: "fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl",
  sheet: "fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none rounded-t-2xl sm:inset-0 sm:m-auto sm:max-w-md sm:rounded-2xl",
  menu: "fixed inset-x-0 top-4 bottom-auto mx-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl",
};

function isBackdrop(event: PointerEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  const { left, top, right, bottom } = event.currentTarget.getBoundingClientRect();
  return event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom;
}

export function dismissModal(event: MouseEvent<HTMLElement>) {
  event.currentTarget.closest("dialog")?.close();
}

export function Modal({ titleId, onClose, pending = false, children, placement = "center" }:
  ModalProps & { placement?: keyof typeof position }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPointer = useRef<number | null>(null);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  function close() {
    if (!pending) dialog.current?.close();
  }

  return (
    <dialog ref={dialog} aria-labelledby={titleId} onClose={onClose}
      onCancel={(event) => { if (pending) event.preventDefault(); }}
      onPointerDown={(event) => {
        backdropPointer.current = event.button === 0 && isBackdrop(event) ? event.pointerId : null;
      }}
      onPointerUp={(event) => {
        if (backdropPointer.current === event.pointerId && isBackdrop(event)) close();
        backdropPointer.current = null;
      }}
      onPointerCancel={() => { backdropPointer.current = null; }}
      className={position[placement] + " max-h-[90dvh] overflow-y-auto bg-white p-5 text-[#17211c] shadow-2xl backdrop:bg-[#122218]/45"}>
      {children}
    </dialog>
  );
}
