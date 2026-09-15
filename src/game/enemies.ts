export type EnemyKind = 'walker' | 'runner' | 'brute';

/** 刷怪时传给 condition 的上下文。 */
export interface EnemySpawnContext {
  level: number;
  elapsed: number;
}

export interface EnemyDefinition {
  kind: EnemyKind;
  hp: number;
  speed: number;
  damage: number;
  xp: number;
  radius: number;
  scale: number;
  tint: number;
  deathWeight: number;
  /** 通过 condition 后的抽取权重。 */
  weight: number;
  animRate: number;
  pickupDrops: number;
  healthBarColor: number;
  hitParticles: number;
  /** 返回 true 则进入本轮刷怪池。 */
  condition: (ctx: EnemySpawnContext) => boolean;
}

const WALKER_HP = 34;
const WALKER_SPEED = 1.05;
const WALKER_DAMAGE = 9;

export const ENEMIES: readonly EnemyDefinition[] = [
  {
    kind: 'walker',
    hp: WALKER_HP,
    speed: WALKER_SPEED,
    damage: WALKER_DAMAGE,
    xp: 6,
    radius: 0.47,
    scale: 1.55,
    tint: 0xffffff,
    deathWeight: 1,
    weight: 60,
    animRate: 1,
    pickupDrops: 1,
    healthBarColor: 0x9bc95b,
    hitParticles: 10,
    condition: () => true,
  },
  {
    kind: 'runner',
    hp: WALKER_HP * 0.3,
    speed: WALKER_SPEED * 1.5,
    damage: WALKER_DAMAGE * 1.2,
    xp: 8,
    radius: 0.4,
    scale: 1.35,
    tint: 0xdde8bf,
    deathWeight: 0.82,
    weight: 40,
    animRate: 1.45,
    pickupDrops: 2,
    healthBarColor: 0x9bc95b,
    hitParticles: 10,
    condition: ({ level }) => level >= 10,
  },
  {
    kind: 'brute',
    hp: 118,
    speed: 0.62,
    damage: 20,
    xp: 20,
    radius: 0.82,
    scale: 2.35,
    tint: 0xdca08a,
    deathWeight: 1.8,
    weight: 13,
    animRate: 0.7,
    pickupDrops: 4,
    healthBarColor: 0xf06a4f,
    hitParticles: 18,
    condition: ({ elapsed }) => elapsed > 42,
  },
];

const ENEMY_BY_KIND = new Map(ENEMIES.map((enemy) => [enemy.kind, enemy]));

export function getEnemy(kind: EnemyKind): EnemyDefinition {
  const enemy = ENEMY_BY_KIND.get(kind);
  if (!enemy) throw new Error(`未知敌人：${kind}`);
  return enemy;
}

/** 遍历配置表，留下 condition 为 true 的，再按权重抽一只。 */
export function pickEnemy(ctx: EnemySpawnContext): EnemyDefinition {
  const pool = ENEMIES.filter((enemy) => enemy.condition(ctx));
  const source = pool.length > 0 ? pool : [getEnemy('walker')];
  const total = source.reduce((sum, enemy) => sum + enemy.weight, 0);
  let roll = Math.random() * total;
  for (const enemy of source) {
    roll -= enemy.weight;
    if (roll <= 0) return enemy;
  }
  return source[source.length - 1];
}

/** 后期血量成长封顶，避免变成海绵怪。 */
export function enemyDifficulty(elapsed: number): number {
  return Math.min(3.5, 1 + elapsed / 90);
}
