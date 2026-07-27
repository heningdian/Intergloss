/**
 * Autogloss — wires the Gemini client to the shared glossing editor.
 * Loaded only by the Autogloss page; Intergloss never includes this file.
 */

(() => {
  "use strict";

  const el = (id) => document.getElementById(id);

  const keySetup = el("key-setup");
  const aiControls = el("ai-controls");
  const apiKeyInput = el("api-key-input");
  const saveKeyBtn = el("save-key-btn");
  const removeKeyBtn = el("remove-key-btn");
  const keySettingsToggle = el("key-settings-toggle");
  const modelSelect = el("model-select");
  const languageHint = el("language-hint");
  const autoglossBtn = el("autogloss-btn");
  const aiStatus = el("ai-status");
  const aiNote = el("ai-note");
  const sentenceInput = el("sentence-input");

  let inFlight = null; // AbortController for the active request

  // -----------------------------------------------------------------------
  // Key + model state
  // -----------------------------------------------------------------------

  function hasKey() {
    return loadStoredKey().trim() !== "";
  }

  function setStatus(message, tone = "muted") {
    aiStatus.textContent = message || "";
    aiStatus.className =
      "text-base mt-2 min-h-[1.5rem] " +
      { muted: "text-gray-800", error: "text-red-600", success: "text-green-700" }[tone];
  }

  function showNote(text) {
    if (text && text.trim()) {
      aiNote.textContent = `Gemini's note: ${text.trim()}`;
      aiNote.classList.remove("hidden");
    } else {
      aiNote.textContent = "";
      aiNote.classList.add("hidden");
    }
  }

  function renderKeyState({ forceSetupOpen = false } = {}) {
    const connected = hasKey();
    aiControls.classList.toggle("hidden", !connected);
    keySetup.classList.toggle("hidden", connected && !forceSetupOpen);
    removeKeyBtn.classList.toggle("hidden", !connected);
    keySettingsToggle.textContent = connected ? "API key settings" : "";
    keySettingsToggle.classList.toggle("hidden", !connected);
    autoglossBtn.disabled = !connected;
  }

  function populateModels() {
    const current = loadStoredModel();
    modelSelect.innerHTML = GEMINI_MODELS.map(
      (m) => `<option value="${m.id}">${m.label}</option>`
    ).join("");
    modelSelect.value = GEMINI_MODELS.some((m) => m.id === current) ? current : DEFAULT_MODEL;
  }

  saveKeyBtn.addEventListener("click", () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      setStatus("Paste a key first.", "error");
      return;
    }
    storeKey(key);
    apiKeyInput.value = "";
    renderKeyState();
    setStatus("Key saved in this browser. You're ready to auto-gloss.", "success");
  });

  apiKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveKeyBtn.click();
  });

  removeKeyBtn.addEventListener("click", () => {
    storeKey("");
    apiKeyInput.value = "";
    renderKeyState({ forceSetupOpen: true });
    setStatus("Key removed from this browser.");
  });

  keySettingsToggle.addEventListener("click", () => {
    keySetup.classList.toggle("hidden");
  });

  modelSelect.addEventListener("change", () => storeModel(modelSelect.value));

  // -----------------------------------------------------------------------
  // Running the gloss
  // -----------------------------------------------------------------------

  function setBusy(busy) {
    autoglossBtn.disabled = busy || !hasKey();
    autoglossBtn.textContent = busy ? "Glossing…" : "✨ Auto-gloss this sentence";
  }

  autoglossBtn.addEventListener("click", async () => {
    const sentence = sentenceInput.value.trim();
    if (!sentence) {
      setStatus("Type a sentence first.", "error");
      sentenceInput.focus();
      return;
    }

    const existing = window.GlossApp.getState();
    const hasWork = existing.words.some((w) =>
      w.morphemes.some((m) => (m.gloss || "").trim() !== "")
    );
    if (hasWork && !confirm("This will replace the current words and glosses. Continue?")) {
      return;
    }

    if (inFlight) inFlight.abort();
    inFlight = new AbortController();

    setBusy(true);
    showNote("");
    setStatus("Asking Gemini…");

    try {
      const draft = await requestGloss({
        apiKey: loadStoredKey(),
        model: modelSelect.value,
        sentence,
        languageHint: languageHint.value,
        signal: inFlight.signal,
      });

      window.GlossApp.loadState(draftToSnapshot(draft, sentenceInput.value));

      const lang = draft.detectedLanguage && draft.detectedLanguage.trim();
      setStatus(
        lang ? `Draft ready (${lang}). Check it carefully.` : "Draft ready. Check it carefully.",
        "success"
      );
      showNote(draft.note);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      setStatus(err.message || "Something went wrong.", "error");
    } finally {
      inFlight = null;
      setBusy(false);
    }
  });

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------

  populateModels();
  renderKeyState();
  if (!hasKey()) keySetup.classList.remove("hidden");
})();
