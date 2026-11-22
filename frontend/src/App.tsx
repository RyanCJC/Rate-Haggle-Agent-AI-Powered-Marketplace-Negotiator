import { useEffect, useState } from "react";
import { Home } from "./features/home/Home";
import { Workspace } from "./features/negotiation/Workspace";
import { TopBar } from "./components/shell/TopBar";
import { ProfilePage } from "./features/profile/ProfilePage";
import { ConnectionsPage } from "./features/connections/ConnectionsPage";
import { parseRoute, type Route } from "./lib/routes";
import type { Mode } from "./types";

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(window.location.hash));
      setMode(null);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const activePage: "profile" | "connections" | null =
    route.kind === "profile" ? "profile" : route.kind === "connections" ? "connections" : null;

  return (
    <div className="app">
      <TopBar mode={route.kind === "run" ? mode : null} activePage={activePage} />
      <main className="app__main">
        {route.kind === "profile" ? (
          <ProfilePage />
        ) : route.kind === "connections" ? (
          <ConnectionsPage runId={route.runId ?? null} />
        ) : route.kind === "run" ? (
          <Workspace
            runId={route.runId}
            onHome={() => (window.location.hash = "")}
            onModeChange={setMode}
          />
        ) : (
          <Home onStart={(id: string) => (window.location.hash = `/run/${id}`)} />
        )}
      </main>
      <footer className="app__footer">
        Haggle &mdash; the AI writes wording; plain code owns the price. Your limit never reaches the AI.
      </footer>
    </div>
  );
}
