import * as THREE from 'three';

export interface SpriteAsset {
  texture: THREE.Texture;
  frames: number;
  /** 单帧宽 / 单帧高；死亡序列是 64x32 宽帧，其余是 32x32 方帧。 */
  frameAspect: number;
}

export interface GameAssets {
  survivor: SpriteAsset;
  zombie: SpriteAsset;
  zombieDeath: SpriteAsset;
  ground: THREE.Texture;
  forest: {
    grass: THREE.Texture[];
    bushes: THREE.Texture[];
    edge: THREE.Texture;
    mist: THREE.Texture;
  };
}

interface TextureOptions {
  /** 平铺贴图；用镜像重复消除接缝，模型输出无法保证严格可平铺。 */
  tiled?: boolean;
  /** 手绘贴图走线性过滤 + mipmap，像素精灵保持最近邻。 */
  painted?: boolean;
}

function configureTexture(texture: THREE.Texture, options: TextureOptions): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  if (options.painted) {
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
  } else {
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
  }
  if (options.tiled) {
    texture.wrapS = THREE.MirroredRepeatWrapping;
    texture.wrapT = THREE.MirroredRepeatWrapping;
  }
}
function loadTexture(url: string, options: TextureOptions = {}): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        configureTexture(texture, options);
        resolve(texture);
      },
      undefined,
      () => reject(new Error(`无法加载纹理：${url}`)),
    );
  });
}

/** 同一类植被按文件名批量加载，数量变化时只改这里。 */
function loadVegetation(names: string[]): Promise<THREE.Texture[]> {
  return Promise.all(
    names.map((name) => loadTexture(`./assets/forest/${name}.png`, { painted: true })),
  );
}

function measureFrameAspect(texture: THREE.Texture, frames: number): number {
  const image = texture.image as
    | { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number }
    | undefined;
  const width = image?.naturalWidth ?? image?.width ?? 0;
  const height = image?.naturalHeight ?? image?.height ?? 0;
  if (!width || !height || frames <= 0) return 1;
  return width / frames / height;
}

async function loadSprite(url: string, frames: number): Promise<SpriteAsset> {
  const texture = await loadTexture(url);
  return { texture, frames, frameAspect: measureFrameAspect(texture, frames) };
}
const GRASS_NAMES = ['grass-a', 'grass-b', 'grass-c'];
const BUSH_NAMES = ['bush-a', 'bush-b', 'bush-c'];

export async function loadGameAssets(): Promise<GameAssets> {
  const [survivor, zombie, zombieDeath, ground, grass, bushes, edge, mist] = await Promise.all([
    loadSprite('./assets/survivor/survivor-walk.png', 8),
    loadSprite('./assets/zombie/zombie-run-3-outline.png', 8),
    // 576x32 = 9 帧 64x32，按 18 帧切会把每帧劈成左右两半，播放时就是闪烁
    loadSprite('./assets/zombie/zombie-death-3-outline.png', 9),
    loadTexture('./assets/forest/ground.png', { tiled: true, painted: true }),
    loadVegetation(GRASS_NAMES),
    loadVegetation(BUSH_NAMES),
    loadTexture('./assets/forest/edge.png', { tiled: true, painted: true }),
    loadTexture('./assets/forest/mist.svg', { painted: true }),
  ]);

  return {
    survivor,
    zombie,
    zombieDeath,
    ground,
    forest: { grass, bushes, edge, mist },
  };
}
