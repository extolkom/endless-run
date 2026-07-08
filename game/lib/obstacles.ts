// lib/obstacles.ts
// Centralised obstacle definitions and spawn logic for Swift Run · Celo Edition

export type ObstacleCategory = 'ground' | 'air' | 'hybrid' | 'crypto';

export type ObstacleKind =
  | 'tumbleweed'
  | 'sinkhole'
  | 'meerkat_pack'
  | 'vulture'
  | 'swinging_vine'
  | 'drone'
  | 'rolling_boulder'
  | 'rival_predator'
  | 'baobab_root'
  | 'gas_fee_wall'
  | 'falling_block'
  | 'rug_pull'
  // legacy kinds kept for compatibility
  | 'spike'
  | 'spike_group'
  | 'spike_wall'
  | 'rotating_wheel'
  | 'moving_spike'
  | 'platform_gap'
  | 'low_ceiling';

export interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
  // Kind of obstacle (optional for legacy objects)
  kind?: ObstacleKind;
  // Category of obstacle (optional for legacy objects)
  category?: ObstacleCategory;
  // Legacy field – some draw logic still checks `obs.type`
  type?: string;
  // Optional per‑frame state (e.g., timers, animation phases)
  angle?: number;
  moveDir?: number;
  moveRange?: number;
  moveOrigin?: number;
  platform?: boolean; // already present, keep

  state?: any;
  // When true this obstacle is a jumpable platform (legacy flag kept)
  // (platform already defined above) - no extra field needed
  // platform flag already defined above; keep only one definition
}

// Helper: weighted random selection
function weightedRandom<T extends PropertyKey>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [item, w] of entries) {
    if (r < w) return item;
    r -= w;
  }
  return entries[entries.length - 1][0];
}

// Spawn weight tables per level (1‑8). Numbers are relative.
const spawnWeights: Record<number, Record<ObstacleKind, number>> = {
  1: { tumbleweed: 25, sinkhole: 20, meerkat_pack: 0, vulture: 0, swinging_vine: 0, drone: 0, rolling_boulder: 0, rival_predator: 0, baobab_root: 0, gas_fee_wall: 0, falling_block: 0, rug_pull: 0, spike: 35, spike_group: 20, spike_wall: 0, rotating_wheel: 0, moving_spike: 0, platform_gap: 0, low_ceiling: 0 },
  2: { tumbleweed: 20, sinkhole: 15, meerkat_pack: 5, vulture: 5, swinging_vine: 5, drone: 0, rolling_boulder: 0, rival_predator: 0, baobab_root: 0, gas_fee_wall: 0, falling_block: 0, rug_pull: 0, spike: 30, spike_group: 20, spike_wall: 10, rotating_wheel: 0, moving_spike: 0, platform_gap: 0, low_ceiling: 0 },
  3: { tumbleweed: 15, sinkhole: 12, meerkat_pack: 5, vulture: 10, swinging_vine: 10, drone: 5, rolling_boulder: 0, rival_predator: 0, baobab_root: 0, gas_fee_wall: 0, falling_block: 0, rug_pull: 0, spike: 25, spike_group: 18, spike_wall: 10, rotating_wheel: 8, moving_spike: 8, platform_gap: 0, low_ceiling: 0 },
  4: { tumbleweed: 12, sinkhole: 10, meerkat_pack: 5, vulture: 10, swinging_vine: 10, drone: 10, rolling_boulder: 5, rival_predator: 5, baobab_root: 5, gas_fee_wall: 0, falling_block: 0, rug_pull: 0, spike: 22, spike_group: 15, spike_wall: 12, rotating_wheel: 10, moving_spike: 10, platform_gap: 0, low_ceiling: 0 },
  5: { tumbleweed: 8, sinkhole: 8, meerkat_pack: 5, vulture: 10, swinging_vine: 10, drone: 10, rolling_boulder: 10, rival_predator: 10, baobab_root: 10, gas_fee_wall: 5, falling_block: 5, rug_pull: 0, spike: 20, spike_group: 15, spike_wall: 12, rotating_wheel: 10, moving_spike: 10, platform_gap: 0, low_ceiling: 0 },
  6: { tumbleweed: 5, sinkhole: 5, meerkat_pack: 5, vulture: 15, swinging_vine: 15, drone: 10, rolling_boulder: 15, rival_predator: 10, baobab_root: 10, gas_fee_wall: 10, falling_block: 10, rug_pull: 5, spike: 18, spike_group: 15, spike_wall: 12, rotating_wheel: 12, moving_spike: 12, platform_gap: 0, low_ceiling: 0 },
  7: { tumbleweed: 5, sinkhole: 5, meerkat_pack: 5, vulture: 15, swinging_vine: 15, drone: 10, rolling_boulder: 15, rival_predator: 15, baobab_root: 10, gas_fee_wall: 10, falling_block: 10, rug_pull: 10, spike: 18, spike_group: 15, spike_wall: 15, rotating_wheel: 12, moving_spike: 12, platform_gap: 0, low_ceiling: 0 },
  8: { tumbleweed: 5, sinkhole: 5, meerkat_pack: 5, vulture: 15, swinging_vine: 15, drone: 15, rolling_boulder: 15, rival_predator: 15, baobab_root: 15, gas_fee_wall: 10, falling_block: 10, rug_pull: 15, spike: 18, spike_group: 15, spike_wall: 15, rotating_wheel: 15, moving_spike: 15, platform_gap: 0, low_ceiling: 0 },
};

