import { Navigate, useParams } from "react-router-dom";
import { trpc } from "#/trpc";
import DatabaseServiceForm from "./DatabaseServiceForm";
import { DATABASE_SERVICES } from "./databases.config";

export default function SettingsDatabasesService() {
  const { service } = useParams<{ service: string }>();
  const cfg = service ? DATABASE_SERVICES[service] : undefined;

  const testOmdbMutation = trpc.testOmdb.useMutation();
  const testTmdbMutation = trpc.testTmdb.useMutation();
  const testMdblistMutation = trpc.testMdblist.useMutation();
  const testTraktMutation = trpc.testTrakt.useMutation();

  if (!cfg) return <Navigate to="/settings/databases/omdb" replace />;

  const runTest = async (input: { api_key: string }): Promise<string> => {
    if (cfg.service === "omdb") {
      const r = await testOmdbMutation.mutateAsync(input);
      return `Connected — found "${r.title}"`;
    }
    if (cfg.service === "tmdb") {
      const r = await testTmdbMutation.mutateAsync(input);
      return `Connected — found "${r.sample}"`;
    }
    if (cfg.service === "trakt") {
      await testTraktMutation.mutateAsync(input);
      return "Connected — the client ID is valid for public lists";
    }
    const r = await testMdblistMutation.mutateAsync(input);
    return `Connected — ${r.name}`;
  };

  return <DatabaseServiceForm config={cfg} runTest={runTest} />;
}
