/** New threads inherit preferences, never message content. */
export type NewThreadComposeSeed<TComposeMode extends string = string> = {
  composeMode: TComposeMode;
  model: string;
  reasoningEffort: string;
  reasoningSummary: string;
  sandboxMode: string;
};
export type NewThreadComposeSeedDefaults = Omit<NewThreadComposeSeed, "composeMode">;
export function buildNewThreadComposeSeed<TComposeMode extends string>(args: {
  previousThreadId: unknown;
  runtime: NewThreadComposeSeed<TComposeMode>;
  global: NewThreadComposeSeedDefaults;
}): NewThreadComposeSeed<TComposeMode> {
  return {
    composeMode: args.runtime.composeMode,
    model: args.runtime.model.trim() || args.global.model,
    reasoningEffort: args.runtime.reasoningEffort.trim() || args.global.reasoningEffort,
    reasoningSummary: args.runtime.reasoningSummary.trim() || args.global.reasoningSummary,
    sandboxMode: args.runtime.sandboxMode.trim() || args.global.sandboxMode,
  };
}
