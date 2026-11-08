/**
 * The site's navigation, in one place.
 *
 * The sidebar, the previous/next footer and the mobile drawer all read from
 * this, so a page can never appear in one and be missing from another. The
 * order here is the reading order: someone going start to finish gets a tour of
 * the library, and the reference pages sit after it.
 *
 * A page that exists in `docs/` but is not listed here still gets a route — it
 * falls into an "Other" group at the end — so adding a markdown file can never
 * break the build. It just shows up in the wrong place until it is listed.
 */

export interface NavPage {
  /** The file name in `docs/`, without `.md`. */
  id: string;
  title: string;
}

export interface NavGroup {
  label: string;
  pages: NavPage[];
}

export const GROUPS: NavGroup[] = [
  {
    label: "Start",
    pages: [
      { id: "index", title: "Overview" },
      { id: "getting-started", title: "Getting started" },
    ],
  },
  {
    label: "Guide",
    pages: [
      { id: "compositions", title: "Compositions" },
      { id: "content", title: "Content" },
      { id: "look", title: "Look" },
      { id: "sound", title: "Sound" },
      { id: "checking", title: "Checking your work" },
      { id: "rendering", title: "Rendering" },
    ],
  },
  {
    label: "Reference",
    pages: [
      { id: "api-reference", title: "Programmatic API" },
      { id: "schema-reference", title: "Composition shape" },
      { id: "studio", title: "Kino Studio" },
      { id: "previews", title: "Previews" },
    ],
  },
];

/** Every page in reading order, flattened. */
export const FLAT: NavPage[] = GROUPS.flatMap((group) => group.pages);

/** The URL path for a page, given the site's base. */
export function pagePath(id: string, base: string): string {
  return id === "index" ? base : `${base}${id}/`;
}

/**
 * Groups with any markdown page missing from `GROUPS` appended.
 *
 * `ids` is what `getCollection("docs")` returned. Keeping this separate from
 * `GROUPS` means the literal above stays readable, and the check happens once.
 */
export function groupsWithExtras(ids: string[]): NavGroup[] {
  const listed = new Set(FLAT.map((page) => page.id));
  const extras = ids
    .filter((id) => !listed.has(id))
    .sort()
    .map((id) => ({ id, title: id.replace(/-/g, " ") }));
  return extras.length ? [...GROUPS, { label: "Other", pages: extras }] : GROUPS;
}

/** The pages either side of `id` in reading order. */
export function neighbours(id: string): { prev?: NavPage; next?: NavPage } {
  const i = FLAT.findIndex((page) => page.id === id);
  if (i === -1) return {};
  return { prev: FLAT[i - 1], next: FLAT[i + 1] };
}
