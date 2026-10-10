// Injected into browser via CDP - captures clicked element data
(function() {
  const RELEVANT_PROPS = [
    'display','flexDirection','alignItems','justifyContent','gap',
    'padding','margin','width','height','fontSize','fontWeight',
    'color','backgroundColor','borderRadius','border','boxShadow',
    'position','overflow','cursor','opacity','transform',
  ];

  function getDepthLimitedHtml(el, depth) {
    if (depth === 0) return `<${el.tagName.toLowerCase()} .../>`;
    const clone = el.cloneNode(false);
    for (const child of el.children) {
      clone.appendChild(clone.ownerDocument.createTextNode(
        child.children.length > 0 && depth > 1
          ? getDepthLimitedHtml(child, depth - 1)
          : child.outerHTML
      ));
    }
    // @ts-ignore
    return clone.outerHTML;
  }

  function extractStyles(el) {
    const computed = window.getComputedStyle(el);
    const styles = {};
    for (const prop of RELEVANT_PROPS) {
      styles[prop] = computed.getPropertyValue(prop);
    }
    return styles;
  }

  function capture(el) {
    return {
      tag: el.tagName.toLowerCase(),
      classes: [...el.classList],
      textContent: el.textContent?.trim().slice(0, 200) ?? '',
      html: getDepthLimitedHtml(el, 5),
      computedStyles: extractStyles(el),
      children: [...el.children].slice(0, 10).map(c => ({
        tag: c.tagName.toLowerCase(),
        classes: [...c.classList],
        computedStyles: extractStyles(c),
      })),
    };
  }

  // Overlay to show which element will be captured
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;pointer-events:none;background:rgba(99,102,241,0.2);border:2px solid #6366f1;z-index:999999;transition:all 0.1s;';
  document.body.appendChild(overlay);

  function highlightEl(el) {
    const rect = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      top: rect.top + 'px', left: rect.left + 'px',
      width: rect.width + 'px', height: rect.height + 'px',
    });
  }

  document.addEventListener('mouseover', e => highlightEl(e.target), { capture: true });

  document.addEventListener('click', function handler(e) {
    e.preventDefault();
    e.stopPropagation();
    document.removeEventListener('click', handler, true);
    overlay.remove();
    const data = capture(e.target);
    window.__AI_CODER_CLONE_DATA__ = data;
  }, { capture: true, once: true });
})();
