/** Remove only complete leading bootstrap blocks; keep real user text verbatim. */
export function stripLeadingMessageContext(text: string): string {
  return String(text ?? "")
    .replace(
      /^(?:\s*<(recommended_plugins|environment_context)>[\s\S]*?<\/\1>)+\s*/i,
      "",
    )
    .trim();
}

export function isMessageContextOnly(text: string): boolean {
  return (
    /^\s*<(recommended_plugins|environment_context)>/i.test(text) &&
    !stripLeadingMessageContext(text)
  );
}
