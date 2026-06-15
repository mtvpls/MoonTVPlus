export function isTVModeEnabled() {
  return process.env.ENABLE_TV_MODE !== 'false';
}
