# Why are there prebuilt files here?

These are the content-hashed CSS/JS bundles from every deploy that shipped
before the site switched to a single inlined index.html. Browsers and
intermediary caches (notably mobile carriers) were observed serving stale
copies of the old HTML long after those assets were replaced, which 404ed
and left the page unstyled and dead.

Publishing the old files at their original URLs means any stale cached page
loads as a fully working older version of the app instead of breaking.
Safe to delete once stale caches have plausibly aged out (they are never
referenced by the current index.html).
