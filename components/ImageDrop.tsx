"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { IconImage, IconX } from "./Icons";

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_SIDE = 1024;

export interface PickedImage {
  file: File;
  url: string; // object URL for previews
}

/**
 * Drag-and-drop / click / paste image picker. Large stills are resized and
 * re-encoded in the browser (faster upload, smaller metadata); GIFs pass through
 * untouched so they stay animated.
 */
export function ImageDrop({
  value,
  onChange,
  disabled,
}: {
  value: PickedImage | null;
  onChange: (v: PickedImage | null) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const take = useCallback(
    async (file: File | undefined | null) => {
      if (!file || disabled) return;
      setError("");
      if (!ACCEPT.includes(file.type)) return setError("Use a PNG, JPG, GIF or WEBP image.");
      setBusy(true);
      try {
        const out = file.type === "image/gif" ? file : await shrink(file);
        if (out.size > MAX_BYTES) return setError("That image is over 4 MB. Try a smaller one.");
        if (value) URL.revokeObjectURL(value.url);
        onChange({ file: out, url: URL.createObjectURL(out) });
      } catch {
        setError("Couldn't read that image. Try another file.");
      } finally {
        setBusy(false);
      }
    },
    [disabled, onChange, value]
  );

  // Paste an image from the clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
      if (item) {
        e.preventDefault();
        take(item.getAsFile());
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [take]);

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          take(e.dataTransfer.files?.[0]);
        }}
        className={`group relative overflow-hidden rounded-2xl border-2 border-dashed transition ${
          drag
            ? "scale-[1.01] border-sol bg-sol/5 shadow-[0_0_0_4px_rgba(255,178,36,0.12)]"
            : value
              ? "border-transparent"
              : "border-line bg-ink/60 hover:border-brand/60 hover:bg-brand/5"
        }`}
      >
        {value ? (
          <div className="flex items-center gap-4 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value.url} alt="Coin image preview" className="h-24 w-24 shrink-0 rounded-xl object-cover ring-1 ring-line" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{value.file.name}</div>
              <div className="text-xs text-muted">{fmtBytes(value.file.size)}</div>
              <div className="mt-2.5 flex gap-2">
                <label htmlFor={inputId} className={`btn-secondary cursor-pointer px-3 py-1.5 text-xs ${disabled ? "pointer-events-none opacity-40" : ""}`}>
                  Replace
                </label>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    URL.revokeObjectURL(value.url);
                    onChange(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-panel2 hover:text-down disabled:opacity-40"
                >
                  <IconX className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
            </div>
          </div>
        ) : (
          <label
            htmlFor={inputId}
            className={`flex cursor-pointer flex-col items-center justify-center px-6 py-9 text-center ${disabled ? "pointer-events-none opacity-50" : ""}`}
          >
            <span
              className={`grid h-14 w-14 place-items-center rounded-2xl transition ${
                drag ? "bg-sol/15 text-sol" : "bg-panel2 text-muted group-hover:-translate-y-0.5 group-hover:text-white"
              }`}
            >
              {busy ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted/40 border-t-white" />
              ) : (
                <IconImage className="h-6 w-6" />
              )}
            </span>
            <span className="mt-3 text-sm font-semibold">{drag ? "Drop to upload" : "Drag and drop an image"}</span>
            <span className="mt-1 text-xs text-muted">
              or <span className="font-semibold text-brand">browse files</span> · you can also paste
            </span>
            <span className="mt-3 text-[11px] text-muted/80">PNG, JPG, GIF or WEBP · up to 4 MB · square looks best</span>
          </label>
        )}
        <input
          id={inputId}
          ref={input}
          type="file"
          accept={ACCEPT.join(",")}
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = ""; // allow re-picking the same file
          }}
        />
      </div>
      {error && <p className="mt-1.5 text-xs text-down">{error}</p>}
    </div>
  );
}

/** Downscale to MAX_SIDE and re-encode as WEBP when that's actually smaller. */
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 500_000) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.9));
  if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".webp", { type: "image/webp" });
}

function fmtBytes(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
