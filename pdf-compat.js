export const PDFJS_VERSION = '3.11.174';
export const PDFJS_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.min.js`;
export const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.js`;

let loadPromise = null;

export function loadPdfJs() {
  if (typeof window !== 'undefined' && window.pdfjsLib && typeof window.pdfjsLib.getDocument === 'function') {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    return Promise.resolve(window.pdfjsLib);
  }

  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDFJS_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib || typeof lib.getDocument !== 'function') {
        loadPromise = null;
        reject(new Error('PDF.js failed to initialize'));
        return;
      }
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      resolve(lib);
    };
    script.onerror = () => {
      loadPromise = null;
      reject(new Error('PDF.js failed to load'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
