import { StateStore } from '../../core/StateStore';

export class SelectorMemory {
  remember(url: string, brokenSelector: string, workingSelector: string) {
    StateStore.rememberSelector(url, brokenSelector, workingSelector);
  }

  recall(url: string, brokenSelector: string): string | null {
    return StateStore.recallSelector(url, brokenSelector);
  }

  getSuccessRate(_url: string): number {
    // Could query StateStore for aggregate stats; simplified for now
    return 1.0;
  }
}
