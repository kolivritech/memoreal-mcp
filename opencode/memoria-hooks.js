import {
  deriveNamespace,
  resolveCloudConfig,
  isPlaceholderApiKey,
  ONBOARDING_WIZARD_PROMPT,
  fetchSessionStartContext,
  buildReadSuffix,
  buildWriteSuffix,
  buildEditSuffix,
  MemorealHooksPlugin,
  setup,
} from "./memoreal-hooks.js"

export {
  deriveNamespace,
  resolveCloudConfig,
  isPlaceholderApiKey,
  ONBOARDING_WIZARD_PROMPT,
  fetchSessionStartContext,
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