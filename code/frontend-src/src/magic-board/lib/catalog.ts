/**
 * The item catalog behind the floating picker.
 *
 * Each entry is a scenario id plus a label and the params to spawn it with —
 * spawning is instant, so anything that would normally need input (an
 * equation, an anatomy focus) is offered as a named preset instead. The
 * spawned simulations carry their own controls, so a user can keep adjusting
 * after it lands.
 */
import type { ScenarioId } from './scenarios';

export type CatalogCategoryId =
  | 'shapes3d'
  | 'graphs'
  | 'algorithms'
  | 'ai'
  | 'physics'
  | 'biology';

export interface CatalogItem {
  /** Stable id — also the React key. */
  id: string;
  /** What the user reads and picks. */
  label: string;
  scenario: ScenarioId;
  params: Record<string, unknown>;
  /** One line shown under the label. */
  hint: string;
}

export interface CatalogCategory {
  id: CatalogCategoryId;
  label: string;
  /** lucide-react icon name, resolved in the picker. */
  icon: 'Box' | 'LineChart' | 'Network' | 'Brain' | 'Atom' | 'HeartPulse';
  items: CatalogItem[];
}

/** Anatomy is the one family worth pre-resolving: the viewer takes a
 *  free-text `focus`, and these are known-good aliases in the bundled atlas. */
const anatomy = (
  id: string,
  label: string,
  focus: string,
  hint: string,
): CatalogItem => ({
  id,
  label,
  scenario: 'anatomy_3d',
  params: { focus, systems: [], isolate: true },
  hint,
});

export const CATALOG: CatalogCategory[] = [
  {
    id: 'biology',
    label: 'Anatomy',
    icon: 'HeartPulse',
    items: [
      anatomy('anatomy-heart', '3D heart', 'heart', 'Cardiac anatomy, isolated'),
      anatomy('anatomy-body', '3D whole body', '', 'Full skeleton + organs, all systems'),
      anatomy('anatomy-brain', '3D brain', 'brain', 'Nervous system, isolated'),
      anatomy('anatomy-lungs', '3D lungs', 'lungs', 'Respiratory system'),
      anatomy('anatomy-skeleton', 'Skeleton', 'skeleton', 'Whole skeletal system'),
      anatomy('anatomy-skull', 'Skull', 'skull', 'Cranial bones'),
      anatomy('anatomy-muscles', 'Muscles', 'muscles', 'Whole muscular system'),
      anatomy('anatomy-kidney', 'Kidney', 'kidney', 'Urinary system'),
      anatomy('anatomy-liver', 'Liver', 'liver', 'Digestive system'),
      anatomy('anatomy-eye', 'Eye', 'eye', 'Visual system'),
    ],
  },
  {
    id: 'shapes3d',
    label: '3D shapes',
    icon: 'Box',
    items: [
      item('sphere', 'Sphere', 'sphere', {}, 'Radius, unfold, slice, paint'),
      item('cone', 'Cone & conic sections', 'cone', {}, 'Plane slices through a cone'),
      item('cylinder', 'Cylinder', 'cylinder', {}, 'Radius and height controls'),
      item('torus', 'Torus', 'torus', {}, 'Donut surface with major/minor radius'),
      item('knot', 'Trefoil knot', 'knot', {}, 'Knot-theory curve'),
      item('mobius', 'Möbius strip', 'mobius', {}, 'One-sided twisted band'),
      item('helix', 'Helix', 'helix', {}, 'Coil / spring'),
      item('wave', 'Wave surface', 'wave', {}, 'Ripples with amplitude and frequency'),
      item('saddle', 'Saddle', 'saddle', {}, 'Hyperbolic paraboloid'),
      item('paraboloid', 'Paraboloid', 'paraboloid', {}, 'Parabolic dish'),
      item('hyperboloid', 'Hyperboloid', 'hyperboloid', {}, 'Ruled cooling-tower surface'),
      item('gaussian', 'Gaussian bump', 'gaussian', {}, 'Normal-distribution surface'),
      item('lathe', 'Surface of revolution', 'lathe', {}, 'Vase profile spun on an axis'),
      item('platonic', 'Platonic solids', 'platonic', {}, 'Tetra to icosahedron'),
      item('tetrahedron', 'Tetrahedron', 'tetrahedron', {}, 'Labelled A B C D'),
    ],
  },
  {
    id: 'graphs',
    label: 'Equations',
    icon: 'LineChart',
    items: [
      item('fn-parabola', 'Parabola  y = x²', 'function_plot', { fn: 'x^2', x_min: -10, x_max: 10 }, 'Editable plot'),
      item('fn-sine', 'Sine  y = sin(x)', 'function_plot', { fn: 'sin(x)', x_min: -10, x_max: 10 }, 'Editable plot'),
      item('fn-cubic', 'Cubic  y = x³ − 2x', 'function_plot', { fn: 'x^3 - 2x', x_min: -5, x_max: 5 }, 'Editable plot'),
      item('fn-exp', 'Exponential  y = eˣ', 'function_plot', { fn: 'e^x', x_min: -3, x_max: 3 }, 'Editable plot'),
      item('fn-sqrt', 'Root  y = √x', 'function_plot', { fn: 'sqrt(x)', x_min: 0, x_max: 20 }, 'Editable plot'),
      item('matmul', 'Matrix multiplication', 'matrix_mult', {}, 'A × B step by step'),
    ],
  },
  {
    id: 'algorithms',
    label: 'Algorithms',
    icon: 'Network',
    items: [
      item('sort', 'Bubble sort', 'bubble_sort', {}, 'Animated swaps, editable array'),
      item('matrix', 'Matrix multiply', 'matrix_mult', {}, 'Grid walkthrough'),
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    icon: 'Brain',
    items: [
      item('nn', 'Neural network', 'neural_network', {}, 'Forward pass, cat vs dog'),
      item('backprop', 'Backpropagation', 'backprop', {}, 'Gradients flowing backward'),
      item('conv', 'Convolution pipeline', 'conv_pipeline', {}, 'Kernel → feature map → dense'),
    ],
  },
  {
    id: 'physics',
    label: 'Physics',
    icon: 'Atom',
    items: [
      item('pendulum', 'Pendulum', 'pendulum', {}, 'Length, gravity, amplitude'),
      item('projectile', 'Projectile', 'projectile', {}, 'Launch speed and angle'),
      item('rc', 'RC circuit', 'rc_circuit', {}, 'Capacitor charging curve'),
    ],
  },
];

function item(
  id: string,
  label: string,
  scenario: ScenarioId,
  params: Record<string, unknown>,
  hint: string,
): CatalogItem {
  return { id, label, scenario, params, hint };
}

/** Quick chips at the top of the anatomy view (ai4edu's AnatomyPicker had the
 *  same idea). `whole body` maps to an empty focus. */
export const ANATOMY_QUICK: { label: string; focus: string }[] = [
  { label: 'whole body', focus: '' },
  { label: 'skeleton', focus: 'skeleton' },
  { label: 'skull', focus: 'skull' },
  { label: 'spine', focus: 'spine' },
  { label: 'heart', focus: 'heart' },
  { label: 'brain', focus: 'brain' },
  { label: 'lungs', focus: 'lungs' },
  { label: 'muscles', focus: 'muscles' },
  { label: 'hand', focus: 'hand' },
  { label: 'foot', focus: 'foot' },
];
