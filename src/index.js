/*! gCal — v0.1.1 - 2026-06-15
 * https://copperdesign.github.io/
 *
 * Copyright (c) 2026 Christian Fillies;
 * Licensed under the MIT license */

/**
 * @docs ../docs/index.md
 *
 * @copperdesign/gcal — public API.
 *
 * One class, one entrypoint:
 *
 *   import { GCal } from '@copperdesign/gcal';
 *
 *   const cal = new GCal({
 *     target:     '#events',
 *     template:   '#gcal-row',
 *     calendarId: '…@group.calendar.google.com',
 *     apiKey:     '…',
 *     // optional:
 *     locale:     'de-DE',
 *     timeZone:   'Europe/Berlin',
 *     maxResults: 50,
 *     emptyTemplate:   '#gcal-empty',
 *     errorTemplate:   '#gcal-error',
 *     loadingTemplate: '#gcal-loading',
 *     consent: { check, request, ctaTemplate: '#gcal-cta' },
 *     transformEvent: (event) => ({ ...event, mapLink: mapUrl(event.location) }),
 *     formatDates:    (event) => formatEventDates(event, { locale: 'de-DE' }),
 *     cleanLocation:  (loc) => loc.replace(/, Deutschland$/, ''),
 *     onError:        (err) => console.error(err),
 *   });
 *
 *   cal.mount();   // renders CTA, then events on consent
 *
 * Design notes:
 *   - The class composes the four primitives (fetch, dates, template,
 *     consent) and adds no behavior of its own beyond glue. If you want
 *     to drive the pipeline yourself (e.g. SSR-pre-rendered events
 *     hydrated client-side), import the primitives directly.
 *   - `mount()` is idempotent — call it again on consent change and it
 *     redraws. Returns an `unmount()` cleanup for SPAs.
 */

import { fetchEvents }     from './fetch.js';
import { formatEventDates } from './dates.js';
import { resolveTemplate, renderTemplate } from './template.js';
import { renderConsentCTA } from './consent.js';

export { formatEventDates, fetchEvents, renderTemplate, resolveTemplate };

const noop = () => {};

export class GCal {
  constructor(options = {}) {
    const {
      target,
      template,
      calendarId,
      apiKey,
      maxResults = 100,
      orderBy    = 'startTime',
      timeMin,
      timeMax,
      locale     = (typeof document !== 'undefined' && document.documentElement.lang) || 'de-DE',
      timeZone,
      emptyTemplate,
      errorTemplate,
      loadingTemplate,
      consent,
      transformEvent = (e) => e,
      formatDates,
      cleanLocation,
      onError = noop,
    } = options;

    if (!target)   throw new Error('gCal: target is required');
    if (!template) throw new Error('gCal: template is required');

    this.target = resolveTarget(target);
    this.template        = resolveTemplate(template);
    this.emptyTemplate   = emptyTemplate   ? resolveTemplate(emptyTemplate)   : null;
    this.errorTemplate   = errorTemplate   ? resolveTemplate(errorTemplate)   : null;
    this.loadingTemplate = loadingTemplate ? resolveTemplate(loadingTemplate) : null;

    this.fetchConfig = { calendarId, apiKey, maxResults, orderBy, timeMin, timeMax };
    this.locale      = locale;
    this.timeZone    = timeZone;
    this.consent     = consent ?? null;

    this.transformEvent = transformEvent;
    this.formatDates    = formatDates ?? ((event) => formatEventDates(event, { locale, timeZone }));
    this.cleanLocation  = cleanLocation;
    this.onError        = onError;

    // For consent flow + unmount.
    this._cleanupCTA   = null;
    this._abortCtrl    = null;
    this._consentEvent = consent?.event ?? 'consentchange';
    this._onConsent    = () => this.render();
  }

