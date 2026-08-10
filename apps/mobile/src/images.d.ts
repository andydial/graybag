/**
 * Image imports, typed.
 *
 * Metro resolves `import logo from './logo.png'` to an asset module; TypeScript does not know
 * that without being told. `expo/types` covers some of this in newer SDKs but not `.png` under
 * this configuration, and the alternative — `require()` — is forbidden by the lint.
 *
 * `number` is what Metro actually produces: an opaque asset registry id, which is exactly what
 * `Image`'s `source` accepts.
 */
declare module '*.png' {
  const asset: number;
  export default asset;
}
