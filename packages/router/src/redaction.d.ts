export function redactSensitiveText(
  value: unknown,
  knownSecrets?: Array<string | undefined | null>,
): string;
