// Static reference data. Pure, no DOM. Library is added in Phase 2.

export const MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core'];

export const MUSCLE_LABEL = {
  chest: 'Chest', back: 'Back', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps',
  quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves', core: 'Core',
};

export const STRENGTH_EQUIPMENT = ['barbell', 'rack', 'bench', 'dumbbell', 'cable', 'machine', 'pullup_bar', 'bodyweight', 'kettlebell', 'bands'];
export const CARDIO_EQUIPMENT = ['treadmill', 'bike', 'rower', 'elliptical', 'stair_machine', 'jump_rope', 'outdoors', 'pool'];
export const EQUIPMENT = [...STRENGTH_EQUIPMENT, ...CARDIO_EQUIPMENT];

export const EQUIPMENT_LABEL = {
  barbell: 'Barbell', rack: 'Rack', bench: 'Bench', dumbbell: 'Dumbbells', cable: 'Cable',
  machine: 'Machines', pullup_bar: 'Pull-up bar', bodyweight: 'Bodyweight', kettlebell: 'Kettlebell',
  bands: 'Bands', treadmill: 'Treadmill', bike: 'Bike', rower: 'Rower', elliptical: 'Elliptical',
  stair_machine: 'Stair machine', jump_rope: 'Jump rope', outdoors: 'Outdoors', pool: 'Pool',
};

export function defaultProfiles() {
  return [
    { id: 'gym', name: 'Gym', builtin: true, equipment: EQUIPMENT.filter((e) => e !== 'outdoors' && e !== 'pool') },
    { id: 'home', name: 'Home', builtin: true, equipment: ['dumbbell', 'bench', 'bodyweight', 'pullup_bar', 'outdoors'] },
  ];
}
