/**
 * Prompt text for the Magic Board, bundled at build time.
 *
 * These are the same prompts the ai4edu backend served from
 * `backend/prompts/` — copied verbatim into the frontend so the whole board
 * (generation included) runs without a server. Edit the .txt files, not this
 * module; Vite inlines them here.
 */
import analyzeUser from '../prompts/analyze_user.txt?raw';
import classify from '../prompts/classify.txt?raw';
import refineElements from '../prompts/refine_elements.txt?raw';
import refineScenario from '../prompts/refine_scenario.txt?raw';
import refine from '../prompts/refine.txt?raw';
import simulation from '../prompts/simulation.txt?raw';

export const PROMPT_SIMULATION = simulation;
export const PROMPT_ANALYZE_USER = analyzeUser.trim();
export const PROMPT_REFINE = refine;
export const PROMPT_REFINE_ELEMENTS = refineElements;
export const PROMPT_REFINE_SCENARIO = refineScenario;
export const PROMPT_CLASSIFY = classify;
