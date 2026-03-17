/**
 * Manual CSL WASM loader.
 *
 * Vite 2 treats `.wasm` imports as asset URLs, not instantiated modules.
 * We bypass the package's entry point and wire the WASM up ourselves:
 *   1. Import the JS bindings (bg.js) which export the __wbg_* glue functions.
 *   2. Import the .wasm file as a URL (Vite 2 default).
 *   3. Fetch + instantiate the WASM, passing the glue functions as imports.
 *   4. Call __wbg_set_wasm() so bg.js can call into the WASM exports.
 */

/* eslint-disable camelcase */
import * as bg from "@emurgo/cardano-serialization-lib-browser/cardano_serialization_lib_bg.js";
import wasmUrl from "@emurgo/cardano-serialization-lib-browser/cardano_serialization_lib_bg.wasm?url";

let initialized = false;
let initPromise = null;

async function init() {
  // Collect every __wbg_* / __wbindgen_* export from bg.js as the import object
  const imports = {
    "./cardano_serialization_lib_bg.js": {}
  };

  for (const [key, value] of Object.entries(bg)) {
    if (key.startsWith("__wbg_") || key.startsWith("__wbindgen_")) {
      imports["./cardano_serialization_lib_bg.js"][key] = value;
    }
  }

  const response = await fetch(wasmUrl);
  const result = await WebAssembly.instantiateStreaming(response, imports);
  bg.__wbg_set_wasm(result.instance.exports);
  initialized = true;
}

/**
 * Returns the fully-initialised CSL namespace (same exports as the package).
 * Safe to call multiple times — WASM is only loaded once.
 */
export async function getCSL() {
  if (!initialized) {
    if (!initPromise) {
      initPromise = init();
    }
    await initPromise;
  }
  return bg;
}
