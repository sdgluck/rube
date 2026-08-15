/**
 * Email, the ninth service.
 *
 * Every other destination Tinkerbell supports is chat or push — all of them
 * reach the admin, none of them reach the people who actually watch the
 * library. A weekly newsletter belongs in email, and its absence is the single
 * most conspicuous gap next to Tautulli.
 *
 * **On the dependency.** `nodemailer` is a real addition to a project that has
 * kept its dependency list deliberately short. It is still the right call: the
 * alternative is hand-rolling SMTP over `node:net` — AUTH mechanisms, STARTTLS
 * upgrade, dot-stuffing, MIME — which is a lot of code whose failure mode is
 * "mail silently doesn't arrive at some providers". Noted rather than
 * smuggled in.
 *
 * **On the template.** Inline styles and a table layout, because that is what
 * renders in Outlook and Gmail alike, and no template system: one well-made
 * layout beats a customisation surface nobody asked for.
 */
import { createTransport, type Transporter } from "nodemailer";
import { getConfig } from "@tinkerbell/core";
import { flattenMessage, type RichMessage } from "./types.ts";

const TIMEOUT_MS = 20_000;

export interface SmtpTarget {
  /** Recipient. Defaults to `global_smtp.to`, the admin's own address. */
  to?: string;
}

/**
 * Thrown when mail is asked for and SMTP isn't set up.
 *
 * A distinct type so the digest job can skip email cleanly instead of
 * recording a failure — an install with no SMTP configured hasn't failed to
 * send anything, it has declined to.
 */
export class SmtpNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpNotConfiguredError";
  }
}

export function smtpConfigured(): boolean {
  const cfg = getConfig("global_smtp");
  return !!(cfg?.host && cfg.port && cfg.from);
}

function transport(): { transporter: Transporter; from: string } {
  const cfg = getConfig("global_smtp");
  if (!cfg?.host || !cfg.port || !cfg.from) {
    throw new SmtpNotConfiguredError("SMTP host, port and from address are required");
  }

  return {
    transporter: createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      // Only pass auth when there is a user: an open relay on the LAN (a very
      // common home-server setup) rejects an empty AUTH rather than ignoring it.
      ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.password ?? "" } } : {}),
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    }),
    from: cfg.from,
  };
}

export async function sendSmtp(message: RichMessage, target: SmtpTarget = {}): Promise<void> {
  const to = target.to || getConfig("global_smtp")?.to;
  if (!to) {
    throw new SmtpNotConfiguredError("No recipient address — set one in Settings, or address the message explicitly");
  }

  const { transporter, from } = transport();
  try {
    await transporter.sendMail({
      from,
      to,
      subject: message.title,
      text: flattenMessage(message),
      html: renderEmailHtml(message),
    });
  } finally {
    // Each send opens its own connection. A digest run sends to a handful of
    // people once a week, so pooling would keep a socket open for days to save
    // nothing.
    transporter.close();
  }
}

// ─── The template ────────────────────────────────────────────────────────────

const INK = "#1c1c1e";
const MUTED = "#6b6b70";
const RULE = "#e4e4e7";
const ACCENT = "#237feb";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The whole email, as one nested table with inline styles.
 *
 * No `<style>` block: Gmail strips it on some clients and Outlook's rendering
 * engine ignores half of what survives. Everything that matters is on the
 * element.
 */
export function renderEmailHtml(message: RichMessage): string {
  const blocks = (message.blocks ?? [])
    .filter((block) => block.lines.length > 0)
    .map(
      (block) => `
        <tr>
          <td style="padding:20px 0 0 0;">
            <p style="margin:0 0 8px 0;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${MUTED};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(
              block.heading,
            )}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              ${block.lines
                .map(
                  (line) =>
                    `<tr><td style="padding:5px 0;border-bottom:1px solid ${RULE};font:400 15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${INK};">${escapeHtml(
                      line,
                    )}</td></tr>`,
                )
                .join("")}
            </table>
          </td>
        </tr>`,
    )
    .join("");

  const image = message.imageUrl
    ? `<tr><td style="padding:16px 0 0 0;"><img src="${escapeHtml(
        message.imageUrl,
      )}" alt="" width="200" style="display:block;max-width:100%;height:auto;border:0;border-radius:6px;" /></td></tr>`
    : "";

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f6f6f7;margin:0;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:#ffffff;border-radius:10px;padding:28px 32px;">
        <tr>
          <td style="border-bottom:2px solid ${ACCENT};padding-bottom:12px;">
            <h1 style="margin:0;font:700 21px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${INK};">${escapeHtml(
              message.title,
            )}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 0 0 0;font:400 15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${INK};">${escapeHtml(
            message.text,
          ).replace(/\n/g, "<br />")}</td>
        </tr>
        ${image}
        ${blocks}
        <tr>
          <td style="padding:28px 0 0 0;font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${MUTED};">
            Sent by Tinkerbell. To change how often you get this — or to stop getting it — open the user portal and edit your notification preferences.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}
