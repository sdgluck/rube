import { perDeps } from "@rube/container";
import { type Services } from "@rube/composition";

export const createImdbCommand = perDeps(function createImdbCommand(deps: Pick<Services, "clients">) {
  const { clients } = deps;
  const { getImdbClient } = clients;

  async function fetchImdbChart(id: string): Promise<{ name: string; imdbIds: string[] }> {
    return getImdbClient().fetchChart(id);
  }

  async function fetchImdbList(id: string): Promise<{ name: string; imdbIds: string[] }> {
    const result = await getImdbClient().fetchList(id);
    return { name: result.title, imdbIds: result.imdbIds };
  }

  return { fetchImdbChart, fetchImdbList };
});
