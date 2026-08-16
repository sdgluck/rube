import { useState } from "react";
import { Link } from "react-router-dom";
import styles from "./Onboarding.module.css";
import ServiceCard from "./ServiceCard";
import { NOTIFY_SERVICES } from "./services";

export default function NotifyStep({ cfg }: { cfg: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className={styles.stepBody}>
      <h2 className={styles.stepTitle}>How should Tinkerbell reach you?</h2>
      <p className={styles.stepLede}>
        Optional, and easy to skip. It earns its place the first time a nightly job fails at 4am and you find out
        without going looking.
      </p>

      <div className={styles.tileGrid}>
        {NOTIFY_SERVICES.map((service) => (
          <ServiceCard
            key={service.id}
            service={service}
            cfg={cfg}
            expanded={expanded === service.id}
            onToggle={() => setExpanded((prev) => (prev === service.id ? null : service.id))}
          />
        ))}
      </div>

      <p className={styles.fieldHint}>
        Anything you set up here is subscribed to failures and recoveries only — enough to be useful, quiet enough not
        to get muted. There are around a dozen other events to choose from in{" "}
        <Link to="/settings/notifications">Settings → Notifications</Link>.
      </p>
    </div>
  );
}
