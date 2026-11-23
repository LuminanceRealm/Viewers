import { layoutDock } from './layout';

const pano = { w: 160, h: 80 };
const section = { w: 30, h: 80 };

describe('layoutDock', () => {
  it('en pantalla ancha pone panorámica y cortes lado a lado a la misma escala', () => {
    const l = layoutDock(1400, 400, pano, section);
    expect(l.sections.length).toBe(5);
    const scale = l.pano.w / pano.w;
    l.sections.forEach(box => {
      expect(box.w / section.w).toBeCloseTo(scale, 6);
      expect(box.x).toBeGreaterThanOrEqual(l.pano.x + l.pano.w);
      expect(box.x + box.w).toBeLessThanOrEqual(1400.5);
    });
    expect(scale * pano.h).toBeLessThanOrEqual(400);
  });

  it('acepta tres cortes aunque encojan la panorámica, pero no menos de la mitad', () => {
    expect(layoutDock(870, 361, { w: 101.6, h: 48 }, { w: 30.4, h: 48 }).sections.length).toBe(3);
    expect(layoutDock(700, 600, { w: 150, h: 60 }, { w: 40.4, h: 60 }).sections.length).toBe(1);
  });

  it('en teléfono apila la panorámica sobre los cortes', () => {
    const l = layoutDock(390, 360, pano, section);
    expect(l.pano.w).toBe(390);
    expect(l.sections[0].y).toBeGreaterThan(l.pano.h);
    expect(l.sections.length % 2).toBe(1);
    l.sections.forEach(box => expect(box.x + box.w).toBeLessThanOrEqual(390.5));
  });

  it('siempre deja al menos un corte', () => {
    expect(layoutDock(700, 500, pano, section).sections.length).toBeGreaterThanOrEqual(1);
  });
});
