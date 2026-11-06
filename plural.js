const rules = new Intl.PluralRules("en");

/** The plural of each noun the page counts, keyed by its singular */
const plurals = {
	conversation: "conversations",
	label: "labels",
	"pull request": "pull requests",
};

/**
 * The form of `noun` for `count`, e.g. “label” for 1 and “labels” for 2. `Intl.PluralRules` picks the form, {@link plurals} spells it.
 * @param {keyof typeof plurals} noun - The singular
 * @param {number} count
 * @returns {string}
 */
export function plural (noun, count) {
	return rules.select(count) === "one" ? noun : plurals[noun];
}
