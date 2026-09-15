import type {
  PlayerStats,
  StatChange,
  StatKey,
  UpgradeCard,
  UpgradeDefinition,
  UpgradeRarity,
} from './types';

/** 未强化时的每秒生命回复。 */
export const BASE_REGEN = 0.8;

const UPGRADES: UpgradeDefinition[] = [
  {
    id: 'damage',
    name: '腐蚀弹头',
    description: '子弹伤害提高 20%。',
    rarity: 'common',
    icon: 'zap',
    condition: () => true,
    apply: (stats) => {
      stats.damage *= 1.2;
    },
  },
  {
    id: 'fire-rate',
    name: '快速扳机',
    description: '攻击速度提高 12%。',
    rarity: 'common',
    icon: 'gauge',
    condition: () => true,
    apply: (stats) => {
      stats.fireRate *= 1.12;
    },
  },
  {
    id: 'move-speed',
    name: '轻装战靴',
    description: '移动速度提高 8%。',
    rarity: 'common',
    icon: 'footprints',
    condition: () => true,
    apply: (stats) => {
      stats.moveSpeed *= 1.08;
    },
  },
  {
    id: 'vitality',
    name: '强心剂',
    description: '最大生命提高 18，并恢复等量生命。',
    rarity: 'common',
    icon: 'heart-pulse',
    condition: ({ level, stacks }) => level >= 10 && stacks < 8,
    apply: (stats) => {
      stats.maxHealth += 18;
      heal(stats, 18);
    },
  },
  {
    id: 'regen',
    name: '循环血清',
    description: '生命回复效率提高 60%，受击后 1.5 秒内暂停回血。',
    rarity: 'rare',
    icon: 'droplet',
    condition: ({ level, stacks }) => level >= 10 && stacks < 5,
    apply: (stats) => {
      stats.regen *= 1.6;
    },
  },
  {
    id: 'projectile-speed',
    name: '高压膛线',
    description: '子弹速度提高 25%。',
    rarity: 'rare',
    icon: 'wind',
    condition: () => true,
    apply: (stats) => {
      stats.projectileSpeed *= 1.25;
    },
  },
  {
    id: 'pickup',
    name: '磁化背包',
    description: '经验拾取范围提高 35%。',
    rarity: 'rare',
    icon: 'magnet',
    condition: ({ stacks }) => stacks < 6,
    apply: (stats) => {
      stats.pickupRadius *= 1.35;
    },
  },
  {
    id: 'caliber',
    name: '重型弹芯',
    description: '子弹体积提高 20%，伤害提高 10%。',
    rarity: 'rare',
    icon: 'maximize-2',
    condition: () => true,
    apply: (stats) => {
      stats.projectileSize *= 1.2;
      stats.damage *= 1.1;
    },
  },
  {
    id: 'crit',
    name: '猎杀标记',
    description: '暴击率提高 8%，暴击伤害提高 25%。',
    rarity: 'rare',
    icon: 'target',
    condition: ({ stacks }) => stacks < 7,
    apply: (stats) => {
      stats.critChance = Math.min(0.8, stats.critChance + 0.08);
      stats.critDamage += 0.25;
    },
  },
  {
    id: 'chosen-one',
    name: '天选之子',
    description: '受到碰撞伤害时有 6% 概率完全免伤，可叠加 5 层。',
    rarity: 'epic',
    icon: 'crown',
    condition: ({ level, stacks }) => level >= 5 && stacks < 5,
    apply: (stats) => {
      stats.damageAvoidance = Math.min(1, stats.damageAvoidance + 0.06);
    },
  },
  {
    id: 'sharpshooter',
    name: '神枪手',
    description: '每次射击有 1% 概率爆头，命中后一击必杀。无等级限制，无层数上限。',
    rarity: 'epic',
    icon: 'crosshair',
    condition: () => true,
    apply: (stats) => {
      stats.headshotChance = Math.min(1, stats.headshotChance + 0.01);
    },
  },
  {
    id: 'pierce',
    name: '穿甲弹',
    description: '子弹额外穿透 1 个敌人。',
    rarity: 'epic',
    icon: 'crosshair',
    condition: ({ stacks }) => stacks < 4,
    apply: (stats) => {
      stats.pierce += 1;
    },
  },
  {
    id: 'multishot',
    name: '分裂射击',
    description: '每次射击额外发射 1 枚子弹。',
    rarity: 'epic',
    icon: 'git-fork',
    condition: ({ stacks }) => stacks < 4,
    apply: (stats) => {
      stats.projectiles += 1;
    },
  },
  {
    id: 'armor',
    name: '拼接护甲',
    description: '最大生命提高 30，移速降低 3%。',
    rarity: 'epic',
    icon: 'shield',
    condition: ({ level, stacks }) => level >= 10 && stacks < 5,
    apply: (stats) => {
      stats.maxHealth += 30;
      heal(stats, 30);
      stats.moveSpeed *= 0.97;
    },
  },
];

