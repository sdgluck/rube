import { useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import styles from "./Onboarding.module.css";
import PlexCard from "./PlexCard";
import ServiceCard from "./ServiceCard";
import { INTEGRATION_SERVICES } from "./services";

interface Props {
  cfg: Record<string, unknown>;
  plexConnected: boolean;
}

export default function ConnectStep({ cfg, plexConnected }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const healthQuery = trpc.health.status.useQuery(undefined, { refetchOnWindowFocus: false });
  const llmConfigured = !!cfg.global_llm || !!cfg.global_anthropic_api_key;

  return (
    <div className={styles.stepBody}>
      <h2 className={styles.stepTitle}>Connect your services</h2>
      <PlexCard cfg={cfg} connected={plexConnected} />

      <h3 className={styles.groupHeading}>Optional</h3>
      <div className={styles.tileGrid}>
        {INTEGRATION_SERVICES.map((service) => (
          <ServiceCard
            key={service.id}
            service={service}
            cfg={cfg}
            expanded={expanded === service.id}
            onToggle={() => setExpanded((prev) => (prev === service.id ? null : service.id))}
          />
        ))}

        {/*
          AI is a link rather than a form. Its fields change per provider and
          the settings page already handles that properly; a cut-down copy here
          would be a second thing to keep in step for no gain. Leaving is safe
          — the wizard reopens where you left it.
        */}
        <div className={styles.tile}>
          <div className={styles.tileHeadStatic}>
            <span className={styles.tileTitle}>
              {llmConfigured && <span className={styles.tileDot} aria-hidden="true" />}
              AI
            </span>
            <Link to="/settings/ai" className={styles.tileState}>
              {llmConfigured ? "Configured" : "Set up →"}
            </Link>
          </div>
          <p className={styles.tileBlurb}>Describe rules in plain English; writes collection summaries.</p>
        </div>
      </div>

      {healthQuery.error && (
        <p className={styles.fieldHint}>Couldn't read service health — the cards may not show current state.</p>
      )}
    </div>
  );
}
