import { useEffect, useRef } from "react";

export function Chat({ history, working }: { history: [string, string][]; working: boolean }) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history.length, working]);

  return (
    <div className="chat" role="log" aria-live="polite">
      {history.map(([role, text], index) => (
        <div key={index} className={`bubble ${role}`}>
          <span className="who">{role === "buyer" ? "Haggle agent" : "Seller"}</span>
          <p>{text}</p>
        </div>
      ))}
      {working && (
        <div className="bubble buyer typing" aria-label="The agent is working">
          <span />
          <span />
          <span />
        </div>
      )}
      <div ref={end} />
    </div>
  );
}