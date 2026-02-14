import { useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCustomerSearch, CustomerSearchResult } from "@/hooks/use-sales-data";
import { User, Phone, Mail, Search, CheckCircle2, Loader2 } from "lucide-react";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const update = useCallback(
    (field: keyof LeadIntakeData, value: string | boolean) => {
      onChange({ ...data, [field]: value });
    },
    [data, onChange]
  );

  const { data: searchResults, isLoading: searching } = useCustomerSearch(searchQuery) as { data: CustomerSearchResult[] | undefined; isLoading: boolean };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelectResult = (result: CustomerSearchResult) => {
    onChange({
      ...data,
      firstName: result.firstName,
      lastName: result.lastName,
      email: result.email,
      phone: result.phone,
      isExistingCustomer: true,
    });
    setSearchQuery("");
    setShowResults(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-2">
        <User className="w-5 h-5 text-emerald-600" />
        <h2 className="text-lg font-semibold text-gray-900">Lead Intake</h2>
      </div>

      {/* Customer Search */}
      <div ref={searchRef} className="relative">
        <Label className="text-gray-600 mb-2 block">Search Customers</Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setShowResults(true); }}
            onFocus={() => setShowResults(true)}
            placeholder="Search by name, email, or phone..."
            className="bg-white border-gray-300 text-gray-900 pl-9"
          />
          {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 animate-spin" />}
        </div>

        {showResults && searchQuery.length >= 2 && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-64 overflow-y-auto">
            {searching && !(searchResults && searchResults.length > 0) && (
              <div className="p-3 text-sm text-gray-500 text-center">Searching...</div>
            )}
            {!searching && searchResults && searchResults.length === 0 && (
              <div className="p-3 text-sm text-gray-500 text-center">No results found</div>
            )}
            {searchResults?.map((r) => (
              <button
                key={r.email}
                onClick={() => handleSelectResult(r)}
                className="w-full text-left p-3 hover:bg-gray-100 transition-colors border-b border-gray-200 last:border-0"
              >
                <div className="flex items-center justify-between">
                  <span className="text-gray-900 font-medium text-sm">
                    {r.firstName} {r.lastName}
                  </span>
                  <Badge className={`text-xs ${r.badgeColor}`}>{r.badge}</Badge>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{r.email}{r.phone ? ` • ${r.phone}` : ""}</div>
                {r.bookingCount && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    {r.bookingCount} booking{r.bookingCount > 1 ? "s" : ""}
                    {r.lastDate ? ` • Last: ${r.lastDate}` : ""}
                    {r.serviceType ? ` • ${r.serviceType}` : ""}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label className="text-gray-600">Lead Source</Label>
          <Select value={data.source} onValueChange={(v) => update("source", v)}>
            <SelectTrigger className="bg-white border-gray-300 text-gray-900">
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
          <Label className="text-gray-600">Contact Channel</Label>
          <Select value={data.channel} onValueChange={(v) => { update("channel", v); update("activeChannel", v); }}>
            <SelectTrigger className="bg-white border-gray-300 text-gray-900">
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
          <Label className="text-gray-600">Active Channel Now</Label>
          <Select value={data.activeChannel} onValueChange={(v) => update("activeChannel", v)}>
            <SelectTrigger className="bg-white border-gray-300 text-gray-900">
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
          <Label className="text-gray-600">First Name</Label>
          <Input
            value={data.firstName}
            onChange={(e) => update("firstName", e.target.value)}
            placeholder="First name"
            className="bg-white border-gray-300 text-gray-900"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-gray-600">Last Name</Label>
          <Input
            value={data.lastName}
            onChange={(e) => update("lastName", e.target.value)}
            placeholder="Last name"
            className="bg-white border-gray-300 text-gray-900"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-gray-600">Phone</Label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={data.phone}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="(555) 123-4567"
              className="bg-white border-gray-300 text-gray-900 pl-9"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-gray-600">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={data.email}
              onChange={(e) => update("email", e.target.value)}
              placeholder="lead@email.com"
              className="bg-white border-gray-300 text-gray-900 pl-9"
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
          <Label className="text-gray-600">Existing Customer?</Label>
        </div>
        {data.isExistingCustomer && (
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" /> Marked as existing
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-gray-600">Notes</Label>
        <Textarea
          value={data.notes}
          onChange={(e) => update("notes", e.target.value)}
          placeholder="Jot anything the lead says — pain points, timeline, specific needs..."
          className="bg-white border-gray-300 text-gray-900 min-h-[80px]"
        />
      </div>
    </div>
  );
}
