import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCustomerLookup, useCustomerBookings } from "@/hooks/use-sales-data";
import { User, Phone, Mail, MessageSquare, Search, CheckCircle2 } from "lucide-react";

const LEAD_SOURCES = [
  "Google Ads", "Facebook", "Instagram DM", "Referral", "Website", "Cold Outreach", "Other"
];

const CONTACT_CHANNELS = [
  "Phone Call", "Text/SMS", "Instagram DM", "Facebook DM", "Email"
];

export interface LeadIntakeData {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  source: string;
  channel: string;
  activeChannel: string;
  notes: string;
  isExistingCustomer: boolean;
}

interface LeadIntakeSectionProps {
  data: LeadIntakeData;
  onChange: (data: LeadIntakeData) => void;
}

export function LeadIntakeSection({ data, onChange }: LeadIntakeSectionProps) {
  const update = useCallback(
    (field: keyof LeadIntakeData, value: string | boolean) => {
      onChange({ ...data, [field]: value });
    },
    [data, onChange]
  );

  const { data: existingCustomer, isLoading: lookingUp } = useCustomerLookup(
    data.isExistingCustomer ? data.email : ""
  );
  const { data: pastBookings } = useCustomerBookings(
    data.isExistingCustomer && existingCustomer ? data.email : ""
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-2">
        <User className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-semibold text-white">Lead Intake</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label className="text-slate-300">Lead Source</Label>
          <Select value={data.source} onValueChange={(v) => update("source", v)}>
            <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
              <SelectValue placeholder="Select source" />
            </SelectTrigger>
            <SelectContent>
              {LEAD_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-300">Contact Channel</Label>
          <Select value={data.channel} onValueChange={(v) => { update("channel", v); update("activeChannel", v); }}>
            <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
              <SelectValue placeholder="How they reached out" />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-300">Active Channel Now</Label>
          <Select value={data.activeChannel} onValueChange={(v) => update("activeChannel", v)}>
            <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
              <SelectValue placeholder="Currently talking via" />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="space-y-2">
          <Label className="text-slate-300">First Name</Label>
          <Input
            value={data.firstName}
            onChange={(e) => update("firstName", e.target.value)}
            placeholder="First name"
            className="bg-slate-800 border-slate-700 text-white"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">Last Name</Label>
          <Input
            value={data.lastName}
            onChange={(e) => update("lastName", e.target.value)}
            placeholder="Last name"
            className="bg-slate-800 border-slate-700 text-white"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">Phone</Label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              value={data.phone}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="(555) 123-4567"
              className="bg-slate-800 border-slate-700 text-white pl-9"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              value={data.email}
              onChange={(e) => update("email", e.target.value)}
              placeholder="lead@email.com"
              className="bg-slate-800 border-slate-700 text-white pl-9"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch
            checked={data.isExistingCustomer}
            onCheckedChange={(v) => update("isExistingCustomer", v)}
          />
          <Label className="text-slate-300">Existing Customer?</Label>
        </div>
        {data.isExistingCustomer && lookingUp && (
          <Badge variant="secondary" className="bg-slate-700 text-slate-300">
            <Search className="w-3 h-3 mr-1 animate-spin" /> Looking up...
          </Badge>
        )}
        {data.isExistingCustomer && existingCustomer && (
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Found: {existingCustomer.first_name} {existingCustomer.last_name} • {pastBookings?.length || 0} bookings
          </Badge>
        )}
        {data.isExistingCustomer && !lookingUp && !existingCustomer && data.email.includes("@") && (
          <Badge variant="secondary" className="bg-amber-500/20 text-amber-400 border-amber-500/30">
            No customer record found
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-slate-300">Notes</Label>
        <Textarea
          value={data.notes}
          onChange={(e) => update("notes", e.target.value)}
          placeholder="Jot anything the lead says — pain points, timeline, specific needs..."
          className="bg-slate-800 border-slate-700 text-white min-h-[80px]"
        />
      </div>
    </div>
  );
}
