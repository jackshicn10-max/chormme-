import type { LearningSettings } from "~types"

const SETTINGS_KEY = "yt-learning-tools-settings"

export const DEFAULT_LEARNING_SETTINGS: LearningSettings = {
  defaultLearningToolsEnabled: false,
  enableHoverTranslation: true,
  enableTranslationPrewarm: true,
  captionLeadSeconds: 0,
  manualTranslationPrewarmScope: "next20m",
  manualTranslationPrewarmWordLimit: 720
}

const toBoolean = (value: unknown, fallback: boolean): boolean => {
  return typeof value === "boolean" ? value : fallback
}

const toCaptionLeadSeconds = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LEARNING_SETTINGS.captionLeadSeconds
  }

  return Math.min(3, Math.max(0, value))
}

const toManualTranslationPrewarmScope = (
  value: unknown
): LearningSettings["manualTranslationPrewarmScope"] => {
  return value === "remaining" ? "remaining" : "next20m"
}

const toManualTranslationPrewarmWordLimit = (
  value: unknown
): LearningSettings["manualTranslationPrewarmWordLimit"] => {
  return value === 1440 || value === 2160 || value === 2880 ? value : 720
}

export const sanitizeLearningSettings = (
  value: Partial<LearningSettings> | null | undefined
): LearningSettings => {
  return {
    defaultLearningToolsEnabled: toBoolean(
      value?.defaultLearningToolsEnabled,
      DEFAULT_LEARNING_SETTINGS.defaultLearningToolsEnabled
    ),
    enableHoverTranslation: toBoolean(
      value?.enableHoverTranslation,
      DEFAULT_LEARNING_SETTINGS.enableHoverTranslation
    ),
    enableTranslationPrewarm: toBoolean(
      value?.enableTranslationPrewarm,
      DEFAULT_LEARNING_SETTINGS.enableTranslationPrewarm
    ),
    captionLeadSeconds: toCaptionLeadSeconds(value?.captionLeadSeconds),
    manualTranslationPrewarmScope: toManualTranslationPrewarmScope(
      value?.manualTranslationPrewarmScope
    ),
    manualTranslationPrewarmWordLimit: toManualTranslationPrewarmWordLimit(
      value?.manualTranslationPrewarmWordLimit
    )
  }
}

export const loadLearningSettings = async (): Promise<LearningSettings> => {
  const result = await chrome.storage.local.get(SETTINGS_KEY)
  return sanitizeLearningSettings(result[SETTINGS_KEY])
}

export const saveLearningSettings = async (
  settings: Partial<LearningSettings>
): Promise<LearningSettings> => {
  const current = await loadLearningSettings()
  const next = sanitizeLearningSettings({ ...current, ...settings })
  await chrome.storage.local.set({ [SETTINGS_KEY]: next })
  return next
}
