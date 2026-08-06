// skeleton-tracing-js ships no types. Only the one entry point the tracer calls is
// declared here, with the shape its README documents — and against the ESM source
// path, since the package's own `module` field points at a file it does not ship.
declare module "skeleton-tracing-js/trace_skeleton.vanilla.js" {
    interface TraceSkeletonResult {
        /** each polyline as [x, y] pairs in pixel coordinates */
        polylines: [number, number][][];
        /** the chunks the divide-and-conquer pass split on — unused here */
        rects: [number, number, number, number][];
        width: number;
        height: number;
    }

    const TraceSkeleton: {
        /**
         * Thin a binary image **in place** (Zhang–Suen) and trace the skeleton into
         * polylines. `im` is one 0/1 entry per pixel, row-major.
         */
        trace(im: number[], w: number, h: number, chunkSize: number): TraceSkeletonResult;
        thinningZS(im: number[], w: number, h: number): void;
        fromBoolArray(im: ArrayLike<unknown>, w: number, h: number): TraceSkeletonResult;
        fromImageData(im: ImageData): TraceSkeletonResult;
    };

    export default TraceSkeleton;
}
