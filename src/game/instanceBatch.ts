import * as THREE from 'three';

const dummy = new THREE.Object3D();
const tint = new THREE.Color();

export interface InstanceBatchOptions {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  capacity: number;
  useFrame?: boolean;
  useOpacity?: boolean;
  renderOrder?: number;
}

/** 每帧 begin → push → commit，把逻辑实体写进一个 InstancedMesh。 */
export class InstanceBatch {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private writeCount = 0;
  private readonly frameAttr: THREE.InstancedBufferAttribute | null;
  private readonly opacityAttr: THREE.InstancedBufferAttribute | null;

  constructor(options: InstanceBatchOptions) {
    const { geometry, material, capacity, useFrame, useOpacity, renderOrder } = options;
    this.capacity = capacity;

    if (useFrame) {
      this.frameAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      this.frameAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aFrame', this.frameAttr);
    } else {
      this.frameAttr = null;
    }

    if (useOpacity) {
      const opacities = new Float32Array(capacity);
      opacities.fill(1);
      this.opacityAttr = new THREE.InstancedBufferAttribute(opacities, 1);
      this.opacityAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aOpacity', this.opacityAttr);
    } else {
      this.opacityAttr = null;
    }

    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (renderOrder !== undefined) this.mesh.renderOrder = renderOrder;
    this.mesh.setColorAt(0, tint.setHex(0xffffff));
    if (this.mesh.instanceColor) this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }

  begin(): void {
    this.writeCount = 0;
  }

  push(
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    rotation: number,
    color: number,
    frame = 0,
    opacity = 1,
  ): void {
    if (this.writeCount >= this.capacity) return;
    const index = this.writeCount;
    this.writeCount += 1;

    dummy.position.set(x, y, z);
    dummy.rotation.set(0, 0, rotation);
    dummy.scale.set(sx, sy, 1);
    dummy.updateMatrix();
    this.mesh.setMatrixAt(index, dummy.matrix);
    this.mesh.setColorAt(index, tint.setHex(color));
    if (this.frameAttr) this.frameAttr.setX(index, frame);
    if (this.opacityAttr) this.opacityAttr.setX(index, opacity);
  }

  commit(): void {
    this.mesh.count = this.writeCount;
    this.mesh.visible = this.writeCount > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.frameAttr) this.frameAttr.needsUpdate = true;
    if (this.opacityAttr) this.opacityAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const material = this.mesh.material;
    if (Array.isArray(material)) {
      for (const item of material) item.dispose();
    } else {
      material.dispose();
    }
    this.mesh.dispose();
  }
}

/** 共享精灵条带：逐实例 aFrame 选帧，不 clone 贴图。 */
export function createSpriteInstanceMaterial(
  texture: THREE.Texture,
  frames: number,
): THREE.MeshBasicMaterial {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    alphaTest: 0.08,
    side: THREE.DoubleSide,
  });
  const cacheKey = `instance-sprite-${frames}`;
  material.customProgramCacheKey = () => cacheKey;
  material.needsUpdate = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFrames = { value: frames };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
attribute float aFrame;
uniform float uFrames;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv.x = vMapUv.x / uFrames + aFrame / uFrames;
#endif`,
    );
  };
  return material;
}

export function createTintInstanceMaterial(options: {
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  useOpacityAttr?: boolean;
}): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    depthWrite: options.depthWrite ?? true,
  });
  if (!options.useOpacityAttr) return material;

  material.needsUpdate = true;
  material.customProgramCacheKey = () => 'instance-opacity';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
attribute float aOpacity;
varying float vInstanceOpacity;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vInstanceOpacity = aOpacity;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
varying float vInstanceOpacity;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
      'vec4 diffuseColor = vec4( diffuse, opacity * vInstanceOpacity );',
    );
  };
  return material;
}
