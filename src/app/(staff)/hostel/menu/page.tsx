import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { getSetting, WEEKDAYS } from "@/lib/settings";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { MenuForm } from "./menu-form";

export const metadata = { title: "Mess menu" };

export default async function MenuPage() {
  const user = await requireUser("hostel.view");
  const menu = await getSetting("hostelMenu", user.branchId);
  return (
    <>
      <PageHeader title="Mess menu" description="The weekly menu served in the hostel mess." breadcrumbs={[{ label: "Hostel", href: "/hostel" }, { label: "Mess menu" }]} />
      {hasPerm(user, "hostel.manage") ? <MenuForm menu={menu} /> : (
        <Card>
          <Table>
            <THead><tr><TH>Day</TH><TH>Breakfast</TH><TH>Lunch</TH><TH>Snacks</TH><TH>Dinner</TH></tr></THead>
            <TBody>{WEEKDAYS.map((d) => <TR key={d}><TD className="font-medium text-ink">{d}</TD><TD>{menu[d]?.breakfast || "—"}</TD><TD>{menu[d]?.lunch || "—"}</TD><TD>{menu[d]?.snacks || "—"}</TD><TD>{menu[d]?.dinner || "—"}</TD></TR>)}</TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
