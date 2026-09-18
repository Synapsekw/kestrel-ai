/** Spec section 6 screen 5 lists provider keys; S5 owns the provider UI (query screen), this is the pointer. */
export function ProvidersPlaceholder() {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">Provider keys</h2>
      <p className="text-sm text-slate-400">
        OpenAI and Anthropic API keys are entered from the Query screen and stored in Windows Credential
        Manager; they are never written to the project folder. This section becomes editable with the
        inference UI.
      </p>
    </section>
  );
}
