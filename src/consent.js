/**
 * @docs ../docs/consent.md
 *
 * Provider-agnostic consent gate.
 *
 * The library never imports a specific consent SDK. Instead, consumers
 * pass a `consent` object implementing this contract:
 *
 *   {
 *     check():   boolean        // is consent currently granted?
 *     request(): Promise<void>  // user clicked the CTA — opt them in
 *     ctaTemplate: HTMLTemplateElement | string  // pre-consent markup
 *     event?: string            // optional DOM event name to re-check on
 *                               // (defaults to 'consentchange' so existing
 *                               // sites that fire this CustomEvent on opt-in
 *                               // get free re-renders)
 *   }
 *
 * A typical adapter — a cookie-consent SDK that exposes per-category
 * `hasConsent()` / `optIn()` methods — wires up like this:
 *
 *   const consent = {
 *     check:   () => window.consent?.hasConsent?.('gcal') ?? false,
 *     request: async () => window.consent?.optIn?.('gcal'),
 *     ctaTemplate: '#gcal-cta',
 *   };
 *
 * Sites with no consent gating at all should omit the option entirely —
 * the library treats absent `consent` as "always render."
 */

/**
 * Render the pre-consent CTA into `target`. Returns a cleanup function
 * that removes the click listener (so re-renders don't leak handlers).
 */
export function renderConsentCTA({ target, template, onOptIn }) {
  const fragment = template.content.cloneNode(true);
  // The clicker is conventionally any [data-gcal-optin] node inside the
  // CTA template, but plain <button> also works for one-button CTAs —
  // we listen for clicks on the fragment as a whole and let the
  // consumer's markup decide what triggers opt-in.
  const trigger = fragment.querySelector('[data-gcal-optin]')
                ?? fragment.querySelector('button');
  if (!trigger) {
    throw new Error('gCal: consent CTA template must contain a <button> or [data-gcal-optin] element');
  }
  // We need a stable reference to the (now-cloned) node before append,
  // since fragment children move into `target` on append.
  const handler = async (ev) => {
    ev.preventDefault();
    await onOptIn();
  };
  trigger.addEventListener('click', handler);

  target.replaceChildren(fragment);
  return () => trigger.removeEventListener('click', handler);
}
