/** Compatibility projection over the single exec-enabled parser in `app-config.ts`. */
import { parseExecEnabled } from "./app-config.js";

export const isExecEnabled = parseExecEnabled;
