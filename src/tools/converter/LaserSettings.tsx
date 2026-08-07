import { LASERS, convertSetting, getLaser } from "../../lib/lasers";
import type { CanvasMeta, ProjectMeta } from "../../lib/meta";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";

// ---------------------------------------------------------------------------
// The power and speed behind each operation, and what they would be on another
// laser.
//
// This cannot travel inside a DXF, an SVG or an .fds, so it is listed for
// re-entering as cut settings after the import. It is also the one thing in the
// app that is genuinely a *table* — six columns and a row per operation — which
// is why it is the one thing that lives in a panel under the stage rather than
// in a 304 px inspector. Squeezing it into the sidebar was the alternative, and
// a table with a column per line is not a table.
// ---------------------------------------------------------------------------

export interface LaserSettingsProps {
    project: ProjectMeta;
    canvas: CanvasMeta;
    source: string;
    target: string;
    onSource: (id: string) => void;
    onTarget: (id: string) => void;
}

const withUnit = (n: number | undefined, sUnit: string): string =>
    n === undefined ? "—" : `${n}${sUnit}`;

const TH = "py-1.5 pr-4 text-left text-[10px] font-semibold tracking-wide text-subtle-foreground uppercase";
const TD = "py-1.5 pr-4 text-muted-foreground tabular-nums";

export function LaserSettings({ project, canvas, source, target, onSource, onTarget }: LaserSettingsProps) {
    const oSource = getLaser(source),
        oTarget = getLaser(target),
        bConvert = !!(oSource && oTarget),
        // A different wavelength interacts with the material in a way no amount
        // of arithmetic covers, so it is called out rather than quietly converted.
        bCrossWave = bConvert && oSource.wavelength !== oTarget.wavelength;

    if (!canvas.settings.length) {
        return (
            <p className="text-xs text-subtle-foreground">
                This canvas records no laser parameters — the project was saved without a device, or with a version
                that did not store them.
            </p>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Convert from</span>
                <div className="w-52">
                    <Select value={source || "none"} onValueChange={v => onSource(v === "none" ? "" : v)}>
                        <SelectTrigger aria-label="Laser the project was made for">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">unknown</SelectItem>
                            {LASERS.map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                {project.sourceAssumed && source && (
                    <Badge variant="warn" title={`${project.device} projects do not always store the module wattage — this is the model's stock laser`}>
                        assumed for {project.device}
                    </Badge>
                )}
                <span>to</span>
                <div className="w-52">
                    <Select value={target || "none"} onValueChange={v => onTarget(v === "none" ? "" : v)}>
                        <SelectTrigger aria-label="Laser to convert the settings for">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">— off —</SelectItem>
                            {LASERS.map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-left text-xs">
                    <thead>
                        <tr className="border-b border-line">
                            <th className={TH}>Operation</th>
                            <th className={TH}>Power</th>
                            <th className={TH}>Speed</th>
                            <th className={TH}>Passes</th>
                            <th className={TH}>Density</th>
                            <th className={TH}>Shapes</th>
                            {bConvert && <th className={`${TH} whitespace-nowrap text-accent`}>→ {oTarget.label}</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {canvas.settings.map(o => {
                            const oNew = bConvert ? convertSetting(o, oSource, oTarget) : undefined;
                            return (
                                <tr
                                    key={`${o.operation.name}|${o.power}|${o.speed}|${o.passes}|${o.density}`}
                                    className="border-b border-line last:border-0"
                                >
                                    <td className="py-1.5 pr-4">
                                        <span className="flex items-center gap-2 whitespace-nowrap text-foreground">
                                            <span className="size-2.5 shrink-0 rounded-full" style={{ background: o.operation.css }} aria-hidden="true" />
                                            {o.operation.name}
                                            {o.preset && <Badge title="Values from an xTool material preset">preset</Badge>}
                                        </span>
                                        {o.notes.length > 0 && (
                                            <span className="mt-0.5 block pl-4.5 text-[11px] text-subtle-foreground">
                                                {o.notes.join(" · ")}
                                            </span>
                                        )}
                                    </td>
                                    <td className={TD}>{withUnit(o.power, " %")}</td>
                                    <td className={`${TD} whitespace-nowrap`}>{withUnit(o.speed, " mm/s")}</td>
                                    <td className={TD}>{withUnit(o.passes, "×")}</td>
                                    <td className={TD}>{withUnit(o.density, "")}</td>
                                    <td className={`${TD} text-subtle-foreground`}>{o.shapes}</td>
                                    {bConvert && (
                                        <td className="py-1.5 whitespace-nowrap tabular-nums">
                                            {oNew ? (
                                                <span
                                                    className={oNew.flatOut ? "text-warn" : "text-accent"}
                                                    title={oNew.flatOut ? `A ${oTarget.label} cannot reach the source's power — full power at a lower speed instead` : undefined}
                                                >
                                                    {oNew.power} % · {oNew.speed} mm/s{oNew.passes > 1 ? ` · ${oNew.passes}×` : ""}
                                                </span>
                                            ) : (
                                                <span className="text-subtle-foreground">—</span>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {target && !source && (
                <p className="text-[11px] text-warn">
                    This project does not say which laser module the percentages refer to — pick the source laser
                    above to convert them.
                </p>
            )}

            {bConvert && (
                <p className="max-w-4xl text-[11px] leading-relaxed text-subtle-foreground">
                    Converted to keep the energy per millimetre equal: speed is held where the target can supply the
                    power, otherwise it runs at 100 % and slower, adding passes below 2 mm/s (amber). Density and
                    dithering are unchanged. Arithmetic only — lens, spot size and air assist all shift the result, so
                    treat it as the centre of a test grid.
                    {bCrossWave && (
                        <span className="mt-1 block text-warn">
                            {oSource.wavelength} nm → {oTarget.wavelength} nm: a different wavelength is absorbed
                            completely differently — IR will not cut wood, CO₂ will not mark bare metal. The numbers
                            are a starting point at best.
                        </span>
                    )}
                </p>
            )}

            {canvas.precautions.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Material precautions">
                    {canvas.precautions.map(s => (
                        <li key={s}>
                            <Badge variant="warn">{s}</Badge>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
