"use client";

// ─── Spin up an STR / Partnership onboarding link ─────────────────────────
//
// Admin/VA tool for the internal booking + partner ops screens. Generates a
// (optionally prefilled) link to the host onboarding form
// (partner.novaracleaning.com/partner/onboarding) that the rep can copy,
// open, or text/email to a prospective STR host. The host finishes the form,
// gets a portal account on the spot, and lands in their dashboard.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  RiLink, RiFileCopyLine, RiExternalLinkLine, RiCheckLine, RiSparkling2Line,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { buildOnboardingLink } from "@/lib/host-onboarding/link";
import { SERVICE_ZONES } from "@/lib/host-onboarding/types";

interface Props {
  /** Optional prefill (e.g. from the booking customer in context). */
  name?: string;
  email?: string;
  phone?: string;
  zone?: string;
  /** Attribution tag baked into the link (?ref=). */
  refTag?: string;
  /** Render a compact/full trigger button. */
  variant?: "outline" | "default";
  size?: "sm" | "default";
  className?: string;
}

const NONE = "__none__";

export function PartnerOnboardingLinkDialog({
  name = "", email = "", phone = "", zone = "", refTag = "internal-booking",
  variant = "outline", size = "sm", className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [n, setN] = useState(name);
  const [e, setE] = useState(email);
  const [p, setP] = useState(phone);
  const [z, setZ] = useState(zone);

  // Keep fields in sync when the dialog is (re)opened with new context.
  const openWith = (v: boolean) => {
    if (v) { setN(name); setE(email); setP(phone); setZ(zone); setCopied(false); }
    setOpen(v);
  };

  const link = useMemo(
    () => buildOnboardingLink({ name: n, email: e, phone: p, zone: z, ref: refTag }),
    [n, e, p, z, refTag],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Onboarding link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select and copy the link manually.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={openWith}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <RiSparkling2Line className="mr-1.5 h-4 w-4" />
          STR / Partnership onboarding
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiLink className="h-5 w-5 text-violet-600" />
            Spin up an onboarding link
          </DialogTitle>
          <DialogDescription>
            Generate a personalized STR / Partnership host onboarding link. The host
            sets up properties + a portal account in one flow; you set rates after.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-700">Host name (optional)</Label>
              <Input value={n} onChange={(ev) => setN(ev.target.value)} placeholder="Jane Host" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-700">Phone (optional)</Label>
              <Input value={p} onChange={(ev) => setP(ev.target.value)} placeholder="(301) 555-0100" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-700">Email (optional)</Label>
            <Input value={e} onChange={(ev) => setE(ev.target.value)} placeholder="host@email.com" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-700">Service zone (optional)</Label>
            <Select value={z || NONE} onValueChange={(v) => setZ(v === NONE ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Any zone" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Any zone</SelectItem>
                {SERVICE_ZONES.map((zone) => (
                  <SelectItem key={zone} value={zone}>{zone}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-700">Link</Label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600 break-all">
              {link}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={copy} className="flex-1 bg-violet-600 hover:bg-violet-700 text-white">
              {copied ? <RiCheckLine className="mr-1.5 h-4 w-4" /> : <RiFileCopyLine className="mr-1.5 h-4 w-4" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button variant="outline" asChild className="flex-1">
              <a href={link} target="_blank" rel="noreferrer">
                <RiExternalLinkLine className="mr-1.5 h-4 w-4" /> Open
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PartnerOnboardingLinkDialog;
