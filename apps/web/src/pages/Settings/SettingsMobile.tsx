import { useEffect, useState } from "react";
import { NATIVE_APPS } from "@tinkerbell/contracts";
import {
  biometryAvailable,
  connectLink,
  getConnection,
  getLockEnabled,
  isNative,
  saveServer,
  setLockEnabled,
  unlock,
} from "@tinkerbell/native-client";
import CardSection from "#components/CardSection";
import QrCode from "#components/QrCode";
import ToggleSwitch from "#components/ToggleSwitch";
import { useToast } from "#components/Toast";
import SettingsPageHeader from "./SettingsPageHeader";
import settings from "./Settings.module.css";
import styles from "./SettingsMobile.module.css";

/**
 * Settings → Mobile app.
 *
 * In a browser: the code a phone scans to point the app at this server, so
 * nobody types a LAN address on a phone keyboard. In the app: which server it
 * is connected to, switching, and the app lock — device-local settings that
 * live on the phone, not in the server's config.
 */
export default function SettingsMobile() {
  const native = isNative();
  const server = getConnection()?.server ?? window.location.origin;
  const link = connectLink(NATIVE_APPS.admin.scheme, server);
  const { addToast } = useToast();

  return (
    <div className={styles.stack}>
      <SettingsPageHeader title="Mobile app" />

      {native ? (
        <AppSettings server={server} />
      ) : (
        <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Connect a phone">
          <p className={settings.hint}>
            Install Tinkerbell on your phone, then scan this with the camera. It opens the app pointed at the address
            this page is open at — so open Tinkerbell at an address your phone can reach first, not{" "}
            <code>localhost</code>.
          </p>
          <div className={styles.connect}>
            <div className={styles.qr}>
              <QrCode value={link} label="QR code that connects the Tinkerbell app to this server" />
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
            Away from home the phone needs an address that reaches this server from outside — behind a reverse proxy
            with HTTPS, and with sign-in on under Settings → Security.
          </p>
        </CardSection>
      )}
    </div>
  );
}

function AppSettings({ server }: { server: string }) {
  const { addToast } = useToast();
  const [available, setAvailable] = useState(false);
  const [lock, setLock] = useState(false);

  useEffect(() => {
    void biometryAvailable().then(setAvailable);
    void getLockEnabled().then(setLock);
  }, []);

  async function toggleLock(on: boolean) {
    // Proving it works before relying on it: a lock you can't open is a lockout.
    if (on && !(await unlock("Turn on the app lock"))) return;
    await setLockEnabled(on);
    setLock(on);
    addToast(on ? "App lock on" : "App lock off", "success");
  }

  return (
    <>
      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Server">
        <p className={settings.hint}>
          Connected to <code>{server}</code>.
        </p>
        <button type="button" className={styles.secondary} onClick={() => void saveServer(null)}>
          Switch server
        </button>
      </CardSection>

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="App lock">
        <label className={settings.field}>
          <span className={settings.label}>Require Face ID, Touch ID or fingerprint</span>
          <div>
            <ToggleSwitch checked={lock} onChange={(on) => void toggleLock(on)} disabled={!available} />
          </div>
        </label>
        <p className={settings.hint}>
          {available
            ? "Asks when the app opens, and when you come back to it after five minutes away."
            : "This phone has no biometrics set up."}
        </p>
      </CardSection>
    </>
  );
}