const RARITY_LABEL: Record<UpgradeRarity, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
};

/** 卡面数值展示：标签 + 格式化方式，顺序即卡面行序。 */
const STAT_PRESENTATION: Record<StatKey, { label: string; format: (value: number) => string }> = {
  maxHealth: { label: '最大生命', format: (value) => String(Math.round(value)) },
  regen: { label: '生命回复', format: (value) => `${value.toFixed(2)}/秒` },
  moveSpeed: { label: '移动速度', format: (value) => value.toFixed(2) },
  damage: { label: '子弹伤害', format: (value) => value.toFixed(1) },
  fireRate: { label: '攻击频率', format: (value) => `${value.toFixed(2)}/秒` },
  projectileSpeed: { label: '子弹速度', format: (value) => value.toFixed(1) },
  projectileSize: { label: '子弹体积', format: (value) => `×${value.toFixed(2)}` },
  projectiles: { label: '弹丸数量', format: (value) => `${Math.round(value)} 发` },
  pierce: { label: '穿透数量', format: (value) => `${Math.round(value)} 个` },
  pickupRadius: { label: '拾取范围', format: (value) => value.toFixed(2) },
  critChance: { label: '暴击率', format: (value) => `${Math.round(value * 100)}%` },
  critDamage: { label: '暴击伤害', format: (value) => `×${value.toFixed(2)}` },
  damageAvoidance: { label: '免伤概率', format: (value) => `${Math.round(value * 100)}%` },
  headshotChance: { label: '爆头概率', format: (value) => `${Math.round(value * 100)}%` },
};

function weightsForLevel(level: number): Record<UpgradeRarity, number> {
  return {
    common: Math.max(24, 72 - level * 2),
    rare: Math.min(52, 20 + level * 2),
    epic: Math.min(24, 4 + level * 1.5),
  };
}

function weightedPick<T extends { rarity: UpgradeRarity }>(items: T[], level: number): T {
  const weights = weightsForLevel(level);
  const total = items.reduce((sum, item) => sum + weights[item.rarity], 0);
  let roll = Math.random() * total;

  for (const item of items) {
    roll -= weights[item.rarity];
    if (roll <= 0) return item;
  }

  return items[items.length - 1];
}

/** 统一的回复入口，治疗不会越过最大生命。 */
export function heal(stats: PlayerStats, amount: number): void {
  stats.health = Math.min(stats.maxHealth, stats.health + amount);
}

export function formatStat(key: StatKey, value: number): string {
  return STAT_PRESENTATION[key].format(value);
}

export function createPlayerStats(): PlayerStats {
  return {
    maxHealth: 100,
    health: 100,
    regen: BASE_REGEN,
    moveSpeed: 4.8,
    damage: 16,
    fireRate: 2.6,
    projectileSpeed: 14,
    projectileSize: 1,
    projectiles: 1,
    pierce: 0,
    pickupRadius: 2.2,
    critChance: 0.05,
    critDamage: 1.5,
    damageAvoidance: 0,
    headshotChance: 0,
  };
}

/** 用当前属性试算一层强化的收益，供卡面显示提升前后的数值。 */
export function describeUpgrade(stats: PlayerStats, id: string): StatChange[] {
  const upgrade = UPGRADES.find((item) => item.id === id);
  if (!upgrade) return [];

  const next: PlayerStats = { ...stats };
  upgrade.apply(next);

  const changes: StatChange[] = [];
  for (const key of Object.keys(STAT_PRESENTATION) as StatKey[]) {
    const before = stats[key];
    const after = next[key];
    if (Math.abs(after - before) < 0.0001) continue;
    changes.push({
      label: STAT_PRESENTATION[key].label,
      from: formatStat(key, before),
      to: formatStat(key, after),
      up: after > before,
    });
  }

  return changes;
}

export function rollUpgradeCards(
  level: number,
  stacks: Map<string, number>,
  stats: PlayerStats,
): UpgradeCard[] {
  const available = UPGRADES.filter((upgrade) =>
    upgrade.condition({
      level,
      stacks: stacks.get(upgrade.id) ?? 0,
      stats,
    }),
  );
  const pool = [...available];
  const result: UpgradeCard[] = [];

  while (result.length < 3 && pool.length > 0) {
    const chosen = weightedPick(pool, level);
    pool.splice(pool.indexOf(chosen), 1);
    result.push({
      id: chosen.id,
      name: chosen.name,
      description: chosen.description,
      rarity: chosen.rarity,
      icon: chosen.icon,
      stacks: stacks.get(chosen.id) ?? 0,
      changes: describeUpgrade(stats, chosen.id),
    });
  }

  return result;
}

export function applyUpgrade(stats: PlayerStats, id: string): UpgradeDefinition | undefined {
  const upgrade = UPGRADES.find((item) => item.id === id);
  upgrade?.apply(stats);
  return upgrade;
}

export function rarityLabel(rarity: UpgradeRarity): string {
  return RARITY_LABEL[rarity];
}
