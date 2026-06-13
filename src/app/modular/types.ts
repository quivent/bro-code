// This module forwards to the authoritative types in lib/types.ts (maintained unified package).
// Early duplicate declarations were removed to eliminate name conflicts when the broad tsconfig include
// pulls in both modular/types.ts and lib/types.ts (via barrel). Consumers should prefer importing from
// './lib/types' (or the package barrel) when possible.
export * from './lib/types';
