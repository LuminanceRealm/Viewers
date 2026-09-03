/**
 * Recorrido de componentes conexas sobre una pila de cortes 2D que comparten
 * dimensiones. Cada corte se direcciona por su índice `k` y cada píxel por su
 * índice lineal `idx = j * width + i` dentro del corte, que es exactamente como
 * están guardados los labelmaps derivados de una serie stack en cornerstone.
 */
export interface SliceStackGrid {
  width: number;
  height: number;
  depth: number;
  get(k: number, idx: number): number;
}

export interface ComponentSlice {
  k: number;
  indices: number[];
}

/** Máscaras de visitados, una por corte, creadas bajo demanda. */
export type VisitedMasks = (Uint8Array | undefined)[];

export function createVisitedMasks(depth: number): VisitedMasks {
  return new Array(depth).fill(undefined);
}

function maskFor(visited: VisitedMasks, k: number, sliceSize: number): Uint8Array {
  let mask = visited[k];
  if (!mask) {
    mask = new Uint8Array(sliceSize);
    visited[k] = mask;
  }
  return mask;
}

/**
 * Devuelve la componente conexa (26-vecinos) que contiene la semilla, formada
 * por los vóxeles para los que `matches(valor)` es verdadero. Los vóxeles
 * visitados quedan marcados en `visited`, así el mismo juego de máscaras sirve
 * para etiquetar todo el volumen componente a componente.
 */
export function collectComponent3D(
  grid: SliceStackGrid,
  seedK: number,
  seedIdx: number,
  matches: (value: number) => boolean,
  visited: VisitedMasks = createVisitedMasks(grid.depth)
): ComponentSlice[] {
  const { width, height, depth } = grid;
  const sliceSize = width * height;

  if (seedK < 0 || seedK >= depth || seedIdx < 0 || seedIdx >= sliceSize) {
    return [];
  }
  if (!matches(grid.get(seedK, seedIdx))) {
    return [];
  }

  const perSlice = new Map<number, number[]>();
  // Pila explícita con pares (k, idx) aplanados; evita recursión y closures.
  const stack: number[] = [seedK, seedIdx];
  maskFor(visited, seedK, sliceSize)[seedIdx] = 1;

  while (stack.length) {
    const idx = stack.pop() as number;
    const k = stack.pop() as number;

    let bucket = perSlice.get(k);
    if (!bucket) {
      bucket = [];
      perSlice.set(k, bucket);
    }
    bucket.push(idx);

    const i = idx % width;
    const j = (idx - i) / width;

    for (let dk = -1; dk <= 1; dk++) {
      const nk = k + dk;
      if (nk < 0 || nk >= depth) {
        continue;
      }
      const mask = maskFor(visited, nk, sliceSize);
      for (let dj = -1; dj <= 1; dj++) {
        const nj = j + dj;
        if (nj < 0 || nj >= height) {
          continue;
        }
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          if (ni < 0 || ni >= width) {
            continue;
          }
          const nIdx = nj * width + ni;
          if (mask[nIdx]) {
            continue;
          }
          if (!matches(grid.get(nk, nIdx))) {
            // Marcarlo evita volver a evaluarlo desde otro vecino.
            mask[nIdx] = 1;
            continue;
          }
          mask[nIdx] = 1;
          stack.push(nk, nIdx);
        }
      }
    }
  }

  return Array.from(perSlice.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([k, indices]) => ({ k, indices }));
}

/**
 * Componentes conexas 2D (8-vecinos) dentro de un solo corte, para los píxeles
 * cuyo valor cumple `matches`. Devuelve los índices lineales de cada componente.
 */
export function collectComponents2D(
  labels: ArrayLike<number>,
  width: number,
  height: number,
  matches: (value: number) => boolean
): number[][] {
  const size = width * height;
  const visited = new Uint8Array(size);
  const components: number[][] = [];

  for (let seed = 0; seed < size; seed++) {
    if (visited[seed] || !matches(labels[seed])) {
      continue;
    }
    const component: number[] = [];
    const stack = [seed];
    visited[seed] = 1;

    while (stack.length) {
      const idx = stack.pop() as number;
      component.push(idx);
      const i = idx % width;
      const j = (idx - i) / width;

      for (let dj = -1; dj <= 1; dj++) {
        const nj = j + dj;
        if (nj < 0 || nj >= height) {
          continue;
        }
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          if (ni < 0 || ni >= width) {
            continue;
          }
          const nIdx = nj * width + ni;
          if (visited[nIdx]) {
            continue;
          }
          visited[nIdx] = 1;
          if (matches(labels[nIdx])) {
            stack.push(nIdx);
          }
        }
      }
    }
    components.push(component);
  }

  return components;
}
