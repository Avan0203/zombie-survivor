import * as THREE from 'three';
import type { SoundEngine } from './audio.js';
import type {
  DamageEvent,
  GameCallbacks,
  GamePhase,
  HudState,
  PlayerStats,
  UpgradeCard,
} from './types.js';
import { applyUpgrade, BASE_REGEN, createPlayerStats, heal, rollUpgradeCards } from './upgrades.js';
import type { GameAssets, SpriteAsset } from './assets.js';
import { enemyDifficulty, getEnemy, pickEnemy, type EnemyKind } from './enemies.js';
import {
  createSpriteInstanceMaterial,
  createTintInstanceMaterial,
  InstanceBatch,
} from './instanceBatch.js';
import { ObjectPool, swapRemove } from './pool.js';

const ARENA_HALF_WIDTH = 15.5;
const ARENA_HALF_HEIGHT = 8.7;
const BASE_VIEW_WIDTH = 34;
const BASE_VIEW_HEIGHT = 20;
const PLAYER_RADIUS = 0.48;
const PLAYER_SPRITE_SIZE = 1.45;
const DEATH_FPS = 12;
const DEATH_HOLD = 0.5;
const ZOMBIE_WALK_FPS = 8.5;
const MAX_ENEMIES = 180;
const MAX_BULLETS = 256;
const MAX_PICKUPS = 200;
const MAX_PARTICLES = 384;
// InstancedMesh 都在原点，只能靠 renderOrder 分层，且必须低于植被（2+）
const RENDER_ENEMY_SHADOW = 0.01;
const RENDER_BODY = 0.02;
const RENDER_PICKUP = 0.03;
const RENDER_BULLET = 0.04;
const RENDER_PARTICLE = 0.05;
const RENDER_BAR_BACK = 0.06;
const RENDER_BAR = 0.07;
const BASE_PICKUP_RADIUS = 0.12;
const BASE_PICKUP_COLLECT = 0.4;
const BASE_PICKUP_VALUE = 6;
// 受击后回血要暂停一会儿，避免站着无脑换血
const REGEN_HIT_PAUSE = 1.5;

interface EnemyEntity {
  id: number;
  kind: EnemyKind;
  position: THREE.Vector2;
  velocity: THREE.Vector2;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  xp: number;
  radius: number;
  visualZ: number;
  hitFlash: number;
  attackTimer: number;
  animationTime: number;
  facing: number;
  state: 'alive' | 'dying';
  deathTime: number;
}

interface BulletEntity {
  position: THREE.Vector2;
  velocity: THREE.Vector2;
  damage: number;
  critical: boolean;
  headshot: boolean;
  life: number;
  pierce: number;
  size: number;
  color: number;
  hitIds: Set<number>;
}

interface PickupEntity {
  position: THREE.Vector2;
  velocity: THREE.Vector2;
  value: number;
  phase: number;
}

interface ParticleEntity {
  position: THREE.Vector2;
  velocity: THREE.Vector2;
  life: number;
  maxLife: number;
  size: number;
  color: number;
}

interface GameplayGfx {
  zombieWalk: InstanceBatch;
  zombieDeath: InstanceBatch;
  enemyShadows: InstanceBatch;
  healthBarBacks: InstanceBatch;
  healthBars: InstanceBatch;
  bullets: InstanceBatch;
  pickups: InstanceBatch;
  particles: InstanceBatch;
}

interface PlayerEntity {
  position: THREE.Vector2;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  stats: PlayerStats;
  fireTimer: number;
  invulnerable: number;
  regenDelay: number;
  regenSpark: number;
  angle: number;
  animationTime: number;
  facing: number;
}

interface FoliagePlacement {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  color: THREE.Color;
}

