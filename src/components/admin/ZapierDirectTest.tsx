import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const ZapierDirectTest = () => {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const handleTrigger = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!webhookUrl) {
      toast.error("Please enter your Zapier webhook URL");
      return;
    }

    setLoading(true);
    const testId = Math.random().toString(36).slice(2, 10);
    const timestamp = new Date().toISOString();

    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        mode: "no-cors",
        body: JSON.stringify({
          type: "direct_test",
          test_id: testId,
          timestamp,
          note: "Sent from /admin/webhooks ZapierDirectTest",
        }),
      });

      toast.success("Request sent", {
        description: `Check your Zap history for test_id ${testId}`,
      });
    } catch (error) {
      console.error("Error triggering webhook:", error);
      toast.error("Failed to trigger the Zapier webhook");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleTrigger} className="flex items-center gap-3">
      <Input
        placeholder="https://hooks.zapier.com/hooks/catch/..."
        value={webhookUrl}
        onChange={(e) => setWebhookUrl(e.target.value)}
      />
      <Button type="submit" disabled={loading} variant="outline">
        {loading ? "Sending..." : "Send sample to URL"}
      </Button>
    </form>
  );
};

export default ZapierDirectTest;
