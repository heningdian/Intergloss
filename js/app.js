(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  let uidCounter = 1;
  const uid = () => `id${uidCounter++}`;

  const state = {
    sentence: "",
    words: [], // { id, segText, morphemes: [{text, delim, gloss}] }
    translation: "",
  };

  let lastFocusedGlossInput = null; // remembers where quick-insert should write to

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------

  const el = (id) => document.getElementById(id);
  const sentenceInput = el("sentence-input");
  const splitWordsBtn = el("split-words-btn");
  const addWordBtn = el("add-word-btn");
  const wordCards = el("word-cards");
  const wordCardsEmpty = el("word-cards-empty");
  const translationInput = el("translation-input");
  const previewGlossLine = el("preview-gloss-line");
  const previewTranslation = el("preview-translation");
  const previewEmpty = el("preview-empty");
  const exportStatus = el("export-status");

  // ---------------------------------------------------------------------
  // Morpheme parsing
  // ---------------------------------------------------------------------

  function parseSegText(segText, prevMorphemes) {
    const parts = segText.split(/([=-])/);
    const morphemes = [];
    let pendingDelim = null;
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        pendingDelim = parts[i];
        continue;
      }
      const text = parts[i];
      if (text === "") continue;
      const idx = morphemes.length;
      const prevGloss = prevMorphemes && prevMorphemes[idx] ? prevMorphemes[idx].gloss : "";
      morphemes.push({
        text,
        delim: idx === 0 ? null : pendingDelim,
        gloss: prevGloss,
      });
    }
    if (morphemes.length === 0) {
      morphemes.push({ text: "", delim: null, gloss: "" });
    }
    return morphemes;
  }

  function makeWord(text) {
    return {
      id: uid(),
      segText: text,
      morphemes: parseSegText(text, null),
    };
  }

  // ---------------------------------------------------------------------
  // Rendering: word editor cards
  // ---------------------------------------------------------------------

  function renderWordCards() {
    wordCards.innerHTML = "";
    wordCardsEmpty.classList.toggle("hidden", state.words.length > 0);

    state.words.forEach((word, wi) => {
      const card = document.createElement("div");
      card.className = "border border-gray-200 rounded-md p-3";
      card.dataset.wordId = word.id;

      const header = document.createElement("div");
      header.className = "flex items-center justify-between mb-1.5";
      header.innerHTML = `<span class="text-base font-medium text-gray-800">Word ${wi + 1}</span>`;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "text-base text-gray-800 hover:text-red-600";
      removeBtn.textContent = "Remove";
      removeBtn.setAttribute("aria-label", `Remove word ${wi + 1}`);
      removeBtn.addEventListener("click", () => {
        state.words = state.words.filter((w) => w.id !== word.id);
        renderAll();
        saveDraftDebounced();
      });
      header.appendChild(removeBtn);
      card.appendChild(header);

      const segInput = document.createElement("input");
      segInput.type = "text";
      segInput.value = word.segText;
      segInput.className =
        "w-full rounded-md border border-gray-300 px-2 py-1.5 text-base font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
      segInput.setAttribute("aria-label", `Morpheme segmentation for word ${wi + 1}`);
      segInput.addEventListener("input", (e) => {
        word.segText = e.target.value;
        word.morphemes = parseSegText(word.segText, word.morphemes);
        renderGlossRow(glossRow, word, wi);
        renderPreview();
        saveDraftDebounced();
      });
      card.appendChild(segInput);

      const glossRow = document.createElement("div");
      glossRow.className = "flex flex-wrap gap-2 mt-2";
      card.appendChild(glossRow);
      renderGlossRow(glossRow, word, wi);

      wordCards.appendChild(card);
    });
  }

  function renderGlossRow(container, word, wi) {
    container.innerHTML = "";
    word.morphemes.forEach((m, mi) => {
      const col = document.createElement("div");
      col.className = "flex flex-col items-center";

      const label = document.createElement("span");
      label.className = "text-base text-gray-800 mb-0.5 max-w-[8rem] truncate";
      label.textContent = m.text || "—";
      label.title = m.text;
      col.appendChild(label);

      const glossInput = document.createElement("input");
      glossInput.type = "text";
      glossInput.value = m.gloss;
      glossInput.placeholder = "GLOSS";
      glossInput.setAttribute("list", "leipzig-datalist");
      glossInput.setAttribute("aria-label", `Gloss for morpheme "${m.text}" in word ${wi + 1}`);
      glossInput.className =
        "w-32 rounded-md border border-gray-300 px-2 py-1 text-base text-center uppercase focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
      glossInput.addEventListener("focus", () => {
        lastFocusedGlossInput = glossInput;
      });
      glossInput.addEventListener("input", (e) => {
        m.gloss = e.target.value;
        renderPreview();
        saveDraftDebounced();
      });
      col.appendChild(glossInput);

      container.appendChild(col);
    });
  }

  // ---------------------------------------------------------------------
  // Rendering: live preview
  // ---------------------------------------------------------------------

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function tokenizeGloss(gloss) {
    if (!gloss) return [];
    return gloss.split(".").map((tok) => ({
      text: tok,
      isAbbr: tok.length > 0 && tok === tok.toUpperCase() && /[A-Z]/.test(tok),
    }));
  }

  function glossDisplayHtml(gloss) {
    const tokens = tokenizeGloss(gloss);
    if (tokens.length === 0) return " ";
    return tokens
      .map((tok, i) => {
        const sep = i > 0 ? "." : "";
        if (!tok.text) return "";
        if (tok.isAbbr) {
          return `${sep}<span style="font-variant:small-caps;">${escapeHtml(tok.text.toLowerCase())}</span>`;
        }
        return `${sep}${escapeHtml(tok.text)}`;
      })
      .join("");
  }

  function hasAnyContent() {
    return (
      state.words.some((w) => w.morphemes.some((m) => m.text || m.gloss)) ||
      state.translation.trim().length > 0
    );
  }

  function renderPreview() {
    previewEmpty.classList.toggle("hidden", hasAnyContent());
    previewGlossLine.innerHTML = "";

    state.words.forEach((word) => {
      const wordEl = document.createElement("div");
      wordEl.className = "gloss-word";

      word.morphemes.forEach((m, mi) => {
        if (mi > 0) {
          const hy = document.createElement("div");
          hy.className = "gloss-morpheme";
          const delim = m.delim || "-";
          hy.innerHTML = `<div class="gloss-text-row">${escapeHtml(delim)}</div><div class="gloss-abbr-row">${escapeHtml(delim)}</div>`;
          wordEl.appendChild(hy);
        }
        const mEl = document.createElement("div");
        mEl.className = "gloss-morpheme";
        mEl.innerHTML =
          `<div class="gloss-text-row">${escapeHtml(m.text) || " "}</div>` +
          `<div class="gloss-abbr-row">${glossDisplayHtml(m.gloss)}</div>`;
        wordEl.appendChild(mEl);
      });

      previewGlossLine.appendChild(wordEl);
    });

    previewTranslation.textContent = state.translation.trim()
      ? `‘${state.translation.trim()}’`
      : "";
  }

  function renderAll() {
    renderWordCards();
    renderPreview();
  }

  // ---------------------------------------------------------------------
  // Step 1: split sentence into words
  // ---------------------------------------------------------------------

  splitWordsBtn.addEventListener("click", () => {
    const text = sentenceInput.value.trim();
    if (!text) return;
    if (
      state.words.length > 0 &&
      !confirm("This will replace the current word list and its glosses. Continue?")
    ) {
      return;
    }
    state.sentence = sentenceInput.value;
    state.words = text.split(/\s+/).map((w) => makeWord(w));
    renderAll();
    saveDraftDebounced();
  });

  sentenceInput.addEventListener("input", () => {
    state.sentence = sentenceInput.value;
    saveDraftDebounced();
  });

  addWordBtn.addEventListener("click", () => {
    state.words.push(makeWord(""));
    renderAll();
    saveDraftDebounced();
  });

  translationInput.addEventListener("input", () => {
    state.translation = translationInput.value;
    renderPreview();
    saveDraftDebounced();
  });

  // ---------------------------------------------------------------------
  // Leipzig abbreviation quick-select panel
  // ---------------------------------------------------------------------

  const abbrPanel = el("abbr-panel");
  const abbrGrid = el("abbr-grid");
  const abbrFilter = el("abbr-filter");
  const leipzigDatalist = el("leipzig-datalist");

  function populateLeipzigData() {
    leipzigDatalist.innerHTML = LEIPZIG_ABBREVIATIONS.map(
      (a) => `<option value="${escapeHtml(a.abbr)}">${escapeHtml(a.desc)}</option>`
    ).join("");
    renderAbbrGrid("");
  }

  function renderAbbrGrid(filter) {
    const f = filter.trim().toLowerCase();
    const items = LEIPZIG_ABBREVIATIONS.filter(
      (a) => !f || a.abbr.toLowerCase().includes(f) || a.desc.toLowerCase().includes(f)
    );
    abbrGrid.innerHTML = items
      .map(
        (a) =>
          `<button type="button" data-abbr="${escapeHtml(a.abbr)}" title="${escapeHtml(a.desc)}"
            class="abbr-chip text-base px-2 py-1 rounded border border-gray-300 hover:bg-blue-50 hover:border-blue-400">${escapeHtml(a.abbr)}</button>`
      )
      .join("");
  }

  abbrGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".abbr-chip");
    if (!btn) return;
    const abbr = btn.dataset.abbr;
    if (!lastFocusedGlossInput || !document.body.contains(lastFocusedGlossInput)) {
      exportStatus.textContent = "Click into a gloss box first, then pick an abbreviation.";
      return;
    }
    const current = lastFocusedGlossInput.value;
    lastFocusedGlossInput.value = current ? `${current}.${abbr}` : abbr;
    lastFocusedGlossInput.dispatchEvent(new Event("input", { bubbles: true }));
    lastFocusedGlossInput.focus();
  });

  abbrFilter.addEventListener("input", () => renderAbbrGrid(abbrFilter.value));

  el("toggle-abbr-panel").addEventListener("click", () => {
    abbrPanel.classList.toggle("hidden");
  });

  // ---------------------------------------------------------------------
  // LocalStorage: draft autosave, templates, recent
  // ---------------------------------------------------------------------

  // Twin apps (Intergloss / Autogloss) share this core but keep separate
  // saved work, so the storage namespace is set by the page before load.
  const NS = window.GLOSS_NAMESPACE || "intergloss";
  const DRAFT_KEY = `${NS}:draft`;
  const TEMPLATES_KEY = `${NS}:templates`;
  const RECENT_KEY = `${NS}:recent`;
  const RECENT_LIMIT = 10;

  function serializeState() {
    return {
      sentence: state.sentence,
      translation: state.translation,
      words: state.words.map((w) => ({
        segText: w.segText,
        morphemes: w.morphemes.map((m) => ({ text: m.text, delim: m.delim, gloss: m.gloss })),
      })),
    };
  }

  function loadStateFrom(snapshot) {
    state.sentence = snapshot.sentence || "";
    state.translation = snapshot.translation || "";
    state.words = (snapshot.words || []).map((w) => ({
      id: uid(),
      segText: w.segText,
      morphemes: (w.morphemes || []).map((m) => ({ text: m.text, delim: m.delim, gloss: m.gloss })),
    }));
    sentenceInput.value = state.sentence;
    translationInput.value = state.translation;
    renderAll();
  }

  let draftTimer = null;
  function saveDraftDebounced() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(serializeState()));
      } catch (err) {
        /* storage full or unavailable — silently skip autosave */
      }
      maybeSaveRecent();
    }, 800);
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      loadStateFrom(JSON.parse(raw));
    } catch (err) {
      /* corrupt draft — ignore */
    }
  }

  function readList(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      return [];
    }
  }

  function writeList(key, list) {
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch (err) {
      /* storage full — ignore */
    }
  }

  let lastRecentSignature = "";
  function maybeSaveRecent() {
    if (!hasAnyContent()) return;
    const snapshot = serializeState();
    const signature = JSON.stringify(snapshot);
    if (signature === lastRecentSignature) return;
    lastRecentSignature = signature;
    const list = readList(RECENT_KEY);
    list.unshift({ id: uid(), savedAt: Date.now(), data: snapshot });
    writeList(RECENT_KEY, list.slice(0, RECENT_LIMIT));
    renderLibrary();
  }

  function saveAsTemplate(name) {
    const list = readList(TEMPLATES_KEY);
    list.unshift({ id: uid(), name, savedAt: Date.now(), data: serializeState() });
    writeList(TEMPLATES_KEY, list);
    renderLibrary();
  }

  function deleteEntry(key, id) {
    writeList(key, readList(key).filter((e) => e.id !== id));
    renderLibrary();
  }

  function formatTimestamp(ts) {
    return new Date(ts).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function summarize(data) {
    const text = data.words.map((w) => w.segText).join(" ") || "(empty)";
    return text.length > 60 ? text.slice(0, 60) + "…" : text;
  }

  function renderLibrary() {
    const templates = readList(TEMPLATES_KEY);
    const recent = readList(RECENT_KEY);

    el("templates-list").innerHTML =
      templates
        .map(
          (t) => `
        <li class="border border-gray-200 rounded-md p-2" data-id="${t.id}">
          <div class="flex items-center justify-between gap-2">
            <span class="text-base font-medium truncate">${escapeHtml(t.name)}</span>
            <div class="flex gap-2 shrink-0">
              <button data-action="load" data-key="templates" data-id="${t.id}" class="text-base text-blue-600 hover:underline">Load</button>
              <button data-action="delete" data-key="templates" data-id="${t.id}" class="text-base text-red-500 hover:underline">Delete</button>
            </div>
          </div>
          <div class="text-base text-gray-800 mt-0.5">${escapeHtml(summarize(t.data))}</div>
          <div class="text-base text-gray-800 mt-0.5">${formatTimestamp(t.savedAt)}</div>
        </li>`
        )
        .join("") || `<li class="text-base text-gray-800 italic">No saved templates yet.</li>`;

    el("recent-list").innerHTML =
      recent
        .map(
          (r) => `
        <li class="border border-gray-200 rounded-md p-2" data-id="${r.id}">
          <div class="flex items-center justify-between gap-2">
            <span class="text-base text-gray-800">${formatTimestamp(r.savedAt)}</span>
            <div class="flex gap-2 shrink-0">
              <button data-action="load" data-key="recent" data-id="${r.id}" class="text-base text-blue-600 hover:underline">Load</button>
              <button data-action="delete" data-key="recent" data-id="${r.id}" class="text-base text-red-500 hover:underline">Delete</button>
            </div>
          </div>
          <div class="text-base mt-0.5 truncate">${escapeHtml(summarize(r.data))}</div>
        </li>`
        )
        .join("") || `<li class="text-base text-gray-800 italic">Nothing here yet — keep glossing.</li>`;
  }

  document.getElementById("templates-list").addEventListener("click", handleLibraryClick);
  document.getElementById("recent-list").addEventListener("click", handleLibraryClick);

  function handleLibraryClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const { action, key, id } = btn.dataset;
    const storeKey = key === "templates" ? TEMPLATES_KEY : RECENT_KEY;
    if (action === "delete") {
      deleteEntry(storeKey, id);
      return;
    }
    if (action === "load") {
      const entry = readList(storeKey).find((e2) => e2.id === id);
      if (entry) {
        loadStateFrom(entry.data);
        saveDraftDebounced();
        closeLibrary();
      }
    }
  }

  el("save-template-btn").addEventListener("click", () => {
    const nameInput = el("template-name-input");
    const name = nameInput.value.trim();
    if (!name) {
      exportStatus.textContent = "Give your template a name first.";
      return;
    }
    saveAsTemplate(name);
    nameInput.value = "";
    exportStatus.textContent = `Saved template "${name}".`;
  });

  // Library panel open/close + tabs
  const libraryPanel = el("library-panel");
  const libraryOverlay = el("library-overlay");
  function openLibrary() {
    renderLibrary();
    libraryPanel.classList.remove("translate-x-full");
    libraryOverlay.classList.remove("hidden");
  }
  function closeLibrary() {
    libraryPanel.classList.add("translate-x-full");
    libraryOverlay.classList.add("hidden");
  }
  el("toggle-library").addEventListener("click", openLibrary);
  el("close-library-btn").addEventListener("click", closeLibrary);
  libraryOverlay.addEventListener("click", closeLibrary);

  function setTab(active) {
    const isTemplates = active === "templates";
    el("tab-templates").classList.toggle("border-blue-600", isTemplates);
    el("tab-templates").classList.toggle("text-blue-700", isTemplates);
    el("tab-templates").classList.toggle("border-transparent", !isTemplates);
    el("tab-templates").classList.toggle("text-gray-800", !isTemplates);
    el("tab-recent").classList.toggle("border-blue-600", !isTemplates);
    el("tab-recent").classList.toggle("text-blue-700", !isTemplates);
    el("tab-recent").classList.toggle("border-transparent", isTemplates);
    el("tab-recent").classList.toggle("text-gray-800", isTemplates);
    el("templates-list").classList.toggle("hidden", !isTemplates);
    el("recent-list").classList.toggle("hidden", isTemplates);
  }
  el("tab-templates").addEventListener("click", () => setTab("templates"));
  el("tab-recent").addEventListener("click", () => setTab("recent"));

  // ---------------------------------------------------------------------
  // Export: HTML snippet
  // ---------------------------------------------------------------------

  function buildStandaloneHtml() {
    const wordsHtml = state.words
      .map((word) => {
        const morphHtml = word.morphemes
          .map((m, mi) => {
            const hyphen =
              mi > 0
                ? `<div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 1px;"><div style="font-style:italic;">${escapeHtml(m.delim || "-")}</div><div>${escapeHtml(m.delim || "-")}</div></div>`
                : "";
            return (
              hyphen +
              `<div style="display:flex;flex-direction:column;align-items:center;text-align:center;">` +
              `<div style="font-style:italic;">${escapeHtml(m.text) || "&nbsp;"}</div>` +
              `<div style="font-variant:small-caps;">${glossDisplayHtml(m.gloss)}</div>` +
              `</div>`
            );
          })
          .join("");
        return `<div style="display:flex;align-items:flex-end;">${morphHtml}</div>`;
      })
      .join("");

    const translation = state.translation.trim()
      ? `<div style="margin-top:0.75rem;">‘${escapeHtml(state.translation.trim())}’</div>`
      : "";

    return (
      `<div style="font-family:Georgia,'Iowan Old Style','Palatino Linotype',serif;font-size:1.05rem;line-height:1.4;">` +
      `<div style="display:flex;flex-wrap:wrap;column-gap:1.35rem;row-gap:0.65rem;align-items:flex-end;">${wordsHtml}</div>` +
      translation +
      `</div>`
    );
  }

  // ---------------------------------------------------------------------
  // Export: LaTeX (gb4e-style)
  // ---------------------------------------------------------------------

  function escapeLatex(str) {
    return String(str)
      .replace(/\\/g, "\\textbackslash{}")
      .replace(/([%$#&_{}])/g, "\\$1")
      .replace(/~/g, "\\textasciitilde{}")
      .replace(/\^/g, "\\textasciicircum{}");
  }

  function latexGlossToken(gloss) {
    const tokens = tokenizeGloss(gloss);
    if (tokens.length === 0) return "";
    return tokens
      .map((t) => (t.isAbbr ? `\\textsc{${escapeLatex(t.text.toLowerCase())}}` : escapeLatex(t.text)))
      .join(".");
  }

  function joinWithDelims(morphemes, mapFn) {
    return morphemes.map((m, i) => (i === 0 ? "" : m.delim || "-") + mapFn(m)).join("");
  }

  function buildLatex() {
    const wordTextLine = state.words
      .map((w) => joinWithDelims(w.morphemes, (m) => escapeLatex(m.text)))
      .join(" ");
    const wordGlossLine = state.words
      .map((w) => joinWithDelims(w.morphemes, (m) => latexGlossToken(m.gloss)))
      .join(" ");
    const translation = escapeLatex(state.translation.trim());

    return (
      `% Requires \\usepackage{gb4e} in the preamble (https://ctan.org/pkg/gb4e)\n` +
      `% Alternative packages: expex, linguex\n` +
      `\\begin{exe}\n` +
      `\\ex\n` +
      `\\gll ${wordTextLine}\\\\\n` +
      `     ${wordGlossLine}\\\\\n` +
      `\\glt \`${translation}'\n` +
      `\\end{exe}\n`
    );
  }

  // ---------------------------------------------------------------------
  // Clipboard / status helper
  // ---------------------------------------------------------------------

  async function copyToClipboard(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      exportStatus.textContent = `${label} copied to clipboard.`;
    } catch (err) {
      exportStatus.textContent = `Could not access clipboard. Copy manually from the console.`;
      console.log(text);
    }
  }

  el("export-html-btn").addEventListener("click", () => {
    copyToClipboard(buildStandaloneHtml(), "HTML snippet");
  });

  el("export-latex-btn").addEventListener("click", () => {
    copyToClipboard(buildLatex(), "LaTeX code");
  });

  el("export-print-btn").addEventListener("click", () => {
    window.print();
  });

  el("export-docx-btn").addEventListener("click", () => {
    try {
      const blob = buildDocxBlob(state);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "interlinear-gloss.docx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      exportStatus.textContent = "Downloaded interlinear-gloss.docx.";
    } catch (err) {
      console.error(err);
      exportStatus.textContent = "Could not generate the .docx file.";
    }
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  populateLeipzigData();
  loadDraft();
  renderLibrary();
  renderAll();

  // Public hook used by the Autogloss twin to drop in an AI-generated draft.
  // Intergloss itself never calls this.
  window.GlossApp = {
    parseSegText: (segText) => parseSegText(segText, null),
    loadState: (snapshot) => {
      loadStateFrom(snapshot);
      saveDraftDebounced();
    },
    getState: serializeState,
    setStatus: (message) => {
      exportStatus.textContent = message || "";
    },
  };
})();
