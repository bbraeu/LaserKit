import { useCallback, useRef, useState } from "react";

/** The file drop zone every tool opens with — same target, different wording. */
export interface DropZoneProps {
    /** accept attribute of the hidden file input */
    accept: string;
    /** heroicons-style outline path for the badge */
    icon: string;
    /** headline and sub-line, and what they say while the file is being worked on */
    label: string;
    sub: string;
    busy?: boolean;
    busyLabel?: string;
    busySub?: string;
    onFile: (file: File) => void;
}

export function DropZone({ accept, icon, label, sub, busy, busyLabel, busySub, onFile }: DropZoneProps) {
    const [dragOver, setDragOver] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
    }, [onFile]);

    const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) onFile(file);
        e.target.value = ""; // allow re-selecting the same file
    }, [onFile]);

    return (
        <div
            role="button"
            tabIndex={0}
            aria-label={`Select or drop a file (${accept})`}
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-300 outline-none
                ${dragOver
                    ? "border-cyan-300 bg-cyan-400/10 scale-[1.02] shadow-[0_0_60px_-12px_rgba(34,211,238,0.6)]"
                    : "border-white/15 bg-white/[0.03] hover:border-cyan-400/60 hover:bg-white/[0.05] focus-visible:border-cyan-400/60"}`}
        >
            <div className="laser-beam" aria-hidden="true" />
            <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onPick} />

            <div className="pointer-events-none relative z-10 flex flex-col items-center gap-3">
                <div className="grid size-16 place-items-center rounded-2xl bg-linear-to-br from-cyan-400/20 to-violet-500/20 ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-110">
                    <svg className="size-8 text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
                        <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                    </svg>
                </div>
                <p className="text-lg font-semibold text-white">{busy ? busyLabel ?? label : label}</p>
                <p className="text-sm text-slate-400">{busy ? busySub ?? sub : sub}</p>
            </div>
        </div>
    );
}
