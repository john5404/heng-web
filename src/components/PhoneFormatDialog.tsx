"use client";

import { useEffect, useRef } from "react";

type Props = {
  message: string;
  onDismiss: () => void;
};

/** Modal for a bad 登記訂單 phone. Dismissing only closes the dialog. */
export function PhoneFormatDialog({ message, onDismiss }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      closing.current = true;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="phone-dialog"
      aria-modal="true"
      aria-labelledby="phone-format-title"
      onClose={() => {
        if (closing.current) return;
        onDismiss();
      }}
    >
      <h2 id="phone-format-title" className="phone-dialog-title">
        {message}
      </h2>
      <button type="button" className="phone-dialog-dismiss" autoFocus onClick={onDismiss}>
        確定
      </button>
    </dialog>
  );
}

type ConfirmProps = {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Same dialog as the phone warning, with 確定 and 取消. */
export function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      closing.current = true;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="phone-dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      onClose={() => {
        if (closing.current) return;
        onCancel();
      }}
    >
      <h2 id="confirm-delete-title" className="phone-dialog-title">
        {message}
      </h2>
      <div className="phone-dialog-actions">
        <button type="button" className="phone-dialog-dismiss" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="phone-dialog-dismiss" autoFocus onClick={onConfirm}>
          確定
        </button>
      </div>
    </dialog>
  );
}
