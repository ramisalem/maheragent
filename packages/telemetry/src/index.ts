// Anonymous, opt-out telemetry. Off when the user disables it or in CI by default.
// TODO: wire a sink + opt-out check. No PII.
export function track(_event: string, _props?: Record<string, unknown>): void {
  // TODO
}
