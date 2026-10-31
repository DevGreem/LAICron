export const platform = "linux";

export { createNotifier } from "./notifier.js";
export { createSystemdInstaller, renderDesktop, renderUnit } from "./service-installer.js";
export type { ExecFn, ExecResult, InstallOptions, ServiceInstaller } from "./service-installer.js";
