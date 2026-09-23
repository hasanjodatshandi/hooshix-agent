/** R7.01 compatibility projection over the single retention parser in `app-config.ts`. */
import { parseRetentionDaysRaw } from "./app-config.js";

export const readLegacyRetentionDays = parseRetentionDaysRaw;
