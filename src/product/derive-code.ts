/**
 * "Dairy products" -> "DAIRY_PRODUCTS".
 *
 * A display name and its machine code are the same fact written twice, so the
 * server derives one from the other rather than asking a person to type both
 * and keep them in step.
 *
 * Accents are folded rather than dropped, so "Crème fraîche" becomes
 * CREME_FRAICHE instead of CRME_FRACHE and "Mützig" becomes MUTZIG — which is
 * also what makes "Mutzig" collide with it rather than becoming a second brand.
 * Anything else outside A-Z, 0-9 and dash collapses to a single underscore, and
 * the result is trimmed of them: a code is read by machines but still has to be
 * recognisable to the person who named the thing.
 *
 * Returns an empty string for a name with nothing to build from ("###"), which
 * callers treat as a refusal rather than saving a blank code.
 */
export function deriveCode(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 40);
}
