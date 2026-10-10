import pptxgen from 'pptxgenjs';

export interface ChartData { labels: string[]; values: number[]; }
export type SlideSpec =
  | { type: 'title'; heading: string; subtitle?: string }
  | { type: 'bullets'; heading: string; points: string[] }
  | { type: 'two-col'; heading: string; left: string[]; right: string[] }
  | { type: 'image-text'; heading: string; imagePath: string; body: string }
  | { type: 'chart'; heading: string; chartType: 'bar' | 'line' | 'pie'; data: ChartData }
  | { type: 'code'; heading: string; language: string; code: string }
  | { type: 'divider'; label: string };

export interface PptxDsl {
  title: string;
  theme: 'dark' | 'light' | 'minimal';
  slides: SlideSpec[];
}

interface Theme { bg: string; text: string; accent: string; subtitle: string; }
const THEMES: Record<string, Theme> = {
  dark:    { bg: '09090B', text: 'F4F4F5', accent: 'F59E0B', subtitle: 'A1A1AA' },
  light:   { bg: 'FFFFFF', text: '09090B', accent: '6366F1', subtitle: '71717A' },
  minimal: { bg: 'FAFAFA', text: '18181B', accent: '18181B', subtitle: '52525B' },
};

class PptxDslEngineClass {
  async render(dsl: PptxDsl, outputPath: string, onProgress?: (pct: number) => void): Promise<void> {
    const pptx = new pptxgen();
    const theme = THEMES[dsl.theme] ?? THEMES.dark;
    pptx.layout = 'LAYOUT_16x9';

    for (let i = 0; i < dsl.slides.length; i++) {
      const spec = dsl.slides[i];
      const slide = pptx.addSlide();
      slide.background = { color: theme.bg };
      this.renderSlide(pptx, slide, spec, theme);
      onProgress?.(Math.round(((i + 1) / dsl.slides.length) * 100));
    }

    await pptx.writeFile({ fileName: outputPath });
  }

  private renderSlide(pptx: pptxgen, slide: pptxgen.Slide, spec: SlideSpec, t: Theme) {
    switch (spec.type) {
      case 'title':
        slide.addText(spec.heading, { x: '10%', y: '30%', w: '80%', h: '20%', fontSize: 40, bold: true, color: t.text, align: 'center' });
        if (spec.subtitle) slide.addText(spec.subtitle, { x: '15%', y: '55%', w: '70%', h: '10%', fontSize: 18, color: t.subtitle, align: 'center' });
        break;

      case 'bullets':
        slide.addText(spec.heading, { x: '5%', y: '5%', w: '90%', h: '15%', fontSize: 28, bold: true, color: t.text });
        slide.addText(spec.points.map(p => ({ text: p, options: { bullet: true, color: t.text, fontSize: 18, paraSpaceBefore: 8 } })), { x: '5%', y: '22%', w: '90%', h: '70%' });
        break;

      case 'two-col':
        slide.addText(spec.heading, { x: '5%', y: '5%', w: '90%', h: '15%', fontSize: 28, bold: true, color: t.text });
        slide.addText(spec.left.map(p => ({ text: p, options: { bullet: true, color: t.text, fontSize: 16, paraSpaceBefore: 6 } })), { x: '5%', y: '22%', w: '43%', h: '70%' });
        slide.addText(spec.right.map(p => ({ text: p, options: { bullet: true, color: t.text, fontSize: 16, paraSpaceBefore: 6 } })), { x: '52%', y: '22%', w: '43%', h: '70%' });
        slide.addShape(pptx.ShapeType.line, { x: '50%', y: '20%', w: 0, h: '72%', line: { color: t.subtitle, width: 0.5 } });
        break;

      case 'divider':
        slide.addText(spec.label, { x: '10%', y: '40%', w: '80%', h: '20%', fontSize: 36, bold: true, color: t.accent, align: 'center' });
        slide.addShape(pptx.ShapeType.line, { x: '20%', y: '62%', w: '60%', h: 0, line: { color: t.accent, width: 1.5 } });
        break;

      case 'code':
        slide.addText(spec.heading, { x: '5%', y: '5%', w: '90%', h: '12%', fontSize: 22, bold: true, color: t.text });
        slide.addText(spec.code, { x: '5%', y: '18%', w: '90%', h: '75%', fontSize: 12, fontFace: 'Courier New', color: t.text, fill: { color: '18181B' }, valign: 'top' });
        break;

      case 'image-text':
        slide.addText(spec.heading, { x: '5%', y: '5%', w: '90%', h: '12%', fontSize: 22, bold: true, color: t.text });
        if (spec.imagePath) slide.addImage({ path: spec.imagePath, x: '5%', y: '18%', w: '40%', h: '70%' });
        slide.addText(spec.body, { x: '48%', y: '18%', w: '47%', h: '70%', fontSize: 16, color: t.text, valign: 'top' });
        break;

      case 'chart': {
        slide.addText(spec.heading, { x: '5%', y: '5%', w: '90%', h: '12%', fontSize: 22, bold: true, color: t.text });
        const chartData = [{ name: spec.heading, labels: spec.data.labels, values: spec.data.values }];
        const chartType = spec.chartType === 'bar' ? pptx.ChartType.bar : spec.chartType === 'line' ? pptx.ChartType.line : pptx.ChartType.pie;
        slide.addChart(chartType, chartData, { x: '5%', y: '18%', w: '90%', h: '75%' });
        break;
      }
    }
  }
}

export const PptxDslEngine = new PptxDslEngineClass();
