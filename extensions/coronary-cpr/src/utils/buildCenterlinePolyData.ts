import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

export interface OrientedCenterline {
  /** xyz por punto, en coordenadas mundo. */
  points: Float32Array;
  /** quaternion (x, y, z, w) por punto. */
  orientations: Float32Array;
}

/**
 * Empaqueta la centerline como el `vtkPolyData` que espera `vtkImageCPRMapper`:
 * una sola polyline y un array de puntos llamado `Orientation` con un quat por
 * punto. El mapper sólo lee la primera celda de `lines`, así que aquí sólo hay una.
 */
export function buildCenterlinePolyData(centerline: OrientedCenterline): vtkPolyData {
  const n = centerline.points.length / 3;
  if (n < 2 || centerline.orientations.length !== n * 4) {
    throw new Error('La centerline necesita al menos dos puntos con orientación.');
  }

  const polyData = vtkPolyData.newInstance();

  const points = vtkPoints.newInstance();
  points.setData(centerline.points, 3);
  polyData.setPoints(points);

  const connectivity = new Uint32Array(n + 1);
  connectivity[0] = n;
  for (let i = 0; i < n; i++) {
    connectivity[i + 1] = i;
  }
  const lines = vtkCellArray.newInstance();
  lines.setData(connectivity);
  polyData.setLines(lines);

  polyData.getPointData().addArray(
    vtkDataArray.newInstance({
      name: 'Orientation',
      numberOfComponents: 4,
      values: centerline.orientations,
    })
  );

  return polyData;
}
