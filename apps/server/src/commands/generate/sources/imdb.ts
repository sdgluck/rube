import { getImdbClient } from "../../../lib/clients.ts";

export async function fetchImdbChart(id: string): Promise<{ name: string; imdbIds: string[] }> {
  return getImdbClient().fetchChart(id);
}

export async function fetchImdbList(id: string): Promise<{ name: string; imdbIds: string[] }> {
  const result = await getImdbClient().fetchList(id);
  return { name: result.title, imdbIds: result.imdbIds };
}
