/**
 * @docs ../docs/template.md
 *
 * <template>-based renderer.
 *
 * The library doesn't ship an opinion on markup. Consumers provide a
 * `<template>` element; this module clones it per event, fills slots,
 * and hides nodes that have no data behind them.
 *
 * Binding syntax:
 *   - `data-slot="summary"`               → textContent ← data.summary
 *   - `data-slot="description" data-html` → innerHTML  ← data.description (trusted)
 *   - `data-slot="mapLink" data-attr="href"` → element.href ← data.mapLink
 *   - When the bound value is falsy/empty, the element gets `hidden`
 *     (or is removed entirely if `data-remove-empty` is present).
 *
 * Multiple `data-attr` bindings on one node are NOT supported — split
 * the binding across child nodes if you need to set both `href` and a
 * label. Keeping the binding rule one-per-node makes the renderer
 * trivial to reason about.
 */

/**
 * Resolve a template parameter into an HTMLTemplateElement.
 * Accepts an element, a selector string, or an HTML string.
 */
export function resolveTemplate(input, doc = document) {
  if (input instanceof HTMLTemplateElement) return input;
  if (typeof input !== 'string') {
    throw new TypeError(`gCal: template must be a <template> element, selector, or HTML string (got ${typeof input})`);
  }
  // Selector form ("#gcal-row", ".event-tpl")
  if (input.startsWith('#') || input.startsWith('.')) {
    const found = doc.querySelector(input);
    if (!found) throw new Error(`gCal: no template found for selector ${input}`);
    if (!(found instanceof HTMLTemplateElement)) {
      throw new Error(`gCal: ${input} is not a <template> element`);
    }
    return found;
  }
  // HTML string form — wrap in a <template> so the parser handles it.
  const wrapper = doc.createElement('template');
  wrapper.innerHTML = input.trim();
  // If the HTML string was itself "<template>…</template>", unwrap one level.
  if (wrapper.content.children.length === 1 && wrapper.content.firstElementChild instanceof HTMLTemplateElement) {
    return wrapper.content.firstElementChild;
  }
  return wrapper;
}

/**
 * Clone a template, bind data to its `data-slot` nodes, return the
 * resulting DocumentFragment ready to append.
 */
export function renderTemplate(template, data) {
  const fragment = template.content.cloneNode(true);
  for (const node of fragment.querySelectorAll('[data-slot]')) {
    bindSlot(node, data);
  }
  return fragment;
}

function bindSlot(node, data) {
  const key = node.dataset.slot;
  const value = data[key];
  const empty = value === undefined || value === null || value === '';

  if (empty) {
    // Two ways to handle missing fields. `data-remove-empty` is for
    // markup where leaving the node behind would still be visible
    // (e.g. an empty `<a>` with its own border). The default — hiding
    // via the `hidden` attribute — keeps the DOM stable for CSS that
    // wants to lay out around the absence.
    if ('removeEmpty' in node.dataset) node.remove();
    else node.hidden = true;
    return;
  }

  // Make sure a previously-hidden template node becomes visible.
  // (Templates often ship attrs like `<a hidden>` so unbound markup
  // doesn't flash before render.)
  node.hidden = false;

  const attr = node.dataset.attr;
  if (attr) {
    node.setAttribute(attr, String(value));
    return;
  }

  if ('html' in node.dataset) {
    // Trusted HTML — for description fields that Google returns with
    // <br>, <a>, etc. baked in. Consumers opt into this per-slot;
    // there is no global "always-as-html" switch.
    node.innerHTML = String(value);
  } else {
    node.textContent = String(value);
  }
}
