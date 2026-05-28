import { Navigate, useParams } from "react-router-dom";
import { trpc } from "#/trpc";
import ArrsServiceForm from "./ArrsServiceForm";
import { ARRS_SERVICES } from "./arrs.config";

export default function SettingsArrsService() {
  const { service } = useParams<{ service: string }>();
  const cfg = service ? ARRS_SERVICES[service] : undefined;

  const testRadarrMutation = trpc.testRadarr.useMutation();
  const testSonarrMutation = trpc.testSonarr.useMutation();
  const testSeerrMutation = trpc.testSeerr.useMutation();

  if (!cfg) return <Navigate to="/settings/arrs/radarr" replace />;

  const runTest = async (input: { url: string; api_key: string }): Promise<string> => {
    if (cfg.service === "radarr") {
      const r = await testRadarrMutation.mutateAsync(input);
      return `Connected to "${r.instanceName}"`;
    }
    if (cfg.service === "sonarr") {
      const r = await testSonarrMutation.mutateAsync(input);
      return `Connected to "${r.instanceName}"`;
    }
    const r = await testSeerrMutation.mutateAsync(input);
    return `Connected — ${r.total} total requests`;
  };

  return <ArrsServiceForm config={cfg} runTest={runTest} />;
}
