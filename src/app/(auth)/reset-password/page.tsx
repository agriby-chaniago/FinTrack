"use client";

import { useActionState } from "react";

import { updatePassword, type AuthFormState } from "../actions";
import { AuthCard, Field, FormStatus, SubmitButton } from "../ui";

export default function ResetPasswordPage() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(updatePassword, {});

  return (
    <AuthCard title="Buat password baru">
      <form action={action} className="space-y-4">
        <Field label="Password baru" name="password" type="password" autoComplete="new-password" />
        <Field label="Ulangi password baru" name="confirmation" type="password" autoComplete="new-password" />
        <p className="text-sm text-muted">Minimal 12 karakter.</p>
        <FormStatus {...state} />
        <SubmitButton pending={pending}>Simpan password</SubmitButton>
      </form>
    </AuthCard>
  );
}
