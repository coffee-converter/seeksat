// lib/mcp/heavy-gate.mjs - How many heavy MCP calls (the scans, the chart
// render) run at once on one server instance. Each caller (an API key, or an
// IP address for anonymous callers) runs one at a time, and the free and pro
// tiers have pools of their own, so neither one caller nor a crowd of free
// callers can hold every slot. Pro's pool is never smaller than free's.

/** The tools that are always heavy: the scans and the chart render. */
export const HEAVY_TOOLS = new Set(['best_pass', 'whats_up_now', 'identify_satellite', 'get_pass_chart']);

/** Whether a call goes through the gate: a heavy tool, or any call that asks
 *  for a sky chart (next_visible_pass with chart:true renders the same image
 *  as get_pass_chart). */
export function isHeavyCall(name, args) {
  return HEAVY_TOOLS.has(name) || args?.chart === true;
}

/** @param {{ perCaller?: number, pools?: Record<string, number> }} [opts] */
export function createHeavyGate({ perCaller = 1, pools = { free: 4, pro: 4 } } = {}) {
  const byCaller = new Map();
  const byTier = new Map();
  return {
    /** A release function, or { busy: reason } when no slot is free. */
    enter(tier, caller) {
      const pool = pools[tier] ?? pools.free;
      if ((byCaller.get(caller) ?? 0) >= perCaller) return { busy: 'one search at a time per caller: wait for the last one to finish' };
      if ((byTier.get(tier) ?? 0) >= pool) return { busy: 'busy with other searches: try again in a few seconds' };
      byCaller.set(caller, (byCaller.get(caller) ?? 0) + 1);
      byTier.set(tier, (byTier.get(tier) ?? 0) + 1);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const c = (byCaller.get(caller) ?? 1) - 1;
        if (c > 0) byCaller.set(caller, c); else byCaller.delete(caller);
        byTier.set(tier, Math.max(0, (byTier.get(tier) ?? 1) - 1));
      };
    },
  };
}

/** Who is asking: a verified (pro) key, by the full hash of the key, else
 *  the client IP (Vercel's headers), else one shared bucket. An unverified
 *  key is not an identity: anyone can make up a new one per request. */
export function callerOf(keyHash, tier, headers) {
  if (keyHash && tier === 'pro') return `key:${keyHash}`;
  const ip = headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return ip ? `ip:${ip}` : 'anon';
}
