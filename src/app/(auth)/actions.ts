"use server";

import { redirect } from "next/navigation";

import { createSupabaseClientFromNextCookies } from "@/server/auth/next-cookies";

export type AuthFormState = { error?: string; message?: string };

const MIN_PASSWORD_LENGTH = 12;

export async function signIn(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Email dan password wajib diisi." };
  }

  const supabase = await createSupabaseClientFromNextCookies();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Generic by design: never reveal whether the email exists.
    return { error: "Email atau password salah." };
  }
  redirect("/");
}

export async function requestPasswordReset(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { error: "Email wajib diisi." };
  }

  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new Error("APP_ORIGIN is not configured");

  const supabase = await createSupabaseClientFromNextCookies();
  // The outcome is ignored so the response never reveals whether the email is registered.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });
  return { message: "Jika email terdaftar, tautan untuk membuat password baru telah dikirim." };
}

export async function updatePassword(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password minimal ${MIN_PASSWORD_LENGTH} karakter.` };
  }
  if (password !== confirmation) {
    return { error: "Konfirmasi password tidak sama." };
  }

  const supabase = await createSupabaseClientFromNextCookies();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return { error: "Tautan sudah tidak berlaku. Minta tautan baru." };
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "Password belum dapat diperbarui. Coba lagi." };
  }

  // The owner must sign in again with the new password.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?reset=1");
}

export async function signOut(scope: "local" | "global"): Promise<void> {
  const supabase = await createSupabaseClientFromNextCookies();
  await supabase.auth.signOut({ scope });
  redirect("/login");
}
