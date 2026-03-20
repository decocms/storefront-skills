---
name: deduplicate-loaders
description: Generate a executive summary of the site performance. 
---

The main point is to reduce the number of API calls to the server.

At the JSON of the pages, you will see loaders defined.

When two equal loaders are defined, you can combine them into a single loader.

Start analyzing the JSON of the page that the user is editing.

If there is no current, page, look for home, categories and search page.

Avoid looping, ask how many pages the user wants to analyze.

**Before:**
"page": {
    "__resolveType": "vtex/loaders/intelligentSearch/productListingPage.ts",
    "selectedFacets": [
    {
        "key": "productClusterIds",
        "value": "334"
    }
    ],
    "count": 24
},
"seo": {
    "__resolveType": "vtex/loaders/intelligentSearch/productListingPage.ts",
    "selectedFacets": [
    {
        "key": "productClusterIds",
        "value": "334"
    }
    ],
    "count": 24
}

**After:**
New file:
GlobalCluster334.json
{
    "__resolveType": "vtex/loaders/intelligentSearch/productListingPage.ts",
    "selectedFacets": [
    {
        "key": "productClusterIds",
        "value": "334"
    }
    ],
    "count": 24
}
"page": {
    "__resolveType": "GlobalCluster334",
},
"seo": {
    "__resolveType": "GlobalCluster334",
}