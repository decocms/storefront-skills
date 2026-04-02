---
name: setup-blog
description: Install and configure the Spire Blog on a deco-site storefront. Covers app registration, deco block files, page routes, and the three core blog sections (BlogPost, BlogCategories, BlogPosts).
---

Set up the Spire Blog integration on a deco storefront. Follow every step exactly — this runs across many sites and must be consistent.

---

## Step 1 — Create app re-export files

Before creating any files, verify that two dependencies meet the minimum versions:

- **`apps`** must be at least **0.144.0**
- **`deco`** must be at least **1.190.0**

Check `deno.json` (or `import_map.json`) for the entries that resolve `apps/` and `deco/` — they typically look like:
```json
"apps/": "https://deno.land/x/deco_apps@0.x.x/",
"deco/": "https://deno.land/x/deco@1.x.x/"
```
or similar specifiers pointing to `deco-cx/apps` and `deco-cx/deco`.

If either version is below the required minimum, stop and tell the user:
> "The `<dependency>` dependency is currently at `<version>`. Please update it to at least `<minimum>` before continuing — the blog app requires features introduced in that version."

Only proceed with the steps below once both version requirements are satisfied.

---

Create **`apps/deco/blog.ts`**:
```ts
export { default } from "apps/blog/mod.ts";
export * from "apps/blog/mod.ts";
```

Create **`apps/deco/spire.ts`**:
```ts
export { default } from "apps/spire/mod.ts";
export * from "apps/spire/mod.ts";
```

---

## Step 2 — Register the apps as deco blocks

Create **`.deco/blocks/deco-blog.json`**:
```json
{ "__resolveType": "site/apps/deco/blog.ts" }
```

Create **`.deco/blocks/deco-spire.json`**:
```json
{
  "__resolveType": "site/apps/deco/spire.ts",
  "account": "<SITE_ACCOUNT>"
}
```

> **Before creating this file, ask the user:** "What is the Spire account name for this site?" — wait for the answer, then use it as the `"account"` value. Do not proceed with a placeholder.

---

## Step 3 — Find the correct Header and Footer names

The Header and Footer `__resolveType` values vary per site — **do not assume `"Global Header"` and `"Global Footer"`**.

Before creating the page files, inspect the site's homepage block to find the exact names in use:
1. Read `.deco/blocks/pages-home.json` (or whichever file contains the `/` route).
2. Find the Lazy sections that wrap the Header and Footer — copy their `__resolveType` values exactly.
3. Use those values in Steps 3 and 4 below wherever `"Global Header"` and `"Global Footer"` appear.

---

## Step 3 — Create the Blog Listing page

Create **`.deco/blocks/pages-Blog-listing.json`**:
```json
{
  "__resolveType": "website/pages/Page.tsx",
  "name": "Blog",
  "path": "/blog",
  "seo": {
    "__resolveType": "website/sections/Seo/SeoV2.tsx",
    "title": "Blog",
    "description": "Latest articles and posts."
  },
  "sections": [
    {
      "__resolveType": "website/sections/Rendering/Lazy.tsx",
      "section": {
        "__resolveType": "Global Header"
      }
    },
    {
      "__resolveType": "site/sections/Blog/BlogPosts.tsx",
      "title": "Blog",
      "postsPerPage": 100,
      "showMoreText": "Show more",
      "posts": {
        "count": 100,
        "page": 1,
        "__resolveType": "spire/loaders/BlogpostList.ts"
      }
    },
    {
      "__resolveType": "website/sections/Rendering/Lazy.tsx",
      "section": {
        "__resolveType": "Global Footer"
      }
    }
  ]
}
```

---

## Step 4 — Create the Blog Post page

