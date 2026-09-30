/** Legacy public facade: preserve exported dispatcher identity for existing tests and callers. */
export { createHandlerDispatcher } from "./dispatcher-factory.js";
export { dispatchToHandler } from "../legacy-tool-handler-composition.js";
