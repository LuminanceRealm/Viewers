import { LUMEN_HU_MAX, LUMEN_HU_MIN, SNAP_RADIUS_MM, Vec3 } from '../constants';
import { add, cross, dot, normalize, scale, sub, length } from './centerlineGeometry';

export interface HuField {
  huAtWorld(p: Vec3): number;
  /** Menor espaciado en mm, para elegir el paso de muestreo del disco. */
  minSpacingMm: number;
}

export interface SnapOptions {
  radiusMm?: number;
  huMin?: number;
  huMax?: number;
}

/**
 * Imán al lumen: busca en un disco del plano del viewport alrededor del clic los
 * vóxeles con densidad de contraste, toma la componente conexa que contiene el
 * clic (o la más cercana) y devuelve su centroide. Si no hay lumen, devuelve el
 * clic sin tocar. Nunca lanza.
 */
export function snapToLumen(
  field: HuField,
  click: Vec3,
  planeNormal: Vec3,
  options: SnapOptions = {}
): Vec3 {
  const radius = options.radiusMm ?? SNAP_RADIUS_MM;
  const huMin = options.huMin ?? LUMEN_HU_MIN;
  const huMax = options.huMax ?? LUMEN_HU_MAX;

  const n = normalize(planeNormal);
  if (length(n) < 0.5) {
    return click;
  }
  // Base (a, b) del plano.
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const a = normalize(cross(n, helper));
  const b = cross(n, a);

  const step = Math.max(field.minSpacingMm * 0.75, 0.1);
  const half = Math.ceil(radius / step);
  const size = half * 2 + 1;
  const mask = new Uint8Array(size * size);
  const centerIdx = half * size + half;

  let any = false;
  for (let gy = -half; gy <= half; gy++) {
    for (let gx = -half; gx <= half; gx++) {
      const dx = gx * step;
      const dy = gy * step;
      if (dx * dx + dy * dy > radius * radius) {
        continue;
      }
      const p = add(click, add(scale(a, dx), scale(b, dy)));
      const hu = field.huAtWorld(p);
      if (Number.isFinite(hu) && hu >= huMin && hu <= huMax) {
        mask[(gy + half) * size + (gx + half)] = 1;
        any = true;
      }
    }
  }
  if (!any) {
    return click;
  }

  // Componentes conexas (4-vecinos) sobre la máscara.
  const labels = new Int32Array(size * size).fill(-1);
  const components: number[][] = [];
  for (let seed = 0; seed < size * size; seed++) {
    if (!mask[seed] || labels[seed] >= 0) {
      continue;
    }
    const id = components.length;
    const cells: number[] = [];
    const stack = [seed];
    labels[seed] = id;
    while (stack.length) {
      const idx = stack.pop() as number;
      cells.push(idx);
      const x = idx % size;
      const y = (idx - x) / size;
      const neighbours = [
        x > 0 ? idx - 1 : -1,
        x < size - 1 ? idx + 1 : -1,
        y > 0 ? idx - size : -1,
        y < size - 1 ? idx + size : -1,
      ];
      neighbours.forEach(nIdx => {
        if (nIdx >= 0 && mask[nIdx] && labels[nIdx] < 0) {
          labels[nIdx] = id;
          stack.push(nIdx);
        }
      });
    }
    components.push(cells);
  }

  let chosen: number[];
  if (labels[centerIdx] >= 0) {
    chosen = components[labels[centerIdx]];
  } else {
    let best = Infinity;
    chosen = components[0];
    components.forEach(cells => {
      cells.forEach(idx => {
        const x = (idx % size) - half;
        const y = Math.floor(idx / size) - half;
        const d = x * x + y * y;
        if (d < best) {
          best = d;
          chosen = cells;
        }
      });
    });
  }

  let sx = 0;
  let sy = 0;
  chosen.forEach(idx => {
    sx += (idx % size) - half;
    sy += Math.floor(idx / size) - half;
  });
  const cx = (sx / chosen.length) * step;
  const cy = (sy / chosen.length) * step;
  const centroid = add(click, add(scale(a, cx), scale(b, cy)));

  // Mantener el punto exactamente en el plano del clic.
  const off = dot(sub(centroid, click), n);
  return sub(centroid, scale(n, off));
}
