/**
 * A simple classnames merge function.
 * Filters out falsy values and joins with spaces.
 *
 * @param  {...(string|boolean|undefined|null)} classes
 * @returns {string}
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}