interface ParallaxLayer {
  object: THREE.Object3D;
  baseX: number;
  baseY: number;
  xFactor: number;
  yFactor: number;
  swayX: number;
  swayY: number;
  speed: number;
  phase: number;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRange(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

function pickupVisualRadius(value: number): number {
  return BASE_PICKUP_RADIUS * Math.min(2.6, Math.sqrt(Math.max(value, 0.001) / BASE_PICKUP_VALUE));
}

function createEnemyEntity(): EnemyEntity {
  return {
    id: 0,
    kind: 'walker',
    position: new THREE.Vector2(),
    velocity: new THREE.Vector2(),
    hp: 0,
    maxHp: 0,
    speed: 0,
    damage: 0,
    xp: 0,
    radius: 0,
    visualZ: 0.9,
    hitFlash: 0,
    attackTimer: 0,
    animationTime: 0,
    facing: 1,
    state: 'alive',
    deathTime: 0,
  };
}

function createBulletEntity(): BulletEntity {
  return {
    position: new THREE.Vector2(),
    velocity: new THREE.Vector2(),
    damage: 0,
    critical: false,
    headshot: false,
    life: 0,
    pierce: 0,
    size: 0.11,
    color: 0xe9f3b0,
    hitIds: new Set(),
  };
}

function createPickupEntity(): PickupEntity {
  return {
    position: new THREE.Vector2(),
    velocity: new THREE.Vector2(),
    value: 0,
    phase: 0,
  };
}

function createParticleEntity(): ParticleEntity {
  return {
    position: new THREE.Vector2(),
    velocity: new THREE.Vector2(),
    life: 0,
    maxLife: 1,
    size: 0.06,
    color: 0xffffff,
  };
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: GameCallbacks;
  private readonly assets: GameAssets;
  private readonly audio: SoundEngine;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-17, 17, 10, -10, 0.1, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly viewport = new THREE.Vector2();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly pointerWorld = new THREE.Vector2();
  private readonly scratchMove = new THREE.Vector2();
  private readonly scratchToward = new THREE.Vector2();
  private readonly scratchPickup = new THREE.Vector2();
  private readonly keys = new Set<string>();
  private readonly gfx: GameplayGfx;
  private readonly enemyPool = new ObjectPool(createEnemyEntity);
  private readonly bulletPool = new ObjectPool(createBulletEntity);
  private readonly pickupPool = new ObjectPool(createPickupEntity);
  private readonly particlePool = new ObjectPool(createParticleEntity);

  private phase: GamePhase = 'ready';
  private player?: PlayerEntity;
  private readonly enemies: EnemyEntity[] = [];
  private readonly bullets: BulletEntity[] = [];
  private readonly pickups: PickupEntity[] = [];
  private readonly particles: ParticleEntity[] = [];
  private readonly parallaxLayers: ParallaxLayer[] = [];
  private readonly baseUpgradeStacks = new Map<string, number>();
  private offeredUpgrades: UpgradeCard[] = [];
  private pendingLevels = 0;
  private enemyId = 0;
  private level = 1;
  private xp = 0;
  private xpToNext = 15;
  private elapsed = 0;
  private kills = 0;
  private spawnTimer = 0;
  private hudTimer = 0;
  private shake = 0;
  private forestTime = 0;
  private lastFrame = 0;
  private animationFrame = 0;
  private disposed = false;
  /** 最近一只存活僵尸的距离与声像，驱动吼叫循环的强度与方位。 */
  private nearestEnemyDistance = Number.POSITIVE_INFINITY;
  private nearestEnemyPan = 0;

  constructor(
    canvas: HTMLCanvasElement,
    assets: GameAssets,
    callbacks: GameCallbacks,
    audio: SoundEngine,
  ) {
    this.canvas = canvas;
    this.assets = assets;
    this.callbacks = callbacks;
    this.audio = audio;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#070c09');
    this.scene.fog = new THREE.FogExp2(0x09120c, 0.012);
    this.camera.position.set(0, 0, 20);
    this.createArena();
    this.gfx = this.createGameplayLayers();
    this.bindEvents();
    this.resize();
    this.emitHud();
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  startRun(): void {
    this.clearRunObjects();
    // 开始按钮就是用户手势，AudioContext 必须在这里之前被创建 / 恢复
    this.audio.unlock();
    this.audio.startRun();
    this.baseUpgradeStacks.clear();
    this.level = 1;
    this.xp = 0;
    this.xpToNext = 15;
    this.elapsed = 0;
    this.kills = 0;
    this.spawnTimer = 0.8;
    this.pendingLevels = 0;
    this.offeredUpgrades = [];
    this.createPlayer();
    this.setPhase('running');
    this.emitHud();
  }

  resume(): void {
    if (this.phase === 'paused') this.setPhase('running');
  }

  pause(): void {
    if (this.phase === 'running') this.setPhase('paused');
  }

  chooseUpgrade(id: string): void {
    if (this.phase !== 'upgrade' || !this.player) return;
    const chosen = this.offeredUpgrades.find((card) => card.id === id);
    if (!chosen) return;

    applyUpgrade(this.player.stats, id);
    this.baseUpgradeStacks.set(id, (this.baseUpgradeStacks.get(id) ?? 0) + 1);
    this.pendingLevels -= 1;
    this.emitHud();

    if (this.pendingLevels > 0) {
      this.offeredUpgrades = rollUpgradeCards(this.level, this.baseUpgradeStacks, this.player.stats);
      this.callbacks.onUpgrade(this.offeredUpgrades);
      return;
    }

    this.setPhase('running');
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('blur', this.handleBlur);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.clearRunObjects();
    for (const batch of Object.values(this.gfx)) {
      this.scene.remove(batch.mesh);
      batch.dispose();
    }
    this.renderer.dispose();
  }

  private createArena(): void {
    const groundTexture = this.assets.ground.clone();
    groundTexture.needsUpdate = true;
    groundTexture.wrapS = THREE.MirroredRepeatWrapping;
    groundTexture.wrapT = THREE.MirroredRepeatWrapping;
    groundTexture.repeat.set(8.5, 5.4);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF_WIDTH * 2 + 4, ARENA_HALF_HEIGHT * 2 + 4),
      new THREE.MeshBasicMaterial({ map: groundTexture, color: 0xeef2e6 }),
    );
    ground.position.z = -2;
    this.scene.add(ground);

    const borderMaterial = new THREE.MeshBasicMaterial({ color: 0x262d23 });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF_WIDTH * 2 + 1, 0.28), borderMaterial);
    top.position.set(0, ARENA_HALF_HEIGHT + 0.18, -1);
    const bottom = top.clone();
    bottom.position.y = -ARENA_HALF_HEIGHT - 0.18;
    const left = new THREE.Mesh(new THREE.PlaneGeometry(0.28, ARENA_HALF_HEIGHT * 2 + 0.35), borderMaterial);
    left.position.set(-ARENA_HALF_WIDTH - 0.18, 0, -1);
    const right = left.clone();
    right.position.x = ARENA_HALF_WIDTH + 0.18;
    this.scene.add(top, bottom, left, right);

    const stainGeometry = new THREE.CircleGeometry(0.4, 12);
    for (let i = 0; i < 24; i += 1) {
      const stain = new THREE.Mesh(
        stainGeometry,
        new THREE.MeshBasicMaterial({
          color: i % 4 === 0 ? 0x39231c : 0x1d2a21,
          transparent: true,
          opacity: i % 4 === 0 ? 0.28 : 0.2,
          depthWrite: false,
        }),
      );
      stain.position.set(
        THREE.MathUtils.randFloat(-ARENA_HALF_WIDTH, ARENA_HALF_WIDTH),
        THREE.MathUtils.randFloat(-ARENA_HALF_HEIGHT, ARENA_HALF_HEIGHT),
        -1.5,
      );
      stain.scale.set(
        THREE.MathUtils.randFloat(0.35, 1.8),
        THREE.MathUtils.randFloat(0.2, 0.9),
        1,
      );
      stain.rotation.z = Math.random() * Math.PI;
      this.scene.add(stain);
    }

