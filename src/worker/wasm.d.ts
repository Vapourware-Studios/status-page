// Static .wasm imports resolve to a pre-compiled WebAssembly.Module under the
// Cloudflare Vite plugin / wrangler. Instantiating a Module is allowed on
// Workers; compiling raw bytes at runtime is not.
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

// Vite ?raw imports resolve to the file's contents as a string.
declare module "*?raw" {
  const contents: string;
  export default contents;
}
