import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_CHARACTERS = 20_000;
const EXTRACTION_TIMEOUT_MS = 20_000;
const modulePath = fileURLToPath(import.meta.url);
const types = Object.freeze({
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  md: 'text/markdown',
});

function failure(message, code = 'DOCUMENT_EXTRACTION_FAILED') {
  return Object.assign(new Error(message), { code });
}

export function documentType(name, mimeType = '') {
  const extension = path.extname(String(name || '').replaceAll('\\', '/')).slice(1).toLowerCase();
  const mime = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
  if (types[extension]) return { format: extension.toUpperCase(), mimeType: types[extension] };
  if (!extension) {
    const found = Object.entries(types).find(([, type]) => type === mime);
    if (found) return { format: found[0].toUpperCase(), mimeType: found[1] };
  }
  throw failure('This document type is not supported. Use PDF, PowerPoint, Excel, Word, OpenDocument, CSV, or text.', 'UNSUPPORTED_DOCUMENT');
}

function validateInput({ bytes, name, mimeType }) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw failure('The document is empty.', 'EMPTY_DOCUMENT');
  }
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw failure('Documents must be 10 MiB or smaller.', 'DOCUMENT_TOO_LARGE');
  }
  const type = documentType(name, mimeType);
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 8));
  const zip = ['PPTX', 'XLSX', 'DOCX', 'ODT', 'ODS', 'ODP'].includes(type.format);
  const ole = ['PPT', 'XLS', 'DOC'].includes(type.format);
  if ((type.format === 'PDF' && header.subarray(0, 5).toString() !== '%PDF-')
    || (zip && !header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
    || (ole && !header.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))) {
    throw failure('The file contents do not match its document type.', 'INVALID_DOCUMENT');
  }
  return { bytes: Buffer.from(bytes), name: path.basename(String(name || 'document').replaceAll('\\', '/')).slice(0, 255), ...type };
}

let active = 0;
const waiting = [];
async function acquire() {
  if (active < 2) { active += 1; return; }
  if (waiting.length >= 8) throw failure('Document extraction is busy. Try attaching this file again shortly.', 'EXTRACTION_BUSY');
  await new Promise(resolve => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else active -= 1;
}

/** Native parsing lives in a killable process; only bounded text reaches the server. */
export async function extractDocument(input) {
  const validated = validateInput(input);
  await acquire();
  try {
    return await new Promise((resolve, reject) => {
      const env = {};
      for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'CHAT_UI_PACKAGE_ROOT']) {
        if (process.env[key]) env[key] = process.env[key];
      }
      if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
      const child = fork(modulePath, ['--extract-document-worker'], {
        env, execArgv: ['--max-old-space-size=256'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced',
      });
      let result, error;
      const timer = setTimeout(() => {
        error = failure('Document extraction timed out. Try a smaller document or fewer pages.', 'EXTRACTION_TIMEOUT');
        child.kill('SIGKILL');
      }, EXTRACTION_TIMEOUT_MS);
      child.on('message', message => {
        if (message?.error) error = failure(String(message.error).slice(0, 500), message.code);
        else if (message?.result && typeof message.result.text === 'string'
          && message.result.text.length <= MAX_DOCUMENT_CHARACTERS
          && Array.isArray(message.result.warnings) && message.result.warnings.length <= 8) result = message.result;
        else error = failure('The document extractor returned an invalid result.');
      });
      child.once('error', cause => { error = failure('The local document extractor could not start: ' + cause.message); });
      child.once('close', code => {
        clearTimeout(timer);
        if (error) reject(error);
        else if (code !== 0 || !result) reject(failure('The local document extractor stopped before finishing. Try a smaller document.'));
        else resolve(result);
      });
      child.send(validated, cause => {
        if (cause) { error = failure('The document could not be sent to the local extractor.'); child.kill('SIGKILL'); }
      });
    });
  } finally { release(); }
}

async function runWorker(input) {
  const { bytes, name, mimeType, format } = validateInput(input);
  const packageRoot = process.env.CHAT_UI_PACKAGE_ROOT || path.dirname(modulePath);
  const require = createRequire(path.join(packageRoot, 'package.json'));
  let xberg;
  try { xberg = require('@xberg-io/xberg'); }
  catch { throw failure('Xberg is unavailable for this installation. Install the document-extraction dependency for this platform.', 'EXTRACTOR_UNAVAILABLE'); }
  const output = await xberg.extract({
    kind: xberg.ExtractInputKind.Bytes, bytes, filename: name, mimeType,
  }, {
    outputFormat: 'markdown',
    useCache: false, cacheTtlSecs: 0, enableQualityProcessing: false,
    disableOcr: true, forceOcr: false, ocrEmbeddedImages: false,
    maxArchiveDepth: 0, maxEmbeddedFileBytes: 0,
    extractionTimeoutSecs: 18, maxConcurrentExtractions: 1,
    concurrency: { maxThreads: 2 },
    securityLimits: {
      maxArchiveSize: 40 * 1024 * 1024, maxCompressionRatio: 100,
      maxFilesInArchive: 2_000, maxNestingDepth: 100,
      maxEntityLength: 1024 * 1024, maxContentSize: 4 * 1024 * 1024,
      maxIterations: 1_000_000, maxXmlDepth: 100, maxTableCells: 25_000, maxPages: 100,
    },
  });
  if (output.errors?.length) throw failure(String(output.errors[0].message || 'Xberg could not extract this document.').slice(0, 400));
  const document = output.results?.[0];
  const content = String(document?.content || '').replaceAll('\r\n', '\n').replaceAll('\0', '').trim();
  if (!content) throw failure('No readable text was found. Scanned pages and text inside images need OCR; attach the relevant images or a searchable document.', 'EMPTY_EXTRACTION');
  let text = content.slice(0, MAX_DOCUMENT_CHARACTERS);
  // Do not cut a UTF-16 surrogate pair at the truncation boundary.
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  const warnings = (document.processingWarnings || []).slice(0, 6).map(item => String(item.message || item.warning || 'Some document content could not be extracted.').slice(0, 300));
  const truncated = text.length < content.length;
  if (truncated) warnings.push('Only the first 20,000 characters will be sent. Split the document to include later sections.');
  if (['PDF', 'PPT', 'PPTX', 'DOC', 'DOCX', 'ODT', 'ODP'].includes(format)) warnings.push('Text extraction only; image content and scanned text are not included.');
  const pages = document?.counts?.pages;
  return { text, format, extractedCharacters: content.length, truncated, warnings,
    ...(Number.isInteger(pages) && pages > 0 ? { pages } : {}) };
}

if (process.argv[1] === modulePath && process.argv[2] === '--extract-document-worker' && process.send) {
  process.once('message', async input => {
    try {
      const result = await runWorker(input);
      process.send({ result }, () => process.exit(0));
    } catch (error) {
      process.send({ error: String(error.message || 'Document extraction failed.').slice(0, 500), code: error.code || 'DOCUMENT_EXTRACTION_FAILED' }, () => process.exit(1));
    }
  });
  process.once('disconnect', () => process.exit(1));
}
