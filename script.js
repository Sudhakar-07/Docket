// ---------- Setup ----------
const { PDFDocument, PageSizes } = PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// ---------- Tab switching ----------
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tool;
    tabs.forEach((t) => t.setAttribute("aria-selected", t === tab ? "true" : "false"));
    panels.forEach((p) => (p.hidden = p.dataset.panel !== target));
  });
});

// ---------- Helpers ----------

function bytesToSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setStatus(id, message, kind) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.className = "status" + (kind ? " " + kind : "");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// Wires a dropzone + file input + internal file store together.
function setupFileArea({ dropzoneId, inputId, listId, multiple, accept, onChange }) {
  const dropzone = document.getElementById(dropzoneId);
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  let files = [];

  function render() {
    list.innerHTML = "";
    files.forEach((file, i) => {
      const li = document.createElement("li");
      li.draggable = list.classList.contains("sortable");
      li.dataset.index = i;

      if (list.classList.contains("sortable")) {
        const order = document.createElement("span");
        order.className = "file-order";
        order.textContent = String(i + 1).padStart(2, "0");
        li.appendChild(order);
      }

      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = `${file.name} · ${bytesToSize(file.size)}`;
      li.appendChild(name);

      const remove = document.createElement("button");
      remove.className = "file-remove";
      remove.type = "button";
      remove.textContent = "remove";
      remove.addEventListener("click", () => {
        files.splice(i, 1);
        render();
      });
      li.appendChild(remove);

      list.appendChild(li);
    });
    onChange(files);
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList).filter((f) => {
      if (!accept) return true;
      return accept.some((type) => f.type === type || f.name.toLowerCase().endsWith(type));
    });
    if (!multiple) {
      files = incoming.slice(0, 1);
    } else {
      files = files.concat(incoming);
    }
    render();
  }

  dropzone.addEventListener("click", () => input.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") input.click();
  });
  input.addEventListener("change", (e) => addFiles(e.target.files));

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  // Drag-to-reorder within the list (merge tool)
  if (list.classList.contains("sortable")) {
    let dragIndex = null;
    list.addEventListener("dragstart", (e) => {
      const li = e.target.closest("li");
      if (!li) return;
      dragIndex = Number(li.dataset.index);
      li.classList.add("dragging");
    });
    list.addEventListener("dragend", (e) => {
      const li = e.target.closest("li");
      if (li) li.classList.remove("dragging");
    });
    list.addEventListener("dragover", (e) => {
      e.preventDefault();
      const li = e.target.closest("li");
      if (!li) return;
      const overIndex = Number(li.dataset.index);
      if (overIndex === dragIndex || dragIndex === null) return;
      const [moved] = files.splice(dragIndex, 1);
      files.splice(overIndex, 0, moved);
      dragIndex = overIndex;
      render();
      // re-mark dragging item after re-render
      const newLi = list.querySelector(`li[data-index="${overIndex}"]`);
      if (newLi) newLi.classList.add("dragging");
    });
  }

  return { getFiles: () => files };
}

// ---------- JPG → PDF ----------

const jpg2pdfArea = setupFileArea({
  dropzoneId: "dz-jpg2pdf",
  inputId: "input-jpg2pdf",
  listId: "list-jpg2pdf",
  multiple: true,
  accept: ["image/jpeg", "image/png", ".jpg", ".jpeg", ".png"],
  onChange: (files) => {
    document.getElementById("btn-jpg2pdf").disabled = files.length === 0;
  },
});

document.getElementById("btn-jpg2pdf").addEventListener("click", async () => {
  const files = jpg2pdfArea.getFiles();
  if (files.length === 0) return;
  const fit = document.querySelector('input[name="pagefit"]:checked').value;

  setStatus("status-jpg2pdf", "Building PDF…", "busy");
  try {
    const pdfDoc = await PDFDocument.create();

    for (const file of files) {
      const bytes = await readAsArrayBuffer(file);
      const isPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
      const image = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);

      if (fit === "a4") {
        const [pw, ph] = PageSizes.A4;
        const page = pdfDoc.addPage([pw, ph]);
        const scale = Math.min(pw / image.width, ph / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        page.drawImage(image, {
          x: (pw - w) / 2,
          y: (ph - h) / 2,
          width: w,
          height: h,
        });
      } else {
        const page = pdfDoc.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      }
    }

    const bytes = await pdfDoc.save();
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), "docket.pdf");
    setStatus("status-jpg2pdf", `Done — ${files.length} image(s) bundled into one PDF.`, "ok");
  } catch (err) {
    console.error(err);
    setStatus("status-jpg2pdf", "Something went wrong reading one of those images.", "error");
  }
});

// ---------- PDF → JPG ----------

const pdf2jpgArea = setupFileArea({
  dropzoneId: "dz-pdf2jpg",
  inputId: "input-pdf2jpg",
  listId: "list-pdf2jpg",
  multiple: false,
  accept: ["application/pdf", ".pdf"],
  onChange: (files) => {
    document.getElementById("btn-pdf2jpg").disabled = files.length === 0;
  },
});

