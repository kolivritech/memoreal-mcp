import {
  deriveNamespace,
  resolveCloudConfig,
  isPlaceholderApiKey,
  ONBOARDING_WIZARD_PROMPT,
  fetchSessionStartContext,
  buildReadSuffix,
  buildWriteSuffix,
  buildEditSuffix,
  isChildSession,
  isChildSubagentSession,
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
  isChildSession,
  isChildSubagentSession,
  MemorealHooksPlugin,
  MemorealHooksPlugin as MemoriaHooksPlugin,
  setup,
}

export default {
  id: "memoria-hooks",
  server: MemorealHooksPlugin,
  setup,
  isChildSession,
  isChildSubagentSession,
}