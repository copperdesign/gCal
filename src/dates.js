/**
 * @docs ../docs/dates.md
 *
 * Intl-based date formatter for Google Calendar events.
 *
 * The composer expresses the German-style "5. Juni bis 7. Juni 2026
 * um 14:00 Uhr" pattern using configurable connector words, so other
 * locales can drop in their own ("from … to …", "du … au …", etc.).
 */

// Default German connectors — the original use case. Override via
// `formatEventDates(event, { connectors: { ... } })`.
export const DE_CONNECTORS = Object.freeze({
  rangeJoin: 'bis',     // "5. Juni BIS 7. Juni"
  timeJoin:  'um',      // "…2026 UM 14:00"
  timeRange: 'bis',     // "14:00 BIS 16:00"
  timeSuffix:'Uhr',     // "…16:00 UHR"
});

// Google Calendar emits either `dateTime` (timed events, ISO 8601 with
// offset) or `date` (all-day events, YYYY-MM-DD). The presence of a
// time component is the authoritative "is this an all-day event" signal.
function extractDate(side) {
  return side.dateTime ?? side.date;
}

function isAllDay(start, end) {
  // All-day events use `.date`, timed events use `.dateTime`. Either
  // side being date-only means the whole event is all-day in Google's
  // data model.
  return !start.dateTime || !end.dateTime;
}

/**
 * Build Intl formatters once per (locale, timeZone) pair and reuse.
 * Constructing Intl.DateTimeFormat is non-trivial; caching matters
 * when rendering dozens of events on a page.
 */
const formatterCache = new Map();
function getFormatters(locale, timeZone) {
  const key = `${locale}|${timeZone ?? ''}`;
  let cached = formatterCache.get(key);
  if (cached) return cached;
  const opts = timeZone ? { timeZone } : {};
  cached = {
    dayMonth: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', ...opts }),
    year:     new Intl.DateTimeFormat(locale, { year: 'numeric', ...opts }),
    time:     new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false, ...opts }),
    iso:      new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...opts }),
    // Structured parts let us identify "same day" / "same time" without
    // string-comparing locale-formatted output (which breaks across locales).
    isoTime:  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, ...opts }),
  };
  formatterCache.set(key, cached);
  return cached;
}

/**
 * Format the start/end of a Google Calendar event into a human-readable
 * range string plus structured fields a template can bind to.
 *
 * Returns:
 *   {
 *     dates:    "5. Juni bis 7. Juni 2026 um 14:00 Uhr",  // composed string
 *     allDay:   boolean,
 *     sameDay:  boolean,
 *     sameTime: boolean,
 *     startDay, startMonth, startYear, startTime,         // structured parts
 *     endDay,   endMonth,   endYear,   endTime            // (end* only when different)
 *   }
 *
 * Hook point: consumers wanting a completely different sentence shape
 * (e.g. icon-based date pills) should bypass this and write their own
 * formatter, passed to GCal as `formatDates`.
 */
export function formatEventDates(event, options = {}) {
  const {
    locale     = 'de-DE',
    timeZone,
    connectors = DE_CONNECTORS,
  } = options;

  const startSrc = extractDate(event.start);
  const endSrc   = extractDate(event.end);
  const start = new Date(startSrc);
  const end   = new Date(endSrc);
  const allDay = isAllDay(event.start, event.end);

  const fmt = getFormatters(locale, timeZone);

  // Same-day / same-time comparison uses ISO output (locale-independent)
  // so reordering month/day in other locales doesn't confuse the check.
  const sameDay  = fmt.iso.format(start) === fmt.iso.format(end);
  const sameTime = !allDay && fmt.isoTime.format(start) === fmt.isoTime.format(end);

  const startDayMonth = fmt.dayMonth.format(start);
  const endDayMonth   = fmt.dayMonth.format(end);
  const startYear     = fmt.year.format(start);
  const startTime     = allDay ? '' : fmt.time.format(start);
  const endTime       = allDay ? '' : fmt.time.format(end);

  // Compose the sentence. Mirrors the original cal.js shape so existing
  // sites swapping in this library see the same output by default.
  let dates = startDayMonth;
  if (!sameDay) dates += ` ${connectors.rangeJoin} ${endDayMonth}`;
  dates += ` ${startYear}`;
  if (!allDay) {
    dates += ` ${connectors.timeJoin} ${startTime}`;
    if (!sameTime) dates += ` ${connectors.timeRange} ${endTime}`;
    dates += ` ${connectors.timeSuffix}`;
  }

  return {
    dates,
    allDay,
    sameDay,
    sameTime,
    startDay:   String(start.getDate()),
    startMonth: startDayMonth.replace(/^\d+\.?\s*/, ''),  // "Juni" from "5. Juni"
    startYear,
    startTime,
    endDay:     sameDay ? '' : String(end.getDate()),
    endMonth:   sameDay ? '' : endDayMonth.replace(/^\d+\.?\s*/, ''),
    endYear:    sameDay ? '' : fmt.year.format(end),
    endTime:    sameTime ? '' : endTime,
  };
}
