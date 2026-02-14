import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CalendarClock, Send, Loader2, CheckCircle } from "lucide-react";

const CHANNELS = ["Phone Call", "Text/SMS", "Email", "Instagram DM", "Facebook DM"];

const FOLLOW_UP_TEMPLATES: Record<string, string> = {
  "Phone Call": "Hi [NAME], this is [VA] from NovaraCleaning following up on your cleaning quote. Do you have a moment to chat?",
  "Text/SMS": "Hi [NAME]! 👋 Following up on your NovaraCleaning quote. Ready to lock in your spot? Reply YES and I'll get you booked!",
  "Email": "Hi [NAME],\n\nJust following up on the cleaning quote we discussed. I wanted to see if you had any questions or if you're ready to book.\n\nWe have availability this week — shall I reserve a spot for you?\n\nBest,\nNovaraCleaning Team",
  "Instagram DM": "Hey [NAME]! 👋 Following up on your cleaning quote. Still interested? I can hold a spot for you this week!",
  "Facebook DM": "Hey [NAME]! Following up from our chat about cleaning services. Ready to get started? 🏠✨",
};

interface FollowUpSchedulerProps {
  leadId: string | null;
  leadName: string;
  activeChannel: string;
}

export function FollowUpScheduler({ leadId, leadName, activeChannel }: FollowUpSchedulerProps) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [channel, setChannel] = useState(activeChannel);
  const [message, setMessage] = useState(
    (FOLLOW_UP_TEMPLATES[activeChannel] || FOLLOW_UP_TEMPLATES["Phone Call"]).replace("[NAME]", leadName)
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleChannelChange = (ch: string) => {
    setChannel(ch);
    setMessage((FOLLOW_UP_TEMPLATES[ch] || "").replace("[NAME]", leadName));
  };

  const handleSave = async () => {
    if (!date) {
      toast.error("Follow-up date is required");
      return;
    }
    if (!leadId) {
      toast.error("Save the lead first before scheduling a follow-up");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("follow_ups").insert({
        lead_id: leadId,
        scheduled_date: date,
        scheduled_time: time || null,
        channel,
        message: message || null,
      } as any);

      if (error) throw error;

      await supabase.from("lead_activity_log").insert({
        lead_id: leadId,
        action: "follow_up_scheduled",
        notes: `Follow-up scheduled for ${date} via ${channel}`,
      } as any);

      toast.success("Follow-up scheduled!");
      setSaved(true);
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="text-center py-6">
        <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
        <p className="text-sm text-white font-medium">Follow-up scheduled</p>
        <p className="text-xs text-slate-400">{date} via {channel}</p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 text-slate-400"
          onClick={() => setSaved(false)}
        >
          Schedule another
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="w-5 h-5 text-amber-400" />
        <h3 className="font-semibold text-white">Schedule Follow-Up</h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-slate-400 text-xs">Date</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-slate-800 border-slate-700 text-white h-9 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-400 text-xs">Time</Label>
          <Input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="bg-slate-800 border-slate-700 text-white h-9 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-slate-400 text-xs">Channel</Label>
        <Select value={channel} onValueChange={handleChannelChange}>
          <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHANNELS.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-slate-400 text-xs">Pre-written Message</Label>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="bg-slate-800 border-slate-700 text-white min-h-[80px] text-sm"
        />
      </div>

      <Button
        onClick={handleSave}
        disabled={saving || !leadId}
        className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold h-9 text-sm"
      >
        {saving ? (
          <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Saving...</>
        ) : (
          <><Send className="w-3 h-3 mr-1" /> Schedule Follow-Up</>
        )}
      </Button>
    </div>
  );
}
