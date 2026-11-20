import { describe, expect, it } from "vitest";
import { LEAD_ROLES, PUBLISH_ROLES, SUPPORT_ROLES, VIEWING_ROLES } from "./marketplace";

describe("customer request roles", () => {
  it("lists who handles customer requests and who publishes", () => {
    expect(LEAD_ROLES).toEqual(["brokerage_admin", "brokerage_manager", "developer_admin", "developer_sales_manager", "pm_admin", "pm_leasing_manager"]);
    expect(VIEWING_ROLES).toEqual(LEAD_ROLES);
    expect(PUBLISH_ROLES).toEqual(["developer_admin", "developer_sales_manager", "pm_admin", "pm_leasing_manager"]);
    expect(SUPPORT_ROLES).toEqual(["platform_admin", "platform_support"]);
  });
  it("never lets customers or agents read other customers' requests", () => {
    for (const r of ["individual", "brokerage_agent", "developer_finance", "pm_maintenance_coordinator", "pm_finance"]) expect(LEAD_ROLES).not.toContain(r);
  });
});
