const REDACTED = "[REDACTED]";

export function redactSensitiveText(value, knownSecrets = []) {
  let text = String(value ?? "");

  const secrets = [...new Set(knownSecrets)]
    .map((secret) => String(secret || "").trim())
    .filter((secret) => secret.length >= 6)
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) {
    text = text.replaceAll(secret, REDACTED);
  }

  text = text.replace(
    /([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi,
    `$1${REDACTED}:${REDACTED}@`,
  );
  text = text.replace(
    /(\bauthorization\s*:\s*)bearer\s+[^\s,;"']+/gi,
    `$1Bearer ${REDACTED}`,
  );
  text = text.replace(/\bbearer\s+[^\s,;"']+/gi, `Bearer ${REDACTED}`);
  text = text.replace(
    /([?&](?:access[_-]?token|api[_-]?key|token|secret)=)[^&#\s]+/gi,
    `$1${REDACTED}`,
  );
  text = text.replace(
    /(["'](?:authorization|x-api-key|api[-_]?key|access[-_]?token|auth[-_]?token|secret|token)["']\s*:\s*)["'][^"']*["']/gi,
    `$1"${REDACTED}"`,
  );
  text = text.replace(
    /(\b(?:x-api-key|api[-_]?key|access[-_]?token|auth[-_]?token|secret|token)\b\s*[:=]\s*)(?!\[REDACTED\])[^\s,;]+/gi,
    `$1${REDACTED}`,
  );

  return text;
}
