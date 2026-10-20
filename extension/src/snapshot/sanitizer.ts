/** Works on a detached DOM copy only; it never receives or changes the live page. */
export function sanitizeFragment(html: string) {
  const documentCopy = new DOMParser().parseFromString(html, 'text/html');
  documentCopy.querySelectorAll('script, iframe, form, input, button, textarea, select, video, audio, svg, img, link, style, object, embed, meta').forEach(node => node.remove());
  documentCopy.querySelectorAll('*').forEach(element => {
    [...element.attributes].forEach(attribute => {
      const name = attribute.name.toLowerCase(); const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || ['src', 'srcset', 'action', 'formaction'].includes(name) || (name === 'href' && !/^(https?:|mailto:|#|\/)/.test(value))) element.removeAttribute(attribute.name);
    });
  });
  return documentCopy.body.innerHTML.slice(0, 1_000_000);
}
