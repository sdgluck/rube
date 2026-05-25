/**
 * SPIKE (feature step 1): verify per-user home-screen targeting end to end.
 *
 * Confirms the mechanism the "My Recommendations" feature depends on:
 *   1. A collection labelled `["Tinkerbell", "User:<username>"]` is created
 *      and promoted to the home.
 *   2. The target user's plex.tv sharing record gets a label allow-list
 *      (`filterMovies/filterTelevision = label=Tinkerbell|User:<username>`),
 *      so ONLY that user sees the collection — additive (Option A): their
 *      access to `Tinkerbell`-labelled content is preserved.
 *
 * This sandbox can't reach a live Plex server, so run it against YOUR server.
 * The final "does it actually show only on their home" check is manual — the
 * script reads the applied restriction back from plex.tv so most of the chain
 * is confirmed programmatically.
 *
 * Run from the repo (resolves @tinkerbell/plex via this package):
 *   PLEX_URL=http://localhost:32400 PLEX_TOKEN=xxxxx \
 *     pnpm --filter @tinkerbell/jobs spike:user-targeting -- --user alice
 *
 *   ... add --apply to mutate, --cleanup to undo. Without --apply it is
 *   read-only and just prints what it would change.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlexClient } from "@tinkerbell/plex";

const SPIKE_LABEL = "TinkerbellSpike";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseArgs(argv: string[]) {
  const args: { user?: string; section?: string; items: number; apply: boolean; cleanup: boolean } = {
    items: 5,
    apply: false,
    cleanup: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--cleanup") args.cleanup = true;
    else if (a === "--user") args.user = argv[++i];
    else if (a === "--section") args.section = argv[++i];
    else if (a === "--items") args.items = parseInt(argv[++i], 10) || 5;
  }
  return args;
}

function statePath(machineId: string, sharingId: number): string {
  return join(tmpdir(), `tinkerbell-spike-${machineId}-${sharingId}.json`);
}

async function main() {
  const PLEX_URL = process.env.PLEX_URL;
  const PLEX_TOKEN = process.env.PLEX_TOKEN;
  if (!PLEX_URL || !PLEX_TOKEN) {
    console.error("Set PLEX_URL and PLEX_TOKEN (admin token) in the environment.");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const client = createPlexClient({ url: PLEX_URL, token: PLEX_TOKEN });

  const identity = await client.getIdentity();
  const machineId = identity.machineIdentifier;
  console.log(`Server: ${identity.friendlyName} (${machineId})`);

  // Resolve a target section (movie library by default).
  const sections = await client.getSections();
  const section = args.section
    ? sections.find((s) => s.title.toLowerCase() === args.section!.toLowerCase())
    : (sections.find((s) => s.type === "movie") ?? sections[0]);
  if (!section) {
    console.error(args.section ? `No section titled "${args.section}".` : "No sections found.");
    process.exit(1);
  }
  console.log(`Section: ${section.title} (key=${section.key}, type=${section.type})`);

  // Resolve target user from sharings.
  const sharings = await client.getSharings(machineId);
  console.log(`\nShared users (${sharings.length}):`);
  for (const s of sharings) console.log(`  - ${s.username} (sharingId=${s.id}, userId=${s.userId})`);

  const details = await client.getSharedServerDetails(machineId);
  const detailFor = (userId: number) => details.find((d) => d.userId === userId);

  if (!args.user) {
    console.log("\nNo --user given → inspect only. Current restrictions:");
    for (const s of sharings) {
      const d = detailFor(s.userId);
      console.log(
        `  ${s.username}: filterMovies="${d?.filterMovies ?? ""}" filterTelevision="${d?.filterTelevision ?? ""}"`,
      );
    }
    console.log("\nRe-run with --user <username> [--apply] to exercise targeting.");
    return;
  }

  const target = sharings.find((s) => s.username.toLowerCase() === args.user!.toLowerCase());
  if (!target) {
    console.error(`\nUser "${args.user}" is not a shared user of this server.`);
    process.exit(1);
  }
  const userLabels = ["Tinkerbell", `User:${target.username}`];
  const collectionName = `Spike — Personalized for ${target.username}`;

  if (args.cleanup) {
    console.log(`\n[cleanup] Removing spike collection(s) labelled "${SPIKE_LABEL}"...`);
    let deleted = 0;
    for (const s of sections) deleted += await client.deleteCollectionsByLabel(s.key, SPIKE_LABEL);
    console.log(`[cleanup] Deleted ${deleted} spike collection(s).`);

    const sp = statePath(machineId, target.id);
    if (existsSync(sp)) {
      const prior = JSON.parse(readFileSync(sp, "utf8")) as { filterMovies: string; filterTelevision: string };
      const priorMovies = prior.filterMovies ?? "";
      if (priorMovies === "") {
        await client.clearSharingRestrictions(target.id);
        console.log(`[cleanup] Restored ${target.username} to no restriction (original was empty).`);
      } else if (priorMovies.startsWith("label=")) {
        const labels = priorMovies.slice("label=".length).split("|").filter(Boolean);
        await client.setSharingRestrictions(target.id, labels);
        console.log(`[cleanup] Restored ${target.username}'s original label allow-list: ${labels.join(", ")}`);
      } else {
        await client.clearSharingRestrictions(target.id);
        console.warn(
          `[cleanup] WARNING: original filter was non-label ("${priorMovies}") and can't be re-applied via this tool.\n` +
            `          Cleared the restriction; restore it manually in Plex if needed.`,
        );
      }
      rmSync(sp);
    } else {
      console.warn(`[cleanup] No saved prior state for ${target.username}; leaving restrictions untouched.`);
    }
    return;
  }

  // Plan summary (always printed).
  const items = (await client.fetchAllItems(section.key)).slice(0, args.items);
  if (items.length === 0) {
    console.error(`No items in "${section.title}" to build a test collection.`);
    process.exit(1);
  }
  const current = detailFor(target.userId);
  console.log(`\nPlan for ${target.username}:`);
  console.log(`  • create collection "${collectionName}" with labels [${userLabels.join(", ")}, ${SPIKE_LABEL}]`);
  console.log(`    items: ${items.map((i) => i.title).join(", ")}`);
  console.log(`  • pin promotedToOwnHome=1, promotedToSharedHome=0`);
  console.log(`  • set ${target.username}'s allow-list → label=${userLabels.join("|")}`);
  console.log(`  • current restriction: filterMovies="${current?.filterMovies ?? ""}"`);

  if (!args.apply) {
    console.log(`\nDry run (no --apply). Nothing changed.`);
    return;
  }

  // Save prior restriction so --cleanup can restore it.
  const sp = statePath(machineId, target.id);
  writeFileSync(
    sp,
    JSON.stringify({ filterMovies: current?.filterMovies ?? "", filterTelevision: current?.filterTelevision ?? "" }),
  );
  console.log(`\n[apply] Saved prior restriction to ${sp}`);

  const collectionKey = await client.createCollectionWithLabel(
    section.key,
    section.type,
    machineId,
    collectionName,
    items.map((i) => i.ratingKey),
    [...userLabels, SPIKE_LABEL],
  );
  if (!collectionKey) {
    console.error(`[apply] Failed to create collection.`);
    process.exit(1);
  }
  console.log(`[apply] Created collection ratingKey=${collectionKey}`);

  await client.pinToHomepage(section.key, collectionKey, {
    promotedToOwnHome: 1,
    promotedToRecommendedHome: 1,
    promotedToSharedHome: 0,
  });
  console.log(`[apply] Pinned to homepage.`);

  await client.setSharingRestrictions(target.id, userLabels);
  console.log(`[apply] Set sharing restriction for ${target.username}.`);

  // Read it back from plex.tv to confirm server-side state.
  const after = (await client.getSharedServerDetails(machineId)).find((d) => d.userId === target.userId);
  console.log(`\n[verify] ${target.username} restriction now: filterMovies="${after?.filterMovies ?? ""}"`);
  const expected = `label=${userLabels.join("|")}`;
  console.log(`[verify] expected: "${expected}" → ${after?.filterMovies === expected ? "MATCH ✓" : "MISMATCH ✗"}`);

  console.log(
    `\nManual checks (the part this sandbox can't do):\n` +
      `  1. Sign in to Plex as "${target.username}" → confirm "${collectionName}" shows on their home.\n` +
      `  2. Confirm OTHER users do NOT see it.\n` +
      `  3. Confirm "${target.username}" can still browse all Tinkerbell-labelled library content (additive).\n` +
      `  4. Note behaviour for managed/home users and the server owner (expected: not friend-targetable).\n\n` +
      `When done: re-run with --cleanup --user ${target.username} to remove the collection and restore the restriction.`,
  );
}

main().catch((err) => {
  console.error("Spike failed:", errorMessage(err));
  process.exit(1);
});
