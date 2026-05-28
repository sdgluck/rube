import { Link } from "react-router-dom";
import { VERSION, IS_BETA } from "#/version";
import SettingsPageHeader from "./SettingsPageHeader";

export default function SettingsAbout() {
  return (
    <div style={{ maxWidth: 640 }}>
      <SettingsPageHeader
        title="Tinkerbell"
        description={
          <>
            Version {VERSION}
            {IS_BETA && <span className="version-pill"> beta</span>}
          </>
        }
      />

      {IS_BETA && (
        <div
          style={{
            padding: "12px 16px",
            background: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            borderRadius: 6,
            marginBottom: 24,
            lineHeight: 1.5,
          }}
        >
          <strong>Tinkerbell is beta software.</strong> Expect rough edges. Data shapes, settings, and behaviour may
          change between releases. Back up your <code>tinkerbell.db</code> before upgrading.
        </div>
      )}

      <p>
        See the <Link to="/changelog">changelog</Link> for the full release history.
      </p>
    </div>
  );
}
