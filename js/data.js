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
    { id: 'gym', name: 'Gym', builtin: true, equipment: EQUIPMENT.filter((e) => e !== 'outdoors' && e !== 'pool'), weights: { dumbbellMaxKg: null, kettlebellMaxKg: null } },
    { id: 'home', name: 'Home', builtin: true, equipment: ['dumbbell', 'bench', 'bodyweight', 'pullup_bar', 'outdoors'], weights: { dumbbellMaxKg: null, kettlebellMaxKg: null } },
  ];
}

export const PATTERNS = ['h_push', 'v_push', 'h_pull', 'v_pull', 'squat', 'hinge', 'lunge', 'hip_ext', 'knee_flex', 'knee_ext',
  'elbow_flex', 'elbow_ext', 'lateral', 'rear_delt', 'fly', 'calf', 'core_flex', 'core_anti', 'hip_abd'];

const X = (id, name, primary, secondary, equip, type, pattern, alternatives = []) =>
  ({ id, name, primary, secondary, equip, type, pattern, alternatives });
const C = 'compound', I = 'isolation';
const BW = [['bodyweight']];

/** Built-in exercise library. Order within each muscle is preference order. */
export const LIBRARY = [
  // Chest
  X('bench_bb', 'Barbell bench press', 'chest', ['triceps', 'shoulders'], [['barbell', 'bench', 'rack']], C, 'h_push', ['bench_db', 'chest_press_m']),
  X('incline_bb', 'Incline barbell bench press', 'chest', ['shoulders', 'triceps'], [['barbell', 'bench', 'rack']], C, 'h_push', ['incline_db']),
  X('bench_db', 'Dumbbell bench press', 'chest', ['triceps', 'shoulders'], [['dumbbell', 'bench']], C, 'h_push', ['bench_bb', 'pushup']),
  X('incline_db', 'Incline dumbbell press', 'chest', ['shoulders', 'triceps'], [['dumbbell', 'bench']], C, 'h_push', ['incline_bb']),
  X('chest_press_m', 'Machine chest press', 'chest', ['triceps', 'shoulders'], [['machine']], C, 'h_push', ['bench_db']),
  X('pushup', 'Push-up', 'chest', ['triceps', 'shoulders', 'core'], BW, C, 'h_push', ['deficit_pushup', 'bench_db']),
  X('deficit_pushup', 'Deficit push-up', 'chest', ['triceps', 'shoulders'], BW, C, 'h_push', ['pushup']),
  X('cable_fly', 'Cable fly', 'chest', [], [['cable']], I, 'fly', ['db_fly', 'pec_deck']),
  X('db_fly', 'Dumbbell fly', 'chest', [], [['dumbbell', 'bench']], I, 'fly', ['cable_fly']),
  X('pec_deck', 'Pec deck', 'chest', [], [['machine']], I, 'fly', ['cable_fly']),
  // Back
  X('pullup', 'Pull-up', 'back', ['biceps'], [['pullup_bar']], C, 'v_pull', ['lat_pulldown', 'chinup']),
  X('row_bb', 'Barbell row', 'back', ['biceps', 'hamstrings'], [['barbell']], C, 'h_pull', ['row_db', 'cable_row']),
  X('chinup', 'Chin-up', 'back', ['biceps'], [['pullup_bar']], C, 'v_pull', ['pullup', 'lat_pulldown']),
  X('lat_pulldown', 'Lat pulldown', 'back', ['biceps'], [['cable'], ['machine']], C, 'v_pull', ['pullup']),
  X('cs_row_db', 'Chest-supported dumbbell row', 'back', ['biceps', 'shoulders'], [['dumbbell', 'bench']], C, 'h_pull', ['row_db']),
  X('row_db', 'One-arm dumbbell row', 'back', ['biceps'], [['dumbbell']], C, 'h_pull', ['cs_row_db', 'row_bb']),
  X('cable_row', 'Seated cable row', 'back', ['biceps'], [['cable']], C, 'h_pull', ['machine_row']),
  X('machine_row', 'Machine row', 'back', ['biceps'], [['machine']], C, 'h_pull', ['cable_row']),
  X('inverted_row', 'Inverted row', 'back', ['biceps', 'core'], [['rack', 'barbell']], C, 'h_pull', ['row_db']),
  X('straight_arm_pd', 'Straight-arm pulldown', 'back', [], [['cable']], I, 'v_pull', ['lat_pulldown']),
  X('band_row', 'Band row', 'back', ['biceps'], [['bands']], C, 'h_pull', ['row_db']),
  // Shoulders
  X('ohp_bb', 'Overhead barbell press', 'shoulders', ['triceps', 'core'], [['barbell', 'rack']], C, 'v_push', ['ohp_db']),
  X('ohp_db', 'Seated dumbbell shoulder press', 'shoulders', ['triceps'], [['dumbbell', 'bench'], ['dumbbell']], C, 'v_push', ['ohp_bb', 'shoulder_press_m']),
  X('shoulder_press_m', 'Machine shoulder press', 'shoulders', ['triceps'], [['machine']], C, 'v_push', ['ohp_db']),
  X('arnold_press', 'Arnold press', 'shoulders', ['triceps'], [['dumbbell']], C, 'v_push', ['ohp_db']),
  X('pike_pushup', 'Pike push-up', 'shoulders', ['triceps'], BW, C, 'v_push', ['ohp_db']),
  X('lat_raise_db', 'Dumbbell lateral raise', 'shoulders', [], [['dumbbell']], I, 'lateral', ['lat_raise_cable']),
  X('lat_raise_cable', 'Cable lateral raise', 'shoulders', [], [['cable']], I, 'lateral', ['lat_raise_db']),
  X('face_pull', 'Face pull', 'shoulders', ['back'], [['cable'], ['bands']], I, 'rear_delt', ['rear_delt_fly']),
  X('rear_delt_fly', 'Rear-delt dumbbell fly', 'shoulders', ['back'], [['dumbbell']], I, 'rear_delt', ['face_pull']),
  X('band_pull_apart', 'Band pull-apart', 'shoulders', ['back'], [['bands']], I, 'rear_delt', ['face_pull']),
  // Biceps
  X('curl_bb', 'Barbell curl', 'biceps', [], [['barbell']], I, 'elbow_flex', ['curl_db']),
  X('curl_db', 'Dumbbell curl', 'biceps', [], [['dumbbell']], I, 'elbow_flex', ['curl_bb', 'hammer_curl']),
  X('incline_curl', 'Incline dumbbell curl', 'biceps', [], [['dumbbell', 'bench']], I, 'elbow_flex', ['curl_db']),
  X('hammer_curl', 'Hammer curl', 'biceps', [], [['dumbbell']], I, 'elbow_flex', ['curl_db']),
  X('cable_curl', 'Cable curl', 'biceps', [], [['cable']], I, 'elbow_flex', ['curl_db']),
  X('preacher_m', 'Machine preacher curl', 'biceps', [], [['machine']], I, 'elbow_flex', ['curl_db']),
  X('band_curl', 'Band curl', 'biceps', [], [['bands']], I, 'elbow_flex', ['curl_db']),
  // Triceps
  X('cgbp', 'Close-grip bench press', 'triceps', ['chest', 'shoulders'], [['barbell', 'bench', 'rack']], C, 'h_push', ['bench_dip']),
  X('bench_dip', 'Bench dip', 'triceps', ['chest', 'shoulders'], [['bench'], ['bodyweight']], C, 'elbow_ext', ['diamond_pushup']),
  X('skull_bb', 'Barbell skull crusher', 'triceps', [], [['barbell', 'bench']], I, 'elbow_ext', ['oh_ext_db']),
  X('oh_ext_db', 'Overhead dumbbell extension', 'triceps', [], [['dumbbell']], I, 'elbow_ext', ['oh_ext_cable']),
  X('pushdown', 'Cable pushdown', 'triceps', [], [['cable']], I, 'elbow_ext', ['band_pushdown']),
  X('oh_ext_cable', 'Overhead cable extension', 'triceps', [], [['cable']], I, 'elbow_ext', ['oh_ext_db']),
  X('diamond_pushup', 'Diamond push-up', 'triceps', ['chest'], BW, C, 'h_push', ['bench_dip']),
  X('band_pushdown', 'Band pushdown', 'triceps', [], [['bands']], I, 'elbow_ext', ['pushdown']),
  // Quads
  X('squat_bb', 'Back squat', 'quads', ['glutes', 'hamstrings', 'core'], [['barbell', 'rack']], C, 'squat', ['front_squat', 'leg_press']),
  X('front_squat', 'Front squat', 'quads', ['glutes', 'core'], [['barbell', 'rack']], C, 'squat', ['squat_bb', 'goblet_squat']),
  X('hack_squat', 'Hack squat', 'quads', ['glutes'], [['machine']], C, 'squat', ['leg_press']),
  X('leg_press', 'Leg press', 'quads', ['glutes'], [['machine']], C, 'squat', ['hack_squat', 'squat_bb']),
  X('goblet_squat', 'Goblet squat', 'quads', ['glutes', 'core'], [['dumbbell'], ['kettlebell']], C, 'squat', ['split_squat_db']),
  X('split_squat_db', 'Bulgarian split squat', 'quads', ['glutes'], [['dumbbell', 'bench'], ['bodyweight', 'bench']], C, 'lunge', ['lunge_db']),
  X('lunge_db', 'Dumbbell walking lunge', 'quads', ['glutes'], [['dumbbell']], C, 'lunge', ['split_squat_db']),
  X('step_up', 'Step-up', 'quads', ['glutes'], [['bench', 'dumbbell'], ['bench', 'bodyweight']], C, 'lunge', ['lunge_db']),
  X('leg_ext', 'Leg extension', 'quads', [], [['machine']], I, 'knee_ext', ['split_squat_bw']),
  X('split_squat_bw', 'Bodyweight split squat', 'quads', ['glutes'], BW, C, 'lunge', ['goblet_squat']),
  // Hamstrings
  X('deadlift', 'Conventional deadlift', 'hamstrings', ['glutes', 'back', 'core'], [['barbell']], C, 'hinge', ['rdl_bb']),
  X('rdl_bb', 'Romanian deadlift', 'hamstrings', ['glutes', 'back'], [['barbell']], C, 'hinge', ['rdl_db']),
  X('rdl_db', 'Dumbbell Romanian deadlift', 'hamstrings', ['glutes', 'back'], [['dumbbell']], C, 'hinge', ['rdl_bb']),
  X('sl_rdl_db', 'Single-leg dumbbell RDL', 'hamstrings', ['glutes'], [['dumbbell']], C, 'hinge', ['rdl_db']),
  X('good_morning', 'Good morning', 'hamstrings', ['glutes', 'back'], [['barbell', 'rack']], C, 'hinge', ['rdl_bb']),
  X('lying_leg_curl', 'Lying leg curl', 'hamstrings', [], [['machine']], I, 'knee_flex', ['seated_leg_curl']),
  X('seated_leg_curl', 'Seated leg curl', 'hamstrings', [], [['machine']], I, 'knee_flex', ['lying_leg_curl']),
  X('nordic_curl', 'Nordic curl', 'hamstrings', [], BW, I, 'knee_flex', ['lying_leg_curl']),
  X('band_leg_curl', 'Band leg curl', 'hamstrings', [], [['bands']], I, 'knee_flex', ['nordic_curl']),
  // Glutes
  X('hip_thrust_bb', 'Barbell hip thrust', 'glutes', ['hamstrings'], [['barbell', 'bench']], C, 'hip_ext', ['hip_thrust_db']),
  X('hip_thrust_db', 'Dumbbell hip thrust', 'glutes', ['hamstrings'], [['dumbbell', 'bench']], C, 'hip_ext', ['hip_thrust_bb', 'glute_bridge']),
  X('kb_swing', 'Kettlebell swing', 'glutes', ['hamstrings', 'core'], [['kettlebell'], ['dumbbell']], C, 'hinge', ['hip_thrust_db']),
  X('sumo_dl', 'Sumo deadlift', 'glutes', ['quads', 'hamstrings', 'back'], [['barbell']], C, 'hinge', ['hip_thrust_bb']),
  X('glute_bridge', 'Glute bridge', 'glutes', ['hamstrings'], BW, I, 'hip_ext', ['hip_thrust_db']),
  X('sl_glute_bridge', 'Single-leg glute bridge', 'glutes', ['hamstrings'], BW, I, 'hip_ext', ['glute_bridge']),
  X('cable_kickback', 'Cable kickback', 'glutes', [], [['cable']], I, 'hip_ext', ['glute_bridge']),
  X('hip_abd_m', 'Hip abduction machine', 'glutes', [], [['machine']], I, 'hip_abd', ['band_walk']),
  X('band_walk', 'Band lateral walk', 'glutes', [], [['bands']], I, 'hip_abd', ['hip_abd_m']),
  // Calves
  X('calf_standing_m', 'Standing calf raise', 'calves', [], [['machine']], I, 'calf', ['calf_sl_db']),
  X('calf_seated', 'Seated calf raise', 'calves', [], [['machine']], I, 'calf', ['calf_standing_m']),
  X('calf_leg_press', 'Leg press calf raise', 'calves', [], [['machine']], I, 'calf', ['calf_standing_m']),
  X('calf_sl_db', 'Single-leg dumbbell calf raise', 'calves', [], [['dumbbell']], I, 'calf', ['calf_bw']),
  X('calf_bw', 'Bodyweight calf raise', 'calves', [], BW, I, 'calf', ['calf_sl_db']),
  // Core
  X('hanging_leg_raise', 'Hanging leg raise', 'core', [], [['pullup_bar']], I, 'core_flex', ['reverse_crunch']),
  X('cable_crunch', 'Cable crunch', 'core', [], [['cable']], I, 'core_flex', ['crunch']),
  X('pallof', 'Pallof press', 'core', [], [['cable'], ['bands']], I, 'core_anti', ['plank']),
  X('plank', 'Plank', 'core', [], BW, I, 'core_anti', ['dead_bug']),
  X('side_plank', 'Side plank', 'core', [], BW, I, 'core_anti', ['plank']),
  X('dead_bug', 'Dead bug', 'core', [], BW, I, 'core_anti', ['plank']),
  X('reverse_crunch', 'Reverse crunch', 'core', [], BW, I, 'core_flex', ['hanging_leg_raise']),
  X('crunch', 'Crunch', 'core', [], BW, I, 'core_flex', ['cable_crunch']),
  X('side_bend_db', 'Dumbbell side bend', 'core', [], [['dumbbell']], I, 'core_anti', ['side_plank']),
];

