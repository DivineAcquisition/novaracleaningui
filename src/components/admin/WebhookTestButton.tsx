import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { useWebhookHistory } from "@/contexts/WebhookHistoryContext";

export const WebhookTestButton = () => {
  const [loading, setLoading] = useState(false);
  const { addEntry } = useWebhookHistory();

  const handleTest = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("test-zapier-webhook");

      if (error) throw error;

      // Add to history if webhook data is available
      if (data?.webhookData) {
        addEntry({
          type: "test",
          payload: data.webhookData.payload || {},
          response: data.webhookData.response || { status: 200, body: "" },
          webhookUrl: data.webhookData.webhookUrl || "",
        });
      }

      toast.success("Test webhook sent successfully", {
        description: `Job ID: ${data.jobId}. Check your Zapier dashboard.`,
      });
    } catch (error: any) {
      toast.error("Failed to send test webhook", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleTest} disabled={loading} variant="outline">
      <Send className="mr-2 h-4 w-4" />
      {loading ? "Sending..." : "Send Test Webhook"}
    </Button>
  );
};
