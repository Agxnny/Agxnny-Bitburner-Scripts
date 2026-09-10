import { PATHS } from "/core/config.js";
import { HEALTH } from "/core/contracts.js";
import { publishDomainState } from "/core/state.js";

const DEFAULT_INTERVAL_MS = 500;

export async function main(ns) {
  const flags = ns.flags([["once", false], ["interval", DEFAULT_INTERVAL_MS]]);
  ns.disableLog("sleep");

  do {
    const startedAt = Date.now();
    try {
      const player = ns.getPlayer();
      const data = {
        health: HEALTH.UNTESTED,
        money: player.money,
        city: player.city,
        location: player.location ?? null,
        hp: player.hp ?? null,
        skills: player.skills ?? {},
        exp: player.exp ?? {},
        jobs: player.jobs ?? {},
        factions: player.factions ?? [],
        currentWork: safeCurrentWork(ns),
        collectionDurationMs: Date.now() - startedAt,
      };

      publishDomainState(ns, PATHS.playerState, {
        domain: "player",
        source: ns.getScriptName(),
        data,
      });
    } catch (error) {
      ns.print(`ERROR player collection failed: ${String(error)}`);
    }

    if (flags.once) break;
    await ns.sleep(Math.max(250, Number(flags.interval) || DEFAULT_INTERVAL_MS));
  } while (true);
}

function safeCurrentWork(ns) {
  try {
    return ns.singularity?.getCurrentWork?.() ?? null;
  } catch {
    return null;
  }
}
