import { useCallback, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Pan & zoom for the stage.
//
// The drawing is inline SVG markup dropped into a container with
// dangerouslySetInnerHTML, so React owns that subtree and rewrites the element
// from its markup whenever it feels like it — restoring the pristine width and
// viewBox and throwing the view away. The size and the current view are
// therefore (re)applied from a MutationObserver rather than from an effect on
// the markup: whenever React puts the element back, this puts the view back.
//
// Nothing here goes through React state. A pan fires a pointermove per frame,
// and re-rendering the whole workspace at that rate would make dragging a
// 40 000-point contour feel like mud. The view is written straight onto the SVG
// element, and anything that wants to *display* it — the rulers, the grid, the
// zoom readout — subscribes through `onView` and updates itself imperatively.
// ---------------------------------------------------------------------------

export interface ViewBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface ViewInfo extends ViewBox {
    /** screen pixels per drawing unit (a millimetre, everywhere in this kit) */
    pxPerMm: number;
    /** zoom relative to the fitted view, where 1 is "fit to design" */
    relative: number;
    /** the container's size in screen pixels */
    clientWidth: number;
    clientHeight: number;
}

/** Zoom limits, relative to the fitted view. */
const MAX_IN = 60;
const MAX_OUT = 4;

/** Padding around the design when fitting, in drawing units. */
const FIT_PAD = 5;

export interface PanZoomOptions {
    /** the SVG markup currently in the container */
    content: string | undefined;
    /** what makes this a different drawing, deserving a refit */
    fitKey?: string;
    /** called on every view change, already throttled to one animation frame */
    onView?: (v: ViewInfo) => void;
    /** panning is suppressed while this is true — the contour tool's pick mode
     *  still wants a drag to pan, so it is the *click* it distinguishes, not this */
    disabled?: boolean;
}

export interface PanZoomApi {
    ref: React.RefObject<HTMLDivElement | null>;
    /** zoom by a factor about a client point, or about the centre */
    zoomBy: (factor: number, cx?: number, cy?: number) => void;
    /** back to the fitted view */
    resetView: () => void;
    /** a client point in drawing coordinates — for the cursor readout and hit tests */
    toDrawing: (cx: number, cy: number) => { x: number; y: number } | null;
    /** the view right now, without subscribing to it */
    read: () => ViewInfo | null;
}

export function usePanZoom({ content, fitKey, onView, disabled }: PanZoomOptions): PanZoomApi {
    const ref = useRef<HTMLDivElement>(null);
    const vbRef = useRef<ViewBox | null>(null);   // the view on screen
    const fitRef = useRef<ViewBox | null>(null);  // the fit-to-content view
    const rafRef = useRef(0);

    // Read through refs so the listeners below never need re-binding when a
    // parent re-renders with a new callback identity.
    const onViewRef = useRef(onView);
    onViewRef.current = onView;
    const disabledRef = useRef(disabled);
    disabledRef.current = disabled;

    const getSvg = (): SVGSVGElement | null => ref.current?.querySelector("svg") ?? null;

    const info = useCallback((): ViewInfo | null => {
        const el = ref.current, vb = vbRef.current, fit = fitRef.current;
        if (!el || !vb || !fit || !el.clientWidth) return null;
        return {
            ...vb,
            pxPerMm: el.clientWidth / vb.w,
            relative: fit.w / vb.w,
            clientWidth: el.clientWidth,
            clientHeight: el.clientHeight
        };
    }, []);

    /** Write the view to the element and tell the subscriber, once per frame. */
    const publish = useCallback((svg: SVGSVGElement, vb: ViewBox) => {
        svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
        if (!onViewRef.current || rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            const v = info();
            if (v) onViewRef.current?.(v);
        });
    }, [info]);

    const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => {
        const el = ref.current, svg = getSvg(), vb = vbRef.current, fit = fitRef.current;
        if (!el || !svg || !vb || !fit) return;
        const rect = el.getBoundingClientRect(),
            px = cx === undefined ? 0.5 : (cx - rect.left) / rect.width,
            py = cy === undefined ? 0.5 : (cy - rect.top) / rect.height,
            w = Math.min(Math.max(vb.w / factor, fit.w / MAX_IN), fit.w * MAX_OUT),
            f = vb.w / w,
            h = vb.h / f;
        vbRef.current = { x: vb.x + (vb.w - w) * px, y: vb.y + (vb.h - h) * py, w, h };
        publish(svg, vbRef.current);
    }, [publish]);

    const resetView = useCallback(() => {
        const svg = getSvg();
        if (!svg || !fitRef.current) return;
        vbRef.current = { ...fitRef.current };
        publish(svg, vbRef.current);
    }, [publish]);

    const toDrawing = useCallback((cx: number, cy: number) => {
        const el = ref.current, vb = vbRef.current;
        if (!el || !vb) return null;
        const rect = el.getBoundingClientRect();
        return {
            x: vb.x + ((cx - rect.left) / rect.width) * vb.w,
            y: vb.y + ((cy - rect.top) / rect.height) * vb.h
        };
    }, []);

    // The fit itself is recomputed only for a drawing not navigated yet — an .xcs
    // work area is a fixed 430 mm canvas that would render small designs tiny, and
    // nudging a slider must never move the view the user set.
    const keyRef = useRef<string | null>(null);
    const wantKeyRef = useRef(fitKey ?? content ?? "");
    wantKeyRef.current = fitKey ?? content ?? "";

    /** The container's size when the view was last written, in CSS px. */
    const sizeRef = useRef<{ w: number; h: number } | null>(null);

    /** The drawing's bounds, padded and widened to the container's shape. */
    const fitBox = (el: HTMLElement, svg: SVGSVGElement): ViewBox | null => {
        let bb: DOMRect;
        try {
            bb = svg.getBBox();
        } catch {
            return null; /* getBBox throws on a detached drawing */
        }
        let x = bb.x - FIT_PAD, y = bb.y - FIT_PAD,
            w = bb.width + FIT_PAD * 2, h = bb.height + FIT_PAD * 2;
        if (!(w > 0) || !(h > 0)) return null;
        // Expanded to the container's aspect ratio so pointer positions map 1:1
        // onto drawing coordinates, with no letterboxing offset.
        const aspect = el.clientWidth / el.clientHeight;
        if (w / h < aspect) { const nw = h * aspect; x -= (nw - w) / 2; w = nw; }
        else { const nh = w / aspect; y -= (nh - h) / 2; h = nh; }
        return { x, y, w, h };
    };

    const apply = useCallback(() => {
        const el = ref.current, svg = getSvg();
        // A hidden container has no size to fit into; the resize observer calls
        // back once it is on screen again.
        if (!el || !svg || !el.clientWidth || !el.clientHeight) return;

        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

        const size = { w: el.clientWidth, h: el.clientHeight };

        if (keyRef.current !== wantKeyRef.current || !vbRef.current) {
            const box = fitBox(el, svg);
            if (!box) return; /* empty drawing — nothing to navigate */
            fitRef.current = box;
            vbRef.current = { ...box };
            keyRef.current = wantKeyRef.current;
        } else if (sizeRef.current && (sizeRef.current.w !== size.w || sizeRef.current.h !== size.h)) {
            // The container was reshaped — a panel opened, the window resized.
            //
            // The viewBox has to be reshaped with it. Leave it at the old aspect
            // ratio and `preserveAspectRatio="meet"` letterboxes the drawing
            // inside it: the geometry is then drawn at a *smaller* scale than
            // clientWidth / viewBox.width says, so the grid, the rulers and the
            // cursor readout — all of which trust that figure — run ahead of the
            // drawing as you pan it. That is the bug this branch exists for.
            //
            // Someone who had not navigated away from the fitted view expects to
            // still be looking at the whole drawing afterwards — a panel opening
            // must not leave them at 207 %. Someone who *had* zoomed in expects
            // their scale and their centre kept, and the window to show more or
            // less of the drawing around them. Both, in that order.
            const vb = vbRef.current,
                fit = fitRef.current,
                bWasFitted = !!fit
                    && Math.abs(vb.w - fit.w) < fit.w * 1e-3
                    && Math.abs(vb.x - fit.x) < fit.w * 1e-3
                    && Math.abs(vb.y - fit.y) < fit.h * 1e-3;

            // The fitted view is what the zoom clamp and the "100 %" readout are
            // measured against, so it follows the new shape either way.
            fitRef.current = fitBox(el, svg) ?? fitRef.current;

            if (bWasFitted && fitRef.current) {
                vbRef.current = { ...fitRef.current };
            } else {
                const pxPerMm = sizeRef.current.w / vb.w,
                    w = size.w / pxPerMm,
                    h = size.h / pxPerMm;
                vbRef.current = { x: vb.x + (vb.w - w) / 2, y: vb.y + (vb.h - h) / 2, w, h };
            }
        }

        sizeRef.current = size;
        publish(svg, vbRef.current);
    }, [publish]);

    useEffect(() => {
        apply();
    }, [content, fitKey, apply]);

    // The listeners live on the container, which only exists once there is
    // something to preview — so this re-runs with the content, not only on mount.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const mo = new MutationObserver(() => apply());
        mo.observe(el, { childList: true });
        const ro = new ResizeObserver(() => apply());
        ro.observe(el);

        // Non-passive, or the page scrolls out from under the zoom.
        const onWheel = (e: WheelEvent): void => {
            e.preventDefault();
            zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
        };
        el.addEventListener("wheel", onWheel, { passive: false });

        let dragging = false, lastX = 0, lastY = 0;
        const onDown = (e: PointerEvent): void => {
            if (disabledRef.current || e.button !== 0) return;
            dragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            el.setPointerCapture(e.pointerId);
            el.dataset.panning = "true";
        };
        const onMove = (e: PointerEvent): void => {
            const vb = vbRef.current, svg = getSvg();
            if (!dragging || !vb || !svg) return;
            const rect = el.getBoundingClientRect();
            vbRef.current = {
                ...vb,
                x: vb.x - (e.clientX - lastX) * (vb.w / rect.width),
                y: vb.y - (e.clientY - lastY) * (vb.h / rect.height)
            };
            lastX = e.clientX;
            lastY = e.clientY;
            publish(svg, vbRef.current);
        };
        const onUp = (e: PointerEvent): void => {
            dragging = false;
            delete el.dataset.panning;
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
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
            el.removeEventListener("wheel", onWheel);
            el.removeEventListener("pointerdown", onDown);
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerup", onUp);
            el.removeEventListener("pointercancel", onUp);
            el.removeEventListener("dblclick", onDblClick);
        };
    }, [content, apply, zoomBy, resetView, publish]);

    return { ref, zoomBy, resetView, toDrawing, read: info };
}
