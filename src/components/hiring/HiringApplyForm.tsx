"use client";

// ─── Public hiring application form ─────────────────────────────────────────
//
// Posts to /api/hiring/apply → cleaner_applicants (stage=applicant). Keeps the
// existing Talent pipeline without requiring a Framer/Fillout front door.

import { useState } from "react";
import {
  RiCheckboxCircleFill,
  RiLoader4Line,
  RiMailLine,
  RiPhoneLine,
  RiUserLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPhoneNumber } from "@/lib/input-formatters";
import {
  HIRING_ROLES,
  type HiringRoleId,
  applicantRoleLabel,
} from "@/lib/hiring/roles";
import { HIRING_GRADIENT } from "@/components/hiring/HiringChrome";
import { cn } from "@/lib/utils";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM",
  "NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA",
  "WV","WI","WY",
];

interface Props {
  defaultRole?: HiringRoleId;
  className?: string;
  compact?: boolean;
}

export function HiringApplyForm({ defaultRole = "field-tech", className, compact }: Props) {
  const [roleId, setRoleId] = useState<HiringRoleId>(defaultRole);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");
  const [state, setState] = useState("MD");
  const [experience, setExperience] = useState("");
  const [availability, setAvailability] = useState("");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!consent) {
      setError("Please confirm you’re authorized to work and agree to 1099 contractor terms.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/hiring/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleId,
          firstName,
          lastName,
          email,
          phone,
          zipCode: zip,
          state,
          experience,
          availability,
          note,
          consent1099: true,
          authorizedToWork: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) throw new Error(data.error || "Could not submit your application.");
      setDone(true);
    } catch (err) {
      setError((err as Error).message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-emerald-200 bg-emerald-50/80 px-6 py-8 text-center",
          className,
        )}
      >
        <RiCheckboxCircleFill className="mx-auto h-10 w-10 text-emerald-600" />
        <h3 className="mt-3 font-jakarta text-xl font-bold text-slate-900">Application received</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Thanks for applying for <span className="font-semibold">{applicantRoleLabel(roleId)}</span>.
          Our recruiting team reviews every submission and will reach out when it’s a fit —
          including evergreen roles, which we fill when demand opens.
        </p>
      </div>
    );
  }

  return (
    <form
      id="apply"
      onSubmit={submit}
      className={cn(
        "scroll-mt-24 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_12px_40px_-24px_rgba(15,23,42,0.25)] sm:p-7",
        className,
      )}
    >
      <div className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5C0FFE]">Apply</p>
        <h3 className="mt-1 font-jakarta text-xl font-bold text-slate-900 sm:text-2xl">
          Start your application
        </h3>
        {!compact && (
          <p className="mt-1.5 text-sm text-slate-500">
            Takes about two minutes. We’ll follow up when we’re ready to screen.
          </p>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-slate-700">Role</Label>
          <Select value={roleId} onValueChange={(v) => setRoleId(v as HiringRoleId)}>
            <SelectTrigger className="h-11 border-slate-200 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HIRING_ROLES.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.title}
                  {r.evergreen ? " (evergreen)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="hire-first" className="text-slate-700">First name</Label>
            <div className="relative">
              <RiUserLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="hire-first"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="h-11 border-slate-200 pl-10"
                placeholder="Jordan"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hire-last" className="text-slate-700">Last name</Label>
            <Input
              id="hire-last"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="h-11 border-slate-200"
              placeholder="Lee"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="hire-email" className="text-slate-700">Email</Label>
            <div className="relative">
              <RiMailLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="hire-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 border-slate-200 pl-10"
                placeholder="you@email.com"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hire-phone" className="text-slate-700">Phone</Label>
            <div className="relative">
              <RiPhoneLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="hire-phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
                className="h-11 border-slate-200 pl-10"
                placeholder="(301) 555-0123"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="hire-zip" className="text-slate-700">ZIP code</Label>
            <Input
              id="hire-zip"
              required
              inputMode="numeric"
              maxLength={5}
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
              className="h-11 border-slate-200"
              placeholder="20814"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-700">State</Label>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger className="h-11 border-slate-200 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {US_STATES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="hire-exp" className="text-slate-700">Cleaning experience</Label>
          <Textarea
            id="hire-exp"
            required
            value={experience}
            onChange={(e) => setExperience(e.target.value)}
            className="min-h-[88px] border-slate-200"
            placeholder="Years of experience, residential vs commercial, specialty work…"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="hire-avail" className="text-slate-700">Availability</Label>
          <Input
            id="hire-avail"
            required
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
            className="h-11 border-slate-200"
            placeholder="e.g. Weekdays after 9am, weekends open"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="hire-note" className="text-slate-700">Anything else? (optional)</Label>
          <Textarea
            id="hire-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-[72px] border-slate-200"
            placeholder="Transportation, preferred zones, specialty skills…"
          />
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-[#5C0FFE] focus:ring-[#8F7BFD]"
          />
          <span>
            I’m authorized to work in the U.S. and understand this is a 1099 independent contractor
            role (not W-2 employment).
          </span>
        </label>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={submitting}
          className="h-12 w-full font-semibold text-white shadow-[0_12px_28px_-14px_rgba(92,15,254,0.65)] hover:opacity-95"
          style={{ background: HIRING_GRADIENT }}
        >
          {submitting ? (
            <>
              <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
              Submitting…
            </>
          ) : (
            "Submit application"
          )}
        </Button>
      </div>
    </form>
  );
}
