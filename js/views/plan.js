import { empty } from '../ui.js';

export function render(root, ctx) {
  ctx.setTitle('Plan');
  root.append(empty('Plan builder', 'Coming in the next phase.'));
}
