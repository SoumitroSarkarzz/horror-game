interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  readonly VITE_ICE_SERVERS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.md?raw" {
  const value: string;
  export default value;
}