Create **`.deco/blocks/pages-blogpost.json`**:
```json
{
  "__resolveType": "website/pages/Page.tsx",
  "name": "Blog Post Page",
  "path": "/blog/:slug",
  "seo": {
    "__resolveType": "blog/sections/Seo/SeoBlogPost.tsx",
    "jsonLD": {
      "__resolveType": "blog/loaders/BlogPostPage.ts",
      "slug": {
        "__resolveType": "website/functions/requestToParam.ts",
        "param": "slug"
      }
    }
  },
  "sections": [
    {
      "__resolveType": "website/sections/Rendering/Lazy.tsx",
      "section": {
        "__resolveType": "Global Header"
      }
    },
    {
      "__resolveType": "site/sections/Blog/BlogPost.tsx",
      "page": {
        "__resolveType": "spire/loaders/BlogPostPage.ts",
        "slug": {
          "__resolveType": "website/functions/requestToParam.ts",
          "param": "slug"
        }
      }
    },
    {
      "__resolveType": "website/sections/Rendering/Lazy.tsx",
      "section": {
        "__resolveType": "Global Footer"
      }
    }
  ]
}
```

> The `BlogPost` section uses `spire/loaders/BlogPostPage.ts`, **not** the generic `blog/loaders/BlogPostPage.ts`.
> SEO uses `blog/sections/Seo/SeoBlogPost.tsx` with `blog/loaders/BlogPostPage.ts` for JSON-LD — this is correct, these two can differ.

---

## Step 5 — Create the Blog sections

These two sections must exist under `sections/Blog/`. Each site may already have them from a previous setup — check first. If they don't exist, create them based on the templates below.

### `sections/Blog/BlogPosts.tsx`

Renders the post grid with optional category/search filtering and pagination.

```tsx
import type { BlogPost } from "apps/blog/types.ts";
import Image from "apps/website/components/Image.tsx";

export interface Props {
  /** @title Title */
  title?: string;
  /** @title Blog Posts */
  posts?: BlogPost[];
  /**
   * @title Posts per page
   * @default 9
   */
  postsPerPage?: number;
  /**
   * @title Show More Text
   * @default Show more
   */
  showMoreText?: string;
  /** @title Current page @hide */
  page?: number;
  /** @title Selected category @hide */
  selectedCategory?: string;
  /** @title Search term @hide */
  search?: string;
  /** @hide */
  baseUrl?: string;
  /** @hide */
  hasMore?: boolean;
  /** @hide */
  totalPosts?: number;
}

export function loader(props: Props, req: Request) {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page")) || 1;
  const selectedCategory = url.searchParams.get("category") || undefined;
  const search = url.searchParams.get("q") || undefined;

  let filtered = props.posts || [];
  if (selectedCategory) {
    filtered = filtered.filter((p) => p.categories?.some((c) => c.slug === selectedCategory));
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (p) => p.title.toLowerCase().includes(q) || p.excerpt?.toLowerCase().includes(q),
    );
  }

  const perPage = props.postsPerPage || 9;
  const displayCount = page * perPage;
  const visible = filtered.slice(0, displayCount);

  return {
    ...props,
    posts: visible,
    page,
    selectedCategory,
    search,
    hasMore: displayCount < filtered.length,
    totalPosts: filtered.length,
    baseUrl: req.url,
  };
}

function getNextPageUrl(baseUrl?: string, page = 1) {
  try {
    const url = new URL(baseUrl || "");
    url.searchParams.set("page", String(page + 1));
    return `${url.pathname}${url.search}`;
  } catch {
    return `?page=${page + 1}`;
  }
}

export default function BlogPosts({
  title = "Blog",
  posts = [],
  page = 1,
  hasMore,
  baseUrl,
  search,
  totalPosts = 0,
  showMoreText = "Show more",
}: Props) {
  return (
    <div class="w-full px-4 py-8">
      {title && !search && (
        <h1 class="text-4xl font-bold mb-8">{title}</h1>
      )}
      {search && (
        <div class="mb-8">
          <h1 class="text-4xl font-bold">Search results</h1>
          <p class="text-gray-500 mt-1">{totalPosts} {totalPosts === 1 ? "result" : "results"} for "{search}"</p>
        </div>
      )}
      {posts.length === 0
        ? (
          <div class="text-center py-16">
            <p class="text-gray-500 text-lg">No posts found.</p>
            {search && <a href="/blog" class="text-blue-500 hover:underline text-sm mt-4 inline-block">Back to all posts</a>}
          </div>
        )
        : (
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {posts.map((post, i) => (
              <a key={i} href={`/blog/${post.slug}`} class="flex flex-col rounded-lg overflow-hidden border border-gray-200 hover:shadow-lg transition-shadow">
                {post.image && (
                  <div class="aspect-video overflow-hidden">
                    <Image src={post.image} alt={post.alt || post.title} width={400} height={225} class="w-full h-full object-cover" />
                  </div>
                )}
                <div class="p-4 flex flex-col gap-2 flex-1">
                  {post.categories && post.categories.length > 0 && (
                    <div class="flex gap-1 flex-wrap">
                      {post.categories.slice(0, 2).map((cat, j) => (
                        <span key={j} class="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{cat.name}</span>
                      ))}
                    </div>
                  )}
                  <h3 class="text-lg font-bold leading-tight">{post.title}</h3>
                  {post.excerpt && <p class="text-sm text-gray-500 line-clamp-2">{post.excerpt}</p>}
                  {post.date && <span class="text-xs text-gray-400 mt-auto pt-2">{new Date(post.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>}
                </div>
              </a>
            ))}
          </div>
        )}
      {hasMore && (
        <div class="flex justify-center py-8">
          <a href={getNextPageUrl(baseUrl, page)} class="px-6 py-3 border border-black rounded font-medium hover:bg-black hover:text-white transition-colors">
            {showMoreText}
          </a>
        </div>
      )}
    </div>
  );
}

export function LoadingFallback() {
  return (
    <div class="w-full px-4 py-8">
      <div class="h-10 w-48 bg-gray-100 rounded animate-pulse mb-8" />
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} class="rounded-lg overflow-hidden border border-gray-100 animate-pulse h-80 bg-gray-100" />
        ))}
      </div>
    </div>
  );
}
```

