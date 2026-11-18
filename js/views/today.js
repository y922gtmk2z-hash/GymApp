import { h, empty } from '../ui.js';

export function render(root, ctx) {
  ctx.setTitle('Today');
  root.append(empty('No plan yet', 'Build this week’s plan to see today’s session here.',
    h('a.btn.primary', { href: '#/plan' }, 'Go to Plan')));
}
