/// <reference types="vite/client" />

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

declare const __APP_VERSION__: string;
declare const __CHANGELOG__: string;
