/**
 * Builds a minimal, valid .docx (WordprocessingML) package in-browser,
 * with no external library dependency, using zip-writer.js.
 */

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Splits a gloss string like "3SG.PST" into tokens, flagging which are
// grammatical abbreviations (rendered small-caps) vs. lexical glosses.
function tokenizeGloss(gloss) {
  if (!gloss) return [];
  return gloss.split(".").map((tok) => ({
    text: tok,
    isAbbr: tok.length > 0 && tok === tok.toUpperCase() && /[A-Z]/.test(tok),
  }));
}

function glossRunsXml(gloss, extraRunProps) {
  const tokens = tokenizeGloss(gloss);
  if (tokens.length === 0) {
    return `<w:r>${extraRunProps || ""}<w:t xml:space="preserve"> </w:t></w:r>`;
  }
  return tokens
    .map((tok, i) => {
      const sep = i > 0 ? "." : "";
      const text = sep + (tok.isAbbr ? tok.text.toLowerCase() : tok.text);
      const rPr = `<w:rPr>${extraRunProps || ""}${tok.isAbbr ? "<w:smallCaps/>" : ""}</w:rPr>`;
      return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
    })
    .join("");
}

function cellXml(innerRunsXml, width) {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
    `<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>` +
    `<w:vAlign w:val="bottom"/></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr>${innerRunsXml}</w:p></w:tc>`
  );
}

function buildGlossTableXml(words) {
  // Flatten to morpheme columns with a narrow spacer column between words.
  const columns = [];
  words.forEach((word, wi) => {
    word.morphemes.forEach((m, mi) => {
      if (mi > 0) {
        columns.push({ type: "hyphen", delim: m.delim || "-" });
      }
      columns.push({ type: "morph", text: m.text, gloss: m.gloss });
    });
    if (wi < words.length - 1) {
      columns.push({ type: "spacer" });
    }
  });

  if (columns.length === 0) return "";

  const grid = columns
    .map((c) => `<w:gridCol w:w="${c.type === "spacer" ? 200 : c.type === "hyphen" ? 160 : 1200}"/>`)
    .join("");

  const row1Cells = columns
    .map((c) => {
      if (c.type === "spacer") return cellXml("", 200);
      if (c.type === "hyphen")
        return cellXml(`<w:r><w:t xml:space="preserve">${xmlEscape(c.delim)}</w:t></w:r>`, 160);
      return cellXml(
        `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${xmlEscape(c.text)}</w:t></w:r>`,
        1200
      );
    })
    .join("");

  const row2Cells = columns
    .map((c) => {
      if (c.type === "spacer") return cellXml("", 200);
      if (c.type === "hyphen")
        return cellXml(`<w:r><w:t xml:space="preserve">${xmlEscape(c.delim)}</w:t></w:r>`, 160);
      return cellXml(glossRunsXml(c.gloss), 1200);
    })
    .join("");

  return (
    `<w:tbl><w:tblPr><w:tblLayout w:type="autofit"/><w:tblBorders>` +
    `<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/>` +
    `<w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr>` +
    `<w:tblGrid>${grid}</w:tblGrid>` +
    `<w:tr>${row1Cells}</w:tr>` +
    `<w:tr>${row2Cells}</w:tr>` +
    `</w:tbl>`
  );
}

function buildDocumentXml(state) {
  const title =
    `<w:p><w:pPr><w:spacing w:after="200"/></w:pPr>` +
    `<w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">Interlinear Gloss</w:t></w:r></w:p>`;

  const table = buildGlossTableXml(state.words);

  const translation = state.translation
    ? `<w:p><w:pPr><w:spacing w:before="200"/></w:pPr>` +
      `<w:r><w:t xml:space="preserve">‘${xmlEscape(state.translation)}’</w:t></w:r></w:p>`
    : "";

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${title}${table}${translation}` +
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
    `</w:body></w:document>`
  );
}

const CONTENT_TYPES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const DOCUMENT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `</w:styles>`;

function buildDocxBlob(state) {
  const files = [
    { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
    { name: "_rels/.rels", content: ROOT_RELS_XML },
    { name: "word/document.xml", content: buildDocumentXml(state) },
    { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML },
    { name: "word/styles.xml", content: STYLES_XML },
  ];
  return createZip(
    files,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}
