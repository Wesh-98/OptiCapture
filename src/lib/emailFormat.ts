/**
 * True for `local@domain` where neither part has whitespace or a second "@", and the domain
 * has a dot with at least one character on each side. Written without a regular expression
 * because the equivalent pattern backtracks badly on long hostile input.
 */
export function isEmailShaped(value: string): boolean {
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@') || /\s/.test(value)) return false;
  const domain = value.slice(at + 1);
  const dot = domain.indexOf('.', 1);
  return dot !== -1 && dot < domain.length - 1;
}
