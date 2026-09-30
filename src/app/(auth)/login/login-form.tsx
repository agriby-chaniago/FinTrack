"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signIn, type AuthFormState } from "../actions";
import { Field, FormStatus, SubmitButton } from "../ui";

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signIn, { message: notice });

  return (
    <form action={action} className="space-y-4">
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field label="Password" name="password" type="password" autoComplete="current-password" />
      <FormStatus {...state} />
      <SubmitButton pending={pending}>Masuk</SubmitButton>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-primary underline-offset-4 hover:underline">
          Lupa password?
        </Link>
      </p>
    </form>
  );
}
