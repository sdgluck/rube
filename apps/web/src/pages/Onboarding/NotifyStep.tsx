import { useState } from "react";
import SettingsPageLink from "#components/SettingsPageLink";
import styles from "./Onboarding.module.css";
import ServiceCard from "./ServiceCard";
import { NOTIFY_SERVICES } from "./services";

export default function NotifyStep({ cfg }: { cfg: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className={styles.stepBody}>
      <h2 className={styles.stepTitle}>How should Tinkerbell reach you?</h2>
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
        More events in <SettingsPageLink to="/settings/notifications" />.
      </p>
    </div>
  );
}
