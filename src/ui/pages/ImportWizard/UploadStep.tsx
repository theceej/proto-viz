import { useRef, useState } from 'react';
import { AlertTriangle, Upload } from 'lucide-react';

/** Step 1: drag-and-drop or browse for a spec file. */
export default function UploadStep({
  onFile,
  error,
}: {
  onFile: (f: File) => void;
  error: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a protocol spec (TXT, HTML, DOCX, or PDF)"
        className={`flex h-52 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors focus-visible:border-cyan-500 focus-visible:outline-2 focus-visible:outline-cyan-400 ${
          dragging ? 'border-cyan-500 bg-cyan-500/5' : 'border-zinc-700 hover:border-zinc-500'
        }`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
      >
        <Upload className="size-6 text-zinc-500" />
        <p className="text-[13px] text-zinc-400">Drop a spec here, or click to browse</p>
        <p className="text-[11px] text-zinc-600">TXT · HTML · DOCX · PDF — parsed entirely in your browser</p>
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.text,.html,.htm,.docx,.doc,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </div>
      {error && (
        <p className="mt-3 flex items-start gap-1.5 text-[13px] text-rose-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}
      <p className="mt-4 text-[12px] text-zinc-600">
        Tip: for RFCs, the plain-text version from rfc-editor.org parses most reliably —
        packet diagrams keep their exact column alignment.
      </p>
    </div>
  );
}