document.getElementById("btn-pdf2jpg").addEventListener("click", async () => {
  const files = pdf2jpgArea.getFiles();
  if (files.length === 0) return;

  setStatus("status-pdf2jpg", "Rendering pages…", "busy");
  try {
    const bytes = await readAsArrayBuffer(files[0]);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const baseName = files[0].name.replace(/\.pdf$/i, "");

    if (pdf.numPages === 1) {
      const blob = await renderPageToJpegBlob(pdf, 1);
      downloadBlob(blob, `${baseName}-page-1.jpg`);
      setStatus("status-pdf2jpg", "Done — 1 page extracted.", "ok");
      return;
    }

    const zip = new JSZip();
    for (let i = 1; i <= pdf.numPages; i++) {
      setStatus("status-pdf2jpg", `Rendering page ${i} of ${pdf.numPages}…`, "busy");
      const blob = await renderPageToJpegBlob(pdf, i);
      zip.file(`${baseName}-page-${String(i).padStart(2, "0")}.jpg`, blob);
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, `${baseName}-pages.zip`);
    setStatus("status-pdf2jpg", `Done — ${pdf.numPages} pages zipped up.`, "ok");
  } catch (err) {
    console.error(err);
    setStatus("status-pdf2jpg", "Couldn't read that PDF. Try another file.", "error");
  }
});

async function renderPageToJpegBlob(pdf, pageNumber, scale = 2) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
}

// ---------- Merge ----------

const mergeArea = setupFileArea({
  dropzoneId: "dz-merge",
  inputId: "input-merge",
  listId: "list-merge",
  multiple: true,
  accept: ["application/pdf", ".pdf"],
  onChange: (files) => {
    document.getElementById("btn-merge").disabled = files.length < 2;
  },
});

document.getElementById("btn-merge").addEventListener("click", async () => {
  const files = mergeArea.getFiles();
  if (files.length < 2) return;

  setStatus("status-merge", "Merging…", "busy");
  try {
    const merged = await PDFDocument.create();
    for (const file of files) {
      const bytes = await readAsArrayBuffer(file);
      const src = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
    const bytes = await merged.save();
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), "docket-merged.pdf");
    setStatus("status-merge", `Done — ${files.length} PDFs merged into one.`, "ok");
  } catch (err) {
    console.error(err);
    setStatus("status-merge", "Couldn't merge those files. Check they're valid PDFs.", "error");
  }
});

// ---------- Split ----------

const splitArea = setupFileArea({
  dropzoneId: "dz-split",
  inputId: "input-split",
  listId: "list-split",
  multiple: false,
  accept: ["application/pdf", ".pdf"],
  onChange: (files) => {
    document.getElementById("btn-split").disabled = files.length === 0;
  },
});

document.querySelectorAll('input[name="splitmode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    document.getElementById("range-input").hidden =
      document.querySelector('input[name="splitmode"]:checked').value !== "range";
  });
});

function parseRanges(text, pageCount) {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const indices = new Set();
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let [, start, end] = m.map(Number);
      if (start > end) [start, end] = [end, start];
      for (let n = start; n <= end; n++) {
        if (n >= 1 && n <= pageCount) indices.add(n - 1);
      }
    } else if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n >= 1 && n <= pageCount) indices.add(n - 1);
    }
  }
  return Array.from(indices).sort((a, b) => a - b);
}

document.getElementById("btn-split").addEventListener("click", async () => {
  const files = splitArea.getFiles();
  if (files.length === 0) return;
  const mode = document.querySelector('input[name="splitmode"]:checked').value;
  const baseName = files[0].name.replace(/\.pdf$/i, "");

  setStatus("status-split", "Splitting…", "busy");
  try {
    const bytes = await readAsArrayBuffer(files[0]);
    const src = await PDFDocument.load(bytes);
    const pageCount = src.getPageCount();

    if (mode === "range") {
      const rangeText = document.getElementById("range-field").value.trim();
      const indices = parseRanges(rangeText, pageCount);
      if (indices.length === 0) {
        setStatus("status-split", "Enter a valid page range, e.g. 1-3, 5.", "error");
        return;
      }
      const out = await PDFDocument.create();
      const pages = await out.copyPages(src, indices);
      pages.forEach((p) => out.addPage(p));
      const outBytes = await out.save();
      downloadBlob(new Blob([outBytes], { type: "application/pdf" }), `${baseName}-selection.pdf`);
      setStatus("status-split", `Done — ${indices.length} page(s) extracted.`, "ok");
      return;
    }

    const zip = new JSZip();
    for (let i = 0; i < pageCount; i++) {
      const out = await PDFDocument.create();
      const [page] = await out.copyPages(src, [i]);
      out.addPage(page);
      const outBytes = await out.save();
      zip.file(`${baseName}-page-${String(i + 1).padStart(2, "0")}.pdf`, outBytes);
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, `${baseName}-split.zip`);
    setStatus("status-split", `Done — ${pageCount} pages zipped up.`, "ok");
  } catch (err) {
    console.error(err);
    setStatus("status-split", "Couldn't read that PDF. Try another file.", "error");
  }
});