// Factory to create a concrete obstacle instance.
function makeObstacle(kind: ObstacleKind, W: number, groundY: number): Obstacle {
  const x = W + 10;
  switch (kind) {
    case 'tumbleweed':
      return { x, y: groundY - 32, width: 36, height: 36, kind, category: 'ground' };
    case 'sinkhole':
      return { x, y: groundY - 20, width: 60, height: 20, kind, category: 'ground' };
    case 'meerkat_pack':
      return { x, y: groundY - 32, width: 90, height: 32, kind, category: 'ground' };
    case 'vulture':
      return { x, y: groundY - 120, width: 48, height: 48, kind, category: 'air' };
    case 'swinging_vine':
      return { x, y: groundY - 100, width: 20, height: 100, kind, category: 'air' };
    case 'drone':
      return { x, y: groundY - 110, width: 40, height: 30, kind, category: 'air' };
    case 'rolling_boulder':
      return { x, y: groundY - 40, width: 60, height: 60, kind, category: 'ground' };
    case 'rival_predator':
      return { x, y: groundY - 80, width: 70, height: 70, kind, category: 'hybrid' };
    case 'baobab_root':
      return { x, y: groundY - 30, width: 80, height: 30, kind, category: 'hybrid' };
    case 'gas_fee_wall':
      return { x, y: groundY - 60, width: 80, height: 12, kind, category: 'crypto' };
    case 'falling_block':
      return { x, y: -30, width: 40, height: 40, kind, category: 'crypto' };
    case 'rug_pull':
      return { x, y: groundY - 32, width: 36, height: 32, kind, category: 'crypto' };
    // Legacy types – keep `type` field for old drawing code.
    case 'spike':
      return { x, y: groundY - 32, width: 24, height: 32, kind, category: 'ground', type: kind };
    case 'spike_group':
      return { x, y: groundY - 32, width: 56, height: 32, kind, category: 'ground', type: kind };
    case 'spike_wall':
      return { x, y: groundY - 64, width: 28, height: 64, kind, category: 'ground', type: kind };
    case 'rotating_wheel':
      return { x, y: groundY - 120, width: 56, height: 56, kind, category: 'air', type: kind, angle: 0 };
    case 'moving_spike':
      return { x, y: groundY - 60, width: 28, height: 32, kind, category: 'air', type: kind, moveDir: 1, moveRange: 80, moveOrigin: groundY - 60 };
    case 'platform_gap':
    case 'low_ceiling':
      return { x, y: groundY - 32, width: 24, height: 32, kind, category: 'ground', type: kind };
    default:
      return { x, y: groundY - 32, width: 30, height: 30, kind, category: 'ground' };
  }
}

// Public API: choose obstacles for the current spawn tick.
export type ObstacleType = ObstacleKind;

export function getSpawnedObstacles(level: number, W: number, groundY: number, _score: number): Obstacle[] {
  const weights = spawnWeights[Math.min(level, 8)];
  const combo = level >= 6 && Math.random() < 0.15;
  if (combo) {
    const groundKinds = Object.keys(weights).filter(k => (weights as any)[k] > 0 && ['tumbleweed', 'sinkhole', 'meerkat_pack', 'rolling_boulder', 'rug_pull'].includes(k));
    const airKinds = Object.keys(weights).filter(k => (weights as any)[k] > 0 && ['vulture', 'swinging_vine', 'drone', 'falling_block'].includes(k));
    const gKind = weightedRandom<any>(groundKinds.reduce((obj, k) => ({ ...obj, [k]: (weights as any)[k] }), {} as any)) as ObstacleKind;
    const aKind = weightedRandom<any>(airKinds.reduce((obj, k) => ({ ...obj, [k]: (weights as any)[k] }), {} as any)) as ObstacleKind;
    return [makeObstacle(gKind, W, groundY), makeObstacle(aKind, W, groundY)];
  }
  const kind = weightedRandom<ObstacleKind>(weights as any);
  return [makeObstacle(kind, W, groundY)];
}

// Per‑frame update for dynamic behaviours.
export function updateObstacle(obs: Obstacle, _time: number): void {
  if (obs.kind === 'tumbleweed') {
    obs.state = { ...obs.state, phase: (obs.state?.phase ?? 0) + 0.02 };
  }
  if (obs.kind === 'sinkhole') {
    const elapsed = obs.state?.elapsed ?? 0;
    obs.state = { ...obs.state, elapsed: elapsed + 1 };
  }
  if (obs.kind === 'falling_block') {
    obs.y += 3;
  }
}