const A = (id, name, equip, impact, intensities) => ({ id, name, equip, impact, intensities });
/** Cardio activities, low impact first (preference order). */
export const ACTIVITIES = [
  A('walk', 'Brisk walk', [['outdoors'], ['treadmill']], 'low', ['steady']),
  A('incline_walk', 'Incline treadmill walk', [['treadmill']], 'low', ['steady', 'intervals']),
  A('bike', 'Bike', [['bike']], 'low', ['steady', 'intervals']),
  A('rower', 'Rower', [['rower']], 'low', ['steady', 'intervals']),
  A('elliptical', 'Elliptical', [['elliptical']], 'low', ['steady', 'intervals']),
  A('hike', 'Hike', [['outdoors']], 'low', ['steady']),
  A('swim', 'Swim', [['pool']], 'low', ['steady']),
  A('stairs', 'Stair climber', [['stair_machine']], 'low', ['steady']),
  A('kb_circuit', 'Kettlebell circuit', [['kettlebell']], 'high', ['intervals']),
  A('bw_circuit', 'Bodyweight circuit', [['bodyweight']], 'high', ['intervals']),
  A('jump_rope', 'Jump rope', [['jump_rope']], 'high', ['steady', 'intervals']),
  A('run', 'Run', [['outdoors'], ['treadmill']], 'high', ['steady', 'intervals']),
];

export function allExercises(custom = []) {
  return [...LIBRARY, ...custom.filter((c) => !c.deleted)];
}
export function allActivities(custom = []) {
  return [...ACTIVITIES, ...custom.filter((c) => !c.deleted)];
}
/** Lookup including deleted customs (history must still resolve names). */
export function findExercise(id, custom = []) {
  return LIBRARY.find((e) => e.id === id) || custom.find((e) => e.id === id) || null;
}
export function findActivity(id, custom = []) {
  return ACTIVITIES.find((e) => e.id === id) || custom.find((e) => e.id === id) || null;
}
