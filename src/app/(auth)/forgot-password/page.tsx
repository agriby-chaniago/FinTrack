"use client";

import Link from "next/link";
import { useActionState } from "react";

import { requestPasswordReset, type AuthFormState } from "../actions";
import { AuthCard, Field, FormStatus, SubmitButton } from "../ui";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(requestPasswordReset, {});

  return (
    <AuthCard title="Lupa password">
      <form action={action} className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <FormStatus {...state} />
        <SubmitButton pending={pending}>Kirim tautan</SubmitButton>
        <p className="text-center text-sm">
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            Kembali ke halaman masuk
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