  /**
   * Render once. If consent is required and not yet granted, paints
   * the CTA instead. Safe to call multiple times — each call cancels
   * any in-flight fetch from the previous call.
   */
  async render() {
    this._cleanup();

    if (this.consent && !this.consent.check()) {
      if (!this.consent.ctaTemplate) {
        throw new Error('gCal: consent.ctaTemplate is required when consent.check is provided');
      }
      this._cleanupCTA = renderConsentCTA({
        target:   this.target,
        template: resolveTemplate(this.consent.ctaTemplate),
        onOptIn:  async () => {
          await this.consent.request();
          await this.render();
        },
      });
      return;
    }

    if (this.loadingTemplate) {
      this.target.replaceChildren(this.loadingTemplate.content.cloneNode(true));
    }

    this._abortCtrl = new AbortController();
    let items;
    try {
      items = await fetchEvents(
        { ...this.fetchConfig, timeMin: this.fetchConfig.timeMin ?? new Date().toISOString() },
        { signal: this._abortCtrl.signal },
      );
    } catch (err) {
      // AbortError is the only "not-actually-an-error" case — it means
      // another render() superseded this one, which is intentional.
      if (err.name === 'AbortError') return;
      this.onError(err);
      this._renderError(err);
      return;
    }

    this.renderItems(items);
  }

  /**
   * Render a pre-fetched event list. Useful for SSR hydration or for
   * test fixtures.
   */
  renderItems(items) {
    if (!items || items.length === 0) {
      if (this.emptyTemplate) {
        this.target.replaceChildren(this.emptyTemplate.content.cloneNode(true));
      } else {
        this.target.replaceChildren();
      }
      return;
    }

    const frag = document.createDocumentFragment();
    for (const raw of items) {
      const event = this.transformEvent(raw);
      const dates = this.formatDates(event);
      const data = this._prepareSlotData(event, dates, items.length);
      frag.appendChild(renderTemplate(this.template, data));
    }
    this.target.replaceChildren(frag);
  }

  /**
   * Wire up consent re-render listener and call render() once.
   * Returns an unmount() cleanup for SPAs.
   */
  mount() {
    if (this.consent && this._consentEvent) {
      document.addEventListener(this._consentEvent, this._onConsent);
    }
    this.render();
    return () => this.unmount();
  }

  unmount() {
    this._cleanup();
    if (this.consent && this._consentEvent) {
      document.removeEventListener(this._consentEvent, this._onConsent);
    }
    this.target.replaceChildren();
  }

  // ── internals ──────────────────────────────────────────────────────

  _cleanup() {
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
    if (this._cleanupCTA) {
      this._cleanupCTA();
      this._cleanupCTA = null;
    }
  }

  _renderError(err) {
    if (this.errorTemplate) {
      // Error template can pull from the error via data-slot="message"
      // etc. We render through the same template path so escaping is
      // consistent with event rendering.
      this.target.replaceChildren(
        renderTemplate(this.errorTemplate, { message: err.message ?? String(err) })
      );
    } else {
      // No error template — fail visibly but cheaply. Site authors who
      // want silence can pass an empty template.
      const fallback = document.createElement('div');
      fallback.className = 'gcal-error';
      fallback.textContent = err.message ?? String(err);
      this.target.replaceChildren(fallback);
    }
  }

  /**
   * Compose the per-event data object the template binds to. Flattens
   * the formatted-date fields onto the event so `data-slot="dates"`,
   * `data-slot="startDay"`, etc. all just work without nested lookups.
   */
  _prepareSlotData(event, dates, total) {
    const location = event.location && this.cleanLocation
      ? this.cleanLocation(event.location)
      : event.location ?? '';
    const mapLink = location
      ? `https://maps.google.com/maps?q=${encodeURIComponent(location)}`
      : '';
    return {
      ...event,
      ...dates,
      location,
      mapLink: event.mapLink ?? mapLink,
      htmlLink: event.htmlLink ?? '',
      total,
    };
  }
}

function resolveTarget(input) {
  if (input instanceof Element) return input;
  if (typeof input === 'string') {
    const el = document.querySelector(input);
    if (!el) throw new Error(`gCal: no target found for selector ${input}`);
    return el;
  }
  throw new TypeError('gCal: target must be an Element or selector string');
}
