import { useCallback, useEffect, useRef } from "react";

interface ViewBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Pan & zoom for an inline SVG preview, shared by the converter and the outline
 * tracer. The container is handed back as a ref; drop the SVG markup into it with
 * dangerouslySetInnerHTML and pass the same markup as `content`.
 *
 * `fitKey` is what decides when the view is refitted — a new file or canvas.
 * Everything else that re-renders the markup (a slider moving, an item being
 * picked) keeps the current view instead, or the drawing would jump back to its
 * fitted position under the user's cursor.
 */
export function usePanZoom(content: string | undefined, fitKey: string = content ?? "") {
    const ref = useRef<HTMLDivElement>(null);
    const vbRef = useRef<ViewBox | null>(null);   // current viewBox
    const fitRef = useRef<ViewBox | null>(null);  // fit-to-content viewBox

    const getSvg = (): SVGSVGElement | null => ref.current?.querySelector("svg") ?? null;

    const applyVB = (svg: SVGSVGElement, vb: ViewBox): void => {
        svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    };

    // Zoom by `factor` around the given client point (container centre if omitted).
    const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => {
        const el = ref.current, svg = getSvg(), vb = vbRef.current, fit = fitRef.current;
        if (!el || !svg || !vb || !fit) return;
        const rect = el.getBoundingClientRect(),
            px = cx === undefined ? 0.5 : (cx - rect.left) / rect.width,
            py = cy === undefined ? 0.5 : (cy - rect.top) / rect.height,
            // clamp: max 60x in, 4x out relative to the fitted view
            w = Math.min(Math.max(vb.w / factor, fit.w / 60), fit.w * 4),
            f = vb.w / w,
            h = vb.h / f;
        vbRef.current = { x: vb.x + (vb.w - w) * px, y: vb.y + (vb.h - h) * py, w, h };
        applyVB(svg, vbRef.current);
    }, []);

    const resetView = useCallback(() => {
        const svg = getSvg();
        if (!svg || !fitRef.current) return;
        vbRef.current = { ...fitRef.current };
        applyVB(svg, vbRef.current);
    }, []);

    // The size and view live on the SVG element, which React owns and rewrites
    // from its markup whenever it feels like it — restoring the pristine
    // attributes. So they are (re)applied from here every time that happens,
    // rather than only when the markup changes. The fit itself — which an .xcs
    // work area needs, being a fixed 430 mm canvas that would render small
    // designs tiny — is recomputed only for a drawing not navigated yet.
    const keyRef = useRef<string | null>(null);
    const wantKeyRef = useRef(fitKey);
    wantKeyRef.current = fitKey;

    const apply = useCallback(() => {
        const el = ref.current, svg = getSvg();
        // A hidden container has no size to fit into; the resize observer below
        // calls back once it is on screen again.
        if (!el || !svg || !el.clientWidth || !el.clientHeight) return;

        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

        if (keyRef.current !== wantKeyRef.current || !vbRef.current) {
            try {
                const bb = svg.getBBox(), pad = 5;
                let x = bb.x - pad, y = bb.y - pad,
                    w = bb.width + pad * 2, h = bb.height + pad * 2;
                // Expand the box to the container's aspect ratio so pointer
                // positions map 1:1 onto viewBox coordinates (no letterboxing
                // offsets).
                const aspect = el.clientWidth / el.clientHeight;
                if (w / h < aspect) { const nw = h * aspect; x -= (nw - w) / 2; w = nw; }
                else { const nh = w / aspect; y -= (nh - h) / 2; h = nh; }
                fitRef.current = { x, y, w, h };
                vbRef.current = { x, y, w, h };
                keyRef.current = wantKeyRef.current;
            } catch {
                return; /* empty drawing — nothing to navigate */
            }
        }
        applyVB(svg, vbRef.current);
    }, []);

    useEffect(() => {
        apply();
    }, [content, fitKey, apply]);

    // Pan & zoom live on the container, not on the SVG — but the container only
    // exists once there is something to preview, so this re-runs with the content
    // rather than only on mount.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        // Markup replaced (React) or the container resized / became visible again.
        const mo = new MutationObserver(() => apply());
        mo.observe(el, { childList: true });
        const ro = new ResizeObserver(() => apply());
        ro.observe(el);

        // Wheel zoom towards the cursor (non-passive to keep the page from scrolling).
        const onWheel = (e: WheelEvent): void => {
            e.preventDefault();
            zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
        };
        el.addEventListener("wheel", onWheel, { passive: false });

        // Pointer drag pans the view.
        let dragging = false, lastX = 0, lastY = 0;
        const onDown = (e: PointerEvent): void => {
            dragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            el.setPointerCapture(e.pointerId);
            el.style.cursor = "grabbing";
        };
        const onMove = (e: PointerEvent): void => {
            const vb = vbRef.current, s = getSvg();
            if (!dragging || !vb || !s) return;
            const rect = el.getBoundingClientRect();
            vbRef.current = {
                ...vb,
                x: vb.x - (e.clientX - lastX) * (vb.w / rect.width),
                y: vb.y - (e.clientY - lastY) * (vb.h / rect.height)
            };
            lastX = e.clientX;
            lastY = e.clientY;
            applyVB(s, vbRef.current);
        };
        const onUp = (e: PointerEvent): void => {
            dragging = false;
            el.style.cursor = "";
            if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        };
        const onDblClick = (): void => resetView();
        el.addEventListener("pointerdown", onDown);
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerup", onUp);
        el.addEventListener("pointercancel", onUp);
        el.addEventListener("dblclick", onDblClick);

        return () => {
            mo.disconnect();
            ro.disconnect();
            el.removeEventListener("wheel", onWheel);
            el.removeEventListener("pointerdown", onDown);
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerup", onUp);
            el.removeEventListener("pointercancel", onUp);
            el.removeEventListener("dblclick", onDblClick);
        };
    }, [content, apply, zoomBy, resetView]);

    return { ref, zoomBy, resetView };
}

/** The +/−/fit cluster that sits in the corner of a preview. */
export function ZoomControls({ zoomBy, resetView }: {
    zoomBy: (factor: number) => void;
    resetView: () => void;
}) {
    return (
        <div className="absolute top-3 right-3 flex flex-col overflow-hidden rounded-lg bg-slate-900/80 ring-1 ring-white/15 backdrop-blur">
            <button aria-label="Zoom in" onClick={() => zoomBy(1.4)}
                className="px-3 py-2 text-slate-200 transition hover:bg-white/10 hover:text-white">+</button>
            <button aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}
                className="border-y border-white/10 px-3 py-2 text-slate-200 transition hover:bg-white/10 hover:text-white">−</button>
            <button aria-label="Reset view" title="Fit to design" onClick={resetView}
                className="px-3 py-2 text-slate-200 transition hover:bg-white/10 hover:text-white">⛶</button>
        </div>
    );
}

export function PanHint() {
    return (
        <p className="pointer-events-none absolute bottom-2 left-3 rounded-md bg-slate-900/70 px-2.5 py-1 text-[11px] text-slate-300 backdrop-blur">
            scroll to zoom · drag to pan · double-click to reset
        </p>
    );
}
