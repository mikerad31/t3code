import type { DesktopUpdateChannel } from "@t3tools/contracts";

const NIGHTLY_VERSION_PATTERN = /-nightly\.\d{8}\.\d+$/;
const HARDENED_VERSION_PATTERN = /-hardened\.\d+$/;

export function isNightlyDesktopVersion(version: string): boolean {
  return NIGHTLY_VERSION_PATTERN.test(version);
}

export function isHardenedDesktopVersion(version: string): boolean {
  return HARDENED_VERSION_PATTERN.test(version);
}

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  return isNightlyDesktopVersion(appVersion) ? "nightly" : "latest";
}
