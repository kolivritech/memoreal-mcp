import {
  deriveNamespace,
  resolveCloudConfig,
  buildReadSuffix,
  buildWriteSuffix,
  buildEditSuffix,
  MemorealHooksPlugin,
  setup,
} from "./memoreal-hooks.js"

export {
  deriveNamespace,
  resolveCloudConfig,
  buildReadSuffix,
  buildWriteSuffix,
  buildEditSuffix,
  MemorealHooksPlugin,
  MemorealHooksPlugin as MemoriaHooksPlugin,
  setup,
}

export default {
  id: "memoria-hooks",
  server: MemorealHooksPlugin,
  setup,
}
