const day = 864e5;
// The average month, since a wait spans no particular one
// NOTE: Temporal.Duration#round() with `relativeTo` counts calendar months. Not in Safari yet (November 2026)
const month = 30.44 * day;
// Units grow with the wait, e.g. “3 yr. ago”, not “1,036 days ago”
const units = [
	["year", 12 * month],
	["month", month],
	["day", day],
	["hour", 36e5],
	["minute", 6e4],
];
// Short units, e.g. “11 min. ago”, keep the latest request on one line in the summary
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });
// Whole words, e.g. “35 days”, since a duration stands alone in its cell
const durations = Object.fromEntries(
	units.map(([unit]) => [
		unit,
		new Intl.NumberFormat("en", { style: "unit", unit, unitDisplay: "long" }),
	]),
);

/**
 * Show in a `<time>` how long ago a date was, e.g. “3 yr. ago”, or how long since, e.g. “35 days”, with the date itself in its tooltip.
 * @param {HTMLTimeElement} time
 * @param {Date | null} [date] - `null` shows “—”, e.g. a request to a team, and `undefined` nothing, e.g. while it loads
 * @param {{ duration?: boolean }} [options] - Whether to show how long since
 */
export function showTime (time, date, { duration } = {}) {
	let elapsed = Date.now() - date;
	// The largest unit the wait rounds to at least one of, so 23.8 hours read “yesterday”, not “24 hr. ago”
	let [unit, length] =
		units.find(([, length], i) => elapsed >= length - (units[i + 1]?.[1] ?? 0) / 2) ??
		units.at(-1);
	// Months and years round off days, so the tooltip adds them, e.g. “Jan 4, 2024, 11:05 AM · 1,036 days”
	let rounded = Boolean(date) && length >= month;

	time.dateTime = date?.toISOString() ?? "";
	// To the minute, as GitHub’s own tooltips
	time.title = date?.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) ?? "";
	if (rounded) {
		time.title += ` · ${durations.day.format(Math.round(elapsed / day))}`;
	}
	time.classList.toggle("rounded", rounded);
	// To the nearest, so the count agrees with the days, e.g. 1,036 days are “3 yr. ago”, not 2
	let count = Math.round(elapsed / length);
	time.textContent = date
		? duration
			? durations[unit].format(count)
			: relative.format(-count, unit)
		: date === null
			? "—"
			: "";
}
