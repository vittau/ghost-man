import { OPPOSITE } from './types';
import type { Dir, UnitDir } from './types';

const DIR_KEYS: Record<string, UnitDir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

const SWALLOW = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

/**
 * Keyboard state with edge detection. Direction presses are tracked as a
 * stack so the most recently pressed key wins (Pac-Man style input), while
 * action keys expose one-shot `justPressed` queries.
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private stack: UnitDir[] = [];

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (SWALLOW.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      const d = DIR_KEYS[e.code];
      if (d) {
        this.stack = this.stack.filter((x) => x !== d);
        this.stack.push(d);
      }
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      const d = DIR_KEYS[e.code];
      if (d) this.stack = this.stack.filter((x) => x !== d);
    });
    target.addEventListener('blur', () => {
      this.down.clear();
      this.stack = [];
    });
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  justPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Most recently pressed direction key. */
  get wantDir(): Dir {
    return this.stack.length ? this.stack[this.stack.length - 1] : 'none';
  }

  /** Any of these pressed this frame. */
  anyPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Grid direction from a code, if it is a direction key. */
  dirOf(code: string): Dir {
    return DIR_KEYS[code] ?? 'none';
  }

  clearPresses(): void {
    this.pressed.clear();
  }
}

export { OPPOSITE };
