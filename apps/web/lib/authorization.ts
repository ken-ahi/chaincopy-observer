export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAllowedAdminEmail(
  candidate: string | null | undefined,
  allowedEmail: string,
): boolean {
  if (candidate === null || candidate === undefined) {
    return false;
  }

  return normalizeEmail(candidate) === normalizeEmail(allowedEmail);
}
