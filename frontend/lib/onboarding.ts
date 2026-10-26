import type { OnboardingProgress, SettingsSection } from "./types";
import { settingsSections } from "./managed-settings";

export function initialOnboarding(): OnboardingProgress {
  return { current: "model", completed: [], skipped: [], finished: false, pending: null };
}

export function advanceOnboarding(
  progress: OnboardingProgress,
  section: SettingsSection,
  skip = false,
): OnboardingProgress {
  const completed = progress.completed.filter((value) => value !== section);
  const skipped = progress.skipped.filter((value) => value !== section);
  (skip ? skipped : completed).push(section);
  const next = settingsSections.find(({ id }) => !completed.includes(id) && !skipped.includes(id));
  return { current: next?.id ?? section, completed, skipped, finished: !next, pending: null };
}
