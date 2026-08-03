/**
 * Registrar for the test-only resolve hook. Used via `node --import`.
 * See ./strip-server-only.mjs.
 */
import { register } from "node:module";

register("./strip-server-only.mjs", import.meta.url);
