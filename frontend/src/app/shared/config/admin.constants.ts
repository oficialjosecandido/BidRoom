/** Centralised list of admin email addresses. Used by AdminGuard, AuthService, and LoginComponent. */
export const ADMIN_EMAILS: readonly string[] = [
  'josevcandido@gmail.com',
  'tomas.cascao123@gmail.com',
  'pt.bidnow@gmail.com',
];

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
