/**
 * NUBIX: muchos CT mandan el localizador (scout/topograma) dentro de la misma
 * serie que los cortes axiales. Una sola imagen con otra orientación y otro
 * tamaño basta para que `isDisplaySetReconstructable` rechace la serie entera y
 * se pierda el MPR. Aquí se identifican esas imágenes para que el volumen se
 * arme sin ellas; en el stack siguen apareciendo como siempre (decisión de
 * Arturo: no crear una serie aparte).
 *
 * Sólo se separa si las imágenes distintas son pocas frente al grupo principal;
 * si no, la serie se deja tal cual (un US con tamaños mezclados, por ejemplo,
 * no debe partirse en decenas de miniaturas). Quien llama decide además si el
 * grupo principal es reconstruible: si no lo es, separar no gana nada.
 */

const IOP_TOLERANCE = 0.01;
const MIN_MAIN_IMAGES = 3;
const MAX_OUTLIER_FRACTION = 0.1;
const MAX_OUTLIERS_ALWAYS_ALLOWED = 3;

function toNumbers(value) {
  if (Array.isArray(value)) {
    return value.map(Number);
  }
  if (typeof value === 'string') {
    return value.split('\\').map(Number);
  }
}

function sameOrientation(a, b) {
  if (!a || !b || a.length < 6 || b.length < 6) {
    return a === b;
  }
  for (let i = 0; i < 6; i++) {
    if (!(Math.abs(a[i] - b[i]) < IOP_TOLERANCE)) {
      return false;
    }
  }
  return true;
}

/**
 * @returns {{ main: Object[], localizers: Object[] } | undefined} undefined si
 * la serie no tiene un grupo principal claro con unas pocas imágenes aparte.
 */
export default function splitLocalizers(instances) {
  if (!instances || instances.length <= MIN_MAIN_IMAGES) {
    return;
  }

  const groups = [];
  for (const instance of instances) {
    const orientation = toNumbers(instance.ImageOrientationPatient);
    const rows = Number(instance.Rows);
    const columns = Number(instance.Columns);
    let group = groups.find(
      g => g.rows === rows && g.columns === columns && sameOrientation(g.orientation, orientation)
    );
    if (!group) {
      group = { rows, columns, orientation, instances: [] };
      groups.push(group);
    }
    group.instances.push(instance);
  }

  if (groups.length < 2) {
    return;
  }

  const main = groups.reduce((a, b) => (b.instances.length > a.instances.length ? b : a));
  const outlierCount = instances.length - main.instances.length;
  const maxOutliers = Math.max(
    MAX_OUTLIERS_ALWAYS_ALLOWED,
    Math.floor(instances.length * MAX_OUTLIER_FRACTION)
  );
  if (
    !main.orientation ||
    main.instances.length < MIN_MAIN_IMAGES ||
    outlierCount > maxOutliers ||
    outlierCount >= main.instances.length
  ) {
    return;
  }

  return {
    main: main.instances,
    localizers: instances.filter(instance => !main.instances.includes(instance)),
  };
}
