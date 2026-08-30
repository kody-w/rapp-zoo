import { useEffect, useState } from "react";

export function useLivenessClock(
  leaseExpirations: (number | null | undefined)[],
): number {
  const key = leaseExpirations.filter(Boolean).sort().join("|");
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    if (nowMs === 0) {
      const bootstrap = setTimeout(() => setNowMs(Date.now()), 0);
      return () => clearTimeout(bootstrap);
    }
    const current = Date.now();
    const nextExpiration = key
      .split("|")
      .filter(Boolean)
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > nowMs)
      .sort((left, right) => left - right)[0];
    if (nextExpiration === undefined) return;
    const timer = setTimeout(
      () => setNowMs(Date.now()),
      Math.min(nextExpiration - current + 25, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [key, nowMs]);

  return nowMs;
}
