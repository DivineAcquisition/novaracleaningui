import { useState, useMemo } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { LeadIntakeSection, LeadIntakeData } from "@/components/sales/LeadIntakeSection";
import { QualificationSection, QualificationData } from "@/components/sales/QualificationSection";
import { LiveQuotePanel } from "@/components/sales/LiveQuotePanel";
import { SalesAssistPanel } from "@/components/sales/SalesAssistPanel";
import { BookingConfirmationSection } from "@/components/sales/BookingConfirmationSection";
import { FollowUpScheduler } from "@/components/sales/FollowUpScheduler";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Headset, Save, CheckCircle, BarChart3 } from "lucide-react";
import { useNavigate } from "react-router-dom";

const initialLead: LeadIntakeData = {
  firstName: "", lastName: "", phone: "", email: "",
  source: "Website", channel: "Phone Call", activeChannel: "Phone Call",
  notes: "", isExistingCustomer: false,
};

const initialQualification: QualificationData = {
  serviceType: "standard", propertyType: "", bedrooms: 0, bathrooms: 0,
  sqft: "", homeSizeId: "", zipCode: "", frequency: "One-Time",
  preferredDate: "", preferredTime: "", specialRequests: "", urgency: "", addOns: [],
};

export default function SalesTool() {
  const navigate = useNavigate();
  const [lead, setLead] = useState<LeadIntakeData>(initialLead);
  const [qual, setQual] = useState<QualificationData>(initialQualification);
  const [saving, setSaving] = useState(false);
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);

  const currentStep = useMemo(() => {
    if (!qual.serviceType) return "service_type";
    if (!qual.homeSizeId) return "home_size";
    if (!qual.zipCode || qual.zipCode.length < 5) return "zip_validation";
    if (!qual.frequency || qual.frequency === "One-Time") return "frequency";
    return "price_presentation";
  }, [qual]);

  const isNewCustomer = !lead.isExistingCustomer;

  const handleSaveLead = async () => {
    if (!lead.firstName || !lead.lastName) {
      toast.error("Lead name is required");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.from("leads").insert({
        first_name: lead.firstName, last_name: lead.lastName,
        phone: lead.phone || null, email: lead.email || null,
        source: lead.source, channel: lead.channel,
        active_channel: lead.activeChannel, notes: lead.notes || null,
        is_existing_customer: lead.isExistingCustomer,
        service_type: qual.serviceType || null, property_type: qual.propertyType || null,
        bedrooms: qual.bedrooms || null, bathrooms: qual.bathrooms || null,
        sqft: qual.sqft ? parseInt(qual.sqft) : null, zip_code: qual.zipCode || null,
        frequency: qual.frequency || null, preferred_date: qual.preferredDate || null,
        preferred_time: qual.preferredTime || null, special_requests: qual.specialRequests || null,
        urgency: qual.urgency || null, status: "new",
      } as any).select().single();

      if (error) throw error;
      if (data) {
        setSavedLeadId((data as any).id);
        await supabase.from("lead_activity_log").insert({
          lead_id: (data as any).id, action: "created",
          notes: `Lead created from ${lead.source} via ${lead.channel}`,
        } as any);
      }
      toast.success("Lead saved!");
    } catch (err: any) {
      toast.error("Failed to save lead: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setLead(initialLead);
    setQual(initialQualification);
    setSavedLeadId(null);
    setBooked(false);
  };

  return (
    <AdminLayout>
      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Headset className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Sales Closer</h1>
              <p className="text-sm text-slate-400">Guided deal-closing dashboard</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => navigate("/admin/pipeline")}
              className="border-slate-600 text-slate-300"
            >
              <BarChart3 className="w-4 h-4 mr-2" /> Pipeline
            </Button>
            {savedLeadId && (
              <Button variant="outline" onClick={handleReset} className="border-slate-600 text-slate-300">
                New Lead
              </Button>
            )}
            <Button
              onClick={handleSaveLead}
              disabled={saving || !!savedLeadId || !lead.firstName}
              className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
            >
              {savedLeadId ? (
                <><CheckCircle className="w-4 h-4 mr-2" /> Saved</>
              ) : (
                <><Save className="w-4 h-4 mr-2" /> Save Lead</>
              )}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Main content */}
          <div className="space-y-6">
            <Card className="bg-slate-900 border-slate-800 p-6">
              <LeadIntakeSection data={lead} onChange={setLead} />
            </Card>

            <Card className="bg-slate-900 border-slate-800 p-6">
              <QualificationSection data={qual} onChange={setQual} />
            </Card>

            {/* Booking Confirmation - only show after lead is saved */}
            {savedLeadId && !booked && (
              <Card className="bg-slate-900 border-slate-800 p-6">
                <BookingConfirmationSection
                  leadId={savedLeadId}
                  lead={lead}
                  qualification={qual}
                  isNewCustomer={isNewCustomer}
                  onBooked={() => setBooked(true)}
                />
              </Card>
            )}
          </div>

          {/* Sticky Sidebar */}
          <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <Card className="bg-slate-900 border-slate-800 p-4">
              <LiveQuotePanel
                homeSizeId={qual.homeSizeId}
                serviceType={qual.serviceType}
                frequency={qual.frequency}
                addOns={qual.addOns}
                isNewCustomer={isNewCustomer}
                bedrooms={qual.bedrooms}
                bathrooms={qual.bathrooms}
                leadEmail={lead.email}
              />
            </Card>

            {/* Follow-Up Scheduler - show after lead saved */}
            {savedLeadId && (
              <Card className="bg-slate-900 border-slate-800 p-4">
                <FollowUpScheduler
                  leadId={savedLeadId}
                  leadName={lead.firstName || "there"}
                  activeChannel={lead.activeChannel}
                />
              </Card>
            )}

            <Card className="bg-slate-900 border-slate-800 p-4">
              <SalesAssistPanel
                activeChannel={lead.activeChannel}
                currentStep={currentStep}
              />
            </Card>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
