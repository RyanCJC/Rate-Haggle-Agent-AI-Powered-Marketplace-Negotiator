import { useEffect, useState } from "react";
import { Home } from "./features/home/Home";
import { Workspace } from "./features/negotiation/Workspace";
import { TopBar } from "./components/shell/TopBar";
import { ProfilePage } from "./features/profile/ProfilePage";
import type { Mode } from "./types";

function readRun(): string | null {
  const match = window.location.hash.match(/^#\/run\/([0-9a-f]+)$/);
  return match ? match[1] : null;
}

function isProfileRoute(): boolean {
  return window.location.hash === "#/profile";
}

export default function App() {
  const [runId, setRunId] = useState<string | null>(readRun);
  const [profileRoute, setProfileRoute] = useState(isProfileRoute);
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    const onHash = () => {
      setRunId(readRun());
      setProfileRoute(isProfileRoute());
      setMode(null);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="app">
      <TopBar mode={runId ? mode : null} activePage={profileRoute ? "profile" : null} />
      <main className="app__main">
        {profileRoute ? (
          <ProfilePage />
        ) : runId ? (
          <Workspace
            runId={runId}
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
