import { useRef, useState } from "react";
import { FileSpreadsheet, Check } from "lucide-react";

interface Props {
  label: string;
  hint: string;
  file: File | null;
  onFile: (f: File) => void;
}

export function FileDrop({ label, hint, file, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      className={`panel cursor-pointer p-5 transition-all ${
        over ? "border-accent ring-2 ring-accent/40" : "hover:border-accent/60"
      } ${file ? "border-success/50" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <div className="flex items-start gap-3">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-md ${
            file ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"
          }`}
        >
          {file ? <Check className="size-5" /> : <FileSpreadsheet className="size-5" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{label}</p>
          <p className="truncate text-xs text-muted-foreground">{file ? file.name : hint}</p>
        </div>
      </div>
    </div>
  );
}
