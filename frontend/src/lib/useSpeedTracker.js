import { useRef, useState, useCallback } from "react";

// Feed it bytes-transferred-so-far on every update; it derives a smoothed
// speed (bytes/sec) from a 3-second sliding window and computes ETA against
// a total size you pass at read time.
export function useSpeedTracker() {
  const samplesRef = useRef([]); // { t, bytes }
  const [speed, setSpeed] = useState(0);

  const push = useCallback((bytes) => {
    const now = performance.now();
    const samples = samplesRef.current;
    samples.push({ t: now, bytes });
    const cutoff = now - 3000;
    while (samples.length > 1 && samples[0].t < cutoff) samples.shift();

    if (samples.length >= 2) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = (last.t - first.t) / 1000;
      const db = last.bytes - first.bytes;
      setSpeed(dt > 0 ? db / dt : 0);
    }
  }, []);

  const reset = useCallback(() => {
    samplesRef.current = [];
    setSpeed(0);
  }, []);

  return { speed, push, reset };
}

export function etaFrom(speed, remaining) {
  return speed > 0 ? remaining / speed : 0;
}
