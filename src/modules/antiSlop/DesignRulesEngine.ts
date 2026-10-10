import { StateStore } from '../../core/StateStore';

const CORE_RULES = `
ANTI-AI-SLOP UI DESIGN RULES (MANDATORY):

REQUIRED STACK:
- Tailwind CSS v4 (no v3 syntax, use @theme in CSS, not tailwind.config.js)
- shadcn/ui components (import from @/components/ui/)
- Framer Motion for animations (import { motion } from 'framer-motion')
- Lucide React for ALL icons (never use emoji as icons)

COLOR PALETTE — ONLY USE:
- Backgrounds: zinc-950, zinc-900, zinc-800 (dark) OR zinc-50, white (light)
- Text: zinc-100, zinc-300 (dark) OR zinc-900, zinc-600 (light)
- Accents: ONE accent color per project (amber, emerald, sky, or rose) — use sparingly
- Borders: zinc-800 (dark) OR zinc-200 (light) — 1px only

TYPOGRAPHY:
- Font: Inter (variable font, loaded via next/font or @fontsource)
- Scale: text-sm (14px) for body, text-base (16px) for leads, text-xl/2xl for headings
- Weight: font-normal body, font-medium labels, font-semibold headings — never font-bold on body text
- Line height: leading-relaxed for body paragraphs

SPACING:
- Use 4px grid: p-1(4px), p-2(8px), p-3(12px), p-4(16px), p-6(24px), p-8(32px)
- Component padding: p-4 for cards, p-3 for inputs, p-2 for buttons
- Gap between sections: gap-6 or gap-8

ABSOLUTELY FORBIDDEN (auto-reject and regenerate if found):
- Gradient backgrounds (bg-gradient-to-*, from-purple-*, from-blue-*)
- rounded-full on cards or containers (only on avatars and badges)
- shadow-xl or shadow-2xl on multiple stacked elements
- Decorative borders with colors (border-purple-*, border-blue-*)
- Generic hero sections with centered text + gradient + CTA button
- Multiple colors on the same page (stick to ONE accent + zinc neutrals)
- animate-bounce or animate-pulse for decorative purposes
- backdrop-blur everywhere (only use on modals/popovers)

COMPONENT PATTERNS:
- Cards: bg-zinc-900 border border-zinc-800 rounded-lg p-4 (NOT rounded-2xl)
- Buttons: precise height h-9, px-4, text-sm, font-medium
- Inputs: bg-zinc-900 border border-zinc-700 focus:border-zinc-500 rounded-md
- Tables: no outer border, subtle row dividers (divide-y divide-zinc-800)
`.trim();

class DesignRulesEngineClass {
  private customRules: string[] = [];
  private referenceLinks: string[] = [];

  getSystemPromptLayer(): string {
    let rules = CORE_RULES;
    if (this.customRules.length > 0) {
      rules += '\n\nCUSTOM PROJECT RULES:\n' + this.customRules.map(r => `- ${r}`).join('\n');
    }
    if (this.referenceLinks.length > 0) {
      rules += '\n\nREFERENCE_URLS (study these for inspiration):\n' + this.referenceLinks.join('\n');
    }
    return rules;
  }

  addCustomRule(rule: string) {
    this.customRules.push(rule);
  }

  injectReferenceLinks(links: string[]) {
    this.referenceLinks = [...this.referenceLinks, ...links];
  }
}

export const DesignRulesEngine = new DesignRulesEngineClass();
