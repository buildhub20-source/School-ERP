import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import { isoDate } from "@/lib/format";

type BusLike = { id: string; busNo: string; registrationNo: string; capacity: number; make: string | null; model: string | null; year: number | null; odometerKm: number; serviceIntervalKm: number; serviceIntervalDays: number; lastServiceDate: Date | null; lastServiceKm: number | null };

export function BusFields({ bus }: { bus?: BusLike }) {
  return (
    <>
      {bus && <input type="hidden" name="id" value={bus.id} />}
      <FormGrid>
        <Field label="Bus name / number" required><Input name="busNo" defaultValue={bus?.busNo} placeholder="Bus 6" required /></Field>
        <Field label="Registration no" required><Input name="registrationNo" defaultValue={bus?.registrationNo} placeholder="TN 01 AB 1234" required /></Field>
        <Field label="Seating capacity" required><Input name="capacity" type="number" min={1} max={120} defaultValue={bus?.capacity ?? 40} required /></Field>
        <Field label="Odometer (km)"><Input name="odometerKm" type="number" min={0} defaultValue={bus?.odometerKm ?? 0} /></Field>
        <Field label="Make"><Input name="make" defaultValue={bus?.make ?? ""} placeholder="Tata" /></Field>
        <Field label="Model"><Input name="model" defaultValue={bus?.model ?? ""} placeholder="Starbus" /></Field>
        <Field label="Year"><Input name="year" type="number" min={1990} max={2100} defaultValue={bus?.year ?? ""} /></Field>
        <Field label="Service every (km)" required><Input name="serviceIntervalKm" type="number" min={500} defaultValue={bus?.serviceIntervalKm ?? 10000} required /></Field>
        <Field label="Service every (days)" required><Input name="serviceIntervalDays" type="number" min={7} defaultValue={bus?.serviceIntervalDays ?? 180} required /></Field>
        <Field label="Last service date"><Input name="lastServiceDate" type="date" defaultValue={bus?.lastServiceDate ? isoDate(bus.lastServiceDate) : ""} /></Field>
        <Field label="Odometer at last service (km)"><Input name="lastServiceKm" type="number" min={0} defaultValue={bus?.lastServiceKm ?? ""} /></Field>
      </FormGrid>
    </>
  );
}

type StaffLike = { id: string; type: string; name: string; phone: string; licenseNo: string | null; address: string | null };

export function StaffFields({ staff }: { staff?: StaffLike }) {
  return (
    <>
      {staff && <input type="hidden" name="id" value={staff.id} />}
      <FormGrid>
        <Field label="Role" required>
          <Select name="type" defaultValue={staff?.type ?? "DRIVER"}><option value="DRIVER">Driver</option><option value="ATTENDANT">Attendant</option></Select>
        </Field>
        <Field label="Name" required><Input name="name" defaultValue={staff?.name} required /></Field>
        <Field label="Mobile" required hint="Used for app sign-in by OTP"><Input name="phone" inputMode="numeric" defaultValue={staff?.phone} required /></Field>
        <Field label="Driving licence no" hint="Required for drivers"><Input name="licenseNo" defaultValue={staff?.licenseNo ?? ""} /></Field>
      </FormGrid>
      <Field label="Address"><Textarea name="address" defaultValue={staff?.address ?? ""} /></Field>
    </>
  );
}
