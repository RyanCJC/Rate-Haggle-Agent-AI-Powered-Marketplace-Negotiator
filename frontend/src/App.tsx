import { useEffect, useState } from "react";
import { Home } from "./features/home/Home";
import { Workspace } from "./features/negotiation/Workspace";
import { TopBar } from "./components/shell/TopBar";

function readRun(): string | null {
  const match = window.location.hash.match(/^#\/run\/([0-9a-f]+)$/);
  return match ? match[1] : null;
}

export default function App() {
  const [runId, setRunId] = useState<string | null>(readRun);

  useEffect(() => {
    const onHash = () => setRunId(readRun());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="app__main">
        {runId ? (
          <Workspace runId={runId} onHome={() => (window.location.hash = "")} />
        ) : (
          <Home onStart={(id: string) => (window.location.hash = `/run/${id}`)} />
        )}
      </main>
      <footer className="app__footer">
        Haggle &mdash; practice mode. The AI writes wording; plain code owns the price. Your limit never reaches the AI.
      </footer>
    </div>
  );
}
