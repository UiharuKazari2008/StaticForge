pdf.js 5.7.284 (pdfjs-dist, Mozilla, Apache-2.0): build/pdf.min.mjs, build/pdf.worker.min.mjs, cmaps/ and standard_fonts/, unmodified.
The engine of Adobe Reader 8 (apps/reader, #910), which also draws a phone PDF's first page in Explorer's preview pane.

legacy/: the same release's legacy/build/pdf.min.mjs and pdf.worker.min.mjs, unmodified. The modern build needs
Map.prototype.getOrInsertComputed, Math.sumPrecise and Uint8Array.prototype.toHex (recent engines only);
Adobe Reader loads legacy/ where a fresh worker lacks them.
