import { Link } from "react-router-dom";
import { VERSION, IS_BETA } from "#/version";
import SettingsPageHeader from "./SettingsPageHeader";
import Banner from "#components/Banner";
import local from "./SettingsAbout.module.css";

export default function SettingsAbout() {
  return (
    <div className={local.page}>
      <SettingsPageHeader
        title="Tinkerbell"
        meta={
          <>
            {VERSION}
            {IS_BETA && <span className="version-pill"> beta</span>}
          </>
        }
      />

      {IS_BETA && (
        <Banner variant="warn">
          <strong>Tinkerbell is beta software.</strong> Expect rough edges. Data shapes, settings, and behaviour may
          change between releases. Back up your <code>tinkerbell.db</code> before upgrading.
        </Banner>
      )}

      <p>
        See the <Link to="/changelog">changelog</Link> for the full release history.
      </p>
    </div>
  );
}
