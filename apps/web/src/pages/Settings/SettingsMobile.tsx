import { isLoopbackAddress, nativeConnectLink } from "@rube/contracts";
import CardSection from "#components/CardSection";
import QrCode from "#components/QrCode";
import { useToast } from "#components/Toast";
import { trpc } from "#/trpc";
import SettingsPageHeader from "./SettingsPageHeader";
import settings from "./Settings.module.css";
import styles from "./SettingsMobile.module.css";

/**
 * Settings → Mobile app.
 *
 * The code a phone scans to point the app at this server, so nobody types a
 * LAN address on a phone keyboard.
 */
export default function SettingsMobile() {
  const server = window.location.origin;
  // The admin half is the address this page is open at; the portal half is
  // its saved public address, so one scan sets up both parts of the app.
  const portalUrl = trpc.auth.server.useQuery().data?.portalUrl;
  const link = nativeConnectLink({ admin: server, portal: portalUrl });
  const loopback = isLoopbackAddress(server);
  const { addToast } = useToast();

  return (
    <div className={styles.stack}>
      <SettingsPageHeader title="Mobile app" />

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Connect a phone">
        <p className={settings.hint}>
          Install Rube on your phone, then scan this with the camera. It opens the app pointed at the address this page
          is open at — so open Rube at an address your phone can reach first, not <code>localhost</code>.
        </p>
        {loopback && (
          <p className={settings.hint} role="alert">
            This page is open at <code>{server}</code>, which on a phone means the phone itself. Open Rube at this
            computer&apos;s network address instead — and if the server listens on <code>127.0.0.1</code> (the default{" "}
            <code>HOST</code>), set <code>HOST=0.0.0.0</code> so the phone can reach it at all.
          </p>
        )}
        <div className={styles.connect}>
          <div className={styles.qr}>
            <QrCode value={link} label="QR code that connects the Rube app to this server" />
          </div>
          <div className={styles.linkColumn}>
            <span className={settings.label}>Or open this link on the phone</span>
            <p className={styles.link}>{link}</p>
            <button
              type="button"
              className={styles.secondary}
              onClick={() =>
                navigator.clipboard.writeText(link).then(
                  () => addToast("Copied", "success"),
                  () => addToast("Couldn't copy — select the text instead", "error"),
                )
              }
            >
              Copy link
            </button>
          </div>
        </div>
        <p className={settings.hint}>
          Away from home the phone needs an address that reaches this server from outside — behind a reverse proxy with
          HTTPS, and with sign-in on under Settings → Security.
        </p>
      </CardSection>
    </div>
  );
}