    this.createForest();
  }

  private createForest(): void {
    const random = createSeededRandom(0x5f3759df);
    // 手绘贴图自带明暗，实例色只做冷暖变化，压深色会把层次吃干净
    const grassColors = [0xffffff, 0xf1f7e2, 0xdcebd4, 0xe6f0cb].map(
      (color) => new THREE.Color(color),
    );
    const bushColors = [0xffffff, 0xe4f0d8, 0xcddfc7, 0xf3f7e3].map(
      (color) => new THREE.Color(color),
    );

    const edgeTexture = this.assets.forest.edge.clone();
    edgeTexture.needsUpdate = true;
    edgeTexture.wrapS = THREE.MirroredRepeatWrapping;
    edgeTexture.wrapT = THREE.ClampToEdgeWrapping;
    edgeTexture.repeat.set(5.5, 1);
    const edgeMaterial = new THREE.MeshBasicMaterial({
      map: edgeTexture,
      transparent: true,
      opacity: 0.9,
      alphaTest: 0.2,
      depthWrite: false,
      color: 0xd2dacb,
    });
    const edgeGeometry = new THREE.PlaneGeometry(42, 4.8);
    const upperForest = new THREE.Mesh(edgeGeometry, edgeMaterial);
    upperForest.position.set(0, ARENA_HALF_HEIGHT + 2.02, -1.45);
    upperForest.renderOrder = 1;
    const lowerForest = upperForest.clone();
    lowerForest.position.y = -ARENA_HALF_HEIGHT - 1.72;
    lowerForest.scale.y = -1;
    this.scene.add(upperForest, lowerForest);
    this.addParallaxLayer(upperForest, 0.55, 0.42, 0.08, 0.035, 0.32);
    this.addParallaxLayer(lowerForest, 0.55, 0.42, 0.07, 0.03, 0.36, 1.7);

    const canopyTexture = edgeTexture.clone();
    canopyTexture.needsUpdate = true;
    // 只取贴图底部参差的一截，前景树冠才有叶缘剪影，否则等于压了块半透明矩形
    canopyTexture.repeat.set(1.7, 0.26);
    const canopyMaterial = new THREE.MeshBasicMaterial({
      map: canopyTexture,
      transparent: true,
      opacity: 0.5,
      alphaTest: 0.18,
      depthWrite: false,
      color: 0x74886f,
    });
    const canopyGeometry = new THREE.PlaneGeometry(40, 3.8);
    const upperCanopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
    upperCanopy.position.set(0, ARENA_HALF_HEIGHT + 0.42, 0.18);
    upperCanopy.renderOrder = 7;
    const lowerCanopy = upperCanopy.clone();
    lowerCanopy.position.y = -ARENA_HALF_HEIGHT - 0.42;
    lowerCanopy.scale.y = -1;
    this.scene.add(upperCanopy, lowerCanopy);
    this.addParallaxLayer(upperCanopy, 0.95, 0.68, 0.16, 0.08, 0.78);
    this.addParallaxLayer(lowerCanopy, 0.95, 0.68, 0.14, 0.07, 0.72, 2.1);

    const mistTexture = this.assets.forest.mist;
    const mistLayout = [
      { y: -5.8, opacity: 0.16, scale: 1.12, speed: 0.18, phase: 0.4 },
      { y: 0.2, opacity: 0.13, scale: 0.92, speed: 0.14, phase: 2.3 },
      { y: 5.7, opacity: 0.12, scale: 1.05, speed: 0.2, phase: 4.1 },
    ];
    mistLayout.forEach((layout, index) => {
      const texture = mistTexture.clone();
      texture.needsUpdate = true;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.repeat.set(2.2 + index * 0.35, 1);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0x718575,
        transparent: true,
        opacity: layout.opacity,
        depthWrite: false,
      });
      const mist = new THREE.Mesh(new THREE.PlaneGeometry(38, 4.8), material);
      mist.position.set(0, layout.y, -0.48 + index * 0.14);
      mist.scale.x = layout.scale;
      mist.renderOrder = 6;
      this.scene.add(mist);
      this.addParallaxLayer(
        mist,
        0.48 + index * 0.08,
        0.24 + index * 0.04,
        0.72,
        0.09,
        layout.speed,
        layout.phase,
      );
    });

    const groundGrass: FoliagePlacement[][] = this.assets.forest.grass.map(() => []);
    for (let index = 0; index < 260; index += 1) {
      const x = randomRange(random, -ARENA_HALF_WIDTH - 0.6, ARENA_HALF_WIDTH + 0.6);
      const y = randomRange(random, -ARENA_HALF_HEIGHT - 0.45, ARENA_HALF_HEIGHT + 0.45);
      groundGrass[index % groundGrass.length].push({
        x,
        y,
        scale: randomRange(random, 0.42, 0.78),
        rotation: randomRange(random, -0.1, 0.1),
        color: grassColors[Math.floor(random() * grassColors.length)],
      });
    }
    groundGrass.forEach((placements, index) => {
      const mesh = this.createInstancedFoliage(this.assets.forest.grass[index], placements, -1.15, 2, 0.8);
      this.addParallaxLayer(mesh, 0.11, 0.07, 0.035, 0.025, 0.58 + index * 0.04, index * 1.4);
    });

    const foregroundGrass: FoliagePlacement[][] = this.assets.forest.grass.map(() => []);
    for (let index = 0; index < 84; index += 1) {
      const upper = random() < 0.5;
      foregroundGrass[index % foregroundGrass.length].push({
        x: randomRange(random, -ARENA_HALF_WIDTH, ARENA_HALF_WIDTH),
        y: upper
          ? randomRange(random, ARENA_HALF_HEIGHT * 0.58, ARENA_HALF_HEIGHT + 0.2)
          : randomRange(random, -ARENA_HALF_HEIGHT - 0.2, -ARENA_HALF_HEIGHT * 0.58),
        scale: randomRange(random, 0.55, 1.02),
        rotation: randomRange(random, -0.16, 0.16),
        color: grassColors[Math.floor(random() * grassColors.length)],
      });
    }
    foregroundGrass.forEach((placements, index) => {
      const mesh = this.createInstancedFoliage(this.assets.forest.grass[index], placements, 0.05, 5, 0.55);
      this.addParallaxLayer(mesh, 0.72, 0.48, 0.1, 0.06, 1.05 + index * 0.06, 0.8 + index * 1.5);
    });

    const bushes: FoliagePlacement[][] = this.assets.forest.bushes.map(() => []);
    let bushIndex = 0;
    while (bushIndex < 34) {
      let x: number;
      let y: number;
      if (random() < 0.68) {
        const side = Math.floor(random() * 4);
        if (side === 0) {
          x = randomRange(random, -ARENA_HALF_WIDTH, ARENA_HALF_WIDTH);
          y = randomRange(random, ARENA_HALF_HEIGHT * 0.68, ARENA_HALF_HEIGHT + 0.45);
        } else if (side === 1) {
          x = randomRange(random, ARENA_HALF_WIDTH * 0.68, ARENA_HALF_WIDTH + 0.45);
          y = randomRange(random, -ARENA_HALF_HEIGHT, ARENA_HALF_HEIGHT);
        } else if (side === 2) {
          x = randomRange(random, -ARENA_HALF_WIDTH, ARENA_HALF_WIDTH);
          y = randomRange(random, -ARENA_HALF_HEIGHT - 0.45, -ARENA_HALF_HEIGHT * 0.68);
        } else {
          x = randomRange(random, -ARENA_HALF_WIDTH - 0.45, -ARENA_HALF_WIDTH * 0.68);
          y = randomRange(random, -ARENA_HALF_HEIGHT, ARENA_HALF_HEIGHT);
        }
      } else {
        x = randomRange(random, -ARENA_HALF_WIDTH + 0.6, ARENA_HALF_WIDTH - 0.6);
        y = randomRange(random, -ARENA_HALF_HEIGHT + 0.55, ARENA_HALF_HEIGHT - 0.55);
      }

      if (Math.hypot(x, y) < 2.7) continue;
      bushes[bushIndex % bushes.length].push({
        x,
        y,
        scale: randomRange(random, 0.95, 1.6),
        rotation: randomRange(random, -0.06, 0.06),
        color: bushColors[Math.floor(random() * bushColors.length)],
      });
      bushIndex += 1;
    }
    bushes.forEach((placements, index) => {
      const mesh = this.createInstancedFoliage(this.assets.forest.bushes[index], placements, -0.72, 3, 0.96);
      this.addParallaxLayer(mesh, 0.26, 0.17, 0.045, 0.035, 0.62 + index * 0.05, 1.1 + index);
    });
  }

  private createInstancedFoliage(
    texture: THREE.Texture,
    placements: FoliagePlacement[],
    z: number,
    renderOrder: number,
    opacity: number,
  ): THREE.InstancedMesh {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      alphaTest: 0.18,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const image = texture.image as { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number };
    const imageWidth = image?.naturalWidth ?? image?.width ?? 1;
    const imageHeight = image?.naturalHeight ?? image?.height ?? 1;
    const aspect = imageWidth / imageHeight;

    placements.forEach((placement, index) => {
      position.set(placement.x, placement.y, z);
      rotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), placement.rotation);
      scale.set(placement.scale * aspect, placement.scale, 1);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, placement.color);
    });

    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.renderOrder = renderOrder;
    this.scene.add(mesh);
    return mesh;
  }

  private addParallaxLayer(
    object: THREE.Object3D,
    xFactor: number,
    yFactor: number,
    swayX: number,
    swayY: number,
    speed: number,
    phase = 0,
  ): void {
    this.parallaxLayers.push({
      object,
      baseX: object.position.x,
      baseY: object.position.y,
      xFactor,
      yFactor,
      swayX,
      swayY,
      speed,
      phase,
    });
  }

  private createGameplayLayers(): GameplayGfx {
    const layers: GameplayGfx = {
      zombieWalk: new InstanceBatch({
        geometry: new THREE.PlaneGeometry(1, 1),
        material: createSpriteInstanceMaterial(this.assets.zombie.texture, this.assets.zombie.frames),
        capacity: MAX_ENEMIES,
        useFrame: true,
        renderOrder: RENDER_BODY,
      }),
      zombieDeath: new InstanceBatch({
        geometry: new THREE.PlaneGeometry(1, 1),
        material: createSpriteInstanceMaterial(
          this.assets.zombieDeath.texture,
          this.assets.zombieDeath.frames,
        ),
        capacity: MAX_ENEMIES,
        useFrame: true,
        renderOrder: RENDER_BODY,
      }),
      enemyShadows: new InstanceBatch({
        geometry: new THREE.CircleGeometry(1, 16),
        material: createTintInstanceMaterial({
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
        }),
        capacity: MAX_ENEMIES,
        renderOrder: RENDER_ENEMY_SHADOW,
      }),
      healthBarBacks: new InstanceBatch({
        geometry: new THREE.PlaneGeometry(1, 1),
        material: createTintInstanceMaterial({
          transparent: true,
          opacity: 0.82,
          depthWrite: false,
        }),
        capacity: MAX_ENEMIES,
        renderOrder: RENDER_BAR_BACK,
      }),
      healthBars: new InstanceBatch({
        geometry: new THREE.PlaneGeometry(1, 1),
        material: createTintInstanceMaterial({}),
        capacity: MAX_ENEMIES,
        renderOrder: RENDER_BAR,
      }),
      bullets: new InstanceBatch({
        geometry: new THREE.CircleGeometry(1, 10),
        material: createTintInstanceMaterial({ transparent: true, depthWrite: false }),
        capacity: MAX_BULLETS,
        renderOrder: RENDER_BULLET,
      }),
      pickups: new InstanceBatch({
        geometry: new THREE.CircleGeometry(1, 6),
        material: createTintInstanceMaterial({ transparent: true, depthWrite: false }),
        capacity: MAX_PICKUPS,
        renderOrder: RENDER_PICKUP,
      }),
      particles: new InstanceBatch({
        geometry: new THREE.CircleGeometry(1, 5),
        material: createTintInstanceMaterial({
          transparent: true,
          useOpacityAttr: true,
          depthWrite: false,
        }),
        capacity: MAX_PARTICLES,
        useOpacity: true,
        renderOrder: RENDER_PARTICLE,
      }),
    };

    for (const batch of Object.values(layers)) this.scene.add(batch.mesh);
    return layers;
  }

  private createPlayer(): void {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 18),
      new THREE.MeshBasicMaterial({
        color: 0x050805,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      }),
    );
    shadow.scale.y = 0.5;
    shadow.position.z = -0.3;
    shadow.renderOrder = RENDER_ENEMY_SHADOW;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PLAYER_SPRITE_SIZE, PLAYER_SPRITE_SIZE),
      this.createAnimatedMaterial(this.assets.survivor),
    );
    mesh.position.z = 1;
    mesh.renderOrder = RENDER_BODY;

    this.player = {
      position: new THREE.Vector2(),
      mesh,
      shadow,
      stats: createPlayerStats(),
      fireTimer: 0,
      invulnerable: 0,
      regenDelay: 0,
      regenSpark: 0,
      angle: 0,
      animationTime: 0,
      facing: 1,
    };
    this.scene.add(shadow, mesh);
  }

  private createAnimatedMaterial(sprite: SpriteAsset, tint = 0xffffff): THREE.MeshBasicMaterial {
    const texture = sprite.texture.clone();
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1 / Math.max(1, sprite.frames), 1);
    texture.offset.set(0, 0);
    texture.needsUpdate = true;

    return new THREE.MeshBasicMaterial({
      map: texture,
      color: new THREE.Color(tint),
      transparent: true,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
    });
  }

  private updateWalkFrame(
    sprite: SpriteAsset,
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    elapsed: number,
    moving: boolean,
    framesPerSecond: number,
  ): void {
    if (sprite.frames <= 1 || !mesh.material.map) return;
    const frame = moving ? Math.floor(elapsed * framesPerSecond) % sprite.frames : 0;
    mesh.material.map.offset.x = frame / sprite.frames;
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase;
    // 暂停 / 升级 / 结算时停掉吼叫循环，已经在响的一次性音效自然收尾
    this.audio.setActive(phase === 'running');
    this.callbacks.onPhase(phase);
    this.emitHud();
  }

  private bindEvents(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('resize', this.resize);
    window.addEventListener('blur', this.handleBlur);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (event.code === 'Escape') {
      if (this.phase === 'running') this.pause();
      else if (this.phase === 'paused') this.resume();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly handleBlur = (): void => {
    this.keys.clear();
    this.pause();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  };

  private readonly resize = (): void => {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const aspect = width / height;
    let viewWidth = BASE_VIEW_WIDTH;
    let viewHeight = BASE_VIEW_HEIGHT;

    if (aspect > BASE_VIEW_WIDTH / BASE_VIEW_HEIGHT) {
      viewWidth = BASE_VIEW_HEIGHT * aspect;
    } else {
      viewHeight = BASE_VIEW_WIDTH / aspect;
    }

    this.viewport.set(viewWidth, viewHeight);
    this.renderer.setSize(width, height, false);
    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
  };

  private readonly loop = (time: number): void => {
    if (this.disposed) return;
    const delta = this.lastFrame === 0 ? 0 : Math.min((time - this.lastFrame) / 1000, 0.05);
    this.lastFrame = time;

    if (this.phase === 'running') this.update(delta);
    this.updateCamera(delta);
    this.updateForestParallax(delta);
    this.render();

    this.hudTimer += delta;
    if (this.hudTimer >= 0.1) {
      this.hudTimer = 0;
      this.emitHud();
    }

    this.animationFrame = requestAnimationFrame(this.loop);
  };

  private update(delta: number): void {
    if (!this.player) return;
    this.elapsed += delta;
    this.shake = Math.max(0, this.shake - delta * 2.2);

    this.updatePointerWorld();
    this.updatePlayer(delta);
    this.updateSpawning(delta);
    this.updateEnemies(delta);
    this.updateRegen(delta);
    this.updateBullets(delta);
    this.updatePickups(delta);
    this.updateParticles(delta);
    this.updateAmbience(delta);
    this.syncInstanceBatches();

    if (this.player.stats.health <= 0) {
      this.player.stats.health = 0;
      this.audio.playerDeath();
      this.setPhase('gameover');
      this.callbacks.onGameOver({
        elapsed: this.elapsed,
        kills: this.kills,
        level: this.level,
      });
    }
  }

  private updatePointerWorld(): void {
    if (!this.player) return;
    this.pointerWorld.set(
      this.pointerNdc.x * (this.viewport.x / 2) + this.camera.position.x,
      this.pointerNdc.y * (this.viewport.y / 2) + this.camera.position.y,
    );
  }

  /** 世界坐标 x 折算成立体声声像，-1 左 … 1 右。 */
  private screenPan(x: number): number {
    const halfWidth = Math.max(0.001, this.viewport.x / 2);
    return THREE.MathUtils.clamp((x - this.camera.position.x) / halfWidth, -1, 1);
  }

  /**
   * 吼叫循环：由最近僵尸的距离与场上数量折算强度，
   * 越近、越挤就越密越响；空场时只剩远处偶尔一声。
   */
  private updateAmbience(delta: number): void {
    const proximity = THREE.MathUtils.clamp(1 - this.nearestEnemyDistance / 10, 0, 1);
    const crowd = Math.min(1, this.countAliveEnemies() / 45);
    this.audio.update(delta, proximity * 0.78 + crowd * 0.22, this.nearestEnemyPan);
  }

  private updatePlayer(delta: number): void {
    const player = this.player;
    if (!player) return;
    const move = this.scratchMove.set(
      Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) -
        Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')),
      Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) -
        Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')),
    );
    const moving = move.lengthSq() > 0;
    if (moving) move.normalize();

    player.position.addScaledVector(move, player.stats.moveSpeed * delta);
    player.position.x = THREE.MathUtils.clamp(
      player.position.x,
      -ARENA_HALF_WIDTH + PLAYER_RADIUS,
      ARENA_HALF_WIDTH - PLAYER_RADIUS,
    );
    player.position.y = THREE.MathUtils.clamp(
      player.position.y,
      -ARENA_HALF_HEIGHT + PLAYER_RADIUS,
      ARENA_HALF_HEIGHT - PLAYER_RADIUS,
    );
    player.angle = Math.atan2(
      this.pointerWorld.y - player.position.y,
      this.pointerWorld.x - player.position.x,
    );
    if (moving) {
      player.animationTime += delta;
    } else {
      player.animationTime = 0;
    }
    const aimDx = this.pointerWorld.x - player.position.x;
    if (Math.abs(aimDx) > 0.01) player.facing = aimDx < 0 ? -1 : 1;
    player.mesh.position.set(player.position.x, player.position.y, 1);
    player.mesh.rotation.z = 0;
    player.mesh.scale.x = player.facing;
    this.updateWalkFrame(this.assets.survivor, player.mesh, player.animationTime, moving, 10);
    // 精灵帧底边就是脚底，阴影要落在 position.y - 半个精灵高，而不是身体中心
    player.shadow.position.set(
      player.position.x,
      player.position.y - PLAYER_SPRITE_SIZE / 2,
      -0.3,
    );
    player.invulnerable = Math.max(0, player.invulnerable - delta);
    player.mesh.material.opacity = player.invulnerable > 0 && Math.floor(player.invulnerable * 14) % 2 === 0 ? 0.35 : 1;

    player.fireTimer -= delta;
    if (player.fireTimer <= 0) {
      player.fireTimer = Math.max(0.06, 1 / player.stats.fireRate);
      this.fireWeapon();
    }
  }

  private fireWeapon(): void {
    const player = this.player;
    if (!player) return;
    const count = player.stats.projectiles;
    const spread = count === 1 ? 0 : THREE.MathUtils.degToRad(9);
    const originOffset = 0.58;
    const originX = player.position.x + Math.cos(player.angle) * originOffset;
    const originY = player.position.y + Math.sin(player.angle) * originOffset;

    for (let index = 0; index < count; index += 1) {
      if (this.bullets.length >= MAX_BULLETS) break;
      const offset = (index - (count - 1) / 2) * spread;
      const angle = player.angle + offset;
      const headshot = Math.random() < player.stats.headshotChance;
      const critical = !headshot && Math.random() < player.stats.critChance;
      const damage = player.stats.damage * (critical ? player.stats.critDamage : 1);
      const size = 0.11 * player.stats.projectileSize * (headshot ? 1.5 : critical ? 1.35 : 1);
      const bullet = this.bulletPool.acquire();
      bullet.position.set(originX, originY);
      bullet.velocity.set(Math.cos(angle), Math.sin(angle)).multiplyScalar(player.stats.projectileSpeed);
      bullet.damage = damage;
      bullet.critical = critical;
      bullet.headshot = headshot;
      bullet.life = 1.7;
      bullet.pierce = player.stats.pierce;
      bullet.size = size;
      bullet.color = headshot ? 0xfff2a8 : critical ? 0xffd26d : 0xe9f3b0;
      bullet.hitIds.clear();
      this.bullets.push(bullet);
    }
    this.createMuzzleParticles(originX, originY, player.angle);
    // 一发弹丸一声枪响：多弹丸强化只把这一声推厚一点，不叠成糊墙
    this.audio.shoot(this.screenPan(originX), 1 + (count - 1) * 0.12);
  }

  private updateSpawning(delta: number): void {
    this.spawnTimer -= delta;
    if (this.spawnTimer > 0 || this.countAliveEnemies() >= Math.min(135, 24 + this.elapsed * 0.55)) return;

    const interval = Math.max(0.28, 1.18 - this.elapsed * 0.0065);
    this.spawnTimer = interval;
    this.spawnEnemy();
    if (this.elapsed > 55 && Math.random() < 0.45) this.spawnEnemy();
  }

  private countAliveEnemies(): number {
    let alive = 0;
    for (const enemy of this.enemies) {
      if (enemy.state === 'alive') alive += 1;
    }
    return alive;
  }

  private spawnEnemy(): void {
    if (this.enemies.length >= MAX_ENEMIES) return;
    const difficulty = enemyDifficulty(this.elapsed);
    const data = pickEnemy({ level: this.level, elapsed: this.elapsed });
    const edge = Math.floor(Math.random() * 4);
    const margin = 1.25;
    const enemy = this.enemyPool.acquire();

    if (edge === 0) enemy.position.set(THREE.MathUtils.randFloatSpread(ARENA_HALF_WIDTH * 2), ARENA_HALF_HEIGHT + margin);
    else if (edge === 1) enemy.position.set(ARENA_HALF_WIDTH + margin, THREE.MathUtils.randFloatSpread(ARENA_HALF_HEIGHT * 2));
    else if (edge === 2) enemy.position.set(THREE.MathUtils.randFloatSpread(ARENA_HALF_WIDTH * 2), -ARENA_HALF_HEIGHT - margin);
    else enemy.position.set(-ARENA_HALF_WIDTH - margin, THREE.MathUtils.randFloatSpread(ARENA_HALF_HEIGHT * 2));

    const hp = data.hp * difficulty;
    enemy.id = this.enemyId;
    enemy.kind = data.kind;
    enemy.velocity.set(0, 0);
    enemy.hp = hp;
    enemy.maxHp = hp;
    enemy.speed = data.speed * (1 + Math.min(0.24, this.elapsed / 500));
    enemy.damage = data.damage * (1 + this.elapsed / 260);
    enemy.xp = data.xp * difficulty;
    enemy.radius = data.radius;
    enemy.visualZ = 0.9 + Math.random() * 0.2;
    enemy.hitFlash = 0;
    enemy.attackTimer = 0;
    enemy.animationTime = Math.random();
    enemy.facing = 1;
    enemy.state = 'alive';
    enemy.deathTime = 0;
    this.enemyId += 1;
    this.enemies.push(enemy);
  }

  private updateEnemies(delta: number): void {
    const player = this.player;
    if (!player) return;
    this.nearestEnemyDistance = Number.POSITIVE_INFINITY;
    this.nearestEnemyPan = 0;

    for (let index = this.enemies.length - 1; index >= 0; index -= 1) {
      const enemy = this.enemies[index];
      const spec = getEnemy(enemy.kind);
      if (enemy.state === 'dying') {
        enemy.deathTime += delta;
        const { frames } = this.assets.zombieDeath;
        if (enemy.deathTime >= frames / DEATH_FPS + DEATH_HOLD) {
          for (let i = 0; i < spec.pickupDrops; i += 1) {
            this.createPickup(enemy.position.x, enemy.position.y, enemy.xp / spec.pickupDrops, i);
          }
          this.enemyPool.release(swapRemove(this.enemies, index));
        }
        continue;
      }
      const towardPlayer = this.scratchToward.subVectors(player.position, enemy.position);
      const distance = towardPlayer.length();
      if (distance > 0.001) towardPlayer.divideScalar(distance);

      if (distance < this.nearestEnemyDistance) {
        this.nearestEnemyDistance = distance;
        this.nearestEnemyPan = this.screenPan(enemy.position.x);
      }

      enemy.velocity.lerp(towardPlayer.multiplyScalar(enemy.speed), 1 - Math.exp(-delta * 4.5));
      enemy.position.addScaledVector(enemy.velocity, delta);
      enemy.animationTime += delta * spec.animRate;
      if (Math.abs(enemy.velocity.x) > 0.08) enemy.facing = enemy.velocity.x < 0 ? -1 : 1;
      if (enemy.hitFlash > 0) enemy.hitFlash -= delta;

      enemy.attackTimer = Math.max(0, enemy.attackTimer - delta);
      const collisionDistance = PLAYER_RADIUS + enemy.radius;
      if (distance <= collisionDistance && enemy.attackTimer <= 0 && player.invulnerable <= 0) {
        const avoided = Math.random() < player.stats.damageAvoidance;
        if (!avoided) {
          player.stats.health -= enemy.damage;
          player.regenDelay = REGEN_HIT_PAUSE;
          this.shake = Math.min(0.45, 0.18 + enemy.damage / 70);
          this.audio.hit();
          this.createHitParticles(player.position.x, player.position.y, 0xff6d5a, 8);
        } else {
          this.createHitParticles(player.position.x, player.position.y, 0x91f2d3, 10);
        }
        player.invulnerable = 0.42;
        enemy.attackTimer = 0.72;
      }

      if (enemy.hp <= 0) {
        this.killEnemy(index);
      }
    }
  }

  private killEnemy(index: number): void {
    const enemy = this.enemies[index];
    if (enemy.state === 'dying') return;
    const spec = getEnemy(enemy.kind);
    enemy.state = 'dying';
    enemy.deathTime = 0;
    this.kills += 1;
    this.audio.zombieDeath(this.screenPan(enemy.position.x), spec.deathWeight);
    this.createHitParticles(enemy.position.x, enemy.position.y, 0x9cc95f, spec.hitParticles);
  }

  private updateRegen(delta: number): void {
    const player = this.player;
    if (!player) return;
    const stats = player.stats;

    player.regenDelay = Math.max(0, player.regenDelay - delta);
    if (player.regenDelay > 0 || stats.health <= 0 || stats.health >= stats.maxHealth) return;

    heal(stats, stats.regen * delta);

    player.regenSpark += delta;
    if (player.regenSpark < 0.34) return;
    player.regenSpark = 0;
    this.createParticle(
      player.position.x + THREE.MathUtils.randFloatSpread(0.5),
      player.position.y + THREE.MathUtils.randFloat(0.15, 0.7),
      THREE.MathUtils.randFloatSpread(0.2),
      1.15,
      0x7ce28f,
      0.55,
    );
  }

  private updateBullets(delta: number): void {
    for (let bulletIndex = this.bullets.length - 1; bulletIndex >= 0; bulletIndex -= 1) {
      const bullet = this.bullets[bulletIndex];
      bullet.position.addScaledVector(bullet.velocity, delta);
      bullet.life -= delta;

      let consumed = false;
      for (let enemyIndex = this.enemies.length - 1; enemyIndex >= 0; enemyIndex -= 1) {
        const enemy = this.enemies[enemyIndex];
        if (bullet.hitIds.has(enemy.id)) continue;
        if (enemy.state === 'dying') continue;
        const hitRadius = 0.12 + enemy.radius;
        if (bullet.position.distanceToSquared(enemy.position) <= hitRadius * hitRadius) {
          bullet.hitIds.add(enemy.id);
          if (bullet.headshot) {
            enemy.hp = 0;
            this.killEnemy(enemyIndex);
          } else {
            enemy.hp -= bullet.damage;
          }
          enemy.hitFlash = 0.075;
          this.emitDamageNumber(
            bullet.position.x,
            bullet.position.y + 0.22,
            bullet.headshot ? enemy.maxHp : bullet.damage,
            bullet.critical,
            bullet.headshot,
          );
          this.createHitParticles(
            bullet.position.x,
            bullet.position.y,
            bullet.headshot ? 0xfff0a3 : 0xefc86d,
            bullet.headshot ? 12 : 4,
          );
          if (bullet.pierce > 0) {
            bullet.pierce -= 1;
          } else {
            consumed = true;
            break;
          }
        }
      }

      if (consumed || bullet.life <= 0 || Math.abs(bullet.position.x) > ARENA_HALF_WIDTH + 4 || Math.abs(bullet.position.y) > ARENA_HALF_HEIGHT + 4) {
        this.bulletPool.release(swapRemove(this.bullets, bulletIndex));
      }
    }
  }

  private emitDamageNumber(
    x: number,
    y: number,
    amount: number,
    critical: boolean,
    headshot: boolean,
  ): void {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = rect.left + ((x - this.camera.position.x) / this.viewport.x + 0.5) * rect.width;
    const screenY = rect.top + (0.5 - (y - this.camera.position.y) / this.viewport.y) * rect.height;
    const event: DamageEvent = {
      screenX,
      screenY,
      amount: Math.round(amount),
      critical,
      headshot,
    };
    this.callbacks.onDamage(event);
  }

  private createPickup(x: number, y: number, value: number, seed: number): void {
    const angle = (seed / 4) * Math.PI * 2;
    const dropX = x + Math.cos(angle) * 0.32;
    const dropY = y + Math.sin(angle) * 0.32;

    if (this.pickups.length >= MAX_PICKUPS) {
      let nearest = this.pickups[0];
      let best = nearest.position.distanceToSquared(this.scratchPickup.set(dropX, dropY));
      for (let index = 1; index < this.pickups.length; index += 1) {
        const candidate = this.pickups[index];
        const distSq = candidate.position.distanceToSquared(this.scratchPickup);
        if (distSq < best) {
          nearest = candidate;
          best = distSq;
        }
      }
      nearest.value += value;
      return;
    }

    const pickup = this.pickupPool.acquire();
    pickup.position.set(dropX, dropY);
    pickup.velocity.set(Math.cos(angle), Math.sin(angle)).multiplyScalar(1.2);
    pickup.value = value;
    pickup.phase = Math.random() * Math.PI * 2;
    this.pickups.push(pickup);
  }

  private updatePickups(delta: number): void {
    const player = this.player;
    if (!player) return;

    for (let index = this.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = this.pickups[index];
      pickup.phase += delta * 5;
      const distanceToPlayer = pickup.position.distanceTo(player.position);
      if (distanceToPlayer < player.stats.pickupRadius && distanceToPlayer > 0.01) {
        pickup.velocity.lerp(
          this.scratchPickup.subVectors(player.position, pickup.position).normalize().multiplyScalar(6.5),
          1 - Math.exp(-delta * 12),
        );
      } else {
        pickup.velocity.multiplyScalar(Math.exp(-delta * 3.5));
      }

      pickup.position.addScaledVector(pickup.velocity, delta);
      const collectRadius = BASE_PICKUP_COLLECT * (pickupVisualRadius(pickup.value) / BASE_PICKUP_RADIUS);
      if (distanceToPlayer <= collectRadius) {
        const value = pickup.value;
        this.pickupPool.release(swapRemove(this.pickups, index));
        this.gainExperience(value);
      }
    }
  }

  private gainExperience(value: number): void {
    const player = this.player;
    if (!player) return;

    this.xp += value;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      this.xpToNext = 12 + this.level * 8;
      this.pendingLevels += 1;
    }
    if (this.pendingLevels > 0) {
      this.offeredUpgrades = rollUpgradeCards(this.level, this.baseUpgradeStacks, player.stats);
      this.callbacks.onUpgrade(this.offeredUpgrades);
      this.setPhase('upgrade');
    }
  }

  private createMuzzleParticles(x: number, y: number, angle: number): void {
    for (let i = 0; i < 3; i += 1) {
      const particleAngle = angle + THREE.MathUtils.randFloatSpread(0.55);
      const speed = THREE.MathUtils.randFloat(2, 5);
      this.createParticle(
        x,
        y,
        Math.cos(particleAngle) * speed,
        Math.sin(particleAngle) * speed,
        i === 0 ? 0xfff0ad : 0xd6b45f,
        0.18,
      );
    }
  }

  private createHitParticles(x: number, y: number, color: number, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = THREE.MathUtils.randFloat(1.6, 6);
      this.createParticle(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        color,
        THREE.MathUtils.randFloat(0.18, 0.46),
      );
    }
  }

  private createParticle(x: number, y: number, vx: number, vy: number, color: number, life: number): void {
    const particle = this.acquireParticle();
    particle.position.set(x, y);
    particle.velocity.set(vx, vy);
    particle.life = life;
    particle.maxLife = life;
    particle.size = THREE.MathUtils.randFloat(0.035, 0.1);
    particle.color = color;
  }

  private acquireParticle(): ParticleEntity {
    if (this.particles.length < MAX_PARTICLES) {
      const particle = this.particlePool.acquire();
      this.particles.push(particle);
      return particle;
    }
    let worstIndex = 0;
    let worstLife = this.particles[0].life;
    for (let index = 1; index < this.particles.length; index += 1) {
      if (this.particles[index].life < worstLife) {
        worstLife = this.particles[index].life;
        worstIndex = index;
      }
    }
    return this.particles[worstIndex];
  }

  private updateParticles(delta: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= delta;
      particle.position.addScaledVector(particle.velocity, delta);
      particle.velocity.multiplyScalar(Math.exp(-delta * 4));
      if (particle.life <= 0) {
        this.particlePool.release(swapRemove(this.particles, index));
      }
    }
  }

  private syncInstanceBatches(): void {
    const { zombieWalk, zombieDeath, enemyShadows, healthBarBacks, healthBars, bullets, pickups, particles } =
      this.gfx;
    zombieWalk.begin();
    zombieDeath.begin();
    enemyShadows.begin();
    healthBarBacks.begin();
    healthBars.begin();
    bullets.begin();
    pickups.begin();
    particles.begin();

    for (const enemy of this.enemies) {
      const spec = getEnemy(enemy.kind);
      const shadowRadius = enemy.radius * 0.72;
      enemyShadows.push(
        enemy.position.x,
        enemy.position.y - spec.scale / 2,
        -0.2,
        shadowRadius,
        shadowRadius * 0.48,
        0,
        0x050805,
      );

      if (enemy.state === 'dying') {
        const { frames, frameAspect } = this.assets.zombieDeath;
        const frame = Math.min(frames - 1, Math.floor(enemy.deathTime * DEATH_FPS));
        zombieDeath.push(
          enemy.position.x,
          enemy.position.y,
          enemy.visualZ,
          enemy.facing * spec.scale * frameAspect,
          spec.scale,
          0,
          spec.tint,
          frame,
        );
        continue;
      }

      const walkFrames = this.assets.zombie.frames;
      const frame = Math.floor(enemy.animationTime * ZOMBIE_WALK_FPS) % Math.max(1, walkFrames);
      zombieWalk.push(
        enemy.position.x,
        enemy.position.y,
        enemy.visualZ,
        enemy.facing * spec.scale,
        spec.scale,
        0,
        enemy.hitFlash > 0 ? 0xffffff : spec.tint,
        frame,
      );
      const barY = enemy.position.y + enemy.radius + 0.5;
      const hpRatio = Math.max(0.001, enemy.hp / enemy.maxHp);
      healthBarBacks.push(enemy.position.x, barY, 2.2, 0.88, 0.11, 0, 0x151a12);
      healthBars.push(
        enemy.position.x - 0.41 * (1 - enemy.hp / enemy.maxHp),
        barY,
        2.21,
        0.82 * hpRatio,
        0.07,
        0,
        spec.healthBarColor,
      );
    }

    for (const bullet of this.bullets) {
      bullets.push(bullet.position.x, bullet.position.y, 1.6, bullet.size, bullet.size * 1.65, 0, bullet.color);
    }

    for (const pickup of this.pickups) {
      const radius = pickupVisualRadius(pickup.value);
      pickups.push(
        pickup.position.x,
        pickup.position.y + Math.sin(pickup.phase) * 0.08,
        1.1,
        radius,
        radius,
        pickup.phase,
        0x80f59a,
      );
    }

    for (const particle of this.particles) {
      const lifeRatio = Math.max(0, particle.life / particle.maxLife);
      const size = particle.size * Math.max(0.05, lifeRatio);
      particles.push(particle.position.x, particle.position.y, 2, size, size, 0, particle.color, 0, lifeRatio);
    }

    zombieWalk.commit();
    zombieDeath.commit();
    enemyShadows.commit();
    healthBarBacks.commit();
    healthBars.commit();
    bullets.commit();
    pickups.commit();
    particles.commit();
  }

  private updateForestParallax(delta: number): void {
    this.forestTime += delta;
    const player = this.player;
    const playerX = player ? player.position.x / ARENA_HALF_WIDTH : 0;
    const playerY = player ? player.position.y / ARENA_HALF_HEIGHT : 0;
    const focusX = this.pointerNdc.x * 0.68 + playerX * 0.32;
    const focusY = this.pointerNdc.y * 0.58 + playerY * 0.42;

    for (const layer of this.parallaxLayers) {
      const swayPhase = this.forestTime * layer.speed + layer.phase;
      layer.object.position.x =
        layer.baseX + focusX * layer.xFactor + Math.sin(swayPhase) * layer.swayX;
      layer.object.position.y =
        layer.baseY +
        focusY * layer.yFactor +
        Math.cos(swayPhase * 0.82 + layer.phase) * layer.swayY;
    }
  }

  private updateCamera(delta: number): void {
    if (this.shake <= 0) {
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, 0, 12, delta);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, 0, 12, delta);
      return;
    }
    this.camera.position.x = THREE.MathUtils.randFloatSpread(this.shake);
    this.camera.position.y = THREE.MathUtils.randFloatSpread(this.shake);
    this.camera.updateMatrixWorld();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private emitHud(): void {
    const player = this.player;
    const state: HudState = {
      phase: this.phase,
      level: this.level,
      health: player?.stats.health ?? 100,
      maxHealth: player?.stats.maxHealth ?? 100,
      regen: player?.stats.regen ?? BASE_REGEN,
      xp: this.xp,
      xpToNext: this.xpToNext,
      elapsed: this.elapsed,
      kills: this.kills,
      wave: Math.floor(this.elapsed / 25) + 1,
    };
    this.callbacks.onHud(state);
  }

  private clearRunObjects(): void {
    while (this.enemies.length > 0) this.enemyPool.release(this.enemies.pop()!);
    while (this.bullets.length > 0) this.bulletPool.release(this.bullets.pop()!);
    while (this.pickups.length > 0) this.pickupPool.release(this.pickups.pop()!);
    while (this.particles.length > 0) this.particlePool.release(this.particles.pop()!);

    for (const batch of Object.values(this.gfx)) {
      batch.begin();
      batch.commit();
    }

    if (this.player) {
      this.scene.remove(this.player.mesh, this.player.shadow);
      this.player.mesh.material.map?.dispose();
      this.player.mesh.geometry.dispose();
      this.player.mesh.material.dispose();
      this.player.shadow.geometry.dispose();
      this.player.shadow.material.dispose();
      this.player = undefined;
    }
  }
}
