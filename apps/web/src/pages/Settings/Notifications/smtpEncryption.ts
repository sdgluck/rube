/**
 * The Email form's one "Encryption" choice, over the two stored fields it
 * replaces in the UI: `global_smtp.secure` and `global_smtp.port`.
 *
 * The stored shape stays as it is — the transport reads `secure` directly and
 * exports already carry it — so the select is derived from those fields on
 * read and written back to them on change. "None" and STARTTLS are both
 * `secure: false` to the transport; what tells them apart is the port, which
 * is also what an operator actually changes between the two.
 *
 * Picking a mode moves the port only when it is blank or still one of the
 * well-known defaults, so a provider's custom port (2525, say) survives a
 * change of mode.
 */
export type SmtpEncryption = "starttls" | "ssl" | "none";

export const SMTP_ENCRYPTION_OPTIONS: { value: SmtpEncryption; label: string }[] = [
  { value: "starttls", label: "STARTTLS" },
  { value: "ssl", label: "SSL/TLS" },
  { value: "none", label: "None" },
];

const DEFAULT_PORT: Record<SmtpEncryption, number> = { starttls: 587, ssl: 465, none: 25 };
const DEFAULT_PORTS = new Set(Object.values(DEFAULT_PORT));

export function readSmtpEncryption(secure: boolean, port: string | number): SmtpEncryption {
  if (secure) return "ssl";
  return Number(port) === DEFAULT_PORT.none ? "none" : "starttls";
}

export function writeSmtpEncryption(mode: SmtpEncryption, port: string | number): { secure: boolean; port: string } {
  const current = Number(port) || 0;
  const keepPort = current !== 0 && !DEFAULT_PORTS.has(current);
  return { secure: mode === "ssl", port: String(keepPort ? current : DEFAULT_PORT[mode]) };
}
