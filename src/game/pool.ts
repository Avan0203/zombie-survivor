/** 复用逻辑对象，避免每帧 new / GC。 */
export class ObjectPool<T> {
  private readonly free: T[] = [];
  private readonly create: () => T;

  constructor(create: () => T) {
    this.create = create;
  }

  acquire(): T {
    return this.free.pop() ?? this.create();
  }

  release(item: T): void {
    this.free.push(item);
  }
}

/** 倒序遍历时安全：换上来的是已处理过的末尾元素。 */
export function swapRemove<T>(arr: T[], index: number): T {
  const item = arr[index];
  arr[index] = arr[arr.length - 1];
  arr.pop();
  return item;
}
