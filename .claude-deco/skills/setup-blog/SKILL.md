---
name: setup-blog
description: Install and configure the Blog Manager on a deco-site storefront. Covers the blog app, page routes, sections, Blog Manager MCP connection in Studio, and first-run brand context initialization.
---

Set up the Blog Manager integration on a deco storefront. Follow every step exactly — this runs across many sites and must be consistent.

---

## Step 1 — Verify dependency version

Before creating any files, verify that the **`apps`** dependency meets the minimum version:

- **`apps`** must be at least **0.144.0**

Check `deno.json` (or `import_map.json`) for the entry that resolves `apps/`:
```json
"apps/": "https://deno.land/x/deco_apps@0.x.x/"
```

If the version is below the required minimum, stop and tell the user:
> "The `apps` dependency is currently at `<version>`. Please update it to at least `0.144.0` before continuing — the blog requires features introduced in that version."

Only proceed once the version requirement is satisfied.

---

## Step 2 — Create blog app re-export file

Create **`apps/deco/blog.ts`**:
```ts
export { default } from "apps/blog/mod.ts";
export * from "apps/blog/mod.ts";
```

---

## Step 3 — Register the blog app as a deco block

Create **`.deco/blocks/deco-blog.json`**:
```json
{ "__resolveType": "site/apps/deco/blog.ts" }
```

---

## Step 4 — Find the correct Header and Footer names

The Header and Footer `__resolveType` values vary per site — **do not assume `"Global Header"` and `"Global Footer"`**.

Before creating the page files, inspect the site's homepage block to find the exact names in use:
1. Read `.deco/blocks/pages-home.json` (or whichever file contains the `/` route).
2. Find the Lazy sections that wrap the Header and Footer — copy their `__resolveType` values exactly.
3. Use those values in Steps 5 and 6 below wherever `"Global Header"` and `"Global Footer"` appear.

---

## Step 5 — Create the Blog Listing page

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
        "__resolveType": "blog/loaders/BlogpostList.ts"
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

## Step 6 — Create the Blog Post page

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
        "__resolveType": "blog/loaders/BlogPostPage.ts",
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

> Both the BlogPost section and SEO use `blog/loaders/BlogPostPage.ts`. Blog Manager publishes posts directly to the blog block collection (`collections/blog/posts/{slug}`) — the loader picks them up automatically.

---

## Step 7 — Create the Blog sections

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

Renders the full blog post: hero, featured image, and rich content sections.

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

## Step 8 — Add a Blog link to the Header navbar

The header block is already known from Step 4. Now add a Blog navigation link to it so users can reach `/blog` from any page.

1. **Find the header block file.**
   - The header `__resolveType` found in Step 4 (e.g. `"Global Header"`) is the block name.
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

## Step 9 — Connect Blog Manager in Studio

After the storefront pages are set up, connect the Blog Manager MCP agent in Studio.

1. Open **Studio → Settings → Virtual MCPs → + New**
2. Set the MCP server URL to:
   ```
   https://spire-agent.infra.deco.cx/mcp
   ```
3. Give it a name like **"Blog Manager"** and save.
4. Studio will discover 20 tools including `BLOG_MANAGER` — it appears as a **Pinned View** tab automatically.

Then configure the Blog Manager settings (in Studio → Settings → Blog Manager):
- **Domain** — the site's domain (e.g. `mystore.com.br`)
- **GitHub Owner** — the org or user that owns the site's repo (e.g. `decocms`)
- **GitHub Repo** — the repo name (e.g. `mystore`)
- **Language** — content language (e.g. `pt-BR` or `en`)

Then connect the required bindings in **Studio → Settings → Connections**:

| Binding | Required | Purpose |
|---|---|---|
| **GitHub** | Yes | Publishes posts to `.deco/blocks/` in the site repo |
| **Google Analytics 4** | Optional | Traffic and engagement data (ANALYTICS_REPORT) |
| **Google Search Console** | Optional | Rankings and impressions (ANALYTICS_OPPORTUNITIES) |
| **SemRush** | Optional | Keyword research (SEO_CONTENT_CLUSTER) |
| **nanoBanana** | Optional | AI cover image generation (POST_CREATE) |

---

## Step 10 — Initialize brand context

Brand context is the mandatory first step before any content generation. The agent will not create posts until context is loaded.

1. In Studio, open the Blog Manager agent — the **BLOG_MANAGER** Pinned View appears as a tab.
2. Call **BLOG_STATUS** — it reports `context.hasContext: false` and points to the Context tab.
3. The UI redirects to the **Context** tab automatically when GitHub is connected but context is missing.
4. Click **"Build Brand Context"** and enter the site URL — this scrapes the homepage, extracts brand identity with AI, and saves `brand/brand.md` and `brand/guardrails.md` to `.deco/blog-manager/brand/` in the site's GitHub repo.
5. Once complete, every session automatically loads context before generating any content.

> Re-run BLOG_BUILD_CONTEXT (with `force: true`) whenever there is a major brand or product category change.

---

## Notes for customization

- **Styles**: The section templates above use plain Tailwind. Replace class names to match the site's design system (color tokens, font utilities, spacing helpers, etc.) once sections are created.
- **SEO on the listing page**: Fill in `title` and `description` in `pages-Blog-listing.json` with the correct site-specific copy.
- **`postsPerPage`**: Defaults to `100` so all posts load client-side for filtering. Reduce this if the site has many posts and server-side pagination is preferred.
- **Posts storage**: Blog Manager publishes posts to `.deco/blocks/collections%2Fblog%2Fposts%2F{slug}.json` in the site's repo — they appear in the blog listing automatically via `blog/loaders/BlogpostList.ts`.
- **Library files**: Brand context lives at `.deco/blog-manager/brand/brand.md` and `.deco/blog-manager/brand/guardrails.md`. Campaign data lives at `.deco/blog-manager/campaigns/{weekId}/`.
- **Campaign workflow**: Use CAMPAIGN_BRIEF (keyword research, operator selects keywords) → CAMPAIGN_PLAN (ranked post ideas) → POST_OUTLINE → POST_CREATE → BLOG_PUBLISH_POST for the full 2-gate approval flow.
