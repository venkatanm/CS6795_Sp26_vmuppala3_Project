import { useEffect, useMemo, useRef, useState } from "react";
import { Coffee, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface IntermissionProps {
  onComplete: () => void;
}

function formatMMSS(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(clamped / 60);
  const ss = clamped % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export default function Intermission({ onComplete }: IntermissionProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(10 * 60);
  const completedRef = useRef(false);

  useEffect(() => {
    if (completedRef.current) return;

    const interval = window.setInterval(() => {
      setSecondsRemaining((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (secondsRemaining > 0) return;
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [secondsRemaining, onComplete]);

  const timeText = useMemo(() => formatMMSS(secondsRemaining), [secondsRemaining]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto mb-6 flex items-center justify-center gap-3 text-slate-200">
          <Coffee className="h-6 w-6" aria-hidden="true" />
          <Clock className="h-6 w-6" aria-hidden="true" />
        </div>

        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          Reading &amp; Writing Complete
        </h1>
        <p className="mt-2 text-lg text-slate-300">Next Up: Math Section</p>

        <div className="mt-8 rounded-2xl border border-slate-700/60 bg-slate-950/30 p-8 shadow-xl">
          <div className="text-6xl sm:text-7xl font-mono font-semibold tracking-tight tabular-nums">
            {timeText}
          </div>
          <p className="mt-4 text-slate-300 leading-relaxed">
            Take a break. Stand up, stretch, and get some water. The next section will start
            automatically.
          </p>

          <div className="mt-8 flex items-center justify-center">
            <Button variant="ghost" onClick={onComplete} className="text-slate-100">
              Resume Now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

