declare module "pdfjs-dist/legacy/build/pdf" {
  export const version: string;
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(src: { 
    data: Uint8Array; 
    disableWorker?: boolean 
  }): { 
    promise: Promise<unknown>  // ✅ změň "any" na "unknown"
  };
}

declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  const workerSrc: string;
  export default workerSrc;
}