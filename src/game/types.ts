export type GamePhase = 'ready' | 'running' | 'paused' | 'upgrade' | 'gameover';
export type UpgradeRarity = 'common' | 'rare' | 'epic';

export interface PlayerStats {
  maxHealth: number;
  health: number;
  /** 每秒回复的生命值，受击后会暂停一段时间。 */
  regen: number;
  moveSpeed: number;
  damage: number;
  fireRate: number;
  projectileSpeed: number;
  projectileSize: number;
  projectiles: number;
  pierce: number;
  pickupRadius: number;
  critChance: number;
  critDamage: number;
  /** 受到碰撞伤害时完全免伤的概率。 */
  damageAvoidance: number;
  /** 子弹命中时直接击杀目标的概率。 */
  headshotChance: number;
}

/** 抽卡时传给 condition 的上下文，层数来自 Game 的 stack store。 */
export interface UpgradePoolContext {
  level: number;
  stacks: number;
  stats: PlayerStats;
}

export interface UpgradeDefinition {
  id: string;
  name: string;
  description: string;
  rarity: UpgradeRarity;
  icon: string;
  /** 返回 true 则进入本轮卡池。 */
  condition: (ctx: UpgradePoolContext) => boolean;
  apply: (stats: PlayerStats) => void;
}

/** 可以在强化卡上展示的常驻属性，health 是实时值，不作为强化收益展示。 */
export type StatKey = Exclude<keyof PlayerStats, 'health'>;

export interface StatChange {
  label: string;
  from: string;
  to: string;
  /** 数值变大为 true，变小（例如护甲扣移速）为 false。 */
  up: boolean;
}

export interface UpgradeCard extends Omit<UpgradeDefinition, 'apply' | 'condition'> {
  /** 本局已经强化的次数。 */
  stacks: number;
  /** 用当前属性试算这一层强化前后的数值。 */
  changes: StatChange[];
}

export interface HudState {
  phase: GamePhase;
  level: number;
  health: number;
  maxHealth: number;
  regen: number;
  xp: number;
  xpToNext: number;
  elapsed: number;
  kills: number;
  wave: number;
}

export interface RunSummary {
  elapsed: number;
  kills: number;
  level: number;
}

export interface DamageEvent {
  screenX: number;
  screenY: number;
  amount: number;
  critical: boolean;
  headshot: boolean;
}

export interface GameCallbacks {
  onHud: (state: HudState) => void;
  onPhase: (phase: GamePhase) => void;
  onUpgrade: (cards: UpgradeCard[]) => void;
  onDamage: (event: DamageEvent) => void;
  onGameOver: (summary: RunSummary) => void;
}
