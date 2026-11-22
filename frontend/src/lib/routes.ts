export type Route =
  | { kind: "home" }
  | { kind: "run"; runId: string }
  | { kind: "profile" }
  | { kind: "connections"; runId?: string };

const RUN = /^#\/run\/([0-9a-f]+)$/;
const CONNECTIONS = /^#\/connections\/([0-9a-f]+)$/;
const CONNECTIONS_TRAILING = /^#\/connections\/?$/;

/**
 * Pure hash -> route mapping. Does not read window.location so it can be
 * unit tested without a DOM or renderer.
 */
export function parseRoute(hash: string): Route {
  const run = hash.match(RUN);
  if (run) return { kind: "run", runId: run[1] };

  const connections = hash.match(CONNECTIONS);
  if (connections) return { kind: "connections", runId: connections[1] };

  if (hash === "#/profile") return { kind: "profile" };

  if (CONNECTIONS_TRAILING.test(hash)) return { kind: "connections" };

  return { kind: "home" };
}

export function routePage(route: Route): "home" | "run" | "profile" | "connections" {
  return route.kind;
}
