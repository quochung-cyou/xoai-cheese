/**
 * Registers the module customization hooks in `raw-loader.mjs`.
 *
 * Node only activates resolve/load hooks registered through `module.register`;
 * passing a hooks file to `--import` does nothing useful. Used as:
 *
 *   node --import ./scripts/register-hooks.mjs --experimental-strip-types <script>
 */
import { register } from 'node:module';

register('./raw-loader.mjs', import.meta.url);
