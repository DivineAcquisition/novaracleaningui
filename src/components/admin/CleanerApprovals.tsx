/**
 * Cleaner Approvals Component
 * 
 * Admin component to review and approve/reject new cleaner applications.
 * Shows pending applications with all their details.
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  User,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Briefcase,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  AlertCircle,
  Shield,
  Star
} from "lucide-react";

interface PendingCleaner {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  state: string;
  home_zip: string;
  max_travel_miles: number;
  preferred_work_days: string[];
  skillset: string[];
  pay_rate_hr: number;
  avatar_url: string | null;
  applied_at: string;
  onboarding_complete: boolean;
}

export default function CleanerApprovals() {
  const [pendingCleaners, setPendingCleaners] = useState<PendingCleaner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  
  // Rejection dialog
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; cleaner: PendingCleaner | null }>({
    open: false,
    cleaner: null
  });
  const [rejectionReason, setRejectionReason] = useState("");
  
  // Approval notes
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    loadPendingCleaners();

    // Real-time updates
    const channel = supabase
      .channel('cleaner-approvals')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cleaners' },
        () => loadPendingCleaners()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadPendingCleaners = async () => {
    try {
      const { data, error } = await supabase
        .from("cleaners")
        .select("*")
        .eq("status", "pending_approval")
        .eq("approved", false)
        .eq("onboarding_complete", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPendingCleaners(data || []);
    } catch (error) {
      console.error("Error loading pending cleaners:", error);
      toast.error("Failed to load pending applications");
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (cleaner: PendingCleaner) => {
    setProcessingId(cleaner.id);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Update cleaner record
      const { error } = await supabase
        .from("cleaners")
        .update({
          approved: true,
          status: "active",
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          activated_at: new Date().toISOString(),
          application_notes: approvalNotes[cleaner.id] || null
        })
        .eq("id", cleaner.id);

      if (error) throw error;

      // Send approval email
      try {
        await supabase.functions.invoke("send-cleaner-approval-email", {
          body: {
            cleanerId: cleaner.id,
            email: cleaner.email,
            firstName: cleaner.first_name,
            approved: true
          }
        });
      } catch (emailError) {
        console.warn("Failed to send approval email:", emailError);
      }

      toast.success(`${cleaner.first_name} ${cleaner.last_name} has been approved!`);
      setPendingCleaners(prev => prev.filter(c => c.id !== cleaner.id));
    } catch (error) {
      console.error("Error approving cleaner:", error);
      toast.error("Failed to approve cleaner");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectDialog.cleaner) return;
    
    if (!rejectionReason.trim()) {
      toast.error("Please provide a rejection reason");
      return;
    }

    const cleaner = rejectDialog.cleaner;
    setProcessingId(cleaner.id);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Update cleaner record
      const { error } = await supabase
        .from("cleaners")
        .update({
          approved: false,
          status: "rejected",
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          rejection_reason: rejectionReason
        })
        .eq("id", cleaner.id);

      if (error) throw error;

      // Send rejection email
      try {
        await supabase.functions.invoke("send-cleaner-approval-email", {
          body: {
            cleanerId: cleaner.id,
            email: cleaner.email,
            firstName: cleaner.first_name,
            approved: false,
            reason: rejectionReason
          }
        });
      } catch (emailError) {
        console.warn("Failed to send rejection email:", emailError);
      }

      toast.success(`${cleaner.first_name} ${cleaner.last_name}'s application has been rejected`);
      setPendingCleaners(prev => prev.filter(c => c.id !== cleaner.id));
      setRejectDialog({ open: false, cleaner: null });
      setRejectionReason("");
    } catch (error) {
      console.error("Error rejecting cleaner:", error);
      toast.error("Failed to reject application");
    } finally {
      setProcessingId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-[#5500FF]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Cleaner Approvals</h2>
          <p className="text-muted-foreground">Review and approve new contractor applications</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-lg px-3 py-1">
            {pendingCleaners.length} Pending
          </Badge>
          <Button variant="outline" size="sm" onClick={loadPendingCleaners}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Pending Applications */}
      {pendingCleaners.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">All Caught Up!</h3>
            <p className="text-muted-foreground">No pending applications to review</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {pendingCleaners.map((cleaner) => (
            <Card key={cleaner.id} className="border-[#5500FF]/20">
              <CardContent className="p-6">
                <div className="flex flex-col lg:flex-row gap-6">
                  {/* Avatar & Basic Info */}
                  <div className="flex items-start gap-4">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center text-white text-2xl font-bold overflow-hidden">
                      {cleaner.avatar_url ? (
                        <img src={cleaner.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        `${cleaner.first_name[0]}${cleaner.last_name[0]}`
                      )}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">
                        {cleaner.first_name} {cleaner.last_name}
                      </h3>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                        <Clock className="w-4 h-4" />
                        Applied {formatDate(cleaner.applied_at)}
                      </div>
                      <Badge variant="secondary" className="mt-2 bg-yellow-100 text-yellow-800">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Pending Review
                      </Badge>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Contact Info */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <span>{cleaner.email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="w-4 h-4 text-muted-foreground" />
                        <span>{cleaner.phone}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <span>{cleaner.state} {cleaner.home_zip} · {cleaner.max_travel_miles} mi radius</span>
                      </div>
                    </div>

                    {/* Work Preferences */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <div className="flex flex-wrap gap-1">
                          {cleaner.preferred_work_days?.map(day => (
                            <Badge key={day} variant="outline" className="text-xs">
                              {day}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Briefcase className="w-4 h-4 text-muted-foreground" />
                        <span>${cleaner.pay_rate_hr}/hr starting rate</span>
                      </div>
                    </div>

                    {/* Skills */}
                    <div className="col-span-full">
                      <p className="text-xs text-muted-foreground mb-1">Skills:</p>
                      <div className="flex flex-wrap gap-1">
                        {cleaner.skillset?.map(skill => (
                          <Badge key={skill} variant="secondary" className="bg-[#5500FF]/10 text-[#5500FF] text-xs">
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Notes Input */}
                    <div className="col-span-full">
                      <Input
                        placeholder="Add notes (optional)"
                        value={approvalNotes[cleaner.id] || ""}
                        onChange={(e) => setApprovalNotes(prev => ({ ...prev, [cleaner.id]: e.target.value }))}
                        className="text-sm"
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex lg:flex-col gap-2 lg:justify-center">
                    <Button
                      onClick={() => handleApprove(cleaner)}
                      disabled={processingId === cleaner.id}
                      className="bg-green-600 hover:bg-green-700 flex-1 lg:flex-none"
                    >
                      {processingId === cleaner.id ? (
                        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                      )}
                      Approve
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => setRejectDialog({ open: true, cleaner })}
                      disabled={processingId === cleaner.id}
                      className="flex-1 lg:flex-none"
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Reject
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Rejection Dialog */}
      <Dialog open={rejectDialog.open} onOpenChange={(open) => setRejectDialog({ open, cleaner: rejectDialog.cleaner })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Application</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting {rejectDialog.cleaner?.first_name}'s application.
              This will be sent to them via email.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for rejection..."
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog({ open: false, cleaner: null })}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleReject}
              disabled={processingId === rejectDialog.cleaner?.id}
            >
              {processingId === rejectDialog.cleaner?.id ? (
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
