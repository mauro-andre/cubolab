import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { emptyState, type State, stateSchema } from "../schemas/state.js";
import { paths } from "./paths.js";

export const readState = (): State => {
    if (!existsSync(paths.state)) return emptyState();
    const raw = readFileSync(paths.state, "utf8");
    return stateSchema.parse(JSON.parse(raw));
};

export const writeState = (state: State): void => {
    const validated = stateSchema.parse(state);
    mkdirSync(dirname(paths.state), { recursive: true });
    writeFileSync(paths.state, `${JSON.stringify(validated, null, 4)}\n`);
};

export const ensureState = (): State => {
    if (existsSync(paths.state)) return readState();
    const state = emptyState();
    writeState(state);
    return state;
};
