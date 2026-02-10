"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Send, Users } from "lucide-react";
import { useWebhookHistory } from "@/contexts/WebhookHistoryContext";

export const WebhookTestButton = () => {
  const [bookingLoading, setBookingLoading] = useState(false);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const { addEntry } = useWebhookHistory();

  const handleTest = async (type: 'booking' | 'dispatch') => {
    const setLoading = type === 'booking' ? setBookingLoading : setDispatchLoading;
    
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("test-zapier-webhook", {
        body: { type }
      });

      if (error) throw error;

      // Add to history if webhook data is available
      if (data?.webhookData) {
        addEntry({
          type: type === 'booking' ? 'booking' : 'job',
          payload: data.webhookData.payload || {},
          response: data.webhookData.response || { status: 200, body: "" },
          webhookUrl: data.webhookData.webhookUrl || "",
        });
      }

      const idLabel = type === 'booking' ? 'Booking ID' : 'Job ID';
      const id = type === 'booking' ? data.bookingId : data.jobId;

      toast.success(`Test ${type} webhook sent successfully`, {
        description: `${idLabel}: ${id}. Check your Zapier dashboard.`,
      });
    } catch (error: any) {
      toast.error(`Failed to send test ${type} webhook`, {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Button 
        onClick={() => handleTest('booking')} 
        disabled={bookingLoading || dispatchLoading} 
        variant="outline"
      >
        <Send className="mr-2 h-4 w-4" />
        {bookingLoading ? "Sending..." : "Test Booking Webhook"}
      </Button>
      
      <Button 
        onClick={() => handleTest('dispatch')} 
        disabled={bookingLoading || dispatchLoading} 
        variant="outline"
      >
        <Users className="mr-2 h-4 w-4" />
        {dispatchLoading ? "Sending..." : "Test Dispatch Webhook"}
      </Button>
    </div>
  );
};
