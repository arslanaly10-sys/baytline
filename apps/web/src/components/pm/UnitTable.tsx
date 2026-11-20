import Link from "next/link";
import type { PmUnitRow } from "@baytline/management";
import type { Dictionary } from "@/i18n";
import { day } from "@/lib/dev-format";
import { SampleBadge } from "@/components/dev/parts";
import { Chip } from "@/components/ui/Chip";
import { occupancyTone } from "./parts";

export function UnitTable({ dict, units, base, locale, showProperty }: { dict: Dictionary; units: PmUnitRow[]; base: string; locale: string; showProperty?: boolean }) {
  const t = dict.pm.units.fields;
  return (
    <div className="overflow-x-auto rounded-panel border border-line">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-surface-sunk text-start text-ink-muted">
          <tr>
            <th scope="col" className="px-4 py-3 text-start font-medium">{t.code}</th>
            {showProperty && <th scope="col" className="px-4 py-3 text-start font-medium">{t.property}</th>}
            <th scope="col" className="px-4 py-3 text-start font-medium">{t.unitType}</th>
            <th scope="col" className="px-4 py-3 text-start font-medium">{t.bedrooms}</th>
            <th scope="col" className="px-4 py-3 text-start font-medium">{t.occupancy}</th>
            <th scope="col" className="px-4 py-3 text-start font-medium">{t.lease}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-surface">
          {units.map((u) => (
            <tr key={u.id} className="hover:bg-gulf-tint">
              <th scope="row" className="px-4 py-3 text-start font-medium">
                <Link href={`${base}/portfolio/units/${u.id}`} className="text-gulf-strong underline-offset-4 hover:underline">{u.code}</Link>
                {u.isSample && <span className="ms-2"><SampleBadge dict={dict} /></span>}
              </th>
              {showProperty && <td className="px-4 py-3">{u.propertyName}</td>}
              <td className="px-4 py-3">{dict.pm.unitTypes[u.unitType]}</td>
              <td className="px-4 py-3 tabular-nums">{u.bedrooms === 0 ? dict.pm.units.studio : u.bedrooms ?? "—"}</td>
              <td className="px-4 py-3">{u.occupancy ? <Chip tone={occupancyTone(u.occupancy)}>{dict.pm.occupancy[u.occupancy]}</Chip> : "—"}</td>
              <td className="px-4 py-3">
                {u.activeLease ? (
                  <Link href={`${base}/leasing/${u.activeLease.id}`} className="text-gulf-strong underline-offset-4 hover:underline">
                    {u.activeLease.tenantName} · {day(u.activeLease.endDate, locale)}
                  </Link>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