### `sections/Blog/BlogPost.tsx`

Renders the full blog post: hero, featured image, and rich content sections from Spire.

```tsx
import type { BlogPostPage } from "apps/blog/types.ts";
import Image from "apps/website/components/Image.tsx";
import { renderSection } from "apps/website/pages/Page.tsx";
import { Section } from "@deco/deco/blocks";
import type { AppContext } from "site/apps/site.ts";

export interface Props {
  /** @title Blog Post Page */
  page?: BlogPostPage | null;
  sectionsToRender?: Section[];
}

export const loader = async (props: Props, _req: Request, ctx: AppContext) => {
  if (!props?.page?.post?.sections) return props;

  const sectionsToRender = await Promise.all(
    props.page.post.sections.map(async (section, index) =>
      await ctx.get(section, {
        resolveChain: [
          { value: ctx.resolverId ?? "root", type: "resolver" },
          { value: "idx" + index, type: "prop" },
        ],
      })
    ),
  );

  return { ...props, sectionsToRender };
};

export default function BlogPost({ page, sectionsToRender }: Props) {
  if (!page) {
    return (
      <div class="w-full py-20 text-center">
        <h1 class="text-3xl font-bold text-gray-500">Post not found</h1>
        <p class="text-gray-400 mt-4">The blog post you're looking for doesn't exist.</p>
      </div>
    );
  }

  return (
    <div id="blog-post" class="w-full">
      {/* Hero */}
      <div class="bg-gray-50 py-12 md:py-16">
        <div class="max-w-3xl mx-auto px-4">
          <h1 class="text-4xl md:text-5xl font-bold leading-tight mb-4">{page.post.title}</h1>
          {page.post.excerpt && <p class="text-lg text-gray-500 mb-6">{page.post.excerpt}</p>}
          <div class="flex items-center gap-2 flex-wrap text-sm text-gray-400">
            {page.post.authors?.map((author, i) => (
              <span key={i}>{i > 0 && <span class="mx-1">|</span>}{author.name}</span>
            ))}
            {page.post.date && (
              <>
                <span class="mx-1">|</span>
                <span>{new Date(page.post.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Featured Image */}
      {page.post.image && (
        <div class="max-w-4xl mx-auto px-4 -mt-6">
          {page.post.image.startsWith("/")
            ? <img src={page.post.image} alt={page.post.alt || page.post.title} width={900} height={500} class="rounded-lg w-full h-auto" loading="lazy" />
            : <Image src={page.post.image} alt={page.post.alt || page.post.title} width={900} height={500} class="rounded-lg w-full h-auto" />}
        </div>
      )}

      {/* Content */}
      <div class="max-w-3xl mx-auto px-4 py-10 md:py-16">
        {Array.isArray(sectionsToRender) && sectionsToRender.map(renderSection)}
      </div>
    </div>
  );
}

export function LoadingFallback() {
  return (
    <div class="w-full">
      <div class="bg-gray-50 py-12 md:py-16">
        <div class="max-w-3xl mx-auto px-4 space-y-4">
          <div class="h-12 w-3/4 bg-gray-200 rounded animate-pulse" />
          <div class="h-6 w-1/2 bg-gray-200 rounded animate-pulse" />
          <div class="h-4 w-64 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>
      <div class="max-w-3xl mx-auto px-4 py-10 space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} class="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${75 + (i % 3) * 10}%` }} />
        ))}
      </div>
    </div>
  );
}
```

---

## Step 6 — Add a Blog link to the Header navbar

The header block is already known from Step 3. Now add a Blog navigation link to it so users can reach `/blog` from any page.

1. **Find the header block file.**
   - The header `__resolveType` found in Step 3 (e.g. `"Global Header"`) is the block name.
   - Locate its file under `.deco/blocks/` — it is typically named something like `header.json`, `global-header.json`, or a similar slug derived from the block name.
   - If you are unsure, list `.deco/blocks/` and open the file whose `"name"` field matches the header block name.

2. **Inspect the navbar items.**
   - Inside the header block JSON, look for the array that holds navigation links. It is usually a field named `navItems`, `items`, `links`, `navigation`, or similar — open the file and look for the array of objects that each contain a `label`/`name` and an `href`/`url` field.

3. **Append the Blog entry.**
   - Add a new object to that array following the exact same shape as the existing items. Typically:
     ```json
     { "label": "Blog", "href": "/blog" }
     ```
   - Match whatever field names (`label`, `name`, `text`, `title`, etc.) and nesting the existing items use. Do not invent new fields.

4. **Save the file** — no other changes are needed; the header section will pick up the new link automatically.

> **If the header block JSON is deeply nested or uses a resolver pattern** (e.g. `"__resolveType": "..."` for the items array), trace the resolver to find the correct place to add the link, and follow the same pattern used for existing items.

---

## Notes for customization

- **Styles**: The section templates above use plain Tailwind. Replace class names to match the site's design system (color tokens, font utilities, spacing helpers, etc.) once sections are created.
- **`overrideSections`**: Only add the `overrideSections` array to `deco-spire.json` when the site uses custom Spire content blocks (e.g. custom `Paragraph.tsx`, `Heading.tsx`, etc.) — leave it out by default.
- **SEO on the listing page**: Fill in `title` and `description` in `pages-Blog-listing.json` with the correct site-specific copy.
- **`postsPerPage`**: Defaults to `100` so all posts load client-side for filtering. Reduce this if the site has many posts and server-side pagination is preferred.
- **`BlogpostList.ts` vs `BlogPostPage.ts`**: The listing page uses `spire/loaders/BlogpostList.ts`; the post page uses `spire/loaders/BlogPostPage.ts`. Do not swap them.
