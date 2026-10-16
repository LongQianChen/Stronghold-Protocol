// Preserve asynchronous web fonts without an inline onload attribute (site CSP).
for (const link of document.querySelectorAll('link[data-web-fonts]')) {
  if (link.sheet) link.media = 'all';
  else link.addEventListener('load', () => { link.media = 'all'; }, { once: true });
}
