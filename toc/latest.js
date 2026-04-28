(function () {
  const contentRoot = document.querySelector('[toc="content"]');
  const listRoot = document.querySelector('[toc="list"]');
  if (!contentRoot || !listRoot) return;

  const range = contentRoot.getAttribute("toc-range") || "h1, h2, h3, h4, h5, h6";
  const collapseEnabled = contentRoot.getAttribute("toc-collapse") === "true";
  const collapseSpeed = contentRoot.getAttribute("toc-collapse-speed") || "200ms";

  // --- Gather templates by depth ---
  const linkTemplates = [];
  let current = listRoot.querySelector('[toc="link"]'); 
  while (current) {
    linkTemplates.push(current);
    current = current.querySelector(':scope > [toc="link"]');
  }
  const maxDepth = linkTemplates.length;

  // --- Collect headings, ignoring empty ones ---
  const headings = Array.from(contentRoot.querySelectorAll(range))
    .filter((el) => el.textContent.trim().length > 0);

  const headingRank = (el) => parseInt(el.tagName[1], 10);
  const minRank = Math.min(...headings.map(headingRank));
  const relativeDepth = (el) =>
    Math.min(headingRank(el) - minRank, Math.max(maxDepth - 1, 0));

  // --- ID helpers ---
  const usedIds = new Set(
    Array.from(document.querySelectorAll("[id]"))
      .map((el) => el.id)
      .filter(Boolean)
  );

  const slugify = (str) => {
    const s = (str ?? "").toString().normalize("NFKC").trim().toLowerCase();
    try {
      return s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
    } catch (e) {
      return s
        .replace(/[^0-9a-z\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u30FC]+/g, "-")
        .replace(/^-+|-+$/g, "");
    }
  };

  const makeUniqueId = (base) => {
    let candidate = base || "section";
    if (!usedIds.has(candidate)) { usedIds.add(candidate); return candidate; }
    let i = 2;
    while (usedIds.has(`${candidate}-${i}`)) i++;
    const unique = `${candidate}-${i}`;
    usedIds.add(unique);
    return unique;
  };

  // --- Build a template clone for a given 0-based depth ---
  const buildNode = (depth, headingEl, uniqueId) => {
    const templateDepth = Math.min(depth, maxDepth - 1);
    const template = linkTemplates[templateDepth];
    const clone = template.cloneNode(true);

    clone.querySelectorAll('[toc="link"]').forEach((n) => n.remove());

    clone.classList.remove("is-active");
    clone.querySelectorAll(".is-active").forEach((n) => n.classList.remove("is-active"));

    const anchor = clone.querySelector("a");
    if (anchor) anchor.setAttribute("href", `#${uniqueId}`);

    const titleEl = clone.querySelector('[toc="title"]');
    if (titleEl) titleEl.innerHTML = headingEl.innerHTML;

    return clone;
  };

  // --- Assign IDs to headings & build entry list ---
  const entries = [];
  const stack = [];

  headings.forEach((heading) => {
    const baseId = slugify(heading.textContent);
    const uniqueId = makeUniqueId(baseId);
    heading.id = uniqueId;
    const depth = relativeDepth(heading);
    const node = buildNode(depth, heading, uniqueId);

    const ancestors = [];
    for (let i = depth - 1; i >= 0; i--) {
      if (stack[i]) {
        ancestors.push(stack[i].uniqueId);
      }
    }

    entries.push({ uniqueId, depth, node, ancestors });
    stack.length = depth;
    stack[depth] = { uniqueId, node };
  });

  // --- Nest nodes according to depth ---
  listRoot.innerHTML = "";
  const nestStack = [];

  entries.forEach(({ depth, node }) => {
    nestStack.length = depth;

    if (depth === 0) {
      listRoot.appendChild(node);
    } else {
      let parentNode = null;
      for (let i = depth - 1; i >= 0; i--) {
        if (nestStack[i]) { parentNode = nestStack[i]; break; }
      }
      (parentNode || listRoot).appendChild(node);
    }

    nestStack[depth] = node;
  });

  // --- Collapse setup ---
  const collapseMap = new Map();

  if (collapseEnabled) {
    entries.forEach(({ uniqueId, node }) => {
      const childLinks = Array.from(node.querySelectorAll(':scope > [toc="link"]'));
      if (childLinks.length === 0) return;

      const container = document.createElement("div");
      container.setAttribute("toc-children", "");
      container.style.overflow = "hidden";
      container.style.transition = `height ${collapseSpeed} ease`;
      childLinks.forEach((child) => container.appendChild(child));
      node.appendChild(container);

      const naturalHeight = container.scrollHeight;
      container.style.height = "0px";

      collapseMap.set(uniqueId, { container, naturalHeight });
    });
  }

  // --- Recalculate heights on resize ---
  function recalcHeights() {
    collapseMap.forEach((entry, uniqueId) => {
      const { container } = entry;
      container.style.height = "auto";
      entry.naturalHeight = container.scrollHeight;
      const isOpen = linkMap.get(uniqueId)?.classList.contains("is-active");
      container.style.height = isOpen ? `${entry.naturalHeight}px` : "0px";
    });
  }

  // --- Active link tracking ---
  const linkMap = new Map(entries.map(({ uniqueId, node }) => [uniqueId, node]));
  const ancestorMap = new Map(entries.map(({ uniqueId, ancestors }) => [uniqueId, ancestors]));

  const getOffset = () => {
    const attr = contentRoot.getAttribute("toc-offset");
    if (attr) {
      const num = parseFloat(attr);
      if (attr.endsWith("rem")) {
        return num * parseFloat(getComputedStyle(document.documentElement).fontSize);
      }
      return num;
    }
    return parseFloat(getComputedStyle(document.documentElement).fontSize) * 5;
  };

  let offsetPx = getOffset();
  window.addEventListener("resize", () => {
    offsetPx = getOffset();
    recalcHeights();
    updateActive();
  });

  let activeId = null;

  function updateActive() {
    const triggerLine = offsetPx;
    let current = headings[0]?.id || null;
    headings.forEach((heading) => {
      if (heading.getBoundingClientRect().top - triggerLine <= 0) {
        current = heading.id;
      }
    });
    if (!current || current === activeId) return;
    activeId = current;

    linkMap.forEach((el) => el.classList.remove("is-active"));

    const activeSet = new Set([current, ...(ancestorMap.get(current) || [])]);
    activeSet.forEach((id) => linkMap.get(id)?.classList.add("is-active"));

    if (collapseEnabled) {
      collapseMap.forEach(({ container, naturalHeight }, id) => {
        container.style.height = activeSet.has(id) ? `${naturalHeight}px` : "0px";
      });
    }
  }

  window.addEventListener("scroll", updateActive, { passive: true });
  updateActive();
})();