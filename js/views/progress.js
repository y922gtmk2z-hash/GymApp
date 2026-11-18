import { empty } from '../ui.js';

export function render(root, ctx) {
  ctx.setTitle('Progress');
  root.append(empty('No progress yet', 'Log workouts and check-ins to see charts here.'));
}
