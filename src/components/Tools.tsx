import { useState } from "react";
import Converter from "./Converter";
import Outliner from "./Outliner";

const TABS = [
    {
        id: "project",
        label: "xTool project",
        hint: ".xcs / .xs → DXF · FDS · SVG",
        icon: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z"
    },
    {
        id: "outline",
        label: "Outer contour",
        hint: ".svg / .xcs / .xs → cut line",
        icon: "M15 8.25H9m6 3H9m3 6-3-3h1.5a3 3 0 1 0 0-6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
    }
] as const;

/**
 * Shell around the two tools. Both panels stay mounted and are only hidden, so
 * switching over to trace an outline does not throw away a converted project.
 */
export default function Tools() {
    const [tool, setTool] = useState<(typeof TABS)[number]["id"]>("project");

    return (
        <div className="mx-auto w-full max-w-3xl">
            <div role="tablist" aria-label="Tool" className="glass mb-8 grid gap-1 rounded-2xl p-1.5 sm:grid-cols-2">
                {TABS.map(o => (
                    <button
                        key={o.id}
                        role="tab"
                        aria-selected={tool === o.id}
                        aria-controls={`tool-${o.id}`}
                        onClick={() => setTool(o.id)}
                        className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left transition
                            ${tool === o.id
                                ? "bg-linear-to-r from-cyan-500/20 to-violet-500/20 ring-1 ring-cyan-400/40"
                                : "hover:bg-white/5"}`}
                    >
                        <svg className={`size-6 shrink-0 transition ${tool === o.id ? "text-cyan-300" : "text-slate-500"}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d={o.icon} />
                        </svg>
                        <span>
                            <span className={`block text-sm font-semibold ${tool === o.id ? "text-white" : "text-slate-300"}`}>
                                {o.label}
                            </span>
                            <span className="block text-[11px] text-slate-500">{o.hint}</span>
                        </span>
                    </button>
                ))}
            </div>

            <div id="tool-project" role="tabpanel" hidden={tool !== "project"}>
                <Converter />
            </div>
            <div id="tool-outline" role="tabpanel" hidden={tool !== "outline"}>
                <Outliner />
            </div>
        </div>
    );
}
