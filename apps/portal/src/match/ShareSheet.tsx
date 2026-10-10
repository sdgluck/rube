import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import Sheet from "./Sheet.tsx";

/**
 * The room's invite: a QR code for the people in the room with you, and the
 * link for everyone else. The link admits anyone who has it, guests included,
 * which the sheet says — passing it on is the point, but it should be a choice.
 */
export default function ShareSheet({ code, link, onClose }: { code: string; link: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* no clipboard (an insecure origin): the link is on screen to select */
    }
  }

  async function share() {
    try {
      await navigator.share({ title: "Movie night", text: `Join room ${code} and help pick a film.`, url: link });
    } catch {
      /* cancelled */
    }
  }

  return (
    <Sheet title="Invite people" onClose={onClose}>
      <h2 className="mm-sheet-title">Invite people</h2>
      <p className="muted mm-center">
        Scan it, or send the link. Anyone with it can join — no Plex account needed. Room code{" "}
        <strong className="mm-code-inline">{code}</strong>.
      </p>
      <div className="mm-qr">
        <QRCodeSVG value={link} size={196} marginSize={2} />
      </div>
      <p className="mm-link">{link}</p>
      <div className="mm-actions">
        <button type="button" className="btn-primary" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </button>
        {canShare && (
          <button type="button" onClick={share}>
            Share…
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
