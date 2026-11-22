import { describe, expect, it } from "vitest";
import type { Route } from "./routes";
import { parseRoute } from "./routes";

function isRunRoute(route: Route): route is Extract<Route, { kind: "run" }> {
  return route.kind === "run";
}
function isConnRoute(route: Route): route is Extract<Route, { kind: "connections" }> {
  return route.kind === "connections";
}

describe("parseRoute", () => {
  it("maps empty hash to home", () => {
    expect(parseRoute("")).toEqual({ kind: "home" });
  });

  it("maps bare slash to home", () => {
    expect(parseRoute("/")).toEqual({ kind: "home" });
  });

  it("maps #/ to home", () => {
    expect(parseRoute("#/")).toEqual({ kind: "home" });
  });

  it("maps #/run/<id> to run with the id", () => {
    const route = parseRoute("#/run/abc123def456");
    expect(isRunRoute(route)).toBe(true);
    if (isRunRoute(route)) expect(route.runId).toBe("abc123def456");
  });

  it("maps #/profile to profile", () => {
    expect(parseRoute("#/profile")).toEqual({ kind: "profile" });
  });

  it("maps #/connections to connections page without a run", () => {
    const route = parseRoute("#/connections");
    expect(isConnRoute(route)).toBe(true);
    if (isConnRoute(route)) expect(route.runId).toBeUndefined();
  });

  it("maps #/connections/ (trailing slash) to connections page without a run", () => {
    const route = parseRoute("#/connections/");
    expect(isConnRoute(route)).toBe(true);
    if (isConnRoute(route)) expect(route.runId).toBeUndefined();
  });

  it("maps #/connections/<id> to connections page with the run id", () => {
    const route = parseRoute("#/connections/abc123def456");
    expect(isConnRoute(route)).toBe(true);
    if (isConnRoute(route)) expect(route.runId).toBe("abc123def456");
  });

  it("maps unknown hashes to home", () => {
    expect(parseRoute("#/unknown")).toEqual({ kind: "home" });
    expect(parseRoute("#/run/not-hex!")).toEqual({ kind: "home" });
    expect(parseRoute("#/connections/not-hex!")).toEqual({ kind: "home" });
  });
});